-- ============================================================
-- AUTO.RS — Миграция 0091: возврат после решения админа в очереди
-- ============================================================
-- ПРОБЛЕМА. Объявление, снятое администратором (0089) и исправленное
-- владельцем (0090), возвращается в очередь модерации обычной строкой,
-- неотличимой от первой подачи. Модератор видит новую машину и не
-- знает, что:
--   * это объявление он (или коллега) уже снимал или отклонял;
--   * причина снятия была такая-то;
--   * продавец на неё ответил и ждёт повторной проверки.
--
-- Последствия ровно два, и оба плохие. Модератор либо одобряет то, что
-- сам же снял неделю назад, не проверив, устранено ли замечание, либо
-- заново разбирается в объявлении с нуля, тратя время на то, что уже
-- было выяснено. Плюс продавец, добросовестно исправивший замечание,
-- стоит в общей очереди наравне с новыми подачами, хотя его случай
-- разбирается быстрее всего — надо лишь сверить одно замечание.
--
-- РЕШЕНИЕ. Очередь отдаёт два новых поля:
--   returned_after_decision — по объявлению уже было решение
--     администратора (отклонение или снятие);
--   last_decision_reason    — причина последнего такого решения.
-- И такие объявления идут В НАЧАЛЕ очереди.
--
-- ИСТОЧНИК — ЖУРНАЛ, а не поля строки. Тот же выбор и по той же
-- причине, что в барьере автопубликации (0090): archived_reason
-- очищается при уходе на модерацию (иначе он бы противоречил новому
-- статусу), moderation_comment — при правке. Журнал append-only и
-- помнит решение после того, как объявление уже сменило статус, —
-- а именно в этот момент оно и попадает в очередь.
--
-- ЧТО НЕ МЕНЯЕТСЯ: набор строк очереди (по-прежнему только
-- status = 'moderation') и порядок существующих колонок. Новые поля
-- добавлены в конец; сортировка внутри групп осталась прежней —
-- created_at по возрастанию, то есть кто дольше ждёт, тот выше.
-- ============================================================

begin;

-- Сигнатура returns table меняется, поэтому функцию нужно удалить
-- перед пересозданием: CREATE OR REPLACE не умеет менять состав
-- возвращаемых колонок.
drop function if exists public.admin_moderation_queue(integer, integer);

create or replace function public.admin_moderation_queue(
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  car_id                 uuid,
  brand                  text,
  model                  text,
  year                   integer,
  city                   text,
  sale_price             numeric,
  rent_price_daily       numeric,
  currency               text,
  photo_url              text,
  photos_count           integer,
  owner_name             text,
  owner_listings_total   integer,
  owner_rejected_count   integer,
  created_at             timestamptz,
  total_count            bigint,
  -- Новые поля (0091).
  returned_after_decision boolean,
  last_decision_reason    text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: очередь модерации доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with decided as (
    -- Последнее решение администратора по каждому объявлению, ждущему
    -- проверки. distinct on берёт первую строку каждой группы в
    -- заданном порядке — здесь самую свежую запись журнала.
    --
    -- Отбираем ровно два действия. car_approved сюда не входит
    -- намеренно: одобрение не оставляет замечания, которое надо
    -- сверять, и объявление, однажды одобренное и потом исправленное,
    -- ничем не отличается от новой подачи.
    select distinct on (l.target_id)
      l.target_id,
      l.payload->>'reason' as reason
    from public.admin_action_log l
    join public.cars c2 on c2.id = l.target_id
    where l.target_table = 'cars'
      and l.action in ('car_rejected', 'car_archived')
      and c2.status = 'moderation'
    order by l.target_id, l.created_at desc
  )
  select
    c.id,
    c.brand,
    c.model,
    c.year,
    c.city,
    c.sale_price,
    c.rent_price_daily,
    c.currency::text,

    -- Миниатюра: первое фото объявления.
    (select ci.image_url
       from public.car_images ci
      where ci.car_id = c.id
      order by ci.order_index asc
      limit 1),

    -- Сколько фотографий всего. Ноль — сам по себе повод присмотреться:
    -- объявление без единого снимка почти всегда отклоняется.
    (select count(*)::integer
       from public.car_images ci
      where ci.car_id = c.id),

    p.full_name,

    -- Контекст доверия, см. шапку блока.
    (select count(*)::integer
       from public.cars oc
      where oc.user_id = c.user_id
        and oc.status <> 'draft'),

    (select count(*)::integer
       from public.cars oc
      where oc.user_id = c.user_id
        and oc.status = 'rejected'),

    c.created_at,

    -- Общее число в очереди — тем же проходом, без второго запроса.
    count(*) over (),

    -- Возврат после решения администратора.
    (d.target_id is not null),
    d.reason
  from public.cars c
  join public.profiles p on p.id = c.user_id
  left join decided d on d.target_id = c.id
  where c.status = 'moderation'
  order by
    -- Возвраты — вперёд: их разбор короче (сверить одно замечание),
    -- и продавец, исправивший замечание, не должен ждать дольше того,
    -- кто подал впервые.
    (d.target_id is not null) desc,
    c.created_at asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$fn$;

comment on function public.admin_moderation_queue(integer, integer)
  is 'Очередь модерации. Объявления, вернувшиеся после отклонения или снятия администратором, помечены и идут первыми (0091)';

grant execute on function public.admin_moderation_queue(integer, integer) to authenticated;

commit;


-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ
-- ============================================================
-- Автоматическая: supabase/checks/0091_queue_returned_test.sql
--
-- Вручную (от админа):
--   select car_id, brand, returned_after_decision, last_decision_reason
--     from public.admin_moderation_queue(50, 0);
-- Объявление, снятое администратором и затем исправленное владельцем,
-- обязано идти первым с returned_after_decision = true и причиной
-- снятия в last_decision_reason.
-- ============================================================
