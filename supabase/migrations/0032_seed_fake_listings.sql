-- ============================================================
-- AUTO.RS — Миграция 0032: 50 ТЕСТОВЫХ объявлений (SEED)
-- ============================================================
-- ВРЕМЕННЫЕ данные для проверки каталога/ленты/фильтров.
-- Все помечены '[SEED]' в description — удаляются одним запросом
-- (см. блок ОЧИСТКА в конце файла).
--
-- Особенности:
--   • Владелец — первый существующий профиль (cars.user_id NOT NULL).
--     Если профилей нет — миграция ничего не делает (RAISE NOTICE).
--   • status = 'active' (иначе не видны: каталог показывает только active).
--   • Города Сербии с реальными координатами (для гео «рядом со мной»).
--   • Часть объявлений с фото (Unsplash), часть — без (плейсхолдер-логотип).
--   • Марки/модели берём из справочника car_brands/car_models — консистентно
--     с фильтрами.
--
-- Идемпотентность: повторный прогон создаст ещё 50 (метка та же). Перед
-- повторным прогоном при необходимости запусти блок ОЧИСТКА.
-- ============================================================

do $$
declare
  v_owner uuid;
  v_car   uuid;
  i       integer;

  -- Города Сербии: название + широта + долгота
  cities  text[]  := array['Beograd','Novi Sad','Niš','Kragujevac','Subotica','Zrenjanin','Pančevo','Čačak','Kraljevo','Novi Pazar'];
  lats    float8[] := array[44.7866, 45.2671, 43.3209, 44.0128, 46.1000, 45.3836, 44.8708, 43.8914, 43.7256, 43.1367];
  lngs    float8[] := array[20.4489, 19.8335, 21.8958, 20.9114, 19.6650, 20.3819, 20.6403, 20.3497, 20.6890, 20.5122];

  -- Пул марок/моделей (берём реально существующие в справочнике)
  brands  text[]  := array['Volkswagen','Audi','BMW','Mercedes-Benz','Toyota','Opel','Renault','Skoda','Peugeot','Fiat'];
  models  text[]  := array['Golf','A4','3 Series','C-Class','Corolla','Astra','Clio','Octavia','308','Punto'];

  -- Пул фото (Unsplash, публичные). Часть объявлений останется без фото.
  photos  text[]  := array[
    'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800',
    'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=800',
    'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800',
    'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800',
    'https://images.unsplash.com/photo-1550355291-bbee04a92027?w=800',
    'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0?w=800'
  ];

  v_brand text;
  v_model text;
  v_city  text;
  v_lat   float8;
  v_lng   float8;
  v_year  integer;
  v_mileage integer;
  v_is_sale boolean;
  v_price   numeric(12,2);
  v_body    body_type;
  v_trans   transmission_type;
  v_fuel    fuel_type;
  v_bodies  body_type[]         := enum_range(null::body_type);
  v_transs  transmission_type[] := enum_range(null::transmission_type);
  v_fuels   fuel_type[]         := enum_range(null::fuel_type);
  v_nphoto  integer;
begin
  -- Владелец: первый профиль. Нет профилей — выходим без ошибки.
  select id into v_owner from public.profiles order by created_at asc limit 1;
  if v_owner is null then
    raise notice 'SEED пропущен: в profiles нет ни одного пользователя. Зарегистрируйтесь и запустите миграцию повторно.';
    return;
  end if;

  for i in 1..50 loop
    -- Детерминированный, но «разнообразный» выбор из пулов по индексу
    v_brand   := brands[1 + (i % array_length(brands, 1))];
    v_model   := models[1 + (i % array_length(models, 1))];
    v_city    := cities[1 + (i % array_length(cities, 1))];
    v_lat     := lats[1 + (i % array_length(lats, 1))];
    v_lng     := lngs[1 + (i % array_length(lngs, 1))];
    v_year    := 2005 + (i % 19);                 -- 2005..2023
    v_mileage := 20000 + (i * 7919 % 280000);     -- разброс пробега
    v_is_sale := (i % 4 <> 0);                    -- каждое 4-е — аренда
    v_body    := v_bodies[1 + (i % array_length(v_bodies, 1))];
    v_trans   := v_transs[1 + (i % array_length(v_transs, 1))];
    v_fuel    := v_fuels[1 + (i % array_length(v_fuels, 1))];

    if v_is_sale then
      v_price := 3000 + (i * 613 % 40000);        -- цена продажи, EUR
    else
      v_price := 20 + (i * 7 % 120);              -- аренда/сутки, EUR
    end if;

    insert into public.cars (
      user_id, is_for_sale, is_for_rent,
      brand, model, year, mileage,
      body_type, transmission, fuel,
      currency, sale_price, rent_price_daily,
      city, description, location, status
    )
    values (
      v_owner, v_is_sale, not v_is_sale,
      v_brand, v_model, v_year, v_mileage,
      v_body, v_trans, v_fuel,
      'EUR',
      case when v_is_sale then v_price else null end,
      case when v_is_sale then null else v_price end,
      v_city,
      '[SEED] Тестовое объявление #' || i || '. ' || v_brand || ' ' || v_model,
      st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography,
      'active'
    )
    returning id into v_car;

    -- Фото: примерно у 2/3 объявлений (каждое 3-е — без фото).
    -- У кого есть — 1..3 фото из пула.
    if i % 3 <> 0 then
      v_nphoto := 1 + (i % 3);  -- 1..3 фото
      insert into public.car_images (car_id, image_url, order_index)
      select v_car,
             photos[1 + ((i + g) % array_length(photos, 1))],
             g
      from generate_series(0, v_nphoto - 1) as g;
    end if;
  end loop;

  raise notice 'SEED: создано 50 тестовых объявлений (владелец %).', v_owner;
end $$;

-- ============================================================
-- ОЧИСТКА (запусти вручную, когда тестовые данные больше не нужны):
-- ------------------------------------------------------------
-- Фото удалятся каскадом (car_images.car_id ... on delete cascade).
--
--   delete from public.cars where description like '[SEED]%';
--
-- ============================================================
