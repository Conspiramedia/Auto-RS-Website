-- ============================================================
-- RS AUTO — в списке пользователей только те, кто реально вошёл.
-- ============================================================
-- ЧТО БЫЛО НЕ ТАК. Админский список показывал всех, у кого есть строка
-- в auth.users, — а она появляется в момент ЗАПРОСА кода, а не после
-- его ввода. Человек, набравший почту и закрывший вкладку, попадал в
-- список наравне с настоящими продавцами. С открытой регистрацией
-- (0107) туда же посыпался бы мусор: 5 адресов в сутки с одного адреса
-- и 20 в час с одного IP — квоты защищают от перебора, но не от
-- появления записей.
--
-- ------------------------------------------------------------
-- ПОЧЕМУ НЕЛЬЗЯ ОПЕРЕТЬСЯ НА ПОЛЯ auth.users.
-- ------------------------------------------------------------
-- Очевидные кандидаты — email_confirmed_at и last_sign_in_at — здесь
-- бесполезны. На проде включён mailer_autoconfirm, и GoTrue проставляет
-- ОБА поля в момент создания записи, ещё до отправки письма. Замерено
-- на живой базе: разрыв между created_at и last_sign_in_at у аккаунта,
-- который код не вводил, — 36 миллисекунд.
--
-- Полагаться на настройку панели тоже нельзя: её видно только в
-- Dashboard, она не хранится в репозитории, и любое переключение молча
-- изменило бы смысл админского списка. Фильтр обязан быть верным при
-- любом её значении.
--
-- ------------------------------------------------------------
-- ЧТО СЛУЖИТ ПРИЗНАКОМ ВХОДА: auth.sessions.
-- ------------------------------------------------------------
-- Строка в auth.sessions создаётся ТОЛЬКО когда GoTrue выдаёт сессию,
-- то есть после успешного verifyOtp. Запрос кода сессии не создаёт —
-- проверять там нечего, кода ещё нет. Автоподтверждение на это не
-- влияет: оно помечает адрес доверенным, но сессию не выдаёт.
--
-- Поэтому «пользователь реально вошёл» = «у него есть или была хотя бы
-- одна сессия».
--
-- ПОЧЕМУ exists, А НЕ join. Сессий у человека много (по одной на
-- устройство и на каждое обновление токена), и join размножил бы строки
-- пользователя. exists отвечает на вопрос «была ли хоть одна» и
-- останавливается на первой найденной.
--
-- ЧТО С УДАЛЁННЫМИ СЕССИЯМИ. GoTrue чистит истёкшие сессии, и у
-- человека, не заходившего очень давно, их может не остаться вовсе —
-- тогда он выпадет из списка. Это осознанный размен: список нужен для
-- работы с живой аудиторией, а не как архив всех, кто когда-либо
-- касался формы входа. Сам профиль при этом на месте и никуда не
-- девается — фильтруется только выдача.
--
-- СИГНАТУРА НЕ МЕНЯЕТСЯ: те же параметры, те же колонки. Приложение
-- эту функцию не вызывает (раздел админский), но правило проекта
-- одно — миграции аддитивные.
-- ============================================================

create or replace function public.admin_list_users(
  p_query    text    default null,
  p_type     text    default null,
  p_limit    integer default 50,
  p_offset   integer default 0,
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
    -- ГЛАВНОЕ УСЛОВИЕ: человек хотя бы раз получил сессию.
    -- Администраторы проходят его наравне со всеми — свою сессию
    -- админ тоже получал, иначе не открыл бы эту страницу.
    exists (
      select 1 from auth.sessions s where s.user_id = p.id
    )
    and (
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
  is 'Список пользователей, ХОТЯ БЫ РАЗ получивших сессию (auth.sessions), со статистикой объявлений; p_new_days — только зарегистрированные за N дней; только для админа';

grant execute on function public.admin_list_users(text, text, integer, integer, integer) to authenticated;


-- ============================================================
-- Счётчики сводки — по тому же правилу.
-- ------------------------------------------------------------
-- Карточка «Пользователи» на главной админки считала все строки
-- profiles и разошлась бы со списком: в списке три человека, в
-- счётчике семь. Расхождение цифр на соседних экранах читается как
-- поломка, поэтому условие здесь то же самое — наличие сессии.
--
-- Правится ТОЛЬКО два счётчика (users_total и users_new_7d);
-- остальные поля, сигнатура и порядок колонок не тронуты.
-- ============================================================
create or replace function public.admin_dashboard_stats()
returns table (
  queue_count     bigint,   -- ждут проверки прямо сейчас
  rejected_today  bigint,   -- отклонено с начала суток
  approved_today  bigint,   -- одобрено с начала суток
  active_total    bigint,   -- опубликовано всего
  users_total     bigint,   -- ВОШЕДШИХ хотя бы раз (см. шапку)
  users_new_7d    bigint,   -- из них новых за неделю
  email_pending   bigint,   -- писем ждёт отправки
  email_failed    bigint    -- писем провалилось (ИНЦИДЕНТ)
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: сводка доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    (select count(*) from public.cars c
      where c.status = 'moderation'),

    -- Одобрения и отклонения берём ИЗ ЖУРНАЛА, а не из cars.status:
    -- статус показывает текущее состояние, а нам нужно количество
    -- решений за сутки. Объявление, отклонённое утром и одобренное
    -- после правки вечером, — два решения, а в cars останется одна
    -- строка со статусом active.
    (select count(*) from public.admin_action_log l
      where l.action = 'car_rejected'
        and l.created_at >= date_trunc('day', now())),

    (select count(*) from public.admin_action_log l
      where l.action = 'car_approved'
        and l.created_at >= date_trunc('day', now())),

    (select count(*) from public.cars c
      where c.status = 'active'),

    -- Только вошедшие: то же условие, что в admin_list_users.
    (select count(*) from public.profiles p
      where exists (select 1 from auth.sessions s where s.user_id = p.id)),

    (select count(*) from public.profiles p
      where p.created_at >= now() - interval '7 days'
        and exists (select 1 from auth.sessions s where s.user_id = p.id)),

    (select count(*) from public.email_queue q
      where q.status = 'pending'),

    (select count(*) from public.email_queue q
      where q.status = 'failed');
end;
$fn$;

comment on function public.admin_dashboard_stats()
  is 'Сводка для главной админки. Пользователи считаются по факту входа (auth.sessions), как и в списке';

grant execute on function public.admin_dashboard_stats() to authenticated;
