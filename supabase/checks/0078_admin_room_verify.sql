-- ============================================================
-- AUTO.RS — Проверка миграции 0078 (фундамент админ-комнаты).
-- ============================================================
-- Выполняется в SQL Editor ПОСЛЕ применения 0078. Ничего не меняет:
-- блоки 1–7 только читают системные каталоги и печатают признак «ok»
-- или то, что пошло не так.
--
-- Блок 8 — ОТДЕЛЬНЫЙ, ручной: он выполняет реальное отклонение и
-- откатывает его. Запускать его нужно осознанно и отдельно от
-- остальных, поэтому он завёрнут в комментарий с инструкцией.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Таблица журнала: колонки, типы, обязательность.
-- ------------------------------------------------------------
-- Проверяем состав, а не только факт существования: create table if
-- not exists промолчит, если таблица с таким именем уже была заведена
-- вручную с другим набором полей.
select
  string_agg(column_name || ':' || data_type, ', ' order by ordinal_position) as columns,
  case
    when count(*) filter (where column_name = 'id'           and is_identity = 'YES') = 1
     and count(*) filter (where column_name = 'actor_id'     and is_nullable = 'NO')  = 1
     and count(*) filter (where column_name = 'action'       and is_nullable = 'NO')  = 1
     and count(*) filter (where column_name = 'target_table')                         = 1
     and count(*) filter (where column_name = 'target_id')                            = 1
     and count(*) filter (where column_name = 'payload'      and is_nullable = 'NO')  = 1
     and count(*) filter (where column_name = 'created_at'   and is_nullable = 'NO')  = 1
    then 'ok'
    else 'ВНИМАНИЕ: состав колонок admin_action_log отличается от ожидаемого'
  end as verdict
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'admin_action_log';


-- ------------------------------------------------------------
-- 2) ГЛАВНОЕ ПО БЕЗОПАСНОСТИ: журнал закрыт с двух сторон.
-- ------------------------------------------------------------
-- RLS включён И политик нет ни одной (значит, под RLS доступ запрещён
-- полностью) И табличных грантов у anon/authenticated тоже нет.
-- Одного RLS мало: гранты выдаются независимо от него, и таблица с
-- включённым RLS без политик, но с грантом, всё равно вернула бы
-- ноль строк — а вот INSERT прошёл бы, если бы политика insert
-- когда-нибудь появилась по недосмотру. Проверяем оба замка.
select
  c.relrowsecurity                                          as rls_enabled,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'admin_action_log') as policies,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name   = 'admin_action_log'
      and grantee in ('anon', 'authenticated'))             as grants_to_clients,
  case
    when c.relrowsecurity
     and (select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'admin_action_log') = 0
     and (select count(*) from information_schema.role_table_grants
           where table_schema = 'public'
             and table_name   = 'admin_action_log'
             and grantee in ('anon', 'authenticated')) = 0
    then 'ok'
    else 'ВНИМАНИЕ: журнал доступен клиентским ролям — проверьте revoke и политики'
  end                                                       as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'admin_action_log';


-- ------------------------------------------------------------
-- 3) Индексы журнала на месте.
-- ------------------------------------------------------------
select
  string_agg(indexname, ', ' order by indexname) as indexes,
  case when count(*) filter (
         where indexname in ('idx_admin_log_created',
                             'idx_admin_log_actor',
                             'idx_admin_log_target')) = 3
       then 'ok'
       else 'ВНИМАНИЕ: не хватает индексов журнала'
  end                                            as verdict
from pg_indexes
where schemaname = 'public'
  and tablename  = 'admin_action_log';


-- ------------------------------------------------------------
-- 4) Функции существуют в единственном экземпляре и объявлены верно.
-- ------------------------------------------------------------
-- Дубль сигнатуры — самая коварная ошибка: ошибки не будет, вызов
-- просто уйдёт в старую версию. Поэтому считаем перегрузки.
select
  p.proname                                                  as function_name,
  count(*)                                                   as overloads,
  bool_and(p.prosecdef)                                      as security_definer,
  bool_and('search_path=public' = any(coalesce(p.proconfig, array[]::text[]))) as search_path_pinned,
  case
    when count(*) = 1
     and bool_and(p.prosecdef)
     and bool_and('search_path=public' = any(coalesce(p.proconfig, array[]::text[])))
    then 'ok'
    else 'ВНИМАНИЕ: перегрузки, отсутствие definer или незакреплённый search_path'
  end                                                        as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('f_admin_log', 'admin_guard', 'admin_dashboard_stats',
                    'approve_car', 'reject_car')
group by p.proname
order by p.proname;


-- ------------------------------------------------------------
-- 5) ПРИЁМКА СОВМЕСТИМОСТИ: сигнатуры не изменились.
-- ------------------------------------------------------------
-- Flutter вызывает approve_car(car_id) и reject_car(car_id, comment)
-- по ИМЕНАМ параметров и разбирает возвращённую строку cars. Любое
-- расхождение здесь ломает приложение молча — на этапе выполнения.
select
  p.proname                                     as function_name,
  pg_get_function_identity_arguments(p.oid)     as args,
  pg_get_function_result(p.oid)                 as returns,
  case
    when p.proname = 'approve_car'
     and pg_get_function_identity_arguments(p.oid) = 'car_id uuid'
     and pg_get_function_result(p.oid)             = 'cars'
    then 'ok'
    when p.proname = 'reject_car'
     and pg_get_function_identity_arguments(p.oid) = 'car_id uuid, comment text'
     and pg_get_function_result(p.oid)             = 'cars'
    then 'ok'
    else 'ВНИМАНИЕ: сигнатура изменилась — вызовы приложения сломаются'
  end                                           as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('approve_car', 'reject_car');


-- ------------------------------------------------------------
-- 6) Гранты на функции: что открыто клиенту, а что нет.
-- ------------------------------------------------------------
-- f_admin_log НЕ должна быть доступна никому снаружи: она пишет в
-- журнал от имени auth.uid() без проверки прав, рассчитывая на то,
-- что права проверил вызывающий. Прямой доступ к ней позволил бы
-- любому авторизованному засорить журнал.
select
  p.proname                                                          as function_name,
  has_function_privilege('authenticated', p.oid, 'execute')          as authenticated_can_execute,
  has_function_privilege('anon',          p.oid, 'execute')          as anon_can_execute,
  case
    when p.proname = 'f_admin_log'
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
    then 'ok'
    when p.proname in ('admin_guard', 'admin_dashboard_stats', 'approve_car', 'reject_car')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
    then 'ok'
    else 'ВНИМАНИЕ: гранты на функцию отличаются от ожидаемых'
  end                                                                as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('f_admin_log', 'admin_guard', 'admin_dashboard_stats',
                    'approve_car', 'reject_car')
order by p.proname;


-- ------------------------------------------------------------
-- 7) is_admin() вызывается внутри обеих RPC модерации.
-- ------------------------------------------------------------
-- Читаем исходник функции из каталога: приёмка требует, чтобы
-- проверка прав стояла в теле, а не только в слое сайта.
select
  p.proname                                                    as function_name,
  position('is_admin()' in pg_get_functiondef(p.oid)) > 0      as has_is_admin,
  position('f_admin_log(' in pg_get_functiondef(p.oid)) > 0    as writes_log,
  case
    when position('is_admin()' in pg_get_functiondef(p.oid)) > 0
     and position('f_admin_log(' in pg_get_functiondef(p.oid)) > 0
    then 'ok'
    else 'ВНИМАНИЕ: нет проверки прав или нет записи в журнал'
  end                                                          as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('approve_car', 'reject_car')
order by p.proname;


-- ------------------------------------------------------------
-- 8) РУЧНАЯ ПРОВЕРКА ПОВЕДЕНИЯ (выполняется отдельно, с откатом).
-- ------------------------------------------------------------
-- Блоки 1–7 читают каталоги. Этот блок проверяет то, чего в каталогах
-- не видно: что короткая причина падает, а нормальная — пишет журнал.
--
-- Выполняется В SQL Editor от роли postgres, поэтому is_admin() внутри
-- вернёт false (auth.uid() = null) и обе RPC упадут на проверке прав.
-- Это правильное поведение, но проверить логику причины так нельзя.
-- Настоящая проверка делается ИЗ ИНТЕРФЕЙСА админки под учётной
-- записью с profiles.is_admin = true:
--
--   а) Открыть карточку из очереди, нажать «Отклонить», ввести
--      причину короче 10 символов → интерфейс показывает ошибку,
--      статус не меняется. Ожидаемый код ошибки от сервера: 23514
--      (check_violation), текст «Причина отклонения обязательна…».
--
--   б) Отклонить с нормальной причиной → статус rejected, в журнале
--      появилась строка. Проверить запросом ниже.
--
--   в) Одобрить объявление → статус active, в журнале строка
--      car_approved с prev_status.
--
-- Запрос для шагов б) и в) — последние 10 записей журнала:
--
--   select l.id, l.created_at, l.action, l.target_id,
--          p.email as actor, l.payload
--     from public.admin_action_log l
--     left join public.profiles p on p.id = l.actor_id
--    order by l.created_at desc
--    limit 10;
--
-- Ожидается: actor — почта модератора, который нажимал кнопку
-- (а не postgres и не null), payload содержит reason / prev_status.
--
-- Проверка гонки модераторов (необязательная, две вкладки SQL Editor
-- не подойдут — нужна одна сессия с открытой транзакцией):
--   объявление, только что переведённое в active, при повторном
--   вызове approve_car даёт check_violation «текущий статус = active».
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- 9) Сводка админки отвечает (проверка формы ответа).
-- ------------------------------------------------------------
-- От роли postgres функция упадёт на is_admin() — это ожидаемо и
-- само по себе доказывает, что проверка прав работает. Раскомментируйте
-- вызов, чтобы убедиться в тексте ошибки:
--
--   select * from public.admin_dashboard_stats();
--
-- Ожидается: ERROR 42501 (insufficient_privilege), «Недостаточно прав:
-- сводка доступна только администратору». Если вернулись цифры —
-- значит, вы выполняете скрипт под админской сессией, и это тоже ok:
-- сверьте queue_count с фактическим числом объявлений на модерации:
--
--   select count(*) from public.cars where status = 'moderation';
-- ------------------------------------------------------------
