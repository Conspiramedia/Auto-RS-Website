-- ============================================================
-- 0140 — МОДЕРАТОР ВИДИТ ВСЁ, ЧТО УКАЗАЛ ПРОДАВЕЦ
-- ============================================================
-- ПРОБЛЕМА. admin_get_car отдаёт набор полей, зафиксированный в 0089.
-- С тех пор в объявление добавились три поля, и ни одно из них до
-- карточки модерации не доехало:
--
--   engine_volume (0133) — объём двигателя;
--   availability  (0119) — «под заказ» / «в пути» у салона;
--   condition     (0138, 0139) — битая, на запчасти, без документов,
--                  только на экспорт.
--
-- ЭТО НЕ КОСМЕТИКА. Модератор проверяет, соответствует ли объявление
-- действительности, и по каждому из трёх полей может быть отказ:
--
--   * описание «машина новая, без документов» при condition = normal —
--     продавец скрыл состояние, и покупатель узнает о нём при встрече;
--   * пометка «в пути» у продавца, который не салон, — повод
--     разобраться (в базе её гасит триггер, но видеть попытку нужно);
--   * объём 2.0 в поле при «1.6 TDI» в заголовке — обычная ошибка
--     подачи, которую сейчас нечем заметить.
--
-- Не видя поля, модератор одобряет его вслепую — то есть проверка
-- превращается в формальность ровно там, где она нужнее всего.
--
-- ЧТО ДЕЛАЕТСЯ. Тело функции перенесено из 0089 ДОСЛОВНО; добавлены
-- три колонки в returns table и три выражения в select. Логика
-- выборки, права и история решений не тронуты.
--
-- Набор возвращаемых колонок меняется, а на это create or replace
-- отвечает SQLSTATE 42P13 — отсюда drop. Сигнатура (uuid) прежняя,
-- поэтому вызов на клиенте не меняется. Следом обязателен повторный
-- grant: пересозданная функция прав не наследует (см. 0065).
-- ============================================================

drop function if exists public.admin_get_car(uuid);

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
  owner_name           text,
  owner_email          text,
  owner_phone          text,
  owner_locale         text,
  owner_created_at     timestamptz,
  owner_listings_total integer,
  owner_rejected_count integer,
  photos             jsonb,
  moderation_history jsonb,
  -- Новые поля (0089).
  archived_by        text,
  archived_reason    text,
  -- ПОЛЯ, ЗАВЕДЁННЫЕ ПОСЛЕ 0089 И НЕ ДОЕХАВШИЕ ДО МОДЕРАТОРА (0140).
  -- Каждое из них — предмет проверки, а не украшение карточки:
  --   engine_volume — характеристика машины наравне с кузовом;
  --   availability  — обещание салона «привезу» / «уже еду»;
  --   condition     — битая, на запчасти, без документов, на экспорт.
  engine_volume      numeric,
  availability       text,
  condition          text
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

    -- История решений по этому объявлению. Свежие сверху.
    --
    -- СПИСОК ДЕЙСТВИЙ РАСШИРЕН до всех, что пишутся по target_table =
    -- 'cars'. Прежний фильтр из двух кодов прятал именно те события,
    -- ради которых карточку и открывают в спорном случае: снятие,
    -- возврат администратором и возврат владельцем. Отбор идёт по
    -- таблице, а не по перечню кодов, — так новая запись, добавленная
    -- будущей RPC, появится здесь сама, а не потеряется молча.
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
          and l.target_id = c.id),
      '[]'::jsonb
    ),

    c.archived_by::text,
    c.archived_reason,
    c.engine_volume,
    c.availability::text,
    -- Enum'ы отдаются текстом, как и везде: пользовательский тип не
    -- должен протекать в клиентские библиотеки.
    c.condition::text
  from public.cars c
  join public.profiles p on p.id = c.user_id
  where c.id = p_car_id;
end;
$fn$;

comment on function public.admin_get_car(uuid)
  is 'Карточка объявления для модерации: поля (включая объём, доступность и состояние), фото, авторство снятия и полная история решений; только для админа (0140)';

grant execute on function public.admin_get_car(uuid) to authenticated;
