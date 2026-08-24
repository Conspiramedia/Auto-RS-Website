-- ============================================================
-- AUTO.RS — Миграция 0080: объявления, пользователи, журнал.
-- ------------------------------------------------------------
-- Пакеты M5–M7. Три раздела админки, ни один из которых не блокирует
-- релиз: модерация (M4) уже работает, а это — удобство разбора.
--
-- Состав:
--   M5  admin_list_cars        — все объявления с фильтрами и поиском;
--       admin_set_car_status   — снятие/возврат с обязательной причиной;
--       письмо car_archived_by_admin — новый шаблон и ветка триггера;
--   M6  admin_list_users       — список пользователей со статистикой;
--       admin_get_user         — профиль + объявления + действия;
--   M7  admin_action_list      — журнал с фильтрами и пагинацией.
--
-- Все RPC: SECURITY DEFINER, is_admin() первой строкой, grant
-- authenticated. Definer нужен ради profiles, auth.users и
-- admin_action_log — последний закрыт наглухо (0078), и прочитать его
-- иначе нельзя.
--
-- РОЛЬ АДМИНИСТРАТОРА ЧЕРЕЗ RPC НЕ ВЫДАЁТСЯ. Функции смены
-- profiles.is_admin здесь нет и не будет: флаг ставится вручную в SQL
-- Editor. Скомпрометированный аккаунт админа не должен уметь плодить
-- админов, а интерфейс, который «просто показывает галочку», рано или
-- поздно обзаводится кнопкой.
-- ============================================================


-- ############################################################
-- M5. ОБЪЯВЛЕНИЯ
-- ############################################################

-- ============================================================
-- 1) Письмо о снятии объявления администратором
-- ------------------------------------------------------------
-- Снятие опубликованного объявления — действие, которое продавец
-- обнаружит сам: оно просто исчезнет из выдачи. Без письма это
-- выглядит как поломка сайта, и человек идёт в поддержку выяснять,
-- куда делось то, за что он, возможно, платил за продвижение.
--
-- Поэтому шаблон заводится ВМЕСТЕ с самой возможностью снимать:
-- сначала ограничение таблицы, потом ветка триггера. Порядок важен —
-- вставка письма с неизвестным template_key упала бы на chk_email_template
-- и откатила транзакцию вместе со сменой статуса.
--
-- ВНИМАНИЕ ПРИ ДЕПЛОЕ: шаблон должен появиться и в Edge Function
-- (supabase/functions/send-email/templates.ts). Пока функция не
-- задеплоена, renderEmail вернёт null и письмо ляжет в failed с
-- внятной ошибкой — оно не потеряется, но и не уйдёт. Диспетчер
-- функции написан именно с расчётом на такое расхождение.
-- ============================================================
alter table public.email_queue
  drop constraint if exists chk_email_template;

alter table public.email_queue
  add constraint chk_email_template check (
    template_key in (
      'car_approved',           -- объявление одобрено, ссылка на карточку
      'car_rejected',           -- отклонено: причина + ссылка на /my
      'car_archived_by_admin',  -- снято администратором: причина + ссылка на /my
      'contact_received',       -- копия обращения автору
      'contact_admin',          -- обращение — администратору
      'dealer_lead_admin'       -- заявка салона — администратору
    )
  );


-- ------------------------------------------------------------
-- Триггерная функция писем модерации: добавлена ветка снятия.
-- ------------------------------------------------------------
-- Пересоздаём целиком (create or replace), сохраняя прежнее поведение
-- один в один и добавляя ровно один переход: active → archived.
--
-- ПОЧЕМУ ЗДЕСЬ, А НЕ В admin_set_car_status. Ровно по той же причине,
-- по которой письма модерации живут на таблице, а не в approve_car:
-- статус меняют несколько путей (RPC админа, set_my_car_status
-- продавца, будущие сценарии), и письмо, привязанное к одному из них,
-- не уйдёт из остальных.
--
-- И ПОЧЕМУ ТОЛЬКО СНЯТИЕ АДМИНОМ. Продавец, снявший объявление сам
-- через set_my_car_status, тоже даёт переход active → archived — но
-- письмо ему было бы спамом: он знает, что сделал. Отличить одно от
-- другого по самой строке cars нельзя, поэтому смотрим на журнал:
-- admin_set_car_status пишет в него запись в ТОЙ ЖЕ транзакции, и на
-- момент срабатывания AFTER-триггера она уже видна. Нет записи —
-- значит, снял владелец, и письма не будет.
-- ------------------------------------------------------------
create or replace function public.email_on_car_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email  text;
  v_locale text;
  v_url    text;
  v_reason text;
  v_by_admin boolean;
begin
  -- Статус не менялся — выходим сразу, не трогая profiles. Триггер
  -- висит на UPDATE OF status, но Postgres вызывает его и когда
  -- колонку переписали тем же значением.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Интересуют три перехода: два решения модерации (как было) и
  -- снятие опубликованного администратором (новое).
  if not (
    (new.status = 'active'   and old.status in ('moderation', 'rejected'))
    or
    (new.status = 'rejected' and old.status = 'moderation')
    or
    (new.status = 'archived' and old.status = 'active')
  ) then
    return new;
  end if;

  -- Снятие: письмо шлём, только если это сделал администратор.
  -- Признак — свежая запись в журнале по этому объявлению, сделанная
  -- в текущей транзакции (см. комментарий к функции).
  --
  -- now() внутри транзакции — это время её НАЧАЛА, одинаковое для
  -- всех операторов, поэтому запись, сделанная миллисекундой раньше в
  -- этой же транзакции, гарантированно попадает в интервал. Минута
  -- взята с запасом на случай длинной транзакции, а не как оценка
  -- «недавности»: чужая запись минутной давности сюда не попадёт,
  -- потому что второе снятие того же объявления невозможно — статус
  -- уже archived и матрица переходов его не пропустит.
  if new.status = 'archived' then
    select l.payload->>'reason'
      into v_reason
      from public.admin_action_log l
     where l.target_table = 'cars'
       and l.target_id = new.id
       and l.action = 'car_archived'
       and l.created_at >= now() - interval '1 minute'
     order by l.created_at desc
     limit 1;

    v_by_admin := found;

    -- Снял сам владелец — он и так знает; письмо было бы спамом.
    if not v_by_admin then
      return new;
    end if;
  end if;

  -- Адрес и язык получателя. Профиль читаем ОДНИМ запросом.
  select p.email, p.locale
    into v_email, v_locale
    from public.profiles p
   where p.id = new.user_id;

  -- Почты нет (вход по SMS, профиль не заполнен) — письма не будет.
  -- Уведомление в колокольчик уже поставила вызывающая RPC.
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

  elsif new.status = 'archived' then
    perform public.f_enqueue_email(
      v_email,
      'car_archived_by_admin',
      jsonb_build_object(
        'locale', coalesce(v_locale, 'sr'),
        'brand',  new.brand,
        'model',  new.model,
        'year',   new.year,
        -- Причина обязательна на уровне admin_set_car_status, поэтому
        -- пустой она сюда не приходит. nullif оставлен на случай
        -- будущего пути, который об этом не знает.
        'reason', nullif(btrim(coalesce(v_reason, '')), '')
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
        -- продавец в кабинете и в колокольчике.
        'reason', nullif(btrim(coalesce(new.moderation_comment, '')), '')
      ),
      new.user_id
    );
  end if;

  return new;
end;
$fn$;

comment on function public.email_on_car_moderation()
  is 'Письмо продавцу о решении модерации и о снятии объявления админом. На таблице, а не в RPC: статус меняют несколько путей';


-- ============================================================
-- 2) admin_list_cars — все объявления с фильтрами
-- ------------------------------------------------------------
-- Отличается от admin_moderation_queue (0079) тем, что видит ВСЕ
-- статусы и умеет искать. Очередь — рабочий конвейер с одним
-- порядком; здесь разбор по запросу: «найти объявление, на которое
-- жалуется покупатель», «показать всё этого продавца».
--
-- ПОИСК ДВУАЛФАВИТНЫЙ. p_query прогоняется через f_normalize
-- (lower + unaccent) — тот же путь, что у каталога (0008, 0060):
-- «Шкода» находит «Škoda», «БМВ» находит «BMW». Своя нормализация
-- здесь означала бы, что админка ищет не так, как сайт, и модератор
-- не находит то, на что смотрит покупатель.
--
-- Поиск по id — отдельная ветка: администратору дают ссылку или
-- идентификатор из письма, и прогонять uuid через триграммы
-- бессмысленно. Проверяем формат регулярным выражением, а не
-- приведением типа: битая строка не должна ронять запрос.
-- ============================================================
create or replace function public.admin_list_cars(
  p_status  text    default null,
  p_query   text    default null,
  p_city    text    default null,
  p_user_id uuid    default null,
  p_sort    text    default 'created_desc',
  p_limit   integer default 50,
  p_offset  integer default 0
)
returns table (
  car_id           uuid,
  brand            text,
  model            text,
  year             integer,
  city             text,
  status           text,
  is_for_sale      boolean,
  is_for_rent      boolean,
  sale_price       numeric,
  rent_price_daily numeric,
  currency         text,
  photo_url        text,
  photos_count     integer,
  owner_id         uuid,
  owner_name       text,
  created_at       timestamptz,
  updated_at       timestamptz,
  total_count      bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_norm    text := public.f_normalize(p_query);
  v_has_q   boolean := nullif(btrim(coalesce(p_query, '')), '') is not null;
  -- Запрос похож на uuid — ищем по идентификатору, а не по тексту.
  v_as_uuid uuid := case
                      when btrim(coalesce(p_query, '')) ~*
                           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then btrim(p_query)::uuid
                      else null
                    end;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: список объявлений доступен только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    c.id,
    c.brand,
    c.model,
    c.year,
    c.city,
    c.status::text,
    c.is_for_sale,
    c.is_for_rent,
    c.sale_price,
    c.rent_price_daily,
    c.currency::text,
    (select ci.image_url from public.car_images ci
      where ci.car_id = c.id order by ci.order_index asc limit 1),
    (select count(*)::integer from public.car_images ci where ci.car_id = c.id),
    c.user_id,
    p.full_name,
    c.created_at,
    c.updated_at,
    count(*) over ()
  from public.cars c
  join public.profiles p on p.id = c.user_id
  where
    -- Статус: null — все. Значение приводим к enum; неизвестное
    -- значение упало бы с ошибкой приведения, поэтому сверяем текстом.
    (p_status is null or c.status::text = p_status)

    and (p_city is null or public.f_normalize(c.city) = public.f_normalize(p_city))

    and (p_user_id is null or c.user_id = p_user_id)

    and (
      not v_has_q
      -- Точное попадание по id — приоритетный сценарий.
      or (v_as_uuid is not null and c.id = v_as_uuid)
      -- Триграммы плюс подстрока поверх f_normalize: ровно как в
      -- каталоге, чтобы админка и сайт находили одно и то же.
      or public.f_normalize(c.brand) % v_norm
      or public.f_normalize(c.model) % v_norm
      or public.f_normalize(c.city)  % v_norm
      or public.f_normalize(c.brand) ilike '%' || v_norm || '%'
      or public.f_normalize(c.model) ilike '%' || v_norm || '%'
      or public.f_normalize(c.city)  ilike '%' || v_norm || '%'
    )
  order by
    -- Белый список сортировок. Неизвестное значение молча даёт
    -- created_desc: сортировка — не то, из-за чего стоит показывать
    -- модератору ошибку вместо списка.
    case when p_sort = 'created_asc'  then c.created_at end asc,
    case when p_sort = 'updated_desc' then c.updated_at end desc,
    case when p_sort not in ('created_asc', 'updated_desc')
         then c.created_at end desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$fn$;

comment on function public.admin_list_cars(text, text, text, uuid, text, integer, integer)
  is 'Все объявления с фильтрами и двуалфавитным поиском; только для админа';

grant execute on function public.admin_list_cars(text, text, text, uuid, text, integer, integer) to authenticated;


-- ============================================================
-- 3) admin_set_car_status — снять с публикации или вернуть
-- ------------------------------------------------------------
-- МАТРИЦА ПЕРЕХОДОВ — БЕЛЫЙ СПИСОК, как в set_my_car_status (0070):
--   active   → archived  (снять с публикации);
--   archived → active    (вернуть).
-- Всё остальное запрещено по умолчанию. В частности, эта функция НЕ
-- умеет одобрять и отклонять: для этого есть approve_car/reject_car с
-- их проверками, журналом и письмами. Второй путь к тем же статусам
-- означал бы, что часть решений проходит мимо модерационных правил.
--
-- ПРИЧИНА ОБЯЗАТЕЛЬНА В ОБЕ СТОРОНЫ, и это сознательно строже, чем
-- «только для снятия». Снятие опубликованного объявления продавец
-- обнаружит сам и без объяснения воспримет как поломку. Возврат
-- реже, но он тоже решение администратора, и через полгода нужно
-- понимать, почему объявление вернули, — журнал без причины
-- бесполезен ровно так же.
--
-- Порядок действий важен: сначала журнал, потом UPDATE. Триггер
-- писем (см. выше) ищет в журнале признак «снял админ», и запись
-- обязана существовать к моменту его срабатывания.
-- ============================================================
create or replace function public.admin_set_car_status(
  p_car_id uuid,
  p_status text,
  p_reason text
)
returns public.cars
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_car    public.cars;
  v_reason text;
  v_prev   text;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: смена статуса доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  -- Причина — до всякой работы со строкой: незачем блокировать её
  -- ради заведомо неверного вызова. Границы те же, что в reject_car
  -- (0078): расхождение путало бы модератора, который видит один и
  -- тот же счётчик символов в двух диалогах.
  v_reason := btrim(coalesce(p_reason, ''));

  if length(v_reason) < 10 then
    raise exception 'Причина обязательна и должна содержать не менее 10 символов'
      using errcode = 'check_violation';
  end if;

  if length(v_reason) > 1000 then
    raise exception 'Причина слишком длинная: % символов, максимум 1000', length(v_reason)
      using errcode = 'check_violation';
  end if;

  -- Блокируем строку до чтения статуса: два администратора не должны
  -- разойтись в гонке.
  select c.* into v_car from public.cars c where c.id = p_car_id for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', p_car_id
      using errcode = 'no_data_found';
  end if;

  v_prev := v_car.status::text;

  if not (
       (v_prev = 'active'   and p_status = 'archived')
    or (v_prev = 'archived' and p_status = 'active')
  ) then
    raise exception 'Переход % → % не разрешён', v_prev, p_status
      using errcode = 'check_violation';
  end if;

  -- Журнал ПЕРЕД обновлением: триггер письма (email_on_car_moderation)
  -- ищет эту запись, чтобы отличить снятие администратором от снятия
  -- владельцем. После UPDATE было бы поздно — AFTER-триггер сработает
  -- раньше.
  perform public.f_admin_log(
    case when p_status = 'archived' then 'car_archived' else 'car_restored' end,
    'cars',
    v_car.id,
    jsonb_build_object(
      'reason',      v_reason,
      'prev_status', v_prev,
      'user_id',     v_car.user_id,
      'brand',       v_car.brand,
      'model',       v_car.model
    )
  );

  update public.cars
     set status = p_status::car_status
   where id = p_car_id
   returning * into v_car;

  -- Уведомление в колокольчик. Письмо ставит триггер — здесь его
  -- дублировать нельзя, продавец получил бы два.
  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_car.user_id,
    case when p_status = 'archived'
         then 'Объявление снято с публикации'
         else 'Объявление снова опубликовано' end,
    v_reason,
    case when p_status = 'archived' then 'car_archived' else 'car_restored' end,
    v_car.id
  );

  return v_car;
end;
$fn$;

comment on function public.admin_set_car_status(uuid, text, text)
  is 'Снятие/возврат объявления администратором с обязательной причиной (≥10 символов) и записью в журнал';

grant execute on function public.admin_set_car_status(uuid, text, text) to authenticated;


-- ############################################################
-- M6. ПОЛЬЗОВАТЕЛИ
-- ############################################################

-- ============================================================
-- 4) admin_list_users — список пользователей
-- ------------------------------------------------------------
-- AUTH.USERS НАРУЖУ НЕ ОТДАЁМ. Из неё берётся ровно одно поле —
-- last_sign_in_at, и берётся оно внутри definer-функции. Причина
-- простая: в auth.users лежат хеши паролей, токены восстановления и
-- служебные метаданные, и любая выборка «звёздочкой» из неё рано или
-- поздно утечёт в ответ. Явный список из одного поля этого не
-- допускает.
--
-- Статистика по объявлениям считается подзапросами, а не join с
-- группировкой: пользователей на порядок меньше, чем объявлений, и
-- группировка по profiles с двумя условными счётчиками читалась бы
-- хуже без выигрыша.
-- ============================================================
create or replace function public.admin_list_users(
  p_query  text    default null,
  p_type   text    default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  user_id             uuid,
  full_name           text,
  email               text,
  phone               text,
  role                text,
  is_admin            boolean,
  verification_status text,
  locale              text,
  listings_total      integer,
  listings_active     integer,
  created_at          timestamptz,
  last_sign_in_at     timestamptz,
  total_count         bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_norm  text := public.f_normalize(p_query);
  v_has_q boolean := nullif(btrim(coalesce(p_query, '')), '') is not null;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: список пользователей доступен только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.email,
    p.phone,
    p.role::text,
    p.is_admin,
    p.verification_status::text,
    p.locale,
    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status <> 'draft'),
    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status = 'active'),
    p.created_at,
    -- Единственное поле из auth.users, см. комментарий к функции.
    u.last_sign_in_at,
    count(*) over ()
  from public.profiles p
  left join auth.users u on u.id = p.id
  where
    -- Тип: admin — администраторы, dealer/client — по роли,
    -- verified/pending — по статусу проверки документов. Один
    -- параметр вместо четырёх фильтров: в интерфейсе это выпадающий
    -- список, а не набор переключателей.
    (
      p_type is null
      or (p_type = 'admin'    and p.is_admin)
      or (p_type = 'verified' and p.verification_status = 'verified')
      or (p_type = 'pending'  and p.verification_status = 'pending')
      or (p_type in ('client', 'dealer') and p.role::text = p_type)
    )
    and (
      not v_has_q
      -- Почта и телефон ищутся подстрокой без нормализации: в них нет
      -- ни диакритики, ни двух алфавитов, зато есть точный формат.
      or p.email ilike '%' || btrim(p_query) || '%'
      or coalesce(p.phone, '') ilike '%' || btrim(p_query) || '%'
      -- Имя — через ту же нормализацию, что и всё остальное:
      -- «Петрович» должен находить «Petrović».
      or public.f_normalize(coalesce(p.full_name, '')) ilike '%' || v_norm || '%'
    )
  order by p.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$fn$;

comment on function public.admin_list_users(text, text, integer, integer)
  is 'Список пользователей со статистикой объявлений; из auth.users берётся только last_sign_in_at; только для админа';

grant execute on function public.admin_list_users(text, text, integer, integer) to authenticated;


-- ============================================================
-- 5) admin_get_user — карточка пользователя
-- ------------------------------------------------------------
-- Профиль, его объявления и действия администраторов НАД НИМ — одним
-- вызовом.
--
-- «Действия над ним» — это записи журнала, где target_id равен id
-- пользователя. Действия над его ОБЪЯВЛЕНИЯМИ туда не попадают: у
-- них target_id — идентификатор объявления. Разделение намеренное:
-- на карточке пользователя нужна история решений по нему самому
-- (верификация, блокировки), а история модерации живёт на карточке
-- каждого объявления, где ей и место.
-- ============================================================
create or replace function public.admin_get_user(p_user_id uuid)
returns table (
  user_id              uuid,
  full_name            text,
  email                text,
  phone                text,
  role                 text,
  is_admin             boolean,
  verification_status  text,
  verification_comment text,
  locale               text,
  avatar_url           text,
  rating_avg           numeric,
  reviews_count        integer,
  created_at           timestamptz,
  last_sign_in_at      timestamptz,
  listings_total       integer,
  listings_active      integer,
  listings_rejected    integer,
  -- [{car_id, brand, model, year, status, created_at}, …]
  listings             jsonb,
  -- [{action, created_at, actor_name, payload}, …]
  actions              jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: карточка пользователя доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.email,
    p.phone,
    p.role::text,
    p.is_admin,
    p.verification_status::text,
    p.verification_comment,
    p.locale,
    p.avatar_url,
    p.rating_avg,
    p.reviews_count,
    p.created_at,
    u.last_sign_in_at,

    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status <> 'draft'),
    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status = 'active'),
    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status = 'rejected'),

    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'car_id',     c.id,
                  'brand',      c.brand,
                  'model',      c.model,
                  'year',       c.year,
                  'status',     c.status::text,
                  'created_at', c.created_at
                )
                order by c.created_at desc
              )
         from public.cars c
        where c.user_id = p.id),
      '[]'::jsonb
    ),

    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'action',     l.action,
                  'created_at', l.created_at,
                  'actor_name', coalesce(ap.full_name, ap.email, 'модератор'),
                  'payload',    l.payload
                )
                order by l.created_at desc
              )
         from public.admin_action_log l
         left join public.profiles ap on ap.id = l.actor_id
        where l.target_table = 'profiles'
          and l.target_id = p.id),
      '[]'::jsonb
    )
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_user_id;
end;
$fn$;

comment on function public.admin_get_user(uuid)
  is 'Карточка пользователя: профиль, объявления, действия администраторов над ним; только для админа';

grant execute on function public.admin_get_user(uuid) to authenticated;


-- ############################################################
-- M7. ЖУРНАЛ
-- ############################################################

-- ============================================================
-- 6) admin_action_list — журнал с фильтрами
-- ------------------------------------------------------------
-- ЕДИНСТВЕННЫЙ способ прочитать admin_action_log. Таблица закрыта
-- наглухо (0078): RLS без политик плюс revoke всех табличных грантов.
-- Definer здесь не удобство, а необходимость.
--
-- ПАГИНАЦИЯ ОБЯЗАТЕЛЬНА, в отличие от очереди. Очередь, доросшая до
-- второй страницы, — сигнал проблемы; журнал же растёт всегда и по
-- определению, это его назначение. total_count той же оконной
-- функцией.
--
-- Период задаётся полуоткрытым интервалом [p_from, p_to): так «за
-- сегодня» пишется как [сегодня, завтра) и не теряет события
-- последней секунды суток, что неминуемо при <= с округлением до дня.
-- ============================================================
create or replace function public.admin_action_list(
  p_action    text        default null,
  p_actor     uuid        default null,
  p_target_id uuid        default null,
  p_from      timestamptz default null,
  p_to        timestamptz default null,
  p_limit     integer     default 50,
  p_offset    integer     default 0
)
returns table (
  id           bigint,
  action       text,
  actor_id     uuid,
  actor_name   text,
  target_table text,
  target_id    uuid,
  payload      jsonb,
  created_at   timestamptz,
  total_count  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: журнал доступен только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    l.id,
    l.action,
    l.actor_id,
    -- Имя модератора: в журнале лежит только actor_id, а «3f2a…»
    -- человеку ничего не говорит. Профиль мог быть удалён — тогда
    -- почта, а если и её нет — обобщённое «модератор».
    coalesce(ap.full_name, ap.email, 'модератор'),
    l.target_table,
    l.target_id,
    l.payload,
    l.created_at,
    count(*) over ()
  from public.admin_action_log l
  left join public.profiles ap on ap.id = l.actor_id
  where (p_action    is null or l.action = p_action)
    and (p_actor     is null or l.actor_id = p_actor)
    and (p_target_id is null or l.target_id = p_target_id)
    and (p_from      is null or l.created_at >= p_from)
    and (p_to        is null or l.created_at <  p_to)
  order by l.created_at desc, l.id desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$fn$;

comment on function public.admin_action_list(text, uuid, uuid, timestamptz, timestamptz, integer, integer)
  is 'Журнал действий администраторов с фильтрами и пагинацией; единственный способ прочитать admin_action_log';

grant execute on function public.admin_action_list(text, uuid, uuid, timestamptz, timestamptz, integer, integer) to authenticated;


-- ============================================================
-- 7) admin_actors — администраторы для фильтра журнала
-- ------------------------------------------------------------
-- Маленькая вспомогательная функция: выпадающий список «кто
-- действовал» в фильтрах журнала. Берём тех, кто реально что-то
-- делал, а не всех с флагом is_admin: фильтр по администратору без
-- единого действия только удлиняет список.
-- ============================================================
create or replace function public.admin_actors()
returns table (
  actor_id   uuid,
  actor_name text,
  actions    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    l.actor_id,
    coalesce(ap.full_name, ap.email, 'модератор'),
    count(*)
  from public.admin_action_log l
  left join public.profiles ap on ap.id = l.actor_id
  group by l.actor_id, ap.full_name, ap.email
  order by count(*) desc;
end;
$fn$;

comment on function public.admin_actors()
  is 'Администраторы, у которых есть записи в журнале — для фильтра';

grant execute on function public.admin_actors() to authenticated;
