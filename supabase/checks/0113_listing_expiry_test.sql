-- ============================================================
-- RS AUTO — ТЕСТ срока жизни объявлений и продления (0113).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл создаёт временных
-- пользователей и объявления, а также вызывает expire_listings,
-- который ставит письма в очередь. Всё идёт в ОДНОЙ транзакции с
-- откатом в конце, но защита от запуска на проде стоит первым
-- блоком: rollback не спасёт от побочных эффектов на боевых данных.
--
-- ЧТО ПРОВЕРЯЕТСЯ (список из задачи):
--   1) новое объявление получает expires_at = now() + TTL;
--   2) job переводит просроченное в expired и оно исчезает из выдачи;
--   3) extend_listing возвращает active и сбрасывает таймер;
--   4) sold объявление job не трогает;
--   5) напоминание приходит за 7 дней (и ровно один раз);
--   6) бэкфилл проставил expires_at всем активным;
--   7) продавец с email получает письмо, без email — уведомление;
--   8) массовое продление extend_my_listings.
-- Плюс то, что легко сломать незаметно:
--   9) архивация снимает срок, реактивация ставит заново;
--  10) чужое объявление продлить нельзя;
--  11) карточка expired открывается по прямой ссылке без цен.
--
-- ЗАПУСК: npm run test:sql
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
-- 1) Подопытные продавцы: с почтой и без неё.
-- ------------------------------------------------------------
-- Два профиля нужны для пункта 7: письмо уходит только тому, у кого
-- заполнен profiles.email. Вход на площадку по SMS, поэтому продавец
-- без почты — не крайний случай, а основная масса.
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
    ('00000000-0000-4000-e000-0000000000f1', v_instance, 'authenticated',
     'authenticated', 'exp-mail@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    ('00000000-0000-4000-e000-0000000000f2', v_instance, 'authenticated',
     'authenticated', 'exp-nomail@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.profiles
    (id, email, full_name, seller_kind, role, locale)
  values
    ('00000000-0000-4000-e000-0000000000f1', 'exp-mail@rsauto.test',
     'Expiry WithMail', 'private', 'client', 'ru'),
    -- email = NULL: этому продавцу писать некуда, остаётся кабинет.
    ('00000000-0000-4000-e000-0000000000f2', null,
     'Expiry NoMail', 'private', 'client', 'sr')
  on conflict (id) do update
    set email  = excluded.email,
        locale = excluded.locale;
end $$;


-- ------------------------------------------------------------
-- 2) ТЕСТ 1: новое объявление получает срок.
-- ------------------------------------------------------------
-- Вставляем сразу active (как после одобрения модератором) и ждём,
-- что триггер проставит expires_at ровно на TTL вперёд.
do $$
declare
  v_id      uuid;
  v_expires timestamptz;
  v_ttl     integer := public.f_listing_ttl_days();
begin
  insert into public.cars (
    user_id, is_for_sale, is_for_rent, brand, model, year, mileage,
    currency, sale_price, city, status
  )
  values (
    '00000000-0000-4000-e000-0000000000f1', true, false,
    'Volkswagen', 'Golf', 2015, 150000, 'EUR', 8000, 'Beograd', 'active'
  )
  returning id, expires_at into v_id, v_expires;

  if v_expires is null then
    raise exception 'ТЕСТ 1 ПРОВАЛЕН: новому активному объявлению не проставлен expires_at';
  end if;

  -- Допуск в минуту: между now() внутри триггера и now() здесь
  -- проходит время, точное равенство проверять нельзя.
  if abs(extract(epoch from (v_expires - (now() + make_interval(days => v_ttl))))) > 60 then
    raise exception 'ТЕСТ 1 ПРОВАЛЕН: expires_at = %, ожидалось около % (TTL % дней)',
      v_expires, now() + make_interval(days => v_ttl), v_ttl;
  end if;

  raise notice 'ТЕСТ 1 ОК: новое объявление получило срок % (+% дней)', v_expires, v_ttl;
end $$;


-- ------------------------------------------------------------
-- 3) ТЕСТ 6: бэкфилл проставил срок всем активным.
-- ------------------------------------------------------------
-- Проверяем инвариант, который миграция обязана держать постоянно:
-- активных без срока быть не должно.
do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans
    from public.cars
   where status = 'active' and expires_at is null;

  if v_orphans > 0 then
    raise exception 'ТЕСТ 6 ПРОВАЛЕН: % активных объявлений без expires_at', v_orphans;
  end if;

  raise notice 'ТЕСТ 6 ОК: активных без срока нет';
end $$;


-- ------------------------------------------------------------
-- 4) ТЕСТ 9: архивация снимает срок, реактивация ставит заново.
-- ------------------------------------------------------------
do $$
declare
  v_id      uuid;
  v_expires timestamptz;
begin
  select id into v_id from public.cars
   where user_id = '00000000-0000-4000-e000-0000000000f1' limit 1;

  update public.cars set status = 'archived' where id = v_id;
  select expires_at into v_expires from public.cars where id = v_id;
  if v_expires is not null then
    raise exception 'ТЕСТ 9 ПРОВАЛЕН: у архивного объявления остался срок %', v_expires;
  end if;

  update public.cars set status = 'active' where id = v_id;
  select expires_at into v_expires from public.cars where id = v_id;
  if v_expires is null then
    raise exception 'ТЕСТ 9 ПРОВАЛЕН: реактивация не проставила срок';
  end if;

  raise notice 'ТЕСТ 9 ОК: архив снимает срок, реактивация ставит заново';
end $$;


-- ------------------------------------------------------------
-- 5) ТЕСТ 5 и 7: предупреждение за N дней, письмо и уведомление.
-- ------------------------------------------------------------
-- Двигаем срок вплотную к границе предупреждения и запускаем job.
-- Продавец с почтой должен получить И письмо, И уведомление;
-- продавец без почты — только уведомление.
do $$
declare
  v_mail_car   uuid;
  v_nomail_car uuid;
  v_res        jsonb;
  v_notif      integer;
  v_emails     integer;
  v_warned     timestamptz;
begin
  select id into v_mail_car from public.cars
   where user_id = '00000000-0000-4000-e000-0000000000f1' limit 1;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent, brand, model, year, mileage,
    currency, sale_price, city, status
  )
  values (
    '00000000-0000-4000-e000-0000000000f2', true, false,
    'Škoda', 'Octavia', 2018, 90000, 'EUR', 11000, 'Novi Sad', 'active'
  )
  returning id into v_nomail_car;

  -- Оба объявления истекают через сутки — это внутри окна
  -- предупреждения (7 дней), но ещё не просрочка.
  update public.cars
     set expires_at = now() + interval '1 day'
   where id in (v_mail_car, v_nomail_car);

  v_res := public.expire_listings();

  if (v_res->>'warned')::integer < 2 then
    raise exception 'ТЕСТ 5 ПРОВАЛЕН: предупреждено %, ожидалось минимум 2 (%)',
      v_res->>'warned', v_res;
  end if;

  -- Уведомление в кабинете — обоим.
  select count(*) into v_notif
    from public.notifications
   where type = 'listing_expiring'
     and action_id in (v_mail_car, v_nomail_car);
  if v_notif <> 2 then
    raise exception 'ТЕСТ 7 ПРОВАЛЕН: уведомлений в кабинете %, ожидалось 2', v_notif;
  end if;

  -- Письмо — только владельцу с почтой.
  select count(*) into v_emails
    from public.email_queue
   where template_key = 'listing_expiring'
     and user_id = '00000000-0000-4000-e000-0000000000f1';
  if v_emails <> 1 then
    raise exception 'ТЕСТ 7 ПРОВАЛЕН: писем владельцу с почтой %, ожидалось 1', v_emails;
  end if;

  select count(*) into v_emails
    from public.email_queue
   where template_key = 'listing_expiring'
     and user_id = '00000000-0000-4000-e000-0000000000f2';
  if v_emails <> 0 then
    raise exception 'ТЕСТ 7 ПРОВАЛЕН: владельцу без почты поставлено % писем', v_emails;
  end if;

  -- Отметка не даёт слать предупреждение повторно.
  select expiry_warned_at into v_warned from public.cars where id = v_mail_car;
  if v_warned is null then
    raise exception 'ТЕСТ 5 ПРОВАЛЕН: не проставлен expiry_warned_at';
  end if;

  v_res := public.expire_listings();
  if (v_res->>'warned')::integer <> 0 then
    raise exception 'ТЕСТ 5 ПРОВАЛЕН: повторный запуск предупредил ещё % раз', v_res->>'warned';
  end if;

  raise notice 'ТЕСТ 5 и 7 ОК: предупреждение однократное, письмо только при наличии почты';
end $$;


-- ------------------------------------------------------------
-- 6) ТЕСТ 2 и 4: job скрывает просроченные, sold не трогает.
-- ------------------------------------------------------------
do $$
declare
  v_car      uuid;
  v_sold     uuid;
  v_res      jsonb;
  v_status   text;
  v_in_feed  integer;
begin
  select id into v_car from public.cars
   where user_id = '00000000-0000-4000-e000-0000000000f1' limit 1;

  -- Проданное объявление с искусственно проставленным сроком: job
  -- обязан пройти мимо, даже если срок в прошлом.
  insert into public.cars (
    user_id, is_for_sale, is_for_rent, brand, model, year, mileage,
    currency, sale_price, city, status
  )
  values (
    '00000000-0000-4000-e000-0000000000f1', true, false,
    'Audi', 'A4', 2016, 120000, 'EUR', 12000, 'Niš', 'active'
  )
  returning id into v_sold;

  update public.cars set status = 'sold' where id = v_sold;
  -- Пишем срок напрямую: триггер его снял, а нам нужен «просроченный
  -- sold» — худший случай для job.
  update public.cars set expires_at = now() - interval '1 day' where id = v_sold;

  update public.cars set expires_at = now() - interval '1 day' where id = v_car;

  v_res := public.expire_listings();

  select status::text into v_status from public.cars where id = v_car;
  if v_status <> 'expired' then
    raise exception 'ТЕСТ 2 ПРОВАЛЕН: просроченное объявление в статусе %, ожидалось expired', v_status;
  end if;

  select status::text into v_status from public.cars where id = v_sold;
  if v_status <> 'sold' then
    raise exception 'ТЕСТ 4 ПРОВАЛЕН: проданное объявление job изменил на %', v_status;
  end if;

  -- Исчезло из выдачи: search_cars фильтрует status = 'active'.
  select count(*) into v_in_feed
    from public.cars
   where id = v_car and status = 'active';
  if v_in_feed <> 0 then
    raise exception 'ТЕСТ 2 ПРОВАЛЕН: expired объявление осталось активным';
  end if;

  raise notice 'ТЕСТ 2 и 4 ОК: просроченное скрыто, проданное не тронуто';
end $$;


-- ------------------------------------------------------------
-- 7) ТЕСТ 11: карточка expired открывается, но без цен и контактов.
-- ------------------------------------------------------------
-- Читаем от анонима: владелец и админ видят объявление целиком, и на
-- них проверка смысла не имеет.
do $$
declare
  v_car   uuid;
  v_row   record;
begin
  select id into v_car from public.cars
   where status = 'expired' limit 1;

  set local role anon;
  select * into v_row from public.get_car_details(v_car);
  reset role;

  if v_row.id is null then
    raise exception 'ТЕСТ 11 ПРОВАЛЕН: карточка expired не открывается (404 вместо заглушки)';
  end if;
  if v_row.brand is null then
    raise exception 'ТЕСТ 11 ПРОВАЛЕН: марка не отдана — заголовок собрать не из чего';
  end if;
  if v_row.sale_price is not null then
    raise exception 'ТЕСТ 11 ПРОВАЛЕН: цена % отдана публично', v_row.sale_price;
  end if;
  if v_row.contact_phone is not null then
    raise exception 'ТЕСТ 11 ПРОВАЛЕН: телефон продавца отдан публично';
  end if;

  raise notice 'ТЕСТ 11 ОК: карточка expired открывается без цен и контактов';
end $$;


-- ------------------------------------------------------------
-- 8) ТЕСТ 3: extend_listing возвращает active и сбрасывает таймер.
-- ------------------------------------------------------------
do $$
declare
  v_car     uuid;
  v_status  text;
  v_expires timestamptz;
  v_ttl     integer := public.f_listing_ttl_days();
begin
  select id into v_car from public.cars
   where status = 'expired'
     and user_id = '00000000-0000-4000-e000-0000000000f1'
   limit 1;

  -- Под владельцем: extend_listing читает auth.uid().
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-e000-0000000000f1","role":"authenticated"}';

  select status, expires_at into v_status, v_expires
    from public.extend_listing(v_car);

  reset role;
  set local request.jwt.claims = '';

  if v_status <> 'active' then
    raise exception 'ТЕСТ 3 ПРОВАЛЕН: после продления статус %, ожидался active', v_status;
  end if;
  if v_expires is null then
    raise exception 'ТЕСТ 3 ПРОВАЛЕН: продление не проставило новый срок';
  end if;
  if abs(extract(epoch from (v_expires - (now() + make_interval(days => v_ttl))))) > 60 then
    raise exception 'ТЕСТ 3 ПРОВАЛЕН: срок % не равен now() + % дней', v_expires, v_ttl;
  end if;

  raise notice 'ТЕСТ 3 ОК: продление вернуло active и сбросило таймер на % дней', v_ttl;
end $$;


-- ------------------------------------------------------------
-- 9) ТЕСТ 10: чужое объявление продлить нельзя.
-- ------------------------------------------------------------
do $$
declare
  v_car uuid;
  v_ok  boolean := false;
begin
  select id into v_car from public.cars
   where user_id = '00000000-0000-4000-e000-0000000000f1' limit 1;

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-e000-0000000000f2","role":"authenticated"}';

  begin
    perform public.extend_listing(v_car);
  exception when insufficient_privilege then
    v_ok := true;
  end;

  reset role;
  set local request.jwt.claims = '';

  if not v_ok then
    raise exception 'ТЕСТ 10 ПРОВАЛЕН: удалось продлить чужое объявление';
  end if;

  raise notice 'ТЕСТ 10 ОК: чужое объявление продлить нельзя';
end $$;


-- ------------------------------------------------------------
-- 10) ТЕСТ 8: массовое продление.
-- ------------------------------------------------------------
do $$
declare
  v_count    integer;
  v_expired  integer;
begin
  -- Загоняем все объявления владельца в expired, чтобы проверить,
  -- что массовое продление поднимает их разом.
  update public.cars
     set status = 'expired'
   where user_id = '00000000-0000-4000-e000-0000000000f1'
     and status = 'active';

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-e000-0000000000f1","role":"authenticated"}';

  select public.extend_my_listings() into v_count;

  reset role;
  set local request.jwt.claims = '';

  if v_count < 1 then
    raise exception 'ТЕСТ 8 ПРОВАЛЕН: массовое продление вернуло %', v_count;
  end if;

  select count(*) into v_expired
    from public.cars
   where user_id = '00000000-0000-4000-e000-0000000000f1'
     and status = 'expired';

  if v_expired <> 0 then
    raise exception 'ТЕСТ 8 ПРОВАЛЕН: после массового продления осталось % истёкших', v_expired;
  end if;

  raise notice 'ТЕСТ 8 ОК: массово продлено % объявлений', v_count;
end $$;


-- ------------------------------------------------------------
-- ИТОГ
-- ------------------------------------------------------------
do $$
begin
  raise notice '=== ВСЕ ТЕСТЫ 0113 ПРОЙДЕНЫ ===';
end $$;

rollback;
