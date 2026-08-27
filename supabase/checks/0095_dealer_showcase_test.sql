-- ============================================================
-- RS AUTO — ТЕСТ витрины автосалона (0095).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл создаёт временных
-- пользователей и объявления. Всё идёт в ОДНОЙ транзакции, которая
-- в конце откатывается, — следов не остаётся.
--
-- ЧТО ПРОВЕРЯЕТСЯ (пункт 6 задачи):
--   1) update_seller_profile ПИШЕТ новые поля витрины;
--   2) get_dealer_profile их ВОЗВРАЩАЕТ;
--   3) СТАРЫЙ ВЫЗОВ ТРЕМЯ АРГУМЕНТАМИ работает — это контракт с
--      приложением, и он важнее остального в этом файле;
--   4) переключение в 'private' затирает поля витрины, а
--      get_dealer_profile не отдаёт их даже при заполненных колонках;
--   5) АНОНИМ видит публичные поля витрины и НЕ видит служебные
--      (phone-логин, email, trusted_seller, contact_person);
--   6) get_showcase_dealers отдаёт салон с миниатюрами машин и не
--      включает частных продавцов;
--   7) слишком длинное описание отклоняется понятной ошибкой.
--
-- ЗАПУСК: npm run test:sql (берёт все supabase/checks/*_test.sql)
-- либо напрямую:
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
--        -f supabase/checks/0095_dealer_showcase_test.sql
-- ============================================================

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- 0) ЗАЩИТА: это точно не боевая база?
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from public.profiles where email = 'admin@rsauto.test'
  ) then
    raise exception
      'ОСТАНОВЛЕНО: не найден тестовый админ admin@rsauto.test. '
      'Похоже, это не локальная база с применённым seed. '
      'Запустите: supabase db reset';
  end if;
end $$;


-- ------------------------------------------------------------
-- 1) Подопытные: салон и частник.
-- ------------------------------------------------------------
do $$
declare
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values
    ('00000000-0000-4000-e000-000000000095', v_instance, 'authenticated',
     'authenticated', 'showcase-dealer@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    ('00000000-0000-4000-e000-000000000096', v_instance, 'authenticated',
     'authenticated', 'showcase-private@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  -- Служебные поля заполняем СРАЗУ: тест 5 проверяет, что они не
  -- утекают анониму, и незаполненные колонки такую утечку скрыли бы.
  insert into public.profiles
    (id, email, full_name, phone, company_name, company_city,
     contact_person, seller_kind, trusted_seller, role)
  values
    ('00000000-0000-4000-e000-000000000095', 'showcase-dealer@rsauto.test',
     'Showcase Dealer', '+381641110095', 'Auto Kuća Test', 'Novi Sad',
     'Menadžer Petar', 'dealer', true, 'client'),
    ('00000000-0000-4000-e000-000000000096', 'showcase-private@rsauto.test',
     'Showcase Private', '+381641110096', null, null,
     null, 'private', false, 'client')
  on conflict (id) do update
    set seller_kind    = excluded.seller_kind,
        company_name   = excluded.company_name,
        company_city   = excluded.company_city,
        contact_person = excluded.contact_person,
        trusted_seller = excluded.trusted_seller,
        phone          = excluded.phone;
end $$;


-- ------------------------------------------------------------
-- 2) Помощник: переключиться на пользователя.
-- ------------------------------------------------------------
-- Тот же приём, что в 0093 и 0089: claims через set_config, потому
-- что SET не вычисляет выражения.
create or replace function pg_temp.act_as(p_user uuid)
returns void
language plpgsql
as $fn$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', p_user)::text,
    true
  );
end;
$fn$;

-- Активное объявление салона с одной фотографией. Нужно тесту 6:
-- get_showcase_dealers показывает только салоны с активными машинами
-- и собирает миниатюры из car_images.
create or replace function pg_temp.mk_car_with_photo(
  p_user  uuid,
  p_brand text,
  p_photo text
)
returns uuid
language plpgsql
security definer
as $fn$
declare
  v_id uuid;
begin
  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    currency, sale_price, city, contact_phone, status
  )
  values (
    p_user, true, false,
    p_brand, 'Golf', 2019, 87000,
    'EUR', 12500, 'Novi Sad', '+381641110095', 'active'::car_status
  )
  returning id into v_id;

  insert into public.car_images (car_id, image_url, order_index)
  values (v_id, p_photo, 0);

  return v_id;
end;
$fn$;


-- ============================================================
-- ТЕСТ 1+2. update_seller_profile пишет поля, get_dealer_profile
--           их возвращает.
-- ============================================================
do $$
declare
  v_dealer uuid := '00000000-0000-4000-e000-000000000095';
  v_row    record;
begin
  perform pg_temp.act_as(v_dealer);
  set local role authenticated;

  perform public.update_seller_profile(
    p_seller_kind   => 'dealer',
    p_company_name  => 'Auto Kuća Test',
    p_logo_url      => 'https://example.test/logo.jpg',
    p_description   => 'Prodaja polovnih automobila od 2010. godine.',
    p_dealer_phone  => '+381 21 555 111',
    p_website       => 'https://autokuca.test',
    p_opening_hours => 'Pon-Pet 09-18, Sub 09-14'
  );

  reset role;

  select * into v_row from public.get_dealer_profile(v_dealer);

  if v_row.description is distinct from
     'Prodaja polovnih automobila od 2010. godine.' then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: описание не сохранилось или не вернулось. '
      'Получено: %', coalesce(v_row.description, '<null>');
  end if;

  if v_row.dealer_phone is distinct from '+381 21 555 111' then
    raise exception 'ТЕСТ 1 ПРОВАЛЕН: телефон салона: %',
      coalesce(v_row.dealer_phone, '<null>');
  end if;

  if v_row.website is distinct from 'https://autokuca.test' then
    raise exception 'ТЕСТ 1 ПРОВАЛЕН: сайт: %',
      coalesce(v_row.website, '<null>');
  end if;

  if v_row.opening_hours is distinct from 'Pon-Pet 09-18, Sub 09-14' then
    raise exception 'ТЕСТ 1 ПРОВАЛЕН: часы работы: %',
      coalesce(v_row.opening_hours, '<null>');
  end if;

  -- Город приходит из profiles.company_city (0085) и до 0095 публичным
  -- клиентам не отдавался вовсе.
  if v_row.company_city is distinct from 'Novi Sad' then
    raise exception 'ТЕСТ 2 ПРОВАЛЕН: город салона не отдан: %',
      coalesce(v_row.company_city, '<null>');
  end if;

  -- Старые колонки обязаны остаться на месте: это тот же контракт.
  if v_row.display_name is distinct from 'Auto Kuća Test'
     or v_row.logo_url is distinct from 'https://example.test/logo.jpg' then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: сломаны существующие поля get_dealer_profile';
  end if;

  raise notice 'ТЕСТ 1+2 ok: поля витрины пишутся и читаются';
end $$;


-- ============================================================
-- ТЕСТ 3. СТАРЫЙ ВЫЗОВ ТРЕМЯ АРГУМЕНТАМИ (контракт с приложением).
-- ============================================================
-- Главная проверка файла. Приложение (Flutter) зовёт функцию именно
-- так, и если после 0095 такой вызов станет неоднозначным или
-- перестанет существовать, сломается сохранение профиля НА ТЕЛЕФОНАХ,
-- а сайт при этом продолжит работать — то есть поломка обнаружилась бы
-- не здесь и не сразу.
do $$
declare
  v_dealer uuid := '00000000-0000-4000-e000-000000000095';
  v_row    record;
begin
  perform pg_temp.act_as(v_dealer);
  set local role authenticated;

  -- Ровно три позиционных аргумента, как в старом коде.
  perform public.update_seller_profile(
    'dealer',
    'Auto Kuća Test',
    'https://example.test/logo2.jpg'
  );

  reset role;

  select * into v_row from public.get_dealer_profile(v_dealer);

  if v_row.logo_url is distinct from 'https://example.test/logo2.jpg' then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: вызов тремя аргументами не сохранил логотип';
  end if;

  -- Новые поля при таком вызове очищаются: параметры получили null,
  -- а функция перезаписывает профиль целиком. Это ожидаемое
  -- поведение (см. комментарий к p_description в 0095), и тест
  -- фиксирует его явно, чтобы будущая правка не сделала иначе молча.
  if v_row.description is not null then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: вызов тремя аргументами обязан очищать поля '
      'витрины, но описание осталось: %', v_row.description;
  end if;

  raise notice 'ТЕСТ 3 ok: контракт с приложением не сломан';
end $$;


-- ============================================================
-- ТЕСТ 4. Переход в 'private' затирает витрину.
-- ============================================================
do $$
declare
  v_dealer uuid := '00000000-0000-4000-e000-000000000095';
  v_row    record;
begin
  perform pg_temp.act_as(v_dealer);
  set local role authenticated;

  -- Сначала снова заполняем поля — иначе тест проверял бы пустоту,
  -- оставшуюся от теста 3.
  perform public.update_seller_profile(
    p_seller_kind   => 'dealer',
    p_company_name  => 'Auto Kuća Test',
    p_logo_url      => 'https://example.test/logo.jpg',
    p_description   => 'Opis salona',
    p_dealer_phone  => '+381 21 555 111',
    p_website       => 'https://autokuca.test',
    p_opening_hours => 'Pon-Pet 09-18'
  );

  perform public.update_seller_profile(p_seller_kind => 'private');

  reset role;

  if exists (
    select 1 from public.profiles
    where id = v_dealer
      and (description is not null
        or dealer_phone is not null
        or website is not null
        or opening_hours is not null)
  ) then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: после перехода в private поля витрины салона '
      'остались в базе';
  end if;

  -- Возвращаем роль салона: следующие тесты работают с ним как с
  -- дилером.
  perform pg_temp.act_as(v_dealer);
  set local role authenticated;

  perform public.update_seller_profile(
    p_seller_kind   => 'dealer',
    p_company_name  => 'Auto Kuća Test',
    p_logo_url      => 'https://example.test/logo.jpg',
    p_description   => 'Prodaja polovnih automobila.',
    p_dealer_phone  => '+381 21 555 111',
    p_website       => 'https://autokuca.test',
    p_opening_hours => 'Pon-Pet 09-18'
  );

  reset role;

  -- company_city триггером update_seller_profile не управляется (его
  -- ставит админ, 0085), поэтому после возврата в 'dealer' он на месте
  -- и снова публичен.
  select * into v_row from public.get_dealer_profile(v_dealer);
  if v_row.company_city is distinct from 'Novi Sad' then
    raise exception 'ТЕСТ 4 ПРОВАЛЕН: город салона потерян';
  end if;

  raise notice 'ТЕСТ 4 ok: private затирает витрину, dealer её возвращает';
end $$;


-- ============================================================
-- ТЕСТ 4б. Частник не получает полей витрины даже с данными в базе.
-- ============================================================
-- Проверяется ЧТЕНИЕ, а не запись: колонки могли остаться от прошлой
-- роли или быть выставлены админом напрямую, и get_dealer_profile
-- обязан фильтровать их сам.
do $$
declare
  v_private uuid := '00000000-0000-4000-e000-000000000096';
  v_row     record;
begin
  update public.profiles
     set description   = 'Ne bi trebalo da se vidi',
         dealer_phone  = '+381 60 000 000',
         website       = 'https://private.test',
         opening_hours = '00-24',
         company_city  = 'Beograd'
   where id = v_private;

  select * into v_row from public.get_dealer_profile(v_private);

  if v_row.description is not null
     or v_row.dealer_phone is not null
     or v_row.website is not null
     or v_row.opening_hours is not null
     or v_row.company_city is not null then
    raise exception
      'ТЕСТ 4б ПРОВАЛЕН: поля витрины салона отданы ЧАСТНОМУ продавцу';
  end if;

  raise notice 'ТЕСТ 4б ok: у частника поля витрины не публикуются';
end $$;


-- ============================================================
-- ТЕСТ 5. АНОНИМ: видит публичное, не видит служебное.
-- ============================================================
do $$
declare
  v_dealer uuid := '00000000-0000-4000-e000-000000000095';
  v_row    record;
  v_cols   text[];
begin
  set local role anon;

  select * into v_row from public.get_dealer_profile(v_dealer);

  if v_row.description is null or v_row.dealer_phone is null then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: аноним не получил публичные поля витрины';
  end if;

  reset role;

  -- Служебные поля не должны существовать в результате КАК КОЛОНКИ:
  -- проверять их значения бессмысленно, если колонки нет вовсе, —
  -- поэтому смотрим на сам состав возвращаемой таблицы.
  select array_agg(a.attname::text order by a.attnum)
    into v_cols
  from pg_proc pr
  join pg_type t on t.oid = pr.prorettype
  join pg_class cl on cl.reltype = t.oid
  join pg_attribute a on a.attrelid = cl.oid and a.attnum > 0
  where pr.pronamespace = 'public'::regnamespace
    and pr.proname = 'get_dealer_profile';

  -- Функция объявлена returns table, и её тип — анонимный record,
  -- у которого нет записи в pg_class. Тогда состав колонок берём из
  -- имён выходных аргументов.
  if v_cols is null then
    select array_agg(name order by ord)
      into v_cols
    from (
      select unnest(pr.proargnames) as name,
             generate_subscripts(pr.proargnames, 1) as ord,
             unnest(pr.proargmodes) as mode
      from pg_proc pr
      where pr.pronamespace = 'public'::regnamespace
        and pr.proname = 'get_dealer_profile'
    ) s
    where mode = 't';
  end if;

  if v_cols && array['phone', 'email', 'trusted_seller',
                     'contact_person', 'contract_date', 'is_admin'] then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: get_dealer_profile отдаёт служебное поле. '
      'Колонки: %', array_to_string(v_cols, ', ');
  end if;

  raise notice 'ТЕСТ 5 ok: аноним видит витрину, служебные поля закрыты';
end $$;


-- ============================================================
-- ТЕСТ 6. get_showcase_dealers: салон с миниатюрами, без частников.
-- ============================================================
do $$
declare
  v_dealer  uuid := '00000000-0000-4000-e000-000000000095';
  v_private uuid := '00000000-0000-4000-e000-000000000096';
  v_row     record;
  v_found   boolean := false;
begin
  perform pg_temp.mk_car_with_photo(v_dealer, 'Volkswagen',
    'https://example.test/car1.jpg');
  perform pg_temp.mk_car_with_photo(v_dealer, 'Škoda',
    'https://example.test/car2.jpg');
  -- Машина частника: он не должен попасть в выдачу вовсе.
  perform pg_temp.mk_car_with_photo(v_private, 'Opel',
    'https://example.test/car3.jpg');

  set local role anon;

  for v_row in select * from public.get_showcase_dealers(24) loop
    if v_row.id = v_private then
      raise exception
        'ТЕСТ 6 ПРОВАЛЕН: частный продавец попал в список салонов';
    end if;

    if v_row.id = v_dealer then
      v_found := true;

      if v_row.active_cars < 2 then
        raise exception 'ТЕСТ 6 ПРОВАЛЕН: счётчик машин салона: %',
          v_row.active_cars;
      end if;

      if coalesce(array_length(v_row.preview_photos, 1), 0) < 2 then
        raise exception
          'ТЕСТ 6 ПРОВАЛЕН: миниатюры машин не собраны (получено %)',
          coalesce(array_length(v_row.preview_photos, 1), 0);
      end if;

      if v_row.description is null then
        raise exception 'ТЕСТ 6 ПРОВАЛЕН: описание салона не отдано';
      end if;
    end if;
  end loop;

  reset role;

  if not v_found then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: салон с активными объявлениями отсутствует '
      'в get_showcase_dealers';
  end if;

  raise notice 'ТЕСТ 6 ok: плитка салона получает данные одним запросом';
end $$;


-- ============================================================
-- ТЕСТ 7. Слишком длинное описание отклоняется.
-- ============================================================
do $$
declare
  v_dealer uuid := '00000000-0000-4000-e000-000000000095';
  v_failed boolean := false;
begin
  perform pg_temp.act_as(v_dealer);
  set local role authenticated;

  begin
    perform public.update_seller_profile(
      p_seller_kind  => 'dealer',
      p_company_name => 'Auto Kuća Test',
      p_logo_url     => null,
      p_description  => repeat('x', 1001)
    );
  exception
    when check_violation then
      v_failed := true;
  end;

  reset role;

  if not v_failed then
    raise exception
      'ТЕСТ 7 ПРОВАЛЕН: описание длиннее 1000 символов принято';
  end if;

  raise notice 'ТЕСТ 7 ok: длина описания ограничена';
end $$;


rollback;

\echo 'ВСЕ ТЕСТЫ 0095 ПРОЙДЕНЫ (транзакция откачена, следов в базе нет)'
