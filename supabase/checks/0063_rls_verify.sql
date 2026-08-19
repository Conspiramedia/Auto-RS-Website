-- ============================================================
-- 0063 — ПРОВЕРКА RLS: снимок прав доступа до и после миграции
-- ============================================================
-- НАЗНАЧЕНИЕ: доказать, что миграция 0063 не изменила НИ ОДНОГО
-- набора видимых строк. Обёртка (select auth.uid()) обязана быть
-- семантически прозрачной — этот файл проверяет, что так и есть.
--
-- КАК ПОЛЬЗОВАТЬСЯ:
--   1) прогнать ДО миграции, сохранить вывод;
--   2) применить 0063;
--   3) прогнать ПОСЛЕ, сравнить построчно.
-- Значения обязаны совпасть строка в строку, КРОМЕ секций 7 и 8 —
-- они измеряют саму цель миграции и обязаны измениться. Любое
-- другое расхождение — миграция НЕ идёт в прод.
--
-- КАК УСТРОЕНО: подменяем роль и JWT-claims через set local, читаем
-- таблицы напрямую (RLS применяется к обычным ролям) и считаем строки.
-- Всё внутри транзакции с ROLLBACK в конце — файл ничего не меняет
-- в базе и безопасен для прода.
--
-- ВАЖНО: скрипт подбирает реальные id из базы. Прогоны ДО и ПОСЛЕ
-- должны идти на ОДНИХ И ТЕХ ЖЕ данных: между ними не публиковать
-- объявления и не менять статусы.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Фикстуры: реальные id из текущей базы.
-- ------------------------------------------------------------
create temporary table _fx on commit drop as
select
  -- Продавец с объявлением на модерации: только на нём видна разница
  -- между «свои все» и «чужие только active».
  (select c.user_id from public.cars c
    where c.status = 'moderation' limit 1)                as seller_id,
  -- Админ: у него отдельная политика на moderation/rejected.
  (select p.id from public.profiles p
    where p.is_admin is true limit 1)                     as admin_id,
  -- Любой другой пользователь — «чужой».
  (select p.id from public.profiles p
    where p.id <> coalesce((select c.user_id from public.cars c
                             where c.status = 'moderation' limit 1),
                           '00000000-0000-0000-0000-000000000000'::uuid)
    limit 1)                                              as other_id;

-- На каких фикстурах шёл прогон: если id разошлись между прогонами,
-- сравнивать счётчики бессмысленно.
-- Роли anon/authenticated читают _fx внутри сценариев (подзапросы
-- вида (select seller_id from _fx)), поэтому выдаём им доступ.
-- Это временная таблица в pg_temp текущей сессии: другие соединения
-- её не видят, а на rollback она исчезает вместе с грантами.
grant select on _fx to anon, authenticated;

select 'ФИКСТУРЫ' as section, seller_id, admin_id, other_id from _fx;

-- Контрольные суммы данных: разошлись — значит поменялись данные,
-- а не поведение RLS.
select 'ДАННЫЕ' as section,
       (select count(*) from public.cars)                           as cars_total,
       (select count(*) from public.cars where status='active')     as cars_active,
       (select count(*) from public.cars where status='moderation') as cars_moderation,
       (select count(*) from public.hidden_cars)                    as hidden_total;


-- ============================================================
-- 1. ANON — только status='active'
-- ============================================================
-- Политика cars_select_active_public: using (status = 'active'),
-- роль не указана → действует и на anon.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select '1. anon: cars' as scenario,
       count(*)                                   as visible_total,
       count(*) filter (where status = 'active')  as visible_active,
       count(*) filter (where status <> 'active') as non_active_MUST_BE_0
  from public.cars;

select '1. anon: приватное' as scenario,
       (select count(*) from public.profiles)            as profiles_MUST_BE_0,
       (select count(*) from public.bookings)            as bookings_MUST_BE_0,
       (select count(*) from public.wallet_transactions) as wallet_MUST_BE_0,
       (select count(*) from public.messages)            as messages_MUST_BE_0,
       (select count(*) from public.favorites)           as favorites_MUST_BE_0;

reset role;


-- ============================================================
-- 2. ПРОДАВЕЦ — свои все (вкл. moderation) + чужие active
-- ============================================================
-- SET не вычисляет подзапросы (это утилитарная команда, а не запрос),
-- поэтому claims ставим через set_config() внутри обычного select.
-- Порядок «claims → роль» намеренный: под своей ролью доступ к _fx
-- гарантирован и не зависит от выданных выше грантов.
select set_config('request.jwt.claims',
                  json_build_object('role','authenticated',
                                    'sub',seller_id)::text,
                  true) from _fx;
set local role authenticated;

select '2. продавец: cars' as scenario,
       count(*)                                                       as visible_total,
       count(*) filter (where user_id  = (select seller_id from _fx)) as own_visible,
       count(*) filter (where user_id  = (select seller_id from _fx)
                          and status <> 'active')                     as own_non_active,
       count(*) filter (where user_id <> (select seller_id from _fx)
                          and status <> 'active')                     as alien_non_active_MUST_BE_0
  from public.cars;

select '2. продавец: своё' as scenario,
       (select count(*) from public.favorites
         where user_id <> (select seller_id from _fx))                 as alien_favorites_MUST_BE_0,
       (select count(*) from public.saved_searches
         where user_id <> (select seller_id from _fx))                 as alien_searches_MUST_BE_0,
       (select count(*) from public.notifications
         where user_id <> (select seller_id from _fx))                 as alien_notif_MUST_BE_0;

select '2. продавец: кошелёк' as scenario,
       (select count(*) from public.wallet_transactions)               as wallet_visible,
       (select count(*) from public.wallet_transactions
         where user_id <> (select seller_id from _fx))                 as alien_wallet_MUST_BE_0,
       (select count(*) from public.transactions)                      as tx_visible;

select '2. продавец: чат' as scenario,
       (select count(*) from public.chats)                             as chats_visible,
       (select count(*) from public.messages)                          as messages_visible,
       (select count(*) from public.chat_prefs
         where user_id <> (select seller_id from _fx))                 as alien_prefs_MUST_BE_0;

reset role;


-- ============================================================
-- 3. АДМИН — видит модерацию
-- ============================================================
-- SET не вычисляет подзапросы (это утилитарная команда, а не запрос),
-- поэтому claims ставим через set_config() внутри обычного select.
-- Порядок «claims → роль» намеренный: под своей ролью доступ к _fx
-- гарантирован и не зависит от выданных выше грантов.
select set_config('request.jwt.claims',
                  json_build_object('role','authenticated',
                                    'sub',admin_id)::text,
                  true) from _fx;
set local role authenticated;

select '3. админ: cars' as scenario,
       count(*)                                      as visible_total,
       count(*) filter (where status = 'moderation') as moderation_visible,
       count(*) filter (where status = 'rejected')   as rejected_visible
  from public.cars;

reset role;


-- ============================================================
-- 4. HIDDEN_CARS — скрытия персональные
-- ============================================================
-- Сам факт скрытия не убирает объявление из cars (фильтрация идёт
-- в RPC ленты), поэтому проверяется изоляция строк hidden_cars
-- между пользователями.
-- SET не вычисляет подзапросы (это утилитарная команда, а не запрос),
-- поэтому claims ставим через set_config() внутри обычного select.
-- Порядок «claims → роль» намеренный: под своей ролью доступ к _fx
-- гарантирован и не зависит от выданных выше грантов.
select set_config('request.jwt.claims',
                  json_build_object('role','authenticated',
                                    'sub',seller_id)::text,
                  true) from _fx;
set local role authenticated;

select '4. hidden: продавец' as scenario,
       count(*)                                                       as visible_total,
       count(*) filter (where user_id <> (select seller_id from _fx)) as alien_MUST_BE_0
  from public.hidden_cars;

reset role;

-- SET не вычисляет подзапросы (это утилитарная команда, а не запрос),
-- поэтому claims ставим через set_config() внутри обычного select.
-- Порядок «claims → роль» намеренный: под своей ролью доступ к _fx
-- гарантирован и не зависит от выданных выше грантов.
select set_config('request.jwt.claims',
                  json_build_object('role','authenticated',
                                    'sub',other_id)::text,
                  true) from _fx;
set local role authenticated;

select '4. hidden: другой' as scenario,
       count(*)                                                      as visible_total,
       count(*) filter (where user_id <> (select other_id from _fx)) as alien_MUST_BE_0
  from public.hidden_cars;

select '4. другой: приватное' as scenario,
       (select count(*) from public.wallet_transactions
         where user_id <> (select other_id from _fx))                 as alien_wallet_MUST_BE_0,
       (select count(*) from public.user_push_tokens
         where user_id <> (select other_id from _fx))                 as alien_tokens_MUST_BE_0;

reset role;


-- ============================================================
-- 5. СЛУЖЕБНЫЕ ТАБЛИЦЫ — deny-all
-- ============================================================
-- RLS включена, политик нет → строк не видно никому, кроме
-- SECURITY DEFINER-функций.
-- SET не вычисляет подзапросы (это утилитарная команда, а не запрос),
-- поэтому claims ставим через set_config() внутри обычного select.
-- Порядок «claims → роль» намеренный: под своей ролью доступ к _fx
-- гарантирован и не зависит от выданных выше грантов.
select set_config('request.jwt.claims',
                  json_build_object('role','authenticated',
                                    'sub',seller_id)::text,
                  true) from _fx;
set local role authenticated;

select '5. deny-all' as scenario,
       (select count(*) from public.otp_send_log)     as otp_log_MUST_BE_0,
       (select count(*) from public.listing_view_log) as view_log_MUST_BE_0;

reset role;


-- ============================================================
-- 6. СНИМОК СХЕМЫ RLS — обязан совпасть до и после
-- ============================================================
-- Политики пересоздаются один в один, их количество не меняется.
select '6. схема' as scenario,
       c.relname                                                   as table_name,
       c.relrowsecurity                                            as rls_enabled,
       (select count(*) from pg_policy p where p.polrelid = c.oid)  as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity is true
 order by c.relname;


-- ============================================================
-- 7-8. ЦЕЛЬ МИГРАЦИИ — эти две секции обязаны РАЗЛИЧАТЬСЯ
-- ============================================================
-- ДО: initplan_wrapped = 0. ПОСЛЕ: 38.
select '7. initplan' as scenario,
       count(*) filter (where qual like '%( SELECT auth.uid()%'
                          or with_check like '%( SELECT auth.uid()%') as initplan_wrapped,
       count(*)                                                       as policies_in_public
  from pg_policies
 where schemaname = 'public';

-- ДО: 10. ПОСЛЕ: 0.
-- ВАЖНО: исключаем функции, принадлежащие расширениям. PostGIS кладёт
-- в public около 900 своих функций (ST_*), у них search_path не задан,
-- и без этого фильтра счётчик показывал бы ~950 вместо наших десяти.
-- Владельцем таких функций является extension, менять их мы не можем
-- и не должны (тот же случай, что и spatial_ref_sys).
select '8. search_path' as scenario,
       count(*) as functions_without_search_path
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) cfg
                    where cfg like 'search_path=%')
   and not exists (select 1 from pg_depend d
                    where d.objid = p.oid
                      and d.classid = 'pg_proc'::regclass
                      and d.deptype = 'e');

rollback;
