-- ============================================================
-- RS AUTO — SEED ДЛЯ ТЕСТОВ. Только локальный Supabase.
-- ============================================================
-- Файл выполняется автоматически после `supabase db reset`, то есть
-- ПОСЛЕ всех миграций из supabase/migrations. На боевую базу он не
-- попадает никогда: `supabase db push` заливает только миграции и
-- этот файл не трогает.
--
-- ЧЕМ ЭТОТ SEED ОТЛИЧАЕТСЯ ОТ ДЕМО-МИГРАЦИЙ 0054/0056. Те заполняют
-- витрину похожими на правду объявлениями и намеренно рандомизированы
-- (случайные марки, цены, пробеги) — для просмотра вёрстки это верно,
-- для тестов губительно: тест, который ищет «Golf за 8900», при
-- каждом прогоне видел бы другие данные. Здесь всё зафиксировано —
-- идентификаторы, цены, статусы, тексты.
--
-- ФИКСИРОВАННЫЕ UUID — часть контракта с тестами. Playwright открывает
-- карточку по прямому адресу /car/00000000-0000-4000-b000-000000000001,
-- а SQL-тесты ссылаются на тех же пользователей. Менять их значения
-- нельзя, не поправив tests/fixtures/seed.ts — там те же константы.
--
-- ИДЕМПОТЕНТНОСТЬ. Все вставки идут через on conflict do nothing/update,
-- поэтому файл безопасно выполнить повторно на уже засеянной базе.
-- ============================================================

-- ------------------------------------------------------------
-- 0) Служебные константы.
-- ------------------------------------------------------------
-- instance_id — одно и то же значение для всех записей auth.users в
-- одноинстансной установке (так делает и сам GoTrue).
do $$
declare
  v_instance   uuid := '00000000-0000-0000-0000-000000000000';

  -- Пользователи. Префикс …a000… — люди, …b000… — объявления:
  -- по идентификатору сразу видно, что за сущность в логе теста.
  v_admin_id   uuid := '00000000-0000-4000-a000-00000000ad01';
  v_seller_id  uuid := '00000000-0000-4000-a000-00000000c101';
  v_dealer_id  uuid := '00000000-0000-4000-a000-00000000d101';

  -- Объявления.
  v_car_active_sale uuid := '00000000-0000-4000-b000-000000000001';
  v_car_active_rent uuid := '00000000-0000-4000-b000-000000000002';
  v_car_both        uuid := '00000000-0000-4000-b000-000000000003';
  v_car_moderation  uuid := '00000000-0000-4000-b000-000000000004';
  v_car_archived    uuid := '00000000-0000-4000-b000-000000000005';
begin

  -- ============================================================
  -- 1) ПОЛЬЗОВАТЕЛИ
  -- ============================================================
  -- Вставляем прямо в auth.users: обычная регистрация требует OTP, а
  -- в seed это лишний круг. email_confirmed_at выставлен сразу —
  -- иначе GoTrue считает адрес неподтверждённым и вход невозможен.
  --
  -- encrypted_password пустой: входа по паролю на площадке нет вовсе,
  -- только OTP. Пустая строка не совпадёт ни с одним хешем, то есть
  -- подобрать пароль к тестовому админу нельзя даже теоретически.
  insert into auth.users (
    id, instance_id, aud, role, email, phone,
    encrypted_password, email_confirmed_at, phone_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  values
    -- АДМИН. Входит по почте (rpc_check_email_login пускает только
    -- админов), поэтому телефона у него нет.
    (v_admin_id, v_instance, 'authenticated', 'authenticated',
     'admin@rsauto.test', null,
     '', now(), null, now(), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),

    -- ОБЫЧНЫЙ ПРОДАВЕЦ. Входит по телефону — основной путь площадки.
    -- Номер сербский и совпадает с [auth.sms.test_otp] в config.toml.
    (v_seller_id, v_instance, 'authenticated', 'authenticated',
     'seller@rsauto.test', '+381601234567',
     '', now(), now(), now(), now(),
     '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb),

    -- САЛОН. Нужен витрине /dealer/{id} и проверке крошек на ней.
    (v_dealer_id, v_instance, 'authenticated', 'authenticated',
     'dealer@rsauto.test', '+381601234568',
     '', now(), now(), now(), now(),
     '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  -- Профили. Триггер handle_new_user создаёт их сам, но на всякий
  -- случай (порядок применения миграций в чистой базе) добиваем
  -- явно и сразу проставляем роли.
  insert into public.profiles (id, email, full_name, phone, role, is_admin)
  values
    (v_admin_id,  'admin@rsauto.test',  'Test Admin',    null,             'admin',  true),
    (v_seller_id, 'seller@rsauto.test', 'Marko Marković', '+381601234567', 'seller', false),
    (v_dealer_id, 'dealer@rsauto.test', 'Auto Centar Test', '+381601234568', 'seller', false)
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone     = excluded.phone,
        role      = excluded.role,
        is_admin  = excluded.is_admin;

  -- ============================================================
  -- 2) ОБЪЯВЛЕНИЯ
  -- ============================================================
  -- Пять карточек, покрывающих разные ветки отображения:
  --   1) active + продажа       — основная карточка, на ней же
  --      проверяется Vehicle JSON-LD и SEO-теги;
  --   2) active + аренда        — другой Offer (цена за сутки, DAY);
  --   3) active + продажа+аренда — ДВА Offer в разметке, редкая ветка;
  --   4) moderation             — не должно быть видно в каталоге;
  --   5) archived               — страница «объявление снято», noindex.
  --
  -- Описания на сербском (латиница): контентные поля на языке автора,
  -- как требует правило проекта. Русская локаль переводит только UI.
  --
  -- Годы заданы литералами, а не now() — карточка с годом «текущий+1»
  -- упёрлась бы в constraint chk_year при прогоне в следующем январе.
  insert into public.cars (
    id, user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage, body_type, transmission, fuel,
    currency, sale_price, rent_price_daily, deposit_amount,
    city, description, status, created_at, updated_at
  )
  values
    (v_car_active_sale, v_seller_id, true, false,
     'Volkswagen', 'Golf', 2019, 87000, 'hatchback', 'manual', 'diesel',
     'EUR', 12500.00, null, 0,
     'Beograd',
     'Volkswagen Golf 7, prvi vlasnik, redovno servisiran u ovlašćenom servisu. Nove gume, bez ulaganja.',
     'active', now() - interval '3 days', now() - interval '3 days'),

    (v_car_active_rent, v_dealer_id, false, true,
     'Škoda', 'Octavia', 2021, 45000, 'wagon', 'automatic', 'petrol',
     'EUR', null, 35.00, 200.00,
     'Novi Sad',
     'Škoda Octavia za iznajmljivanje. Cena po danu, depozit se vraća pri povraćaju vozila.',
     'active', now() - interval '2 days', now() - interval '2 days'),

    (v_car_both, v_dealer_id, true, true,
     'BMW', 'Serija 3', 2020, 62000, 'sedan', 'automatic', 'diesel',
     'EUR', 24900.00, 55.00, 300.00,
     'Beograd',
     'BMW Serija 3, dostupan i za prodaju i za iznajmljivanje. Servisna knjižica uredna.',
     'active', now() - interval '1 day', now() - interval '1 day'),

    -- НА МОДЕРАЦИИ: в каталоге и sitemap появиться не должно.
    (v_car_moderation, v_seller_id, true, false,
     'Opel', 'Astra', 2017, 120000, 'hatchback', 'manual', 'petrol',
     'EUR', 7800.00, null, 0,
     'Niš',
     'Opel Astra, čeka odobrenje moderatora.',
     'moderation', now() - interval '2 hours', now() - interval '2 hours'),

    -- СНЯТОЕ С ПУБЛИКАЦИИ: страница отдаёт CarGoneView и noindex.
    (v_car_archived, v_seller_id, true, false,
     'Renault', 'Clio', 2015, 165000, 'hatchback', 'manual', 'petrol',
     'EUR', 5200.00, null, 0,
     'Kragujevac',
     'Renault Clio, oglas je povučen.',
     'archived', now() - interval '10 days', now() - interval '10 days')
  on conflict (id) do update
    set status     = excluded.status,
        sale_price = excluded.sale_price,
        updated_at = excluded.updated_at;

end $$;


-- ------------------------------------------------------------
-- 3) КОНТРОЛЬ: seed действительно применился.
-- ------------------------------------------------------------
-- Вывод виден в логе `supabase db reset`. Если строк меньше
-- ожидаемого, тесты упадут дальше по цепочке с невнятной ошибкой
-- «страница 404» — а здесь причина названа сразу.
do $$
declare
  v_users int;
  v_cars  int;
  v_active int;
begin
  select count(*) into v_users from public.profiles
   where email like '%@rsauto.test';

  select count(*) into v_cars from public.cars
   where id::text like '00000000-0000-4000-b000-%';

  select count(*) into v_active from public.cars
   where id::text like '00000000-0000-4000-b000-%' and status = 'active';

  raise notice '[seed] Пользователей: % (ожидается 3)', v_users;
  raise notice '[seed] Объявлений: % (ожидается 5, из них active: % — ожидается 3)',
    v_cars, v_active;

  if v_users < 3 or v_cars < 5 or v_active < 3 then
    raise exception '[seed] Данные применились не полностью — тесты запускать нельзя';
  end if;
end $$;
