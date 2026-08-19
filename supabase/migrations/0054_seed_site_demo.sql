-- ============================================================
-- AUTO.RS — Миграция 0054: демо-объявления для витрины сайта
-- ============================================================
-- ЗАЧЕМ:
--   На момент запуска сайта в базе нет ни одного активного объявления на
--   продажу, поэтому каталог, SEO-страницы и sitemap пусты — проверить
--   вёрстку и индексацию не на чем.
--
-- ВАЖНО — ЭТА МИГРАЦИЯ ПРЕДНАЗНАЧЕНА ТОЛЬКО ДЛЯ DEV/STAGING.
--   На боевой базе её применять НЕ НУЖНО: демо-объявления попадут в
--   каталог, в sitemap и к живым пользователям. Удалить их потом можно
--   запросом из блока в конце файла.
--
-- КАК УСТРОЕНО:
--   Демо-профиль создаётся в auth.users (иначе не сработает внешний ключ
--   profiles → auth.users), объявления привязываются к нему. Все записи
--   помечены признаком в description, чтобы их можно было найти и удалить
--   одним запросом.
--
--   Объявления создаются сразу со статусом 'active': проводить их через
--   модерацию вручную ради демо-данных бессмысленно.
-- ============================================================

do $$
declare
  v_user_id  uuid := '00000000-0000-4000-a000-0000000000de';
  v_car_id   uuid;
  v_brand    text;
  v_model    text;
  v_city     text;
  v_year     integer;
  v_price    numeric;
  v_mileage  integer;
  v_body     body_type;
  v_trans    transmission_type;
  v_fuel     fuel_type;
  i          integer;

  -- Марки и модели подобраны под реальный сербский рынок: здесь
  -- преобладают немецкий и французский масс-сегмент.
  v_brands  text[] := array[
    'Volkswagen','Volkswagen','Volkswagen','Opel','Opel','Renault','Renault',
    'Škoda','Škoda','Peugeot','Peugeot','Fiat','Ford','Ford','Audi','Audi',
    'BMW','BMW','Mercedes-Benz','Mercedes-Benz','Citroën','Toyota','Hyundai',
    'Kia','Nissan','Dacia','Seat'
  ];
  v_models  text[] := array[
    'Golf','Passat','Polo','Astra','Corsa','Clio','Megane',
    'Octavia','Fabia','308','206','Punto','Focus','Fiesta','A4','A3',
    'Serija 3','X5','C klasa','E klasa','C4','Yaris','i30',
    'Ceed','Qashqai','Duster','Leon'
  ];
  -- Города Сербии по убыванию населения — так распределение объявлений
  -- выглядит правдоподобно.
  v_cities  text[] := array[
    'Beograd','Beograd','Beograd','Novi Sad','Novi Sad','Niš','Kragujevac',
    'Subotica','Zrenjanin','Pančevo','Čačak','Kraljevo','Novi Pazar','Leskovac'
  ];
begin
  -- ---------- Демо-пользователь ----------
  -- Вставляем напрямую в auth.users: обычная регистрация требует OTP,
  -- а для сида это лишнее. Минимальный набор обязательных полей.
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values (
    v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'demo-seller@rsauto.local',
    '', now(), now(), now(),
    '{"provider":"phone","providers":["phone"]}'::jsonb,
    '{"full_name":"Demo prodavac"}'::jsonb
  )
  on conflict (id) do nothing;

  -- Профиль создаётся триггером handle_new_user, но при повторном запуске
  -- миграции пользователь уже существует и триггер не сработает —
  -- поэтому подстраховываемся.
  insert into public.profiles (id, full_name, seller_kind)
  values (v_user_id, 'Demo prodavac', 'private')
  on conflict (id) do nothing;

  -- ---------- 27 демо-объявлений ----------
  for i in 1..27 loop
    v_brand := v_brands[i];
    v_model := v_models[i];
    v_city  := v_cities[1 + (i % array_length(v_cities, 1))];

    -- Год, цена и пробег связаны между собой: свежее авто дороже и с
    -- меньшим пробегом. Случайные независимые значения дали бы абсурд
    -- вроде «2023 год, 400 000 км за 900 €».
    v_year    := 2006 + (i % 17);
    v_price   := 1500 + (v_year - 2006) * 900 + (i % 5) * 250;
    v_mileage := greatest(15000, (2024 - v_year) * 18000 + (i % 7) * 5000);

    v_body := (array['sedan','hatchback','suv','wagon','coupe','minivan']::body_type[])
              [1 + (i % 6)];
    v_trans := (array['manual','automatic','robot','variator']::transmission_type[])
               [1 + (i % 4)];
    v_fuel := (array['petrol','diesel','hybrid','electric','gas']::fuel_type[])
              [1 + (i % 5)];

    insert into public.cars (
      user_id, is_for_sale, is_for_rent,
      brand, model, year, mileage,
      body_type, transmission, fuel,
      currency, sale_price, city,
      description, status, contact_phone, created_at
    )
    values (
      v_user_id, true, false,
      v_brand, v_model, v_year, v_mileage,
      v_body, v_trans, v_fuel,
      'EUR', v_price, v_city,
      -- Метка [DEMO] обязательна: по ней демо-данные удаляются.
      '[DEMO] ' || v_brand || ' ' || v_model || ', ' || v_year ||
        '. Redovno održavan, prvi vlasnik, servisna knjiga. Registrovan.',
      'active',
      '+381600000' || lpad(i::text, 3, '0'),
      -- Разносим даты создания: иначе сортировка «сначала новые» покажет
      -- всё одним куском и её нельзя будет проверить.
      now() - (i || ' hours')::interval
    )
    returning id into v_car_id;
  end loop;
end $$;


-- ============================================================
-- УДАЛЕНИЕ ДЕМО-ДАННЫХ
-- ============================================================
-- Выполнить на боевой базе, если демо-объявления попали туда по ошибке:
--
--   delete from public.cars
--    where user_id = '00000000-0000-4000-a000-0000000000de';
--
--   delete from auth.users
--    where id = '00000000-0000-4000-a000-0000000000de';
--
-- Фотографии демо-объявлениям не добавляются: файлов в бакете car-images
-- нет, а ссылки на несуществующие объекты Storage выглядели бы как
-- битые изображения. Карточка и каталог корректно показывают заглушку.
-- ============================================================
