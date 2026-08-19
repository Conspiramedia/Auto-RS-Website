-- ============================================================
-- AUTO.RS — Миграция 0056: демо-объявления АРЕНДЫ для сайта
-- ============================================================
-- ТОЛЬКО ДЛЯ DEV/STAGING — как и 0054. На боевой базе не применять:
-- объявления попадут в каталог, sitemap и к живым пользователям.
--
-- Продолжает сид 0054: тот же служебный продавец
-- 00000000-0000-4000-a000-0000000000de и та же метка [DEMO] в описании,
-- поэтому docs/cleanup_demo.sql удаляет и эти записи — отдельный скрипт
-- очистки не нужен.
--
-- Состав: 6 объявлений аренды. Из них два (Golf и Passat) выставлены
-- ОДНОВРЕМЕННО на продажу и в аренду — это отдельный случай в интерфейсе
-- (карточка показывает обе цены), и его нужно уметь проверить.
--
-- Цены: суточные ставки и залог взяты в диапазоне сербского рынка
-- проката — 25-90 € в сутки, залог 150-500 €.
-- ============================================================

do $$
declare
  v_user_id uuid := '00000000-0000-4000-a000-0000000000de';
  i         integer;

  -- Марка, модель, год, цена аренды в сутки, залог, город,
  -- продаётся ли одновременно, цена продажи (NULL если только аренда).
  v_brands   text[]    := array['Renault','Škoda','Volkswagen','Toyota','Fiat','Volkswagen'];
  v_models   text[]    := array['Clio','Octavia','Golf','Yaris','Panda','Passat'];
  v_years    integer[] := array[2021, 2022, 2020, 2023, 2019, 2021];
  v_rents    numeric[] := array[28, 45, 35, 32, 25, 55];
  v_deposits numeric[] := array[200, 300, 250, 200, 150, 400];
  v_cities   text[]    := array['Beograd','Novi Sad','Beograd','Beograd','Niš','Novi Sad'];
  v_alsosale boolean[] := array[false, false, true, false, false, true];
  v_sales    numeric[] := array[null, null, 14500, null, null, 19900];
  v_bodies   body_type[] := array['hatchback','wagon','hatchback','hatchback','hatchback','sedan']::body_type[];
  v_trans    transmission_type[] := array['manual','automatic','manual','automatic','manual','automatic']::transmission_type[];
  v_fuels    fuel_type[] := array['petrol','diesel','petrol','hybrid','petrol','diesel']::fuel_type[];
begin
  -- Демо-продавец создан миграцией 0054. Если её не применяли, вставка
  -- упадёт по внешнему ключу — это осознанно: молча создавать здесь
  -- второго служебного пользователя значит развести два набора демо-данных
  -- и усложнить очистку.
  if not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception
      'Демо-продавец не найден. Сначала примените 0054_seed_site_demo.sql';
  end if;

  for i in 1..6 loop
    insert into public.cars (
      user_id, is_for_sale, is_for_rent,
      brand, model, year, mileage,
      body_type, transmission, fuel,
      currency, sale_price, rent_price_daily, deposit_amount,
      city, description, status, contact_phone, created_at
    )
    values (
      v_user_id,
      v_alsosale[i],
      true,
      v_brands[i], v_models[i], v_years[i],
      -- Прокатные машины свежие и с умеренным пробегом.
      (2026 - v_years[i]) * 14000 + i * 1200,
      v_bodies[i], v_trans[i], v_fuels[i],
      'EUR',
      v_sales[i],
      v_rents[i],
      v_deposits[i],
      v_cities[i],
      '[DEMO] ' || v_brands[i] || ' ' || v_models[i] || ', ' || v_years[i] ||
        '. Rent-a-car: puno kasko osiguranje, neograničena kilometraža, ' ||
        'preuzimanje u centru grada. Depozit ' || v_deposits[i]::text || ' EUR.',
      'active',
      '+38160000' || lpad((100 + i)::text, 4, '0'),
      -- Свежее продажных объявлений из 0054, чтобы аренда была видна
      -- в начале ленты «сначала новые».
      now() - (i || ' minutes')::interval
    );
  end loop;
end $$;


-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ
-- ============================================================
-- Ожидается: rent_only = 4, both = 2, sale_only = 27.
--
--   select
--     count(*) filter (where is_for_rent and not is_for_sale) as rent_only,
--     count(*) filter (where is_for_rent and is_for_sale)     as both,
--     count(*) filter (where is_for_sale and not is_for_rent) as sale_only
--   from public.cars
--   where user_id = '00000000-0000-4000-a000-0000000000de';
--
-- Удаление — тем же docs/cleanup_demo.sql, что и для продажных:
-- условие по user_id + метка [DEMO] покрывает обе группы.
-- ============================================================
