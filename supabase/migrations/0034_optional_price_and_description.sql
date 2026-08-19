-- ============================================================
-- AUTO.RS — Миграция 0034: Цена необязательна + описание в RPC
-- ============================================================
-- 1) Цена перестаёт быть обязательной: объявление можно опубликовать без
--    цены — в каталоге и карточке она отображается как «Договорная».
--    Снимаем constraints chk_sale_price / chk_rent_price (миграция 0003),
--    которые требовали цену при is_for_sale / is_for_rent.
-- 2) create_car_v2 принимает описание (p_description). Колонка
--    cars.description уже существует (0003) — просто заполняем её.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Снимаем обязательность цены
-- ------------------------------------------------------------
alter table public.cars drop constraint if exists chk_sale_price;
alter table public.cars drop constraint if exists chk_rent_price;

-- ------------------------------------------------------------
-- 2) create_car_v2 + описание. Сигнатура меняется → удаляем версию 0033.
-- ------------------------------------------------------------
drop function if exists public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type
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
  p_description  text              default null  -- НОВОЕ: описание (до 6000)
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
    city, description, location
  )
  values (
    v_user_id, v_is_sale, v_is_rent,
    brand, model, year, mileage,
    p_body_type, p_transmission, p_fuel,
    coalesce(currency, 'EUR')::currency_code, v_sale, v_rent,
    city, nullif(btrim(coalesce(p_description, '')), ''), v_location
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
  body_type, transmission_type, fuel_type, text
) is 'Создание объявления (+кузов/КПП/топливо/описание, цена опциональна). user_id = auth.uid()';

grant execute on function public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text
) to authenticated;
