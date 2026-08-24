-- ============================================================
-- AUTO.RS — Проверка миграции 0080 (объявления, пользователи, журнал).
-- ============================================================
-- Выполняется в SQL Editor ПОСЛЕ применения 0080. Блоки 1–5 только
-- читают каталоги. Блок 6 — ручной, с инструкцией.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Все шесть функций существуют и объявлены как надо.
-- ------------------------------------------------------------
select
  p.proname                                    as function_name,
  count(*)                                     as overloads,
  bool_and(p.prosecdef)                        as security_definer,
  bool_and('search_path=public' = any(coalesce(p.proconfig, array[]::text[])))
                                               as search_path_pinned,
  case
    when count(*) = 1
     and bool_and(p.prosecdef)
     and bool_and('search_path=public' = any(coalesce(p.proconfig, array[]::text[])))
    then 'ok'
    else 'ВНИМАНИЕ: перегрузки, нет definer или незакреплённый search_path'
  end                                          as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_list_cars', 'admin_set_car_status',
    'admin_list_users', 'admin_get_user',
    'admin_action_list', 'admin_actors'
  )
group by p.proname
order by p.proname;


-- ------------------------------------------------------------
-- 2) ГЛАВНОЕ ПО БЕЗОПАСНОСТИ: is_admin() в теле каждой.
-- ------------------------------------------------------------
-- Все шесть — definer и читают profiles, auth.users и закрытый
-- журнал. Без проверки прав внутри любой авторизованный получил бы
-- список пользователей с почтой и телефонами.
select
  p.proname                                               as function_name,
  position('is_admin()' in pg_get_functiondef(p.oid)) > 0 as has_is_admin,
  case
    when position('is_admin()' in pg_get_functiondef(p.oid)) > 0
    then 'ok'
    else 'ВНИМАНИЕ: нет проверки прав — функция отдаёт данные кому угодно'
  end                                                     as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_list_cars', 'admin_set_car_status',
    'admin_list_users', 'admin_get_user',
    'admin_action_list', 'admin_actors'
  )
order by p.proname;


-- ------------------------------------------------------------
-- 3) Гранты: authenticated может звать, anon — нет.
-- ------------------------------------------------------------
select
  p.proname                                                  as function_name,
  has_function_privilege('authenticated', p.oid, 'execute')  as authenticated_can_execute,
  has_function_privilege('anon',          p.oid, 'execute')  as anon_can_execute,
  case
    when has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
    then 'ok'
    else 'ВНИМАНИЕ: гранты отличаются от ожидаемых'
  end                                                        as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_list_cars', 'admin_set_car_status',
    'admin_list_users', 'admin_get_user',
    'admin_action_list', 'admin_actors'
  )
order by p.proname;


-- ------------------------------------------------------------
-- 4) Шаблон письма о снятии разрешён ограничением таблицы.
-- ------------------------------------------------------------
-- Порядок здесь критичен: если ограничение не обновилось, вставка
-- письма упадёт на chk_email_template и ОТКАТИТ ВМЕСТЕ С СОБОЙ смену
-- статуса. Администратор увидит непонятную ошибку, а объявление
-- останется опубликованным.
select
  pg_get_constraintdef(c.oid) as definition,
  case
    when position('car_archived_by_admin' in pg_get_constraintdef(c.oid)) > 0
    then 'ok'
    else 'ВНИМАНИЕ: шаблон не разрешён — снятие объявления будет падать'
  end                         as verdict
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'email_queue'
  and c.conname = 'chk_email_template';


-- ------------------------------------------------------------
-- 5) Триггер писем знает про снятие и различает, кто снял.
-- ------------------------------------------------------------
-- Две проверки в одной: функция обрабатывает переход в archived И
-- смотрит в журнал, чтобы не слать письмо владельцу, который снял
-- объявление сам (для него это был бы спам).
select
  position('car_archived_by_admin' in pg_get_functiondef(p.oid)) > 0 as handles_archived,
  position('admin_action_log' in pg_get_functiondef(p.oid)) > 0      as checks_log,
  case
    when position('car_archived_by_admin' in pg_get_functiondef(p.oid)) > 0
     and position('admin_action_log' in pg_get_functiondef(p.oid)) > 0
    then 'ok'
    else 'ВНИМАНИЕ: триггер не обновился — письма о снятии не уйдут'
  end                                                                as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'email_on_car_moderation';


-- ------------------------------------------------------------
-- 6) РУЧНАЯ ПРОВЕРКА (из интерфейса, под учётной записью админа).
-- ------------------------------------------------------------
-- ВАЖНО ПЕРЕД ПРОВЕРКОЙ: задеплоить Edge Function send-email. Шаблон
-- car_archived_by_admin добавлен и в неё (templates.ts). Пока функция
-- старая, письмо ляжет в failed с внятной ошибкой — оно не потеряется,
-- но и не уйдёт. Проверить статус очереди:
--
--   select status, count(*) from public.email_queue
--    where template_key = 'car_archived_by_admin' group by status;
--
-- ЧТО ПРОВЕРИТЬ:
--
--   а) Поиск двуалфавитный. /admin/listings, в поиск «Шкода» —
--      находятся объявления Škoda. И наоборот. Сверить с каталогом:
--      админка обязана находить то же, что и покупатель.
--
--   б) Поиск по id. Вставить uuid объявления в то же поле — должно
--      найтись ровно одно.
--
--   в) Снятие требует причину. Нажать «Снять», ввести 9 символов —
--      кнопка неактивна. С 10 и более — работает.
--
--   г) Снятие целиком. Снять опубликованное объявление и проверить
--      все четыре следствия одним запросом:
--
--        select c.status,
--               (select count(*) from public.admin_action_log l
--                 where l.target_id = c.id and l.action = 'car_archived') as log_rows,
--               (select count(*) from public.email_queue q
--                 where q.template_key = 'car_archived_by_admin'
--                   and q.user_id = c.user_id
--                   and q.created_at > now() - interval '5 minutes') as emails,
--               (select count(*) from public.notifications nt
--                 where nt.action_id = c.id and nt.type = 'car_archived') as notifications
--          from public.cars c
--         where c.id = 'ВСТАВЬТЕ-ID';
--
--      Ожидается: archived, 1, 1, 1.
--
--   д) Владелец снимает сам — письма НЕТ. Из кабинета продавца
--      (/my) снять объявление в архив и убедиться, что новых писем
--      car_archived_by_admin не появилось. Это и есть смысл проверки
--      журнала в триггере: продавец знает, что сделал.
--
--   е) Матрица переходов. Попробовать снять объявление на модерации —
--      RPC должна отказать (check_violation): для этого есть
--      approve_car/reject_car, и второй путь к тем же статусам
--      обошёл бы модерационные правила. Кнопка в интерфейсе для таких
--      статусов не рисуется вовсе, проверять — прямым вызовом:
--
--        select public.admin_set_car_status(
--          'ID-НА-МОДЕРАЦИИ', 'archived', 'проверка матрицы переходов');
--
--   ж) Пользователи: is_admin виден, но не редактируется. Открыть
--      /admin/users — у администратора плашка «админ». Открыть его
--      карточку — плашка есть, кнопки выдачи и снятия прав НЕТ.
--      Это защита от собственного скомпрометированного аккаунта.
--
--   з) auth.users наружу не течёт. В ответе admin_list_users есть
--      last_sign_in_at и НИЧЕГО больше из auth.users — ни
--      encrypted_password, ни recovery_token. Проверить составом
--      возвращаемых колонок:
--
--        select pg_get_function_result(p.oid)
--          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname = 'public' and p.proname = 'admin_list_users';
--
--   и) Журнал: фильтры и раскрытие. /admin/log — выбрать действие и
--      период, убедиться, что список сузился. Раскрыть строку тапом:
--      видны причина, прежний статус, марка и модель. Проверить, что
--      раскрытие работает с клавиатуры (Tab до строки, Enter) — это
--      нативный <details>, скриптов там нет.
--
--   к) Пагинация журнала. При числе записей больше 50 внизу
--      появляются «Назад/Вперёд» и счётчик. Перейти на вторую
--      страницу с применёнными фильтрами — фильтры обязаны
--      сохраниться в адресе.
-- ------------------------------------------------------------
