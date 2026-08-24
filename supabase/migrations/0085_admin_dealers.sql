-- ============================================================
-- AUTO.RS — Миграция 0085: окна автосалонов в админке
-- ============================================================
-- ЧТО ДОБАВЛЯЕТСЯ:
--   1) поля профиля салона: trusted_seller, город, контактное лицо,
--      дата договора;
--   2) admin_dealer_cards()  — карточки всех салонов ОДНИМ запросом
--      (счётчики считаются агрегатом, а не подзапросом на каждый салон);
--   3) admin_get_dealer()    — профиль салона + мини-статы для окна;
--   4) admin_set_trusted()   — тумблер «публиковать без модерации»;
--   5) admin_block_dealer()  — блокировка: снять флаг и скрыть объявления.
--
-- ГЛАВНОЕ ПО СМЫСЛУ — trusted_seller. Флаг означает «объявления этого
-- салона публикуются, минуя очередь модерации». Это не косметика:
-- салон с флагом получает право публиковать в обход единственной
-- проверки контента на площадке. Поэтому:
--   • читать и писать флаг может ТОЛЬКО администратор (RLS ниже);
--   • каждое переключение попадает в журнал admin_action_log;
--   • по умолчанию false — новый салон проходит модерацию, как все.
--
-- САМА АВТОПУБЛИКАЦИЯ В ЭТОЙ МИГРАЦИИ НЕ ВКЛЮЧАЕТСЯ. Здесь заводится
-- флаг, хранилище и управление им из админки. Триггер, который будет
-- ставить объявлениям доверенного салона статус active вместо
-- moderation, — отдельная задача: он меняет поведение подачи для
-- живых продавцов, и включать его надо осознанно, а не заодно с
-- редизайном интерфейса. До тех пор флаг виден админу и ни на что
-- не влияет — это честнее, чем скрытая логика.
--
-- СОВМЕСТИМОСТЬ: существующие RPC и вызовы приложения не меняются.
-- Все новые функции — с префиксом admin_, доступны только authenticated
-- и проверяют is_admin() первой строкой.
-- ============================================================


-- ============================================================
-- БЛОК 1. ПОЛЯ ПРОФИЛЯ САЛОНА
-- ============================================================
-- Все четыре поля nullable и не имеют constraint «обязательно для
-- дилера»: салоны уже заведены, и требование заполненности сломало бы
-- существующие строки. Незаполненное поле окно салона просто не
-- показывает — так же, как /contact поступает с реквизитами оператора.
alter table public.profiles
  -- Публиковать без модерации. default false — новый салон проходит
  -- очередь, как все. Not null: тумблер с тремя состояниями (да / нет /
  -- неизвестно) в интерфейсе означал бы, что админ не знает, действует
  -- ли право прямо сейчас.
  add column if not exists trusted_seller  boolean not null default false,
  -- Город салона. Отдельно от cars.city: у салона один адрес, а
  -- объявления он может выставлять по нескольким городам.
  add column if not exists company_city    text,
  -- Контактное лицо — с кем именно разговаривать. Не дублирует
  -- full_name: профиль заведён на компанию, а разговаривает админ с
  -- менеджером, и это разные имена.
  add column if not exists contact_person  text,
  -- Дата договора с площадкой. date, а не timestamptz: у договора нет
  -- времени суток, и хранить его значило бы показывать «14 марта 03:00»
  -- из-за пересчёта часового пояса.
  add column if not exists contract_date   date;

comment on column public.profiles.trusted_seller
  is 'Салон публикует объявления без модерации. Только админ читает и меняет; каждое переключение в admin_action_log';
comment on column public.profiles.company_city
  is 'Город автосалона (адрес компании), не путать с городом объявления';
comment on column public.profiles.contact_person
  is 'Контактное лицо салона: с кем разговаривает администратор';
comment on column public.profiles.contract_date
  is 'Дата договора салона с площадкой';


-- ------------------------------------------------------------
-- RLS: флаг доверия наружу не отдаётся.
-- ------------------------------------------------------------
-- На profiles уже действуют политики из ранних миграций, и переписывать
-- их эта миграция не должна. Но trusted_seller — не обычное поле
-- профиля: по нему видно, чьи объявления не проверяются, а это
-- подсказка, за каким продавцом наблюдать бессмысленно.
--
-- Postgres не умеет RLS на уровне КОЛОНКИ, поэтому закрываем то, что
-- умеет: отзываем право читать и писать эту колонку у клиентских ролей
-- напрямую. Наружу флаг попадает только через admin_* функции ниже —
-- они security definer и проверяют is_admin().
--
-- Колоночный grant не мешает существующим select p.* из RPC: те
-- выполняются с правами владельца функции (definer), а не роли клиента.
revoke select (trusted_seller) on public.profiles from anon, authenticated;
revoke update (trusted_seller) on public.profiles from anon, authenticated;

-- Остальные три поля — обычные реквизиты салона: город и контактное
-- лицо видит и сам владелец профиля в кабинете, скрывать их не от кого.
-- Дату договора наружу не отдаём: это условие сделки с площадкой.
revoke select (contract_date) on public.profiles from anon, authenticated;
revoke update (contract_date) on public.profiles from anon, authenticated;


-- ============================================================
-- БЛОК 2. admin_dealer_cards — карточки салонов ОДНИМ запросом
-- ============================================================
-- Секция «Автосалоны» на главной админки. Требование — без N+1:
-- отдельный запрос счётчиков на каждый салон при двух десятках салонов
-- означал бы два десятка обращений к базе на отрисовку одного экрана.
--
-- Здесь всё считается ОДНИМ проходом по cars: left join + count с
-- filter. Салон без единого объявления при этом не теряется (в отличие
-- от get_site_dealers, где inner join отбрасывает такие строки) —
-- в админке новый салон обязан появиться сразу после регистрации,
-- ещё до первой подачи. Это прямое требование задачи: «новый салон →
-- карточка появляется автоматически».
create or replace function public.admin_dealer_cards()
returns table (
  user_id         uuid,
  company_name    text,
  logo_url        text,
  company_city    text,
  trusted_seller  boolean,
  active_count    integer,   -- опубликованных объявлений
  queue_count     integer,   -- ждут проверки
  rejected_count  integer    -- отклонённых
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: список салонов доступен только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    -- Название пустым не отдаём: карточка без подписи нечитаема.
    -- Запасной вариант тот же, что в get_site_dealers (0072).
    coalesce(nullif(btrim(p.company_name), ''), 'Автосалон'),
    p.logo_url,
    p.company_city,
    p.trusted_seller,
    count(c.id) filter (where c.status = 'active')::integer,
    count(c.id) filter (where c.status = 'moderation')::integer,
    count(c.id) filter (where c.status = 'rejected')::integer
  from public.profiles p
  -- LEFT JOIN, а не INNER: салон без объявлений тоже нужен в списке.
  left join public.cars c on c.user_id = p.id
  where p.seller_kind = 'dealer'
  group by p.id, p.company_name, p.logo_url, p.company_city, p.trusted_seller
  -- Сначала те, у кого есть работа для модератора: салон с очередью
  -- важнее салона, у которого всё разобрано. Затем по числу активных
  -- объявлений, затем по названию — чтобы порядок был устойчив и
  -- карточки не прыгали между обновлениями страницы.
  order by
    count(c.id) filter (where c.status = 'moderation') desc,
    count(c.id) filter (where c.status = 'active') desc,
    coalesce(nullif(btrim(p.company_name), ''), 'Автосалон') asc;
end;
$fn$;

comment on function public.admin_dealer_cards()
  is 'Карточки всех автосалонов со счётчиками одним запросом (без N+1). Салоны без объявлений включаются. Только для админа';

grant execute on function public.admin_dealer_cards() to authenticated;


-- ============================================================
-- БЛОК 3. admin_get_dealer — окно одного салона
-- ============================================================
-- Профиль и мини-статы. Объявления салона отдельным вызовом
-- (admin_list_cars с фильтром по user_id уже существует с 0080 —
-- второй список заводить незачем).
create or replace function public.admin_get_dealer(p_user_id uuid)
returns table (
  user_id         uuid,
  company_name    text,
  logo_url        text,
  company_city    text,
  contact_person  text,
  contact_phone   text,
  phone           text,
  email           text,
  contract_date   date,
  trusted_seller  boolean,
  created_at      timestamptz,
  active_count    integer,
  queue_count     integer,
  rejected_count  integer
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: карточка салона доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    coalesce(nullif(btrim(p.company_name), ''), 'Автосалон'),
    p.logo_url,
    p.company_city,
    p.contact_person,
    -- Два телефона намеренно: contact_phone заполняет салон для связи
    -- по объявлениям, phone — номер входа в аккаунт. Админу нужны оба:
    -- по первому звонят, по второму опознают учётную запись.
    p.contact_phone,
    p.phone,
    p.email,
    p.contract_date,
    p.trusted_seller,
    p.created_at,
    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status = 'active'),
    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status = 'moderation'),
    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status = 'rejected')
  from public.profiles p
  where p.id = p_user_id
    -- Проверка вида продавца — часть контракта функции: окно салона,
    -- открытое на частнике, показало бы пустые поля компании и сбивало
    -- бы с толку. Пустой результат честнее.
    and p.seller_kind = 'dealer';
end;
$fn$;

comment on function public.admin_get_dealer(uuid)
  is 'Профиль автосалона и мини-статы для окна админки. Только для админа';

grant execute on function public.admin_get_dealer(uuid) to authenticated;


-- ============================================================
-- БЛОК 4. admin_set_trusted — тумблер «без модерации»
-- ============================================================
-- Возвращает НОВОЕ состояние флага: интерфейс перерисовывает тумблер
-- по ответу сервера, а не по своему предположению. Разойдись они —
-- админ видел бы включённый тумблер при выключенном праве.
create or replace function public.admin_set_trusted(
  p_user_id uuid,
  p_trusted boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prev    boolean;
  v_kind    text;
  v_company text;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: флаг доверия меняет только администратор'
      using errcode = 'insufficient_privilege';
  end if;

  if p_trusted is null then
    raise exception 'Состояние флага обязательно'
      using errcode = 'check_violation';
  end if;

  -- Блокируем строку до чтения: два администратора не должны разойтись
  -- в гонке, переключая тумблер одновременно.
  select p.trusted_seller, p.seller_kind, p.company_name
    into v_prev, v_kind, v_company
    from public.profiles p
   where p.id = p_user_id
   for update;

  if v_kind is null then
    raise exception 'Профиль % не найден', p_user_id
      using errcode = 'no_data_found';
  end if;

  if v_kind <> 'dealer' then
    raise exception 'Флаг доверия применим только к автосалонам'
      using errcode = 'check_violation';
  end if;

  -- Повторное выставление того же значения — не ошибка (тумблер мог
  -- быть нажат дважды), но и в журнал его писать незачем: запись
  -- «изменил false на false» только засоряет историю.
  if v_prev = p_trusted then
    return v_prev;
  end if;

  update public.profiles
     set trusted_seller = p_trusted,
         updated_at     = now()
   where id = p_user_id;

  -- В журнал — обязательно и с прежним значением: право публиковать в
  -- обход модерации выдаётся и отзывается людьми, и через месяц нужно
  -- уметь ответить, кто и когда его дал.
  perform public.f_admin_log(
    case when p_trusted then 'dealer_trusted_on' else 'dealer_trusted_off' end,
    'profiles',
    p_user_id,
    jsonb_build_object(
      'company', v_company,
      'from',    v_prev,
      'to',      p_trusted
    )
  );

  return p_trusted;
end;
$fn$;

comment on function public.admin_set_trusted(uuid, boolean)
  is 'Включает/выключает публикацию салона без модерации. Пишет в журнал. Только для админа';

grant execute on function public.admin_set_trusted(uuid, boolean) to authenticated;


-- ============================================================
-- БЛОК 5. admin_block_dealer — блокировка салона
-- ============================================================
-- Два действия одной транзакцией: снять флаг доверия и убрать
-- объявления из выдачи. Разделять их нельзя — салон, у которого сняли
-- доверие, но оставили объявления, продолжает торговать; салон, у
-- которого скрыли объявления, но оставили доверие, опубликует новые
-- в обход очереди.
--
-- СКРЫВАЕМ В 'archived', А НЕ УДАЛЯЕМ. Блокировка обратима: объявления
-- восстанавливаются существующим admin_set_car_status (0080), и в нём
-- уже разрешён переход archived → active. Удаление отняло бы у
-- ошибочно заблокированного салона всю его работу.
--
-- Возвращает число скрытых объявлений: интерфейсу нужно показать, что
-- именно произошло («скрыто 12 объявлений»), а не просто «готово».
create or replace function public.admin_block_dealer(
  p_user_id uuid,
  p_reason  text
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_reason  text;
  v_kind    text;
  v_company text;
  v_hidden  integer;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: блокировка доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  -- Границы причины те же, что у reject_car и admin_set_car_status:
  -- один и тот же счётчик символов во всех диалогах админки.
  v_reason := btrim(coalesce(p_reason, ''));

  if length(v_reason) < 10 then
    raise exception 'Причина обязательна и должна содержать не менее 10 символов'
      using errcode = 'check_violation';
  end if;

  if length(v_reason) > 1000 then
    raise exception 'Причина слишком длинная: % символов, максимум 1000', length(v_reason)
      using errcode = 'check_violation';
  end if;

  select p.seller_kind, p.company_name
    into v_kind, v_company
    from public.profiles p
   where p.id = p_user_id
   for update;

  if v_kind is null then
    raise exception 'Профиль % не найден', p_user_id
      using errcode = 'no_data_found';
  end if;

  if v_kind <> 'dealer' then
    raise exception 'Функция применима только к автосалонам'
      using errcode = 'check_violation';
  end if;

  -- 1) Снимаем право публиковать без модерации.
  update public.profiles
     set trusted_seller = false,
         updated_at     = now()
   where id = p_user_id;

  -- 2) Убираем из выдачи только ОПУБЛИКОВАННЫЕ объявления.
  -- Ждущие проверки не трогаем: они и так не видны покупателю, а
  -- модератор разберёт их обычным порядком и, скорее всего, отклонит.
  update public.cars
     set status     = 'archived',
         updated_at = now()
   where user_id = p_user_id
     and status   = 'active';

  get diagnostics v_hidden = row_count;

  perform public.f_admin_log(
    'dealer_blocked',
    'profiles',
    p_user_id,
    jsonb_build_object(
      'company', v_company,
      'reason',  v_reason,
      'hidden',  v_hidden
    )
  );

  return v_hidden;
end;
$fn$;

comment on function public.admin_block_dealer(uuid, text)
  is 'Блокировка салона: снимает флаг доверия и переводит активные объявления в archived. Обратимо через admin_set_car_status. Только для админа';

grant execute on function public.admin_block_dealer(uuid, text) to authenticated;


-- ============================================================
-- БЛОК 6. Фильтр «новые за N дней» в списке пользователей
-- ============================================================
-- Карточка «Новых за 7 дней» на главной админки обязана вести в
-- отфильтрованный список — иначе она показывает число, проверить
-- которое негде.
--
-- Добавляется НОВЫЙ ПАРАМЕТР с default null, а не меняется поведение
-- существующих: старые вызовы admin_list_users(query, type, limit,
-- offset) продолжают работать как прежде. Именованные параметры в
-- supabase-js делают такое расширение безопасным.
--
-- ВАЖНО: старую четырёхаргументную сигнатуру нужно удалить, иначе в
-- схеме останутся две перегрузки, и PostgREST не сможет выбрать между
-- ними при вызове без нового параметра.
drop function if exists public.admin_list_users(text, text, integer, integer);

create or replace function public.admin_list_users(
  p_query    text    default null,
  p_type     text    default null,
  p_limit    integer default 50,
  p_offset   integer default 0,
  -- Показать только зарегистрированных за последние N дней.
  -- null — фильтр не применяется.
  p_new_days integer default null
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
    u.last_sign_in_at,
    count(*) over ()
  from public.profiles p
  left join auth.users u on u.id = p.id
  where
    (
      p_type is null
      or (p_type = 'admin'    and p.is_admin)
      or (p_type = 'verified' and p.verification_status = 'verified')
      or (p_type = 'pending'  and p.verification_status = 'pending')
      or (p_type in ('client', 'dealer') and p.role::text = p_type)
    )
    -- Новый фильтр. greatest(...,1) отсекает 0 и отрицательные:
    -- «новые за 0 дней» — заведомо пустая выдача, которая выглядела бы
    -- как поломка списка.
    and (
      p_new_days is null
      or p.created_at >= now() - (greatest(p_new_days, 1) || ' days')::interval
    )
    and (
      not v_has_q
      or p.email ilike '%' || btrim(p_query) || '%'
      or coalesce(p.phone, '') ilike '%' || btrim(p_query) || '%'
      or public.f_normalize(coalesce(p.full_name, '')) ilike '%' || v_norm || '%'
    )
  order by p.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$fn$;

comment on function public.admin_list_users(text, text, integer, integer, integer)
  is 'Список пользователей со статистикой объявлений; p_new_days — только зарегистрированные за N дней; только для админа';

grant execute on function public.admin_list_users(text, text, integer, integer, integer) to authenticated;
