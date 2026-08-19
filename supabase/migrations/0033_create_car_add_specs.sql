-- ============================================================
-- AUTO.RS — Миграция 0033: create_car_v2 + кузов/КПП/топливо
-- ============================================================
-- Форма подачи объявления должна собирать те же характеристики, что и
-- фильтры каталога. Добавляем в RPC три НЕОБЯЗАТЕЛЬНЫХ параметра:
--   p_body_type    body_type          (тип кузова)
--   p_transmission transmission_type  (коробка передач)
--   p_fuel         fuel_type          (топливо)
-- NULL — характеристика не указана (в cars эти поля nullable).
--
-- Сигнатура меняется → удаляем старую версию (перегрузка → неоднозначность
-- в PostgREST). Тело — как в 0014, плюс запись новых полей.
-- ============================================================
drop function if exists public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[]
);

create or replace function public.create_car_v2(
  listing_type   text,
  brand          text,
  model          text,
  year           integer,
  mileage        integer,
  price          numeric,
  currency       text,
  city           text,
  lat            double precision,
  lng            double precision,
  photo_urls     text[],
  -- НОВОЕ: характеристики (как в фильтрах). NULL = не указано.
  p_body_type    body_type         default null,
  p_transmission transmission_type default null,
  p_fuel         fuel_type         default null
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

  -- Маппинг назначения и цены по типу объявления
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

  -- PostGIS-точка из координат (порядок: долгота, широта!)
  if lat is not null and lng is not null then
    v_location := st_setsrid(st_makepoint(lng, lat), 4326)::geography;
  end if;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    body_type, transmission, fuel,
    currency, sale_price, rent_price_daily,
    city, location
  )
  values (
    v_user_id, v_is_sale, v_is_rent,
    brand, model, year, mileage,
    p_body_type, p_transmission, p_fuel,
    coalesce(currency, 'EUR')::currency_code, v_sale, v_rent,
    city, v_location
  )
  returning id into v_car_id;

  -- Фото → car_images с сохранением порядка
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
  body_type, transmission_type, fuel_type
) is 'Создание объявления (+кузов/КПП/топливо, PostGIS-локация, фото). user_id = auth.uid()';

grant execute on function public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type
) to authenticated;
