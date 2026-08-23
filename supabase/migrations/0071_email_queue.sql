-- ============================================================
-- AUTO.RS — Миграция 0071: очередь исходящих писем
-- ============================================================
-- ЗАЧЕМ. До сих пор единственным каналом уведомлений был пуш в
-- приложение (push_queue → Edge Function send-push). Для сайта этого
-- недостаточно: продавец, подавший объявление через /sell, приложения
-- может не иметь вовсе. Он узнаёт решение модератора только если сам
-- зайдёт в кабинет — то есть, скорее всего, не узнаёт никогда.
--
-- АРХИТЕКТУРА ПОВТОРЯЕТ push_queue ДОСЛОВНО, и это осознанно: та схема
-- уже проверена в бою, а второй, «улучшенный» вариант очереди в одном
-- проекте означал бы два разных набора граблей.
--   * база В СЕТЬ НЕ ХОДИТ. Триггер только кладёт строку в очередь;
--     таймаут почтового провайдера не имеет права заблокировать
--     транзакцию одобрения объявления;
--   * claim_email_batch забирает пачку под FOR UPDATE SKIP LOCKED и
--     сразу увеличивает attempts — параллельные запуски функции не
--     отправят одно письмо дважды;
--   * после 5 неудач задание перестаёт выбираться и остаётся в таблице
--     с текстом ошибки: недоставленное письмо должно быть видно, а не
--     исчезнуть.
--
-- ЧТО ХРАНИМ, А ЧТО НЕТ. В очереди лежит template_key + payload jsonb,
-- а НЕ готовый HTML. Причины две. Во-первых, вёрстка письма меняется
-- чаще, чем события: правка шаблона не должна требовать миграции.
-- Во-вторых, письмо, собранное в момент постановки в очередь, ушло бы
-- с устаревшими данными, если отправка задержалась. Тексты и разметка
-- живут в Edge Function (supabase/functions/send-email/templates.ts).
--
-- ЯЗЫК ПИСЬМА. Хранится в payload.locale. Для писем продавцу берётся
-- из profiles.locale, если поле заполнено, иначе сербский — основной
-- рынок. Для копии обращения — локаль формы, с которой человек писал.
-- ============================================================


-- ============================================================
-- 1) АДРЕС АДМИНИСТРАТОРА — ключ в app_settings
-- ============================================================
-- Заявки салонов и обращения через форму обратной связи уходят на
-- служебный ящик. Адрес — настройка окружения, а не константа кода:
-- на стенде он один, на проде другой. Кладём его туда же, где живёт
-- site_base_url (миграция 0048), — вторая таблица настроек ради одной
-- строки не нужна.
--
-- Значение по умолчанию совпадает с почтой поддержки из lib/legal.ts.
-- Менять командой:
--   select public.set_admin_email('support@rsauto.rs');
insert into public.app_settings (key, value)
values ('admin_email', 'support@rsauto.rs')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- f_admin_email() — адрес служебного ящика
-- ------------------------------------------------------------
-- Отдельная функция, а не подзапрос в каждом триггере: при смене
-- способа хранения править придётся одно место. STABLE достаточно —
-- в пределах запроса значение не меняется.
create or replace function public.f_admin_email()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(btrim((select s.value from public.app_settings s
                   where s.key = 'admin_email')), ''),
    'support@rsauto.rs'          -- страховка, если строку удалили
  );
$$;

comment on function public.f_admin_email()
  is 'Адрес служебного ящика из app_settings. Получатель заявок салонов и обращений';

-- Клиенту адрес администратора незачем: он нужен только триггерам
-- (SECURITY DEFINER выполняется с правами владельца) и Edge Function
-- под service_role. Публичный доступ открыл бы служебный ящик
-- сборщикам спама.
revoke execute on function public.f_admin_email() from anon, authenticated;


-- ------------------------------------------------------------
-- set_admin_email(text) — смена адреса (только администратор)
-- ------------------------------------------------------------
-- Зеркало set_site_base_url из 0048, включая проверку формата: адрес
-- с опечаткой означал бы молча теряемые заявки салонов.
create or replace function public.set_admin_email(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_admin() then
    raise exception 'Смена адреса администратора доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  -- Тот же шаблон проверки, что в submit_contact_message (0058):
  -- две одинаковые по смыслу, но разные по строгости проверки в одной
  -- базе рано или поздно разошлись бы.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'Ожидается корректный адрес электронной почты'
      using errcode = 'check_violation';
  end if;

  insert into public.app_settings (key, value, updated_at)
  values ('admin_email', v_email, now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  return v_email;
end;
$$;

comment on function public.set_admin_email(text)
  is 'Устанавливает адрес служебного ящика (только админ)';

grant execute on function public.set_admin_email(text) to authenticated;


-- ============================================================
-- 2) ТАБЛИЦА: email_queue — очередь исходящих писем
-- ============================================================
-- status вместо булева sent (как в push_queue): у письма есть
-- промежуточное состояние. Пуш либо ушёл, либо нет, а письмо может
-- лежать в очереди, быть отправленным или окончательно провалиться
-- после исчерпания попыток — и «failed» надо отличать от «ещё не
-- пробовали», иначе разбор недоставленных превращается в гадание по
-- полю attempts.
create table if not exists public.email_queue (
  id           uuid        primary key default gen_random_uuid(),

  -- Получатель. Хранится СТРОКОЙ, а не ссылкой на профиль: адрес
  -- фиксируется в момент постановки в очередь. Если человек сменит
  -- почту, пока письмо ждёт отправки, оно всё равно обязано уйти туда,
  -- куда его адресовали, — иначе решение модератора уедет постороннему.
  -- По той же причине адрес админа тоже лежит здесь строкой.
  to_email     text        not null,

  -- Ключ шаблона. Разметка и тексты — в Edge Function; база знает
  -- только имя. Перечень закрыт check-ограничением: опечатка в имени
  -- шаблона иначе создала бы письмо, которое функция молча не
  -- отправит, и никто этого не заметит.
  template_key text        not null,

  -- Данные для подстановки в шаблон: brand, model, car_url, reason,
  -- locale и т.п. Состав зависит от шаблона и описан у каждого
  -- триггера ниже.
  payload      jsonb       not null default '{}'::jsonb,

  -- Получатель-пользователь, если письмо адресовано ему. Нужен только
  -- для разбора («что мы слали этому продавцу»); у писем администратору
  -- поле пустое. ON DELETE SET NULL, а не CASCADE: удаление аккаунта не
  -- должно стирать историю отправленных писем.
  user_id      uuid        references auth.users (id) on delete set null,

  status       text        not null default 'pending',
  attempts     integer     not null default 0,
  -- Идентификатор письма у провайдера (Resend возвращает id). Нужен
  -- для разбора жалоб «письмо не пришло»: по нему видно судьбу
  -- сообщения в панели Resend.
  provider_id  text,
  error        text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),

  constraint chk_email_status check (
    status in ('pending', 'sent', 'failed')
  ),

  constraint chk_email_template check (
    template_key in (
      'car_approved',      -- объявление одобрено, ссылка на карточку
      'car_rejected',      -- отклонено: причина + ссылка на /my
      'contact_received',  -- копия обращения автору
      'contact_admin',     -- обращение — администратору
      'dealer_lead_admin'  -- заявка салона — администратору
    )
  ),

  -- Адрес проверяем и здесь, на уровне таблицы. Триггеры уже
  -- отсеивают пустые значения, но ограничение защищает от строки,
  -- вставленной будущим кодом в обход этой проверки: письмо с битым
  -- адресом всё равно не уйдёт, и лучше узнать об этом при вставке.
  constraint chk_email_to check (
    to_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
  )
);

comment on table public.email_queue
  is 'Очередь исходящих писем. Пишут триггеры, разбирает Edge Function send-email';
comment on column public.email_queue.template_key
  is 'Имя шаблона. Разметка живёт в Edge Function, база хранит только ключ и данные';
comment on column public.email_queue.payload
  is 'Данные подстановки шаблона, включая locale. Состав зависит от template_key';

-- Индекс под главный запрос Edge Function: ожидающие, старые сверху.
-- Частичный — отправленные и провалившиеся в индекс не попадают,
-- он остаётся компактным при любом объёме истории.
create index if not exists idx_email_queue_pending
  on public.email_queue (created_at) where status = 'pending';

-- Индекс под разбор: «что мы слали этому пользователю».
create index if not exists idx_email_queue_user
  on public.email_queue (user_id, created_at desc);


-- ------------------------------------------------------------
-- RLS: deny-all
-- ------------------------------------------------------------
-- RLS включён, политик НЕТ НИ ОДНОЙ — ни select, ни insert. Для anon и
-- authenticated таблица не существует.
--
-- Почему строже, чем у push_queue (там владелец читает свои пуши):
-- в payload писем лежит текст обращения и адрес почты, а у писем
-- администратору — контакты заявителя. Это персональные данные третьих
-- лиц, и доступ к ним из браузера не нужен никому. Пользователю своя
-- история уведомлений видна через notifications — там она без чужих
-- контактов.
--
-- Пишут строки только SECURITY DEFINER триггеры (RLS обходят по
-- определению), читает Edge Function под service_role (RLS к нему не
-- применяется).
alter table public.email_queue enable row level security;

-- Прав на таблицу у клиентских ролей нет и на уровне GRANT — второй
-- рубеж на случай, если однажды кто-то добавит политику по ошибке.
revoke all on table public.email_queue from anon, authenticated;


-- ============================================================
-- 3) ХЕЛПЕР: f_enqueue_email — единственная точка постановки в очередь
-- ============================================================
-- Все триггеры ниже ставят письма только через неё. Причина —
-- проверка адреса: пустой, NULL или синтетический адрес не должен
-- порождать строку очереди, которую Edge Function потом будет пять раз
-- пытаться отправить и пять раз получать отказ провайдера.
--
-- ВОЗВРАЩАЕТ id письма или NULL, если адрес непригоден. NULL — штатный
-- исход, а не ошибка: у продавца, вошедшего по SMS, почты может не быть
-- вовсе (profiles.email = NULL при телефонной авторизации, миграция
-- 0035). Уведомление в колокольчик он в этом случае получит, письмо —
-- нет, и падать транзакции одобрения объявления из-за этого нельзя.
create or replace function public.f_enqueue_email(
  p_to_email     text,
  p_template_key text,
  p_payload      jsonb default '{}'::jsonb,
  p_user_id      uuid  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_to_email, '')));
  v_id    uuid;
begin
  -- Нет адреса или он битый — молча выходим. Проверка ровно та же,
  -- что в ограничении таблицы: не пройдя её здесь, вставка упала бы
  -- на check и уронила транзакцию вызывающего.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return null;
  end if;

  insert into public.email_queue (to_email, template_key, payload, user_id)
  values (v_email, p_template_key, coalesce(p_payload, '{}'::jsonb), p_user_id)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.f_enqueue_email(text, text, jsonb, uuid)
  is 'Ставит письмо в очередь. Возвращает NULL, если адрес отсутствует или битый — это штатный исход';

revoke execute on function public.f_enqueue_email(text, text, jsonb, uuid)
  from anon, authenticated;


-- ============================================================
-- 3b) profiles.email и profiles.locale — адрес и язык для писем
-- ============================================================
-- ПОЧЕМУ ЭТО ЗДЕСЬ. Вход на площадку — по SMS (миграция 0035), поэтому
-- у подавляющего большинства продавцов profiles.email равен NULL:
-- auth.users.email при телефонной авторизации пуст, и триггер
-- handle_new_user честно пишет NULL. Письмо о модерации при этом
-- отправлять НЕКУДА.
--
-- Значит, канал писем без места, где продавец укажет почту,
-- бессмысленен. Колонка email в profiles уже есть и уже необязательна
-- (0035 снял NOT NULL) — трогать её не нужно. Не хватает двух вещей:
--   1) языка, на котором писать письмо;
--   2) права владельца профиля менять свой email — до сих пор он
--      заполнялся только триггером из auth.users, и в кабинете сайта
--      поле выводится нередактируемым.
--
-- ЯЗЫК ПИСЬМА. Отдельная колонка, а не вывод из данных: определить
-- язык человека по объявлению нельзя (контент пишется на языке автора,
-- и серб вполне может написать описание по-русски), а по номеру
-- телефона — тем более. Значение проставляет сайт при сохранении
-- профиля, исходя из локали, на которой человек работает.
-- NULL допустим и означает «не выбирал»: шаблон возьмёт сербский.
alter table public.profiles
  add column if not exists locale text;

-- Ограничение добавляем отдельно и идемпотентно: add column if not
-- exists не умеет добавлять constraint к уже существующей колонке,
-- а повторный прогон миграции падать не должен.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_profiles_locale'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint chk_profiles_locale
      check (locale is null or locale in ('sr', 'ru'));
  end if;
end;
$$;

comment on column public.profiles.locale
  is 'Язык интерфейса и писем: sr | ru. NULL — не выбирал, письма уходят на сербском';

comment on column public.profiles.email
  is 'Почта для уведомлений. При входе по SMS заполняется самим пользователем в кабинете';

-- ------------------------------------------------------------
-- RPC: set_my_contact_email(p_email, p_locale)
-- ------------------------------------------------------------
-- Почему RPC, а не прямой UPDATE под политикой profiles_update_own.
-- Тому две причины, и обе — правила, которым место в базе:
--   * email обязан быть уникальным среди заполненных (частичный
--     уникальный индекс profiles_email_unique из 0035). Прямой UPDATE
--     упал бы с сырой ошибкой нарушения индекса, и сайту пришлось бы
--     разбирать её текст, чтобы сказать «эта почта уже занята»;
--   * пустая строка и NULL должны означать одно и то же — «почты нет».
--     Пустая строка, попав в колонку, нарушила бы уникальность при
--     втором таком же профиле и сломала бы проверку адреса в
--     f_enqueue_email.
--
-- Подтверждения адреса (письмо со ссылкой) здесь НЕТ намеренно: это
-- отдельная задача со своим состоянием и сроком жизни токена. Пока
-- почта используется только для писем самому владельцу профиля, и
-- худшее последствие опечатки — письмо не дойдёт до него самого.
create or replace function public.set_my_contact_email(
  p_email  text,
  p_locale text default null
)
returns table (email text, locale text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_locale text := nullif(btrim(coalesce(p_locale, '')), '');
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Пустая строка = «почты нет». Приводим к NULL до всех проверок:
  -- иначе частичный уникальный индекс посчитал бы две пустые строки
  -- дублем и второй пользователь не смог бы очистить поле.
  if v_email = '' then
    v_email := null;
  elsif v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'Некорректный адрес электронной почты'
      using errcode = 'check_violation';
  elsif length(v_email) > 200 then
    raise exception 'Адрес слишком длинный'
      using errcode = 'check_violation';
  end if;

  if v_locale is not null and v_locale not in ('sr', 'ru') then
    raise exception 'Неизвестный язык: %', v_locale
      using errcode = 'check_violation';
  end if;

  -- Занятость проверяем явно, до UPDATE: сообщение об ошибке должно
  -- быть человеческим, а не текстом нарушения индекса.
  if v_email is not null and exists (
    select 1 from public.profiles p
     where p.email = v_email and p.id <> v_user
  ) then
    raise exception 'Эта почта уже используется другим аккаунтом'
      using errcode = 'unique_violation';
  end if;

  update public.profiles p
     set email      = v_email,
         -- Язык не передали — оставляем прежний: вызов ради смены
         -- почты не должен сбрасывать выбранный язык писем.
         locale     = coalesce(v_locale, p.locale),
         updated_at = now()
   where p.id = v_user;

  return query
    select p.email, p.locale from public.profiles p where p.id = v_user;
end;
$$;

comment on function public.set_my_contact_email(text, text)
  is 'Почта и язык уведомлений текущего пользователя. Пустая строка очищает адрес';

grant execute on function public.set_my_contact_email(text, text) to authenticated;


-- ============================================================
-- 4) ТРИГГЕР: письмо продавцу о решении модерации
-- ============================================================
-- ПОЧЕМУ ТРИГГЕР НА ТАБЛИЦЕ, А НЕ ВСТАВКА ВНУТРИ approve_car/reject_car.
-- Уведомление в колокольчик (миграция 0039) ставится именно внутри этих
-- двух RPC. Для писем такой способ не годится: статус объявления
-- меняется не только ими. Есть прямой UPDATE под политикой
-- cars_update_own (им до сих пор пользуется приложение), есть
-- set_my_car_status (0070), есть update_car_v2, возвращающая объявление
-- на модерацию. Перечислять места вставки письма означало бы
-- гарантированно пропустить одно из них — сегодня или при следующей
-- правке.
--
-- Триггер на самой колонке ловит любой путь по определению. Это и есть
-- принцип толстого бэкенда: правило живёт при данных, а не при каждом
-- вызывающем.
--
-- КАКИЕ ПЕРЕХОДЫ ПОРОЖДАЮТ ПИСЬМО. Только два, и только они интересны
-- продавцу как решение по его объявлению:
--   moderation|rejected → active    «объявление опубликовано»
--   moderation          → rejected  «отклонено», с причиной
--
-- Остальные переходы письма НЕ порождают, и каждый по своей причине:
--   * active → archived|sold — это действие самого продавца, он и так
--     знает, что снял объявление; письмо выглядело бы спамом;
--   * archived|sold → active — возврат из архива, модерации не было;
--   * → moderation — объявление ушло на проверку, решения ещё нет.
create or replace function public.email_on_car_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_locale text;
  v_url    text;
begin
  -- Статус не менялся — выходим сразу, не трогая profiles. Триггер
  -- висит на UPDATE OF status, но Postgres вызывает его и когда
  -- колонку переписали тем же значением.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Интересуют ровно два перехода (см. комментарий выше).
  if not (
    (new.status = 'active'   and old.status in ('moderation', 'rejected'))
    or
    (new.status = 'rejected' and old.status = 'moderation')
  ) then
    return new;
  end if;

  -- Адрес и язык получателя. Профиль читаем ОДНИМ запросом: два
  -- обращения к одной строке ради двух полей — лишний проход по
  -- индексу на каждой модерации.
  select p.email, p.locale
    into v_email, v_locale
    from public.profiles p
   where p.id = new.user_id;

  -- Почты нет (вход по SMS, профиль не заполнен) — письма не будет.
  -- Уведомление в колокольчик поставила approve_car/reject_car, и
  -- продавец увидит решение в кабинете. Это штатный путь, а не ошибка.
  if v_email is null then
    return new;
  end if;

  -- Ссылка собирается тем же f_car_site_url, что и canonical на сайте
  -- (0048): адрес в письме обязан совпадать с адресом в выдаче до
  -- символа, иначе продавец, перейдя из письма, попадёт на дубль.
  v_url := public.f_car_site_url(new.id);

  if new.status = 'active' then
    perform public.f_enqueue_email(
      v_email,
      'car_approved',
      jsonb_build_object(
        'locale',  coalesce(v_locale, 'sr'),
        'brand',   new.brand,
        'model',   new.model,
        'year',    new.year,
        'car_url', v_url
      ),
      new.user_id
    );
  else
    perform public.f_enqueue_email(
      v_email,
      'car_rejected',
      jsonb_build_object(
        'locale', coalesce(v_locale, 'sr'),
        'brand',  new.brand,
        'model',  new.model,
        'year',   new.year,
        -- Причина из moderation_comment — та же строка, что видит
        -- продавец в кабинете и в колокольчике. Пустая причина
        -- допустима: шаблон покажет формулировку по умолчанию, а
        -- выдумывать причину за модератора нельзя.
        'reason', nullif(btrim(coalesce(new.moderation_comment, '')), '')
      ),
      new.user_id
    );
  end if;

  return new;
end;
$$;

comment on function public.email_on_car_moderation()
  is 'Письмо продавцу о решении модерации. На таблице, а не в RPC: статус меняют несколько путей';

drop trigger if exists tg_email_on_car_moderation on public.cars;

create trigger tg_email_on_car_moderation
  after update of status on public.cars
  for each row execute function public.email_on_car_moderation();


-- ============================================================
-- 5) ТРИГГЕР: заявка автосалона — письмо администратору
-- ============================================================
-- Таблица dealer_leads (0053) до сих пор читалась только SQL-запросом:
-- интерфейса разбора заявок нет, и заявка могла пролежать незамеченной
-- неделю. Для формы «стать партнёром» это прямая потеря клиента —
-- салон, не получивший ответа, уходит к конкуренту.
--
-- Письмо уходит на служебный ящик и содержит контакты заявителя: имя,
-- телефон, почту, город и комментарий. Отвечает менеджер вручную,
-- отдельного интерфейса эта миграция не заводит.
create or replace function public.email_on_dealer_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.f_enqueue_email(
    public.f_admin_email(),
    'dealer_lead_admin',
    jsonb_build_object(
      -- Письма администратору всегда на русском: служебный ящик читает
      -- команда площадки, а не клиент. Сербский здесь только мешал бы.
      'locale',       'ru',
      'lead_id',      new.id,
      'company_name', new.company_name,
      'contact_name', new.contact_name,
      'phone',        new.phone,
      'email',        new.email,
      'city',         new.city,
      'comment',      new.comment
    ),
    null                       -- получатель не пользователь площадки
  );

  return new;
end;
$$;

comment on function public.email_on_dealer_lead()
  is 'Письмо администратору о новой заявке автосалона';

drop trigger if exists tg_email_on_dealer_lead on public.dealer_leads;

create trigger tg_email_on_dealer_lead
  after insert on public.dealer_leads
  for each row execute function public.email_on_dealer_lead();


-- ============================================================
-- 6) ТРИГГЕР: обращение через форму — письмо администратору и копия автору
-- ============================================================
-- ДВА письма на одну вставку, и оба нужны:
--   * администратору — само обращение с контактами отправителя;
--   * автору — копия его текста. Она подтверждает, что сообщение
--     дошло: без неё человек, не получивший ответа за сутки, пишет
--     второй раз или считает площадку нерабочей. Заодно у него
--     остаётся текст собственного обращения.
--
-- Копия уходит на адрес, который человек САМ указал в форме, и
-- содержит только то, что он сам же и написал. Подтверждения адреса
-- не требуется: чужой почте мы этим письмом ничего не раскрываем.
-- Антиспам-ограничение на частоту обращений с одного адреса уже стоит
-- в submit_contact_message (0058), поэтому рассылку по чужому ящику
-- этой парой писем не устроить.
create or replace function public.email_on_contact_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1) Администратору.
  perform public.f_enqueue_email(
    public.f_admin_email(),
    'contact_admin',
    jsonb_build_object(
      'locale',     'ru',        -- служебный ящик, см. выше
      'message_id', new.id,
      'topic',      new.topic,
      'name',       new.name,
      'email',      new.email,
      'message',    new.message,
      'car_id',     new.car_id,
      -- Локаль формы: по ней менеджер поймёт, на каком языке отвечать.
      'from_locale', new.locale
    ),
    null
  );

  -- 2) Копия автору обращения — на его языке.
  perform public.f_enqueue_email(
    new.email,
    'contact_received',
    jsonb_build_object(
      'locale',  new.locale,
      'topic',   new.topic,
      'name',    new.name,
      'message', new.message
    ),
    null                         -- автор мог писать не будучи авторизован
  );

  return new;
end;
$$;

comment on function public.email_on_contact_message()
  is 'Обращение с формы: письмо администратору и копия автору';

drop trigger if exists tg_email_on_contact_message on public.contact_messages;

create trigger tg_email_on_contact_message
  after insert on public.contact_messages
  for each row execute function public.email_on_contact_message();


-- ============================================================
-- 7) СЛУЖЕБНЫЕ RPC ДЛЯ EDGE FUNCTION
-- ============================================================
-- Зеркало claim_push_batch / mark_push_sent / cleanup_push_queue из
-- 0045. Все три доступны только service_role: клиенту в очереди писем
-- делать нечего.

-- ------------------------------------------------------------
-- claim_email_batch(p_limit) — забрать пачку заданий
-- ------------------------------------------------------------
-- FOR UPDATE SKIP LOCKED + немедленное увеличение attempts. Два
-- одновременных запуска функции (расписание наложилось на ручной
-- вызов) разберут разные строки, и ни одно письмо не уйдёт дважды.
--
-- attempts < 5 — та же граница, что у пушей. После пяти неудач письмо
-- перестаёт выбираться; статус ему проставит mark_email_sent при
-- последней попытке, так что в 'pending' оно не зависнет.
create or replace function public.claim_email_batch(p_limit integer default 50)
returns table (
  id           uuid,
  to_email     text,
  template_key text,
  payload      jsonb,
  attempts     integer
)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select q.id
      from public.email_queue q
     where q.status = 'pending'
       and q.attempts < 5
     order by q.created_at
     -- Порция меньше, чем у пушей (50 против 100): письмо отправляется
     -- отдельным HTTP-запросом к провайдеру, и пачка в сотню запросов
     -- упёрлась бы в лимит времени выполнения Edge Function.
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update skip locked
  ),
  bumped as (
    update public.email_queue q
       set attempts = q.attempts + 1
      from claimed c
     where q.id = c.id
    returning q.id, q.to_email, q.template_key, q.payload, q.attempts
  )
  select b.id, b.to_email, b.template_key, b.payload, b.attempts
    from bumped b;
$$;

comment on function public.claim_email_batch(integer)
  is 'Забирает пачку писем из очереди. SKIP LOCKED защищает от двойной отправки';

revoke execute on function public.claim_email_batch(integer) from anon, authenticated;


-- ------------------------------------------------------------
-- mark_email_sent(p_id, p_ok, p_error, p_provider_id)
-- ------------------------------------------------------------
-- Отметка результата. Логика статуса:
--   успех                        → 'sent'
--   неудача, попытки не исчерпаны → остаётся 'pending', уйдёт в
--                                   следующий запуск (ретри);
--   неудача, attempts >= 5        → 'failed', больше не выбирается.
--
-- Текст ошибки пишем в обоих неуспешных случаях: по нему видно, почему
-- письмо не ушло, ещё до того, как попытки кончатся.
create or replace function public.mark_email_sent(
  p_id          uuid,
  p_ok          boolean,
  p_error       text default null,
  p_provider_id text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_queue q
     set status = case
                    when p_ok then 'sent'
                    when q.attempts >= 5 then 'failed'
                    else 'pending'
                  end,
         sent_at     = case when p_ok then now() end,
         error       = case when p_ok then null else p_error end,
         provider_id = coalesce(p_provider_id, q.provider_id)
   where q.id = p_id;
$$;

comment on function public.mark_email_sent(uuid, boolean, text, text)
  is 'Результат отправки письма. Неудача до 5 попыток оставляет письмо в очереди';

revoke execute on function public.mark_email_sent(uuid, boolean, text, text)
  from anon, authenticated;


-- ------------------------------------------------------------
-- cleanup_email_queue() — очистка старых записей
-- ------------------------------------------------------------
-- Отправленные старше 30 дней удаляются: очередь не должна расти
-- вечно. Провалившиеся (status = 'failed') НЕ трогаем — это след
-- недоставленного письма, и он должен пережить чистку.
create or replace function public.cleanup_email_queue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.email_queue
   where status = 'sent' and created_at < now() - interval '30 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.cleanup_email_queue()
  is 'Удаляет отправленные письма старше 30 дней. Провалившиеся сохраняются';

revoke execute on function public.cleanup_email_queue() from anon, authenticated;
