-- ============================================================
-- 0063 — ПОСТ-ПРОВЕРКА: одна таблица вердиктов
-- ============================================================
-- Зачем отдельный файл: SQL Editor экспортирует в CSV результат
-- ТОЛЬКО последнего запроса, поэтому многосекционный 0063_rls_verify.sql
-- выгружается неполностью. Здесь всё сведено в ОДИН select — вывод
-- целиком попадает в CSV.
--
-- Файл только читает (никаких DDL/DML) и безопасен для прода.
-- Запускать ПОСЛЕ применения миграции 0063.
--
-- КАК ЧИТАТЬ: колонка verdict.
--   OK    — так и должно быть;
--   FAIL  — требует разбирательства, миграция что-то сломала.
-- Ни одного FAIL быть не должно.
-- ============================================================

with
-- ------------------------------------------------------------
-- 1) Обёртка (select auth.uid()) — цель миграции.
-- ------------------------------------------------------------
-- pg_policies отдаёт условия уже нормализованными планировщиком,
-- поэтому обёрнутый вызов выглядит как "( SELECT auth.uid()".
pol as (
  select
    count(*) filter (
      where qual       like '%( SELECT auth.uid()%'
         or with_check  like '%( SELECT auth.uid()%'
    )                                                    as wrapped,
    -- Голый auth.uid() без обёртки — то, что миграция должна была убрать.
    count(*) filter (
      where (qual      like '%auth.uid()%' and qual      not like '%( SELECT auth.uid()%')
         or (with_check like '%auth.uid()%' and with_check not like '%( SELECT auth.uid()%')
    )                                                    as bare,
    count(*)                                             as total
  from pg_policies
  where schemaname = 'public'
),
-- ------------------------------------------------------------
-- 2) search_path у НАШИХ функций (без функций расширений).
-- ------------------------------------------------------------
fn as (
  select count(*) as without_sp
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) cfg
                     where cfg like 'search_path=%')
    -- Функции, принадлежащие расширениям (PostGIS ~900 штук), исключаем:
    -- их владелец — extension, менять их нельзя и не нужно.
    and not exists (select 1 from pg_depend d
                     where d.objid = p.oid
                       and d.classid = 'pg_proc'::regclass
                       and d.deptype = 'e')
),
-- ------------------------------------------------------------
-- 3) RLS и число политик по таблицам.
-- ------------------------------------------------------------
tbl as (
  select
    count(*)                                              as rls_tables,
    count(*) filter (where pol_count = 0)                 as no_policy
  from (
    select c.oid,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as pol_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity is true
  ) t
),
-- Таблицы в public БЕЗ RLS — не должно быть ни одной нашей.
norls as (
  select count(*) as cnt
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity is false
    -- spatial_ref_sys принадлежит PostGIS, включить RLS на ней нельзя
    -- (42501 must be owner) — исключаем как известное и принятое.
    and c.relname <> 'spatial_ref_sys'
),
-- ------------------------------------------------------------
-- 4) Целостность политик на ключевых таблицах.
-- ------------------------------------------------------------
-- Миграция пересоздавала политики; их число обязано остаться прежним.
keyt as (
  select
    (select count(*) from pg_policies where schemaname='public' and tablename='cars')                as cars,
    (select count(*) from pg_policies where schemaname='public' and tablename='profiles')            as profiles,
    (select count(*) from pg_policies where schemaname='public' and tablename='bookings')            as bookings,
    (select count(*) from pg_policies where schemaname='public' and tablename='messages')            as messages,
    (select count(*) from pg_policies where schemaname='public' and tablename='wallet_transactions') as wallet,
    (select count(*) from pg_policies where schemaname='public' and tablename='hidden_cars')         as hidden
),
-- ------------------------------------------------------------
-- 5) Storage не тронут — там должны остаться голые auth.uid().
-- ------------------------------------------------------------
sto as (
  select count(*) as cnt from pg_policies where schemaname = 'storage'
)
select * from (
  select 1 as ord, 'Политик в public'                as check_name,
         pol.total::text                             as value,
         '53'                                        as expected,
         case when pol.total = 53 then 'OK' else 'FAIL' end as verdict
    from pol
  union all
  select 2, 'Политик с обёрткой (select auth.uid())',
         pol.wrapped::text, '38',
         case when pol.wrapped = 38 then 'OK' else 'FAIL' end
    from pol
  union all
  select 3, 'Политик с ГОЛЫМ auth.uid() в public',
         pol.bare::text, '0',
         case when pol.bare = 0 then 'OK' else 'FAIL' end
    from pol
  union all
  select 4, 'Наших функций без search_path',
         fn.without_sp::text, '0',
         case when fn.without_sp = 0 then 'OK' else 'FAIL' end
    from fn
  union all
  select 5, 'Таблиц с включённой RLS',
         tbl.rls_tables::text, '25',
         case when tbl.rls_tables = 25 then 'OK' else 'FAIL' end
    from tbl
  union all
  select 6, 'Таблиц RLS без политик (deny-all)',
         tbl.no_policy::text, '2 (otp_send_log, listing_view_log)',
         case when tbl.no_policy = 2 then 'OK' else 'FAIL' end
    from tbl
  union all
  select 7, 'Наших таблиц БЕЗ RLS',
         norls.cnt::text, '0',
         case when norls.cnt = 0 then 'OK' else 'FAIL' end
    from norls
  union all
  select 8, 'Политик на cars',      keyt.cars::text,     '6',
         case when keyt.cars     = 6 then 'OK' else 'FAIL' end from keyt
  union all
  select 9, 'Политик на profiles',  keyt.profiles::text, '3',
         case when keyt.profiles = 3 then 'OK' else 'FAIL' end from keyt
  union all
  select 10,'Политик на bookings',  keyt.bookings::text, '3',
         case when keyt.bookings = 3 then 'OK' else 'FAIL' end from keyt
  union all
  select 11,'Политик на messages',  keyt.messages::text, '3',
         case when keyt.messages = 3 then 'OK' else 'FAIL' end from keyt
  union all
  select 12,'Политик на wallet_transactions', keyt.wallet::text, '2',
         case when keyt.wallet   = 2 then 'OK' else 'FAIL' end from keyt
  union all
  select 13,'Политик на hidden_cars', keyt.hidden::text, '3',
         case when keyt.hidden   = 3 then 'OK' else 'FAIL' end from keyt
  union all
  select 14,'Политик в storage (не трогали)', sto.cnt::text, '12',
         case when sto.cnt = 12 then 'OK' else 'FAIL' end from sto
) x
order by ord;
