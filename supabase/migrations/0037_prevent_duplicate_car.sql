-- ============================================================
-- AUTO.RS — Миграция 0037: Защита от дублей объявлений (анти-даблклик)
-- ============================================================
-- Один продавец мог по ошибке (двойной тап «Опубликовать» или повторная
-- подача) создать несколько одинаковых объявлений. Добавляем проверку в
-- create_car_v2: если у ТЕКУЩЕГО пользователя уже есть объявление той же
-- марки/модели/года и того же типа сделки в статусе moderation или active —
-- публикацию отклоняем с понятной ошибкой.
--
-- Это «мягкая» защита от случайных повторов (а не жёсткий UNIQUE): архивные,
-- отклонённые и проданные объявления не мешают подать заново. Проверка — на
-- бэкенде (толстый backend), чтобы её нельзя было обойти с клиента.
--
-- Сигнатура функции НЕ меняется (те же параметры, что в 0036) → create or
-- replace достаточно, drop не нужен.
-- ============================================================

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
  p_phone        text              default null   -- контактный телефон
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

  -- ---------- Анти-даблклик: нет ли уже такого же живого объявления ----------
  -- Сравниваем по продавцу + марка/модель/год + тип сделки. Марку/модель
  -- нормализуем (регистр/пробелы), чтобы «BMW» и «bmw » считались одним.
  -- Учитываем только актуальные статусы (moderation, active) — архив/отказ/
  -- продажа не мешают подать заново.
  if exists (
    select 1
    from public.cars c
    where c.user_id = v_user_id
      and lower(btrim(c.brand)) = lower(btrim(brand))
      and lower(btrim(c.model)) = lower(btrim(model))
      and c.year = year
      and c.is_for_sale = v_is_sale
      and c.is_for_rent = v_is_rent
      and c.status in ('moderation', 'active')
  ) then
    raise exception
      'У вас уже есть такое объявление (%, % %, % г.). Дождитесь модерации или отредактируйте существующее.',
      case when v_is_rent and not v_is_sale then 'аренда' else 'продажа' end,
      brand, model, year
      using errcode = 'unique_violation';
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
