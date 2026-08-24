-- ============================================================
-- AUTO.RS — Миграция 0079: чтение очереди модерации.
-- ------------------------------------------------------------
-- Пакет M4. Две читающие RPC для админки сайта:
--   1) admin_moderation_queue(p_limit, p_offset) — список на проверку;
--   2) admin_get_car(p_car_id)                   — карточка целиком.
--
-- Обе — SECURITY DEFINER с is_admin() первой строкой. Definer нужен не
-- ради обхода RLS на cars (там уже есть политика
-- cars_select_admin_moderation из 0015), а ради profiles и
-- admin_action_log: журнал закрыт наглухо (0078, deny-all + revoke), и
-- прочитать историю модерации иначе нельзя вовсе.
--
-- ПИСАТЬ ЭТИ ФУНКЦИИ НЕ УМЕЮТ. Решения принимают approve_car и
-- reject_car из 0078 — они же пишут журнал и запускают триггер письма.
-- Здесь только чтение.
--
-- КОДЫ ДЕЙСТВИЙ В ЖУРНАЛЕ. История фильтруется по 'car_approved' и
-- 'car_rejected' — ровно тем строкам, которые пишет f_admin_log из
-- 0078. Любое расхождение здесь означало бы вечно пустую историю на
-- карточке: ошибка молчаливая, поэтому коды продублированы в
-- комментарии и должны меняться только вместе с 0078.
-- ============================================================


-- ============================================================
-- 1) admin_moderation_queue — список объявлений на проверку
-- ------------------------------------------------------------
-- ПОРЯДОК FIFO (created_at ASC) — не стилистика, а требование
-- справедливости: при сортировке «новые сверху» первое объявление
-- продавца висело бы вечно, пока сверху сыплются свежие. Модератор
-- разбирает голову очереди, и время ожидания у всех примерно равное.
--
-- КОНТЕКСТ ДОВЕРИЯ (owner_listings_total, owner_rejected_count) —
-- главное, что эта RPC даёт сверх обычного select. Объявление от
-- продавца с пятью отклонениями подряд и объявление от того, кто
-- publikует первый раз, требуют разного внимания, а по самой карточке
-- этого не видно. Считаем ОБА числа по всем объявлениям владельца:
--   * owner_listings_total — сколько всего подавал (кроме черновиков:
--     draft ещё не показывался модератору и в счёт не идёт);
--   * owner_rejected_count — сколько отклонено СЕЙЧАС. Это именно
--     текущее состояние, а не история решений: объявление, отклонённое
--     и затем исправленное, здесь не считается — продавец сделал
--     работу над ошибками, и держать это против него незачем.
--
-- total_count в каждой строке — общее число ждущих проверки, для
-- пагинации. Оконная функция count(*) over () считает его тем же
-- проходом, без второго запроса.
--
-- Фотография одна — первая по order_index: в списке нужна миниатюра,
-- а не галерея. Полный набор отдаёт admin_get_car.
-- ============================================================
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
  total_count            bigint
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
    count(*) over ()
  from public.cars c
  join public.profiles p on p.id = c.user_id
  where c.status = 'moderation'
  order by c.created_at asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$fn$;

comment on function public.admin_moderation_queue(integer, integer)
  is 'Очередь модерации FIFO с контекстом доверия по владельцу; только для админа';

grant execute on function public.admin_moderation_queue(integer, integer) to authenticated;


-- ============================================================
-- 2) admin_get_car — карточка объявления целиком
-- ------------------------------------------------------------
-- Один вызов вместо трёх: поля объявления, все фотографии и история
-- решений по нему. Карточка проверки открывается по одному нажатию из
-- очереди, и три последовательных запроса означали бы три задержки
-- подряд на каждом объявлении — на потоке модерации это заметно.
--
-- Фотографии и история отдаются как jsonb-массивы. Это сознательный
-- выбор в пользу одной строки ответа: returns table с джойном
-- размножил бы карточку по числу фото, и клиенту пришлось бы
-- схлопывать её обратно.
--
-- ЗАЧЕМ ИСТОРИЯ НА КАРТОЧКЕ. Объявление приходит на проверку повторно
-- после правки, и модератор обязан видеть, за что его отклонили в
-- прошлый раз: иначе он либо придирается к тому, что продавец уже
-- исправил, либо пропускает то же самое нарушение. Журнал —
-- единственный источник этих сведений: moderation_comment хранит
-- ТОЛЬКО последнюю причину и очищается при одобрении.
--
-- Возвращает 0 строк, если объявления нет. notFound() на стороне
-- сайта — исключение здесь было бы неверно: несуществующий id это не
-- ошибка доступа, а обычная опечатка в адресе.
-- ============================================================
create or replace function public.admin_get_car(p_car_id uuid)
returns table (
  car_id             uuid,
  user_id            uuid,
  status             text,
  is_for_sale        boolean,
  is_for_rent        boolean,
  brand              text,
  model              text,
  year               integer,
  mileage            integer,
  body_type          text,
  transmission       text,
  fuel               text,
  currency           text,
  sale_price         numeric,
  rent_price_daily   numeric,
  deposit_amount     numeric,
  city               text,
  description        text,
  contact_phone      text,
  moderation_comment text,
  created_at         timestamptz,
  updated_at         timestamptz,
  -- Владелец: контакты и контекст доверия — те же счётчики, что в
  -- очереди, чтобы карточка не требовала возврата к списку.
  owner_name           text,
  owner_email          text,
  owner_phone          text,
  owner_locale         text,
  owner_created_at     timestamptz,
  owner_listings_total integer,
  owner_rejected_count integer,
  -- [{image_url, order_index}, …] в порядке показа.
  photos             jsonb,
  -- [{action, created_at, actor_name, payload}, …], свежие сверху.
  moderation_history jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: карточка модерации доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    c.id,
    c.user_id,
    c.status::text,
    c.is_for_sale,
    c.is_for_rent,
    c.brand,
    c.model,
    c.year,
    c.mileage,
    c.body_type::text,
    c.transmission::text,
    c.fuel::text,
    c.currency::text,
    c.sale_price,
    c.rent_price_daily,
    c.deposit_amount,
    c.city,
    c.description,
    c.contact_phone,
    c.moderation_comment,
    c.created_at,
    c.updated_at,

    p.full_name,
    p.email,
    p.phone,
    p.locale,
    p.created_at,

    (select count(*)::integer
       from public.cars oc
      where oc.user_id = c.user_id
        and oc.status <> 'draft'),

    (select count(*)::integer
       from public.cars oc
      where oc.user_id = c.user_id
        and oc.status = 'rejected'),

    -- Фотографии в порядке показа. coalesce вместо null: клиенту
    -- удобнее пустой массив, чем проверка на null перед перебором.
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'image_url',   ci.image_url,
                  'order_index', ci.order_index
                )
                order by ci.order_index asc
              )
         from public.car_images ci
        where ci.car_id = c.id),
      '[]'::jsonb
    ),

    -- История решений по этому объявлению. Свежие сверху: модератору
    -- важно прежде всего последнее отклонение.
    --
    -- Коды действий — те, что пишет f_admin_log в approve_car и
    -- reject_car (0078). Менять их можно только там и здесь
    -- одновременно, иначе история молча опустеет.
    --
    -- Имя модератора join'им к profiles: в журнале лежит только
    -- actor_id, а «отклонил 3f2a…» человеку ничего не говорит.
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
        where l.target_table = 'cars'
          and l.target_id = c.id
          and l.action in ('car_approved', 'car_rejected')),
      '[]'::jsonb
    )
  from public.cars c
  join public.profiles p on p.id = c.user_id
  where c.id = p_car_id;
end;
$fn$;

comment on function public.admin_get_car(uuid)
  is 'Карточка объявления для модерации: поля, все фото, история решений по журналу; только для админа';

grant execute on function public.admin_get_car(uuid) to authenticated;
