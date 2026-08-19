-- ============================================================
-- AUTO.RS — Миграция 0036: Контактный телефон продавца в объявлении
-- ============================================================
-- Фронт собирает контактный телефон (форма подачи) и читает его из
-- cars.contact_phone (см. CarModel), а create_car_v2 получает p_phone.
-- Но в БД не было ни колонки, ни параметра — из-за чего RPC падала с
-- «Could not find the function create_car_v2(...)». Эта миграция:
--   1) добавляет cars.contact_phone;
--   2) пересоздаёт create_car_v2 с параметром p_phone и записью телефона.
--
-- Телефон хранится как есть (в формате «+381 …», нормализация ввода — на
-- клиенте). Пустая строка → NULL (btrim/nullif).
-- ============================================================


-- ---------- 1) Колонка контактного телефона ----------
alter table public.cars
  add column if not exists contact_phone text;

comment on column public.cars.contact_phone
  is 'Контактный телефон продавца из объявления (+381 …). Отдельно от аккаунта.';


-- ---------- 2) Пересоздание create_car_v2 с p_phone ----------
-- Сигнатура меняется (добавляется p_phone) → удаляем прежнюю версию 0034.
drop function if exists public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text
);

create or replace function public.create_car_v2(
  listing_type   text,
  brand          text,
  model          text,
  year           integer,
  mileage        integer,
  price          numeric,                        -- NULL → «Договорная»
  currency       text,
  city           text,
  lat            double precision,
  lng            double precision,
  photo_urls     text[],
  p_body_type    body_type         default null,
  p_transmission transmission_type default null,
  p_fuel         fuel_type         default null,
  p_description  text              default null,  -- описание (до 6000)
  p_phone        text              default null   -- НОВОЕ: контактный телефон
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_car_id   uuid;
  v_is_sale  boolean := false;
  v_is_rent  boolean := false;
  v_sale     numeric(12,2);
  v_rent     numeric(12,2);
  v_location geography(point, 4326);
  v_url      text;
  v_idx      integer := 0;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация для создания объявления'
      using errcode = 'insufficient_privilege';
  end if;

  -- Маппинг назначения. Цена может быть NULL (тогда «Договорная»).
  if listing_type = 'sale' then
    v_is_sale := true;
    v_sale := price;
  elsif listing_type = 'rent' then
    v_is_rent := true;
    v_rent := price;
  elsif listing_type = 'both' then
    v_is_sale := true;
    v_is_rent := true;
    v_sale := price;
    v_rent := price;
  else
    raise exception 'Некорректный listing_type = % (ожидалось sale/rent/both)', listing_type
      using errcode = 'check_violation';
  end if;

  if lat is not null and lng is not null then
    v_location := st_setsrid(st_makepoint(lng, lat), 4326)::geography;
  end if;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    body_type, transmission, fuel,
    currency, sale_price, rent_price_daily,
    city, description, contact_phone, location
  )
  values (
    v_user_id, v_is_sale, v_is_rent,
    brand, model, year, mileage,
    p_body_type, p_transmission, p_fuel,
    coalesce(currency, 'EUR')::currency_code, v_sale, v_rent,
    city,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    v_location
  )
  returning id into v_car_id;

  if photo_urls is not null then
    foreach v_url in array photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (v_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_car_id;
end;
$$;

comment on function public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text
) is 'Создание объявления (+кузов/КПП/топливо/описание/телефон, цена опциональна). user_id = auth.uid()';

grant execute on function public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text
) to authenticated;
