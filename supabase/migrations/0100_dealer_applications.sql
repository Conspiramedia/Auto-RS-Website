-- ============================================================
-- AUTO.RS — Миграция 0100: статус автосалона выдаётся по заявке
-- ============================================================
-- ЧТО ЧИНИМ. С миграции 0043 поле profiles.seller_kind писал сам
-- пользователь: update_seller_profile принимала p_seller_kind от кого
-- угодно и проверяла ровно одно — что название салона непустое. То
-- есть любой вошедший набирал «Autosalon X» и получал витрину в
-- каталоге /dealers, публичную страницу /dealer/{id}, плитку в выдаче
-- и подпись «Автосалон» на своих объявлениях. Витрина салона — это
-- обещание покупателю, что за объявлением стоит зарегистрированная
-- компания, и раздавать её по нажатию кнопки нельзя.
--
-- КАК ЧИНИМ. Статус дилера перестаёт быть полем, которое пишет
-- пользователь, и становится РЕШЕНИЕМ АДМИНИСТРАТОРА:
--
--   1) пользователь подаёт заявку с реквизитами (dealer_applications);
--   2) администратор смотрит их и одобряет или отклоняет с причиной;
--   3) только одобрение ставит profiles.seller_kind = 'dealer'.
--
-- Сам по себе вызов update_seller_profile с p_seller_kind = 'dealer'
-- отныне падает, если одобренной заявки нет.
--
-- ПОЧЕМУ РУЧНАЯ ПРОВЕРКА, А НЕ АВТОМАТИЧЕСКАЯ. Реквизиты сербской
-- компании (PIB и матични број) проверяются по реестру APR, и
-- обращение к нему — внешняя зависимость с собственной доступностью и
-- ключом. Сейчас их проверяет глазами администратор, а поля в заявке
-- заведены сразу — чтобы включение автопроверки позже не потребовало
-- менять схему и переспрашивать реквизиты у тех, кто уже подал.
--
-- СОВМЕСТИМОСТЬ С ПРИЛОЖЕНИЕМ. Сигнатура update_seller_profile не
-- меняется ни на один параметр: приложение вызывает её тем же набором
-- аргументов. Меняется ПОВЕДЕНИЕ внутри — и меняется сразу для обоих
-- клиентов, что и требуется: правило «салон подтверждает
-- администратор» не может действовать на сайте и не действовать в
-- приложении.
--
-- СУЩЕСТВУЮЩИЕ САЛОНЫ НЕ ТЕРЯЮТ СТАТУС. Блок 6 заводит им одобренные
-- задним числом заявки. Без этого первое же сохранение профиля упало
-- бы с «статус подтверждает администратор» — у действующего салона
-- заявки нет и быть не может, её тогда не существовало.
-- ============================================================


-- ============================================================
-- БЛОК 1. Таблица заявок
-- ============================================================
-- ОДНА СТРОКА — ОДНА ПОДАННАЯ ЗАЯВКА, история сохраняется целиком.
-- Отклонённая заявка не удаляется и не переписывается: пользователь
-- подаёт новую, а прежняя остаётся с причиной отказа. Иначе на второй
-- итерации нельзя ответить, за что отказали в первый раз, — а именно
-- этот вопрос и задаёт человек, которому отказали дважды.
--
-- Реквизиты КОПИРУЮТСЯ в заявку, а не читаются из профиля по ссылке.
-- Заявка — документ на момент подачи: администратор одобрил компанию
-- с конкретным PIB, и последующая правка профиля не должна менять
-- то, что он одобрял.
create table if not exists public.dealer_applications (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users (id) on delete cascade,

  -- Стадия рассмотрения. pending → approved | rejected, обратных
  -- переходов нет: решение по заявке принимается один раз, а передумав,
  -- администратор снимает статус салона отдельным действием.
  status         text        not null default 'pending',

  -- ---------- Реквизиты компании ----------
  -- Название салона. Пойдёт в profiles.company_name при одобрении.
  company_name   text        not null,
  -- PIB — налоговый номер (Poreski identifikacioni broj), ровно 9
  -- цифр. Главный реквизит: по нему компания ищется в реестре APR.
  tax_id         text        not null,
  -- Матични број — регистрационный номер юрлица, ровно 8 цифр.
  -- Второй реквизит той же выписки; вместе с PIB он не оставляет
  -- места для совпадений.
  registration_number text   not null,
  -- Город салона. Пойдёт в profiles.company_city.
  company_city   text,
  -- Контактное лицо: с кем разговаривать администратору. Пойдёт в
  -- profiles.contact_person.
  contact_person text,
  -- Телефон для связи по заявке. Отдельно от телефона входа: заявку
  -- подаёт человек, а звонить администратор может в приёмную салона.
  phone          text,
  website        text,
  -- Свободный комментарий заявителя.
  comment        text,

  -- ---------- Решение ----------
  -- Кто рассмотрел. on delete set null: уволившийся администратор
  -- удаляется из auth.users, а заявка обязана пережить это. Кто именно
  -- решал — остаётся в admin_action_log, откуда записи не удаляются.
  reviewed_by    uuid        references auth.users (id) on delete set null,
  reviewed_at    timestamptz,
  -- Причина отказа. Показывается заявителю в кабинете: отказ без
  -- объяснения не даёт исправить заявку и превращает подачу в лотерею.
  reject_reason  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint chk_dealer_app_status check (
    status in ('pending', 'approved', 'rejected')
  ),

  -- Название: те же границы, что у profiles.company_name в 0095.
  constraint chk_dealer_app_company check (
    length(btrim(company_name)) between 2 and 120
  ),

  -- PIB и матични број проверяются ФОРМАТОМ, а не только длиной:
  -- строка из девяти пробелов прошла бы проверку длины и попала бы
  -- администратору как якобы заполненный реквизит.
  constraint chk_dealer_app_tax_id check (tax_id ~ '^[0-9]{9}$'),
  constraint chk_dealer_app_reg_num check (registration_number ~ '^[0-9]{8}$'),

  constraint chk_dealer_app_city check (length(coalesce(company_city, '')) <= 100),
  constraint chk_dealer_app_person check (length(coalesce(contact_person, '')) <= 120),
  constraint chk_dealer_app_phone check (length(coalesce(phone, '')) <= 40),
  constraint chk_dealer_app_website check (length(coalesce(website, '')) <= 200),
  constraint chk_dealer_app_comment check (length(coalesce(comment, '')) <= 1000),
  constraint chk_dealer_app_reason check (length(coalesce(reject_reason, '')) <= 1000),

  -- Решение и его автор появляются вместе. Строка со статусом
  -- approved и пустым reviewed_at означала бы «одобрено неизвестно
  -- кем и когда» — как раз то, чего журнал решений не допускает.
  constraint chk_dealer_app_reviewed check (
    (status = 'pending'  and reviewed_at is null and reviewed_by is null)
    or
    (status <> 'pending' and reviewed_at is not null)
  ),

  -- Отказ обязан быть объяснён. Граница снизу та же, что у отказа в
  -- модерации и блокировки салона (10 символов): один счётчик во всех
  -- диалогах админки.
  constraint chk_dealer_app_reason_required check (
    status <> 'rejected' or length(btrim(coalesce(reject_reason, ''))) >= 10
  )
);

comment on table public.dealer_applications
  is 'Заявки на статус автосалона. Одобряет только администратор; одобрение ставит profiles.seller_kind = dealer';
comment on column public.dealer_applications.tax_id
  is 'PIB — налоговый номер компании, 9 цифр. Проверяется администратором по реестру APR';
comment on column public.dealer_applications.registration_number
  is 'Матични број — регистрационный номер юрлица, 8 цифр';
comment on column public.dealer_applications.reject_reason
  is 'Причина отказа, показывается заявителю в кабинете. Обязательна при status = rejected';


-- ------------------------------------------------------------
-- ОДНА АКТИВНАЯ ЗАЯВКА НА ПОЛЬЗОВАТЕЛЯ
-- ------------------------------------------------------------
-- Частичный уникальный индекс по pending: одобренных и отклонённых
-- строк у пользователя может быть сколько угодно (это история), а
-- ждущая рассмотрения — ровно одна. Без него нажатие «Отправить»
-- дважды подряд клало бы в очередь администратора два одинаковых
-- документа, а недобросовестный заявитель завалил бы её сотней.
--
-- Ограничение стоит НА УРОВНЕ БАЗЫ, а не проверкой внутри RPC:
-- проверка «нет ли уже заявки» и последующая вставка — это две
-- операции, между которыми успевает пройти второй такой же запрос.
create unique index if not exists uq_dealer_app_pending
  on public.dealer_applications (user_id)
  where status = 'pending';

-- Очередь администратора: сначала ждущие, свежие сверху.
create index if not exists idx_dealer_app_status_created
  on public.dealer_applications (status, created_at desc);

-- История заявок конкретного пользователя (кабинет и окно салона).
create index if not exists idx_dealer_app_user
  on public.dealer_applications (user_id, created_at desc);


-- ------------------------------------------------------------
-- RLS: читать — свои; писать напрямую нельзя вообще
-- ------------------------------------------------------------
-- Политик INSERT/UPDATE/DELETE нет намеренно. Вся запись идёт через
-- SECURITY DEFINER функции ниже — тот же приём, что у кошелька в
-- 0043. Будь тут политика на UPDATE «своя строка», заявитель менял бы
-- себе status на approved прямым запросом из браузера, и вся эта
-- миграция теряла бы смысл.
alter table public.dealer_applications enable row level security;

drop policy if exists "dealer_app_select_own" on public.dealer_applications;
create policy "dealer_app_select_own" on public.dealer_applications
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "dealer_app_select_admin" on public.dealer_applications;
create policy "dealer_app_select_admin" on public.dealer_applications
  for select to authenticated using (public.is_admin());

-- Гранты на запись отзываем явно: RLS накладывается ПОВЕРХ грантов, а
-- роль authenticated получает права на новые таблицы схемы public
-- через ALTER DEFAULT PRIVILEGES. Отсутствия политик мало (см. тот же
-- разбор в 0078 у журнала админа).
revoke insert, update, delete on public.dealer_applications from anon, authenticated;


-- ============================================================
-- БЛОК 2. f_has_approved_dealer_application — общая проверка
-- ============================================================
-- Вынесена отдельной функцией, потому что нужна в двух местах:
-- в update_seller_profile (блок 3) и в подсказке кабинета. Две копии
-- одного условия разошлись бы при первой же правке правила.
--
-- security definer: вызывается из update_seller_profile, которая
-- работает от владельца, и обязана видеть строки заявки независимо от
-- RLS вызывающего.
create or replace function public.f_has_approved_dealer_application(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.dealer_applications a
     where a.user_id = p_user_id
       and a.status  = 'approved'
  );
$fn$;

comment on function public.f_has_approved_dealer_application(uuid)
  is 'true, если у пользователя есть одобренная заявка на статус автосалона';

-- Вызывается только изнутри других definer-функций.
revoke all on function public.f_has_approved_dealer_application(uuid)
  from public, anon, authenticated;


-- ============================================================
-- БЛОК 3. update_seller_profile — статус дилера только по заявке
-- ============================================================
-- СИГНАТУРА НЕ МЕНЯЕТСЯ: те же десять параметров в том же порядке,
-- что в 0098. Приложение и сайт продолжают звать функцию как звали.
-- Добавлена ровно одна проверка — та, ради которой всё затевалось.
--
-- НАПРАВЛЕНИЯ НЕСИММЕТРИЧНЫ, и это осознанно:
--   private → dealer   требует одобренной заявки;
--   dealer  → private   разрешено всегда.
-- Отказаться от статуса салона — право владельца, и спрашивать на это
-- разрешения администратора не у чего. Обратно он вернётся без новой
-- заявки: прежняя одобренная никуда не делась и продолжает
-- действовать, пока администратор её не отозвал.
--
-- ПРОВЕРКА СРАБАТЫВАЕТ НА КАЖДОМ сохранении с p_seller_kind =
-- 'dealer', а не только на переходе. Так и задумано: если
-- администратор отозвал у салона статус, следующее сохранение профиля
-- вернуть 'dealer' уже не сможет. Действующим салонам это ничем не
-- грозит — блок 6 выдал им заявки задним числом.
create or replace function public.update_seller_profile(
  p_seller_kind   text,
  p_company_name  text default null,
  p_logo_url      text default null,
  p_description   text default null,
  p_dealer_phone  text default null,
  p_website       text default null,
  p_opening_hours text default null,
  p_company_city  text default null,
  p_cover_url     text default null,
  p_tagline       text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  if p_seller_kind not in ('private', 'dealer') then
    raise exception 'Недопустимый тип продавца: %', p_seller_kind
      using errcode = 'check_violation';
  end if;

  -- ------------------------------------------------------------
  -- ГЛАВНАЯ ПРОВЕРКА МИГРАЦИИ 0100.
  -- ------------------------------------------------------------
  -- Стоит ПЕРЕД проверкой названия салона: человеку, у которого нет
  -- одобренной заявки, сообщение «укажите название автосалона»
  -- предлагало бы дозаполнить форму, которая всё равно не сохранится.
  -- Сначала отвечаем на вопрос «а можно ли вам вообще».
  --
  -- Код ошибки insufficient_privilege (42501), а не check_violation:
  -- это отказ в праве, и сайт разбирает его отдельной веткой.
  if p_seller_kind = 'dealer'
     and not public.f_has_approved_dealer_application(v_user) then
    raise exception 'Статус автосалона подтверждает администратор. Подайте заявку в профиле'
      using errcode = 'insufficient_privilege';
  end if;

  -- Дилер без названия салона не сохраняется: проверяем ДО UPDATE, чтобы
  -- вернуть человекочитаемую ошибку, а не текст constraint из Postgres.
  if p_seller_kind = 'dealer'
     and nullif(trim(coalesce(p_company_name, '')), '') is null then
    raise exception 'Укажите название автосалона'
      using errcode = 'check_violation';
  end if;

  -- Длины проверяются и здесь, хотя их стережёт CHECK на таблице:
  -- constraint отдаёт клиенту техническое «violates check constraint»,
  -- а продавцу нужно понятное «описание слишком длинное».
  if length(coalesce(p_description, '')) > 1000 then
    raise exception 'Описание салона слишком длинное'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_dealer_phone, '')) > 40 then
    raise exception 'Телефон салона слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_website, '')) > 200 then
    raise exception 'Адрес сайта слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_opening_hours, '')) > 200 then
    raise exception 'Часы работы слишком длинные'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_company_city, '')) > 100 then
    raise exception 'Название города слишком длинное'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_cover_url, '')) > 500 then
    raise exception 'Адрес обложки слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_tagline, '')) > 90 then
    raise exception 'Слоган слишком длинный'
      using errcode = 'check_violation';
  end if;

  update public.profiles p
     set seller_kind   = p_seller_kind,
         -- При возврате в private затираем витрину дилера.
         company_name  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_company_name), '') end,
         logo_url      = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_logo_url), '') end,
         description   = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_description), '') end,
         dealer_phone  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_dealer_phone), '') end,
         website       = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_website), '') end,
         opening_hours = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_opening_hours), '') end,
         company_city  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_company_city), '') end,
         cover_url     = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_cover_url), '') end,
         tagline       = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_tagline), '') end,
         updated_at    = now()
   where p.id = v_user
  returning p.* into v_profile;

  return v_profile;
end;
$$;

comment on function public.update_seller_profile(
  text, text, text, text, text, text, text, text, text, text
) is 'Смена типа продавца и полей витрины дилера. С 0100 переход в dealer требует одобренной заявки; возврат в private свободен. Работает только со своим профилем';

grant execute on function public.update_seller_profile(
  text, text, text, text, text, text, text, text, text, text
) to authenticated;


-- ============================================================
-- БЛОК 4. RPC пользователя: подать заявку и узнать её судьбу
-- ============================================================

-- ------------------------------------------------------------
-- submit_dealer_application — подача заявки
-- ------------------------------------------------------------
-- Пользователь подаёт заявку ТОЛЬКО за себя: user_id берётся из
-- auth.uid(), в параметрах его нет принципиально — иначе можно было
-- бы подать заявку от чужого имени.
--
-- ПОВТОРНАЯ ПОДАЧА ПОСЛЕ ОТКАЗА РАЗРЕШЕНА: отклонённая заявка
-- остаётся в истории, новая ложится рядом. Запрещена только вторая
-- ОДНОВРЕМЕННО ждущая — её отсекает уникальный индекс, и ошибку
-- 23505 мы перехватываем, чтобы вернуть понятный текст вместо
-- «duplicate key value violates unique constraint».
--
-- ДЕЙСТВУЮЩЕМУ САЛОНУ подавать заявку незачем — отказываем сразу,
-- иначе в очереди администратора копились бы заявки от тех, у кого
-- статус уже есть.
create or replace function public.submit_dealer_application(
  p_company_name        text,
  p_tax_id              text,
  p_registration_number text,
  p_company_city        text default null,
  p_contact_person      text default null,
  p_phone               text default null,
  p_website             text default null,
  p_comment             text default null
)
returns public.dealer_applications
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_app  public.dealer_applications;
  -- Реквизиты чистим от всего, что не цифра: человек наберёт PIB как
  -- «PIB 123 456 789» или «123-456-789», и требовать от него ровно
  -- девять символов подряд — придирка, которую легко снять здесь.
  v_tax  text := regexp_replace(coalesce(p_tax_id, ''), '[^0-9]', '', 'g');
  v_reg  text := regexp_replace(coalesce(p_registration_number, ''), '[^0-9]', '', 'g');
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Уже салон — заявка не нужна.
  if exists (
    select 1 from public.profiles p
     where p.id = v_user and p.seller_kind = 'dealer'
  ) then
    raise exception 'У вас уже есть статус автосалона'
      using errcode = 'check_violation';
  end if;

  if length(btrim(coalesce(p_company_name, ''))) < 2 then
    raise exception 'Укажите название автосалона'
      using errcode = 'check_violation';
  end if;

  if length(btrim(p_company_name)) > 120 then
    raise exception 'Название автосалона слишком длинное'
      using errcode = 'check_violation';
  end if;

  -- Проверяем ДЛИНУ ПОСЛЕ очистки: сообщение должно называть то, что
  -- от человека действительно требуется, — девять цифр, а не девять
  -- символов.
  if v_tax !~ '^[0-9]{9}$' then
    raise exception 'PIB состоит из 9 цифр'
      using errcode = 'check_violation';
  end if;

  if v_reg !~ '^[0-9]{8}$' then
    raise exception 'Матични број состоит из 8 цифр'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_company_city, '')) > 100 then
    raise exception 'Название города слишком длинное'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_contact_person, '')) > 120 then
    raise exception 'Имя контактного лица слишком длинное'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_phone, '')) > 40 then
    raise exception 'Телефон слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_website, '')) > 200 then
    raise exception 'Адрес сайта слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_comment, '')) > 1000 then
    raise exception 'Комментарий слишком длинный'
      using errcode = 'check_violation';
  end if;

  begin
    insert into public.dealer_applications (
      user_id, company_name, tax_id, registration_number,
      company_city, contact_person, phone, website, comment
    )
    values (
      v_user,
      btrim(p_company_name),
      v_tax,
      v_reg,
      nullif(btrim(coalesce(p_company_city, '')), ''),
      nullif(btrim(coalesce(p_contact_person, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_website, '')), ''),
      nullif(btrim(coalesce(p_comment, '')), '')
    )
    returning * into v_app;
  exception
    -- Сработал uq_dealer_app_pending: заявка уже ждёт рассмотрения.
    -- Это не ошибка системы, а нормальное положение дел — отвечаем
    -- человеческим текстом.
    when unique_violation then
      raise exception 'Ваша заявка уже отправлена и ждёт рассмотрения'
        using errcode = 'check_violation';
  end;

  return v_app;
end;
$fn$;

comment on function public.submit_dealer_application(
  text, text, text, text, text, text, text, text
) is 'Подача заявки на статус автосалона. Одна ждущая заявка на пользователя; повторная подача после отказа разрешена';

grant execute on function public.submit_dealer_application(
  text, text, text, text, text, text, text, text
) to authenticated;


-- ------------------------------------------------------------
-- get_my_dealer_application — состояние моей заявки
-- ------------------------------------------------------------
-- Отдаёт ПОСЛЕДНЮЮ заявку пользователя, какой бы она ни была. Именно
-- она определяет, что показать в кабинете: ждущую — «на
-- рассмотрении», отклонённую — причину и кнопку «подать снова»,
-- одобренную — открытые поля витрины.
--
-- Читать можно было бы и прямым select под политикой
-- dealer_app_select_own, но RPC даёт стабильный контракт: набор
-- колонок кабинета не поедет от того, что в таблицу добавили
-- служебное поле.
create or replace function public.get_my_dealer_application()
returns table (
  id                  uuid,
  status              text,
  company_name        text,
  tax_id              text,
  registration_number text,
  company_city        text,
  contact_person      text,
  phone               text,
  website             text,
  comment             text,
  reject_reason       text,
  created_at          timestamptz,
  reviewed_at         timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    a.id, a.status, a.company_name, a.tax_id, a.registration_number,
    a.company_city, a.contact_person, a.phone, a.website, a.comment,
    a.reject_reason, a.created_at, a.reviewed_at
  from public.dealer_applications a
  where a.user_id = auth.uid()
  order by a.created_at desc
  limit 1;
$fn$;

comment on function public.get_my_dealer_application()
  is 'Последняя заявка текущего пользователя на статус автосалона: стадия, реквизиты, причина отказа';

grant execute on function public.get_my_dealer_application() to authenticated;


-- ============================================================
-- БЛОК 5. RPC администратора: очередь заявок и решение
-- ============================================================

-- ------------------------------------------------------------
-- admin_dealer_applications — очередь заявок
-- ------------------------------------------------------------
-- p_status = null означает «все стадии»: администратору нужен и
-- разбор ждущих, и возможность посмотреть, кому и за что отказали.
--
-- Телефон и почта аккаунта приходят из profiles: заявку подаёт
-- человек, вошедший по SMS, и связаться с ним можно по номеру входа,
-- даже если контактный телефон в заявке он не указал.
create or replace function public.admin_dealer_applications(
  p_status text default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id                  uuid,
  user_id             uuid,
  status              text,
  company_name        text,
  tax_id              text,
  registration_number text,
  company_city        text,
  contact_person      text,
  phone               text,
  website             text,
  comment             text,
  reject_reason       text,
  created_at          timestamptz,
  reviewed_at         timestamptz,
  -- Контакты аккаунта заявителя.
  account_phone       text,
  account_email       text,
  account_name        text,
  -- Общее число строк под выбранный фильтр — для пагинации. Считается
  -- окном в том же запросе: отдельный count() означал бы второй проход
  -- по таблице ради числа под кнопкой «дальше».
  total_count         bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: заявки салонов доступны только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Недопустимая стадия: %', p_status
      using errcode = 'check_violation';
  end if;

  return query
  select
    a.id, a.user_id, a.status, a.company_name, a.tax_id, a.registration_number,
    a.company_city, a.contact_person, a.phone, a.website, a.comment,
    a.reject_reason, a.created_at, a.reviewed_at,
    p.phone, p.email, p.full_name,
    count(*) over ()
  from public.dealer_applications a
  left join public.profiles p on p.id = a.user_id
  where p_status is null or a.status = p_status
  -- Ждущие рассмотрения — всегда сверху, независимо от даты: это
  -- работа, а одобренные и отклонённые — архив. Внутри стадии свежие
  -- первыми.
  order by (a.status = 'pending') desc, a.created_at desc
  limit  least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

comment on function public.admin_dealer_applications(text, integer, integer)
  is 'Очередь заявок на статус автосалона с контактами заявителя. Ждущие сверху. Только для админа';

grant execute on function public.admin_dealer_applications(text, integer, integer) to authenticated;


-- ------------------------------------------------------------
-- admin_review_dealer_application — решение по заявке
-- ------------------------------------------------------------
-- ОДНА ФУНКЦИЯ НА ОБА РЕШЕНИЯ, а не approve/reject по отдельности:
-- проверки прав, блокировки строки и защиты от повторного решения у
-- них общие, и разделение дало бы две почти одинаковые функции,
-- которые разойдутся при первой правке.
--
-- ПРИ ОДОБРЕНИИ ФУНКЦИЯ САМА СТАВИТ СТАТУС САЛОНА. Оставь мы это
-- пользователю («заявка одобрена, теперь переключите тип продавца в
-- профиле»), человек с одобренной заявкой ходил бы частником, пока не
-- догадается нажать кнопку. Одобрение — это и есть выдача статуса.
--
-- Реквизиты переносятся из ЗАЯВКИ, а не из текущего профиля: одобрено
-- именно то, что администратор прочитал.
create or replace function public.admin_review_dealer_application(
  p_id      uuid,
  p_approve boolean,
  p_reason  text default null
)
returns public.dealer_applications
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_app    public.dealer_applications;
  v_reason text;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: решение по заявке принимает только администратор'
      using errcode = 'insufficient_privilege';
  end if;

  if p_approve is null then
    raise exception 'Решение обязательно'
      using errcode = 'check_violation';
  end if;

  -- FOR UPDATE: два администратора могли открыть одну заявку. Второй
  -- дождётся коммита первого и увидит стадию, отличную от pending, —
  -- и получит внятный отказ вместо перезаписи чужого решения.
  select * into v_app
    from public.dealer_applications a
   where a.id = p_id
   for update;

  if v_app.id is null then
    raise exception 'Заявка не найдена'
      using errcode = 'no_data_found';
  end if;

  if v_app.status <> 'pending' then
    raise exception 'Заявка уже рассмотрена: текущая стадия = %', v_app.status
      using errcode = 'check_violation';
  end if;

  -- ---------- ОТКАЗ ----------
  if not p_approve then
    v_reason := btrim(coalesce(p_reason, ''));

    -- Границы те же, что у отказа в модерации и блокировки салона.
    if length(v_reason) < 10 then
      raise exception 'Причина обязательна и должна содержать не менее 10 символов'
        using errcode = 'check_violation';
    end if;

    if length(v_reason) > 1000 then
      raise exception 'Причина слишком длинная: % символов, максимум 1000', length(v_reason)
        using errcode = 'check_violation';
    end if;

    update public.dealer_applications
       set status        = 'rejected',
           reject_reason = v_reason,
           reviewed_by   = auth.uid(),
           reviewed_at   = now(),
           updated_at    = now()
     where id = p_id
    returning * into v_app;

    perform public.f_admin_log(
      'dealer_app_rejected',
      'dealer_applications',
      p_id,
      jsonb_build_object(
        'user_id', v_app.user_id,
        'company', v_app.company_name,
        'tax_id',  v_app.tax_id,
        'reason',  v_reason
      )
    );

    return v_app;
  end if;

  -- ---------- ОДОБРЕНИЕ ----------
  update public.dealer_applications
     set status      = 'approved',
         -- Причину при одобрении затираем: поле означает «за что
         -- отказали», и текст из прошлой жизни заявки вводил бы в
         -- заблуждение.
         reject_reason = null,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         updated_at  = now()
   where id = p_id
  returning * into v_app;

  -- Статус салона и реквизиты — из заявки. Поля витрины (обложка,
  -- слоган, часы, описание) НЕ трогаем: их заполняет сам салон, и
  -- пустыми они и должны быть у только что одобренного.
  --
  -- coalesce у города и контактного лица: заявка могла их не
  -- содержать (поля необязательные), и затирать уже заполненное
  -- администратором в окне салона незачем.
  update public.profiles p
     set seller_kind    = 'dealer',
         company_name   = v_app.company_name,
         company_city   = coalesce(v_app.company_city, p.company_city),
         contact_person = coalesce(v_app.contact_person, p.contact_person),
         -- Телефон салона из заявки — если владелец его указал и в
         -- профиле пусто. Это контакт для покупателей на витрине.
         dealer_phone   = coalesce(p.dealer_phone, v_app.phone),
         website        = coalesce(p.website, v_app.website),
         updated_at     = now()
   where p.id = v_app.user_id;

  perform public.f_admin_log(
    'dealer_app_approved',
    'dealer_applications',
    p_id,
    jsonb_build_object(
      'user_id', v_app.user_id,
      'company', v_app.company_name,
      'tax_id',  v_app.tax_id,
      'reg_num', v_app.registration_number
    )
  );

  return v_app;
end;
$fn$;

comment on function public.admin_review_dealer_application(uuid, boolean, text)
  is 'Решение по заявке салона. При одобрении сама ставит seller_kind = dealer и переносит реквизиты. Пишет в журнал. Только для админа';

grant execute on function public.admin_review_dealer_application(uuid, boolean, text) to authenticated;


-- ============================================================
-- БЛОК 6. Действующие салоны получают заявки задним числом
-- ============================================================
-- Без этого блока миграция сломала бы прод: у салона, заведённого до
-- неё, одобренной заявки нет, и первое же сохранение профиля упало бы
-- с «статус автосалона подтверждает администратор». Салон при этом
-- ничего не нарушал — правила на момент его регистрации были другими.
--
-- Реквизиты заполняем ЗАГЛУШКАМИ из нулей: настоящих PIB и матични
-- број у нас нет, выдумывать их нельзя, а NOT NULL и формат колонок
-- требуют значения. Нули — очевидно ненастоящий номер: он сразу виден
-- администратору в очереди как «реквизиты не собраны», и его нельзя
-- перепутать с проверенным.
--
-- reviewed_by = null: эти заявки не одобрял человек, их завела
-- миграция. Ставить сюда чей-либо uuid значило бы приписать живому
-- администратору решение, которого он не принимал.
--
-- Комментарий в самой строке объясняет её происхождение тому, кто
-- откроет заявку через полгода.
--
-- on conflict do nothing не нужен: insert ... select с where not
-- exists уже отсекает тех, у кого заявка есть, а повторный прогон
-- миграции (db push идемпотентен по файлам) сюда не доберётся.
insert into public.dealer_applications (
  user_id, status, company_name, tax_id, registration_number,
  company_city, contact_person, phone, website, comment,
  reviewed_by, reviewed_at
)
select
  p.id,
  'approved',
  coalesce(nullif(btrim(p.company_name), ''), 'Autosalon'),
  '000000000',
  '00000000',
  p.company_city,
  p.contact_person,
  p.dealer_phone,
  p.website,
  'Заявка заведена миграцией 0100 задним числом: салон работал до введения подтверждения статуса. Реквизиты (PIB, матични број) не собраны — запросить у салона.',
  null,
  now()
from public.profiles p
where p.seller_kind = 'dealer'
  and not exists (
    select 1 from public.dealer_applications a
     where a.user_id = p.id
  );
