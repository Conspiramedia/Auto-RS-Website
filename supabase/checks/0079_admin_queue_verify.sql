-- ============================================================
-- AUTO.RS — Проверка миграции 0079 (очередь модерации).
-- ============================================================
-- Выполняется в SQL Editor ПОСЛЕ применения 0079. Блоки 1–4 только
-- читают каталоги и печатают «ok» или то, что пошло не так.
-- Блок 5 — ручной, с инструкцией.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Обе функции существуют в единственном экземпляре и объявлены
--    как надо: definer, stable, закреплённый search_path.
-- ------------------------------------------------------------
-- Дубль сигнатуры — самая коварная ошибка: ошибки не будет, вызов
-- просто уйдёт в старую версию.
select
  p.proname                                    as function_name,
  count(*)                                     as overloads,
  bool_and(p.prosecdef)                        as security_definer,
  bool_and(p.provolatile = 's')                as is_stable,
  bool_and('search_path=public' = any(coalesce(p.proconfig, array[]::text[])))
                                               as search_path_pinned,
  case
    when count(*) = 1
     and bool_and(p.prosecdef)
     and bool_and(p.provolatile = 's')
     and bool_and('search_path=public' = any(coalesce(p.proconfig, array[]::text[])))
    then 'ok'
    else 'ВНИМАНИЕ: перегрузки, нет definer/stable или незакреплённый search_path'
  end                                          as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_moderation_queue', 'admin_get_car')
group by p.proname
order by p.proname;


-- ------------------------------------------------------------
-- 2) ГЛАВНОЕ ПО БЕЗОПАСНОСТИ: is_admin() в теле обеих функций.
-- ------------------------------------------------------------
-- Обе читают profiles и admin_action_log в обход RLS (они definer).
-- Без проверки прав внутри любой авторизованный пользователь получил
-- бы очередь модерации вместе с почтой и телефонами продавцов.
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
  and p.proname in ('admin_moderation_queue', 'admin_get_car')
order by p.proname;


-- ------------------------------------------------------------
-- 3) Гранты: authenticated может звать, anon — нет.
-- ------------------------------------------------------------
-- Права админа отдельной ролью не выдаются (решение 0065): функции
-- доступны authenticated и отбиваются изнутри через is_admin().
-- А вот anon не должен доходить даже до проверки.
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
  and p.proname in ('admin_moderation_queue', 'admin_get_car')
order by p.proname;


-- ------------------------------------------------------------
-- 4) КОДЫ ДЕЙСТВИЙ СОВПАДАЮТ С ТЕМИ, ЧТО ПИШЕТ 0078.
-- ------------------------------------------------------------
-- Самая тихая ошибка этой миграции. admin_get_car фильтрует историю
-- по 'car_approved' / 'car_rejected'. Если в approve_car/reject_car
-- коды другие, история на карточке будет ВСЕГДА ПУСТОЙ — без единой
-- ошибки, без записи в лог, без каких-либо внешних признаков.
-- Модератор просто не увидит, за что объявление отклонили в прошлый
-- раз, и повторно пропустит то же нарушение.
select
  case
    when position('''car_approved''' in pg_get_functiondef(g.oid)) > 0
     and position('''car_rejected''' in pg_get_functiondef(g.oid)) > 0
     and position('''car_approved''' in pg_get_functiondef(a.oid)) > 0
     and position('''car_rejected''' in pg_get_functiondef(r.oid)) > 0
    then 'ok'
    else 'ВНИМАНИЕ: коды действий разошлись — история модерации будет пустой'
  end as verdict
from pg_proc g
cross join pg_proc a
cross join pg_proc r
join pg_namespace n on n.oid = g.pronamespace
where n.nspname = 'public'
  and g.proname = 'admin_get_car'
  and a.proname = 'approve_car'
  and r.proname = 'reject_car'
  and a.pronamespace = n.oid
  and r.pronamespace = n.oid;


-- ------------------------------------------------------------
-- 5) РУЧНАЯ ПРОВЕРКА ПОВЕДЕНИЯ (из интерфейса, под учётной записью
--    с profiles.is_admin = true).
-- ------------------------------------------------------------
-- От роли postgres обе функции упадут на is_admin() (auth.uid() там
-- null) — это правильное поведение и заодно доказательство, что
-- проверка прав работает. Раскомментируйте, чтобы убедиться:
--
--   select * from public.admin_moderation_queue(10, 0);
--
-- Ожидается: ERROR 42501, «Недостаточно прав: очередь модерации
-- доступна только администратору».
--
-- ЧТО ПРОВЕРИТЬ В ИНТЕРФЕЙСЕ:
--
--   а) FIFO. Открыть /admin/queue: сверху объявление с самой ранней
--      датой в колонке «Подано». Сверить с запросом:
--
--        select id, brand, model, created_at
--          from public.cars
--         where status = 'moderation'
--         order by created_at asc
--         limit 5;
--
--   б) Одобрение. Открыть карточку, нажать A (или «Одобрить»).
--      Ожидается: возврат в очередь, объявление из неё исчезло.
--      Проверить три следствия одной командой:
--
--        select c.status,
--               (select count(*) from public.admin_action_log l
--                 where l.target_id = c.id and l.action = 'car_approved') as log_rows,
--               (select count(*) from public.email_queue q
--                 where q.template_key = 'car_approved'
--                   and q.created_at > now() - interval '5 minutes') as fresh_emails
--          from public.cars c
--         where c.id = 'ВСТАВЬТЕ-ID';
--
--      Ожидается: status = active, log_rows = 1, fresh_emails >= 1.
--
--   в) Отклонение без причины. Нажать R, ничего не выбрать —
--      кнопка «Отклонить» неактивна. Выбрать «Другое» и ввести
--      9 символов — по-прежнему неактивна.
--
--   г) Отклонение с причиной. Выбрать типовую причину. Если у
--      продавца profiles.locale = 'sr' (или null), под списком видно
--      сербский текст — именно он уйдёт в письмо. Отправить и
--      проверить:
--
--        select c.status, c.moderation_comment,
--               (select q.payload->>'reason' from public.email_queue q
--                 where q.template_key = 'car_rejected'
--                 order by q.created_at desc limit 1) as email_reason
--          from public.cars c
--         where c.id = 'ВСТАВЬТЕ-ID';
--
--      Ожидается: status = rejected, moderation_comment и email_reason
--      совпадают и написаны на языке продавца.
--
--   д) Гонка модераторов. Открыть одну карточку в двух вкладках.
--      В первой нажать «Одобрить», во второй — «Отклонить».
--      Ожидается: вторая вкладка показывает «Объявление уже обработал
--      другой модератор» и через секунду возвращается в очередь.
--      В журнале при этом РОВНО ОДНА запись по этому объявлению:
--
--        select action, created_at from public.admin_action_log
--         where target_id = 'ВСТАВЬТЕ-ID' order by created_at;
--
--   е) История на карточке. Отклонить объявление, затем одобрить его
--      же (из карточки — она открывается и для разобранных). Открыть
--      карточку снова: блок «История модерации» показывает обе записи,
--      свежая сверху, у отклонения видна причина.
-- ------------------------------------------------------------
