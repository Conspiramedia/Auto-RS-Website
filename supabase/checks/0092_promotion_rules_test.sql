-- ============================================================
-- AUTO.RS — Проверка миграции 0092: правила продвижения
-- ============================================================
-- ЧТО ПРОВЕРЯЕТСЯ:
--   1) объявление на 14-й день после подачи продвинуть НЕЛЬЗЯ;
--   2) на 15-й — МОЖНО;
--   3) второе продвижение внутри 30 дней от старта первого — НЕЛЬЗЯ;
--   4) после 30 дней — МОЖНО;
--   5) в wallet_transactions пишется created_by = владелец;
--   6) срок продвижения — ровно 7 дней, p_days игнорируется;
--   7) promoted_at переживает снятие с публикации (лимит не обходится
--      через archived → active);
--   8) get_my_listings_stats отдаёт корректные promo_state и дату.
--
-- КАК ЗАПУСКАТЬ. Скрипт целиком выполняется в транзакции и в конце
-- ОТКАТЫВАЕТСЯ: ни одной строки в базе не остаётся. Это позволяет
-- гонять его и на локальном стеке, и, при нужде, на боевом — данные
-- он не меняет.
--
--   psql "$DATABASE_URL" -f supabase/checks/0092_promotion_rules_test.sql
--
-- Успех — набор строк «ТЕСТ N ok». Любой провал поднимает exception,
-- транзакция откатывается, и в выводе видно, что именно разошлось.
--
-- ПОЧЕМУ ВОЗРАСТ ЗАДАЁТСЯ ПОДМЕНОЙ created_at, А НЕ ОЖИДАНИЕМ.
-- Ждать пятнадцать суток в тесте нельзя, а now() подменить в
-- security definer нечем. Поэтому двигаем не время, а данные:
-- объявление с created_at = now() - 14 дней ПО ОПРЕДЕЛЕНИЮ находится
-- на 14-м дне жизни. Проверяется ровно то же условие, что в бою.
-- ============================================================

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- 0) ЗАЩИТА: это точно не боевая база?
-- ------------------------------------------------------------
-- Тот же предохранитель, что в 0089: скрипт создаёт пользователей и
-- объявления, и запуск его по недосмотру на проде должен обрываться
-- на первом же шаге, а не на rollback в конце.
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

-- Роль вызывающего подменяется через set_config: activate_promotion
-- читает владельца из auth.uid(), а он берётся из request.jwt.claims.
-- Иначе тест пришлось бы гонять под реальным входом.

do $$
declare
  v_owner   uuid := '00000000-0000-4000-f000-0000000000c1';
  v_other   uuid := '00000000-0000-4000-f000-0000000000c2';
  v_car     uuid;
  v_until   timestamptz;
  v_state   text;
  v_at      timestamptz;
  v_created uuid;
  v_days    numeric;
  v_msg     text;
  v_ok      boolean;
begin
  -- ----------------------------------------------------------
  -- ПОДГОТОВКА: пользователь и объявление.
  -- ----------------------------------------------------------
  -- auth.users заполняем напрямую: GoTrue в тесте не участвует, а
  -- внешний ключ profiles → auth.users обязан быть удовлетворён.
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'promo-owner@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'promo-other@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.profiles
    (id, email, full_name, seller_kind, role, is_admin, locale)
  values
    (v_owner, 'promo-owner@rsauto.test', 'Promo Owner',
     'private', 'seller', false, 'ru'),
    (v_other, 'promo-other@rsauto.test', 'Promo Other',
     'private', 'seller', false, 'ru')
  on conflict (id) do nothing;

  -- Представляемся владельцем: auth.uid() читает этот claim.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('role', 'authenticated', true);

  -- ==========================================================
  -- ТЕСТ 1. 14-й день — отказ.
  -- ==========================================================
  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    currency, sale_price, city, contact_phone, status, created_at
  )
  values (
    v_owner, true, false,
    'BMW', 'X5', 2019, 84000,
    'EUR', 15000, 'Beograd', '+381641234567', 'active',
    now() - interval '14 days'
  )
  returning id into v_car;

  v_ok := false;
  begin
    perform public.activate_promotion(v_car, 7);
  exception when check_violation then
    v_ok := true;
    v_msg := sqlerrm;
  end;

  if not v_ok then
    raise exception 'ТЕСТ 1 ПРОВАЛЕН: продвижение на 14-й день прошло, '
      'хотя правило требует 15 дней';
  end if;

  -- Сообщение обязано называть дату, а не быть техническим.
  if v_msg not like 'Поднять объявление будет доступно с %' then
    raise exception 'ТЕСТ 1 ПРОВАЛЕН: текст отказа «%» не содержит даты '
      'доступности', v_msg;
  end if;

  raise notice 'ТЕСТ 1 ok: 14-й день отклонён — «%»', v_msg;

  -- ==========================================================
  -- ТЕСТ 2. 15-й день — проходит.
  -- ==========================================================
  -- Тому же объявлению сдвигаем дату подачи на сутки назад: теперь
  -- ему ровно 15 дней.
  update public.cars
     set created_at = now() - interval '15 days'
   where id = v_car;

  perform public.activate_promotion(v_car, 7);

  select c.is_vip, c.boosted_until, c.promoted_at
    into v_ok, v_until, v_at
    from public.cars c where c.id = v_car;

  if not v_ok or v_until is null or v_until <= now() then
    raise exception 'ТЕСТ 2 ПРОВАЛЕН: после продвижения is_vip = %, '
      'boosted_until = %', v_ok, v_until;
  end if;

  if v_at is null then
    raise exception 'ТЕСТ 2 ПРОВАЛЕН: promoted_at не заполнен';
  end if;

  raise notice 'ТЕСТ 2 ok: 15-й день прошёл, продвижение до %', v_until;

  -- ==========================================================
  -- ТЕСТ 3. Срок — ровно 7 дней, p_days игнорируется.
  -- ==========================================================
  -- Выше вызывали с p_days = 7, но проверяем именно длительность:
  -- при следующем вызове (тест 6) передадим 30 и убедимся, что срок
  -- не изменился.
  v_days := extract(epoch from (v_until - now())) / 86400.0;

  if v_days < 6.9 or v_days > 7.1 then
    raise exception 'ТЕСТ 3 ПРОВАЛЕН: срок продвижения % дней вместо 7',
      round(v_days, 2);
  end if;

  raise notice 'ТЕСТ 3 ok: срок продвижения % дней', round(v_days, 2);

  -- ==========================================================
  -- ТЕСТ 4. created_by записан.
  -- ==========================================================
  select w.created_by into v_created
    from public.wallet_transactions w
   where w.car_id = v_car
     and w.type = 'gift'
   order by w.created_at desc
   limit 1;

  if v_created is null then
    raise exception 'ТЕСТ 4 ПРОВАЛЕН: created_by в gift-транзакции пуст — '
      'нельзя отличить подъём владельцем от подарка администратора';
  end if;

  if v_created <> v_owner then
    raise exception 'ТЕСТ 4 ПРОВАЛЕН: created_by = %, ожидался владелец %',
      v_created, v_owner;
  end if;

  raise notice 'ТЕСТ 4 ok: created_by = владелец';

  -- ==========================================================
  -- ТЕСТ 5. Повтор внутри 30 дней — отказ.
  -- ==========================================================
  -- Гасим действующее промо руками: иначе сработает более ранняя
  -- проверка «продвижение уже включено», и мы проверили бы не то
  -- правило. Именно так выглядит объявление через неделю, когда срок
  -- вышел, а 30 дней с момента подъёма ещё не прошли.
  update public.cars
     set is_vip = false, boosted_until = null
   where id = v_car;

  v_ok := false;
  begin
    perform public.activate_promotion(v_car, 7);
  exception when check_violation then
    v_ok := true;
    v_msg := sqlerrm;
  end;

  if not v_ok then
    raise exception 'ТЕСТ 5 ПРОВАЛЕН: второе продвижение внутри 30 дней '
      'прошло — лимит не работает';
  end if;

  raise notice 'ТЕСТ 5 ok: повтор внутри окна отклонён — «%»', v_msg;

  -- ==========================================================
  -- ТЕСТ 6. Через 30 дней — проходит; p_days = 30 игнорируется.
  -- ==========================================================
  update public.cars
     set promoted_at = now() - interval '30 days' - interval '1 minute'
   where id = v_car;

  perform public.activate_promotion(v_car, 30);

  select c.boosted_until into v_until
    from public.cars c where c.id = v_car;

  v_days := extract(epoch from (v_until - now())) / 86400.0;

  if v_days < 6.9 or v_days > 7.1 then
    raise exception 'ТЕСТ 6 ПРОВАЛЕН: p_days = 30 дал срок % дней, '
      'ожидались фиксированные 7', round(v_days, 2);
  end if;

  raise notice 'ТЕСТ 6 ok: после 30 дней продвижение прошло, срок % дней',
    round(v_days, 2);

  -- ==========================================================
  -- ТЕСТ 7. promoted_at переживает снятие с публикации.
  -- ==========================================================
  -- Триггер К6 (0089) гасит is_vip и boosted_until при уходе в archived.
  -- Если бы он гасил и promoted_at, лимит обходился бы так: снял —
  -- вернул — поднял заново.
  update public.cars set status = 'archived' where id = v_car;

  select c.promoted_at into v_at
    from public.cars c where c.id = v_car;

  if v_at is null then
    raise exception 'ТЕСТ 7 ПРОВАЛЕН: promoted_at обнулился при снятии — '
      'лимит обходится через archived → active';
  end if;

  update public.cars set status = 'active' where id = v_car;

  v_ok := false;
  begin
    perform public.activate_promotion(v_car, 7);
  exception when check_violation then
    v_ok := true;
  end;

  if not v_ok then
    raise exception 'ТЕСТ 7 ПРОВАЛЕН: после снятия и возврата продвижение '
      'прошло внутри окна 30 дней';
  end if;

  raise notice 'ТЕСТ 7 ok: снятие не обнуляет лимит';

  -- ==========================================================
  -- ТЕСТ 8. get_my_listings_stats: состояния кнопки.
  -- ==========================================================
  -- 8а. cooldown — промо гасили, 30 дней не прошли.
  update public.cars
     set is_vip = false, boosted_until = null,
         promoted_at = now() - interval '10 days'
   where id = v_car;

  select g.promo_state, g.promo_available_at into v_state, v_at
    from public.get_my_listings_stats() g
   where g.car_id = v_car;

  if v_state <> 'cooldown' then
    raise exception 'ТЕСТ 8а ПРОВАЛЕН: promo_state = «%», ожидался cooldown',
      v_state;
  end if;

  if v_at is null or v_at::date <> (now() + interval '20 days')::date then
    raise exception 'ТЕСТ 8а ПРОВАЛЕН: дата доступности % не равна '
      'старт + 30 дней', v_at;
  end if;

  raise notice 'ТЕСТ 8а ok: cooldown до %', v_at;

  -- 8б. too_young — молодое объявление, ни разу не поднималось.
  update public.cars
     set promoted_at = null,
         created_at  = now() - interval '3 days'
   where id = v_car;

  select g.promo_state, g.promo_available_at into v_state, v_at
    from public.get_my_listings_stats() g
   where g.car_id = v_car;

  if v_state <> 'too_young' then
    raise exception 'ТЕСТ 8б ПРОВАЛЕН: promo_state = «%», ожидался too_young',
      v_state;
  end if;

  if v_at::date <> (now() + interval '12 days')::date then
    raise exception 'ТЕСТ 8б ПРОВАЛЕН: дата доступности % не равна '
      'подача + 15 дней', v_at;
  end if;

  raise notice 'ТЕСТ 8б ok: too_young до %', v_at;

  -- 8в. available — взрослое и не поднималось.
  update public.cars
     set created_at = now() - interval '40 days'
   where id = v_car;

  select g.promo_state, g.promo_available_at into v_state, v_at
    from public.get_my_listings_stats() g
   where g.car_id = v_car;

  if v_state <> 'available' or v_at is not null then
    raise exception 'ТЕСТ 8в ПРОВАЛЕН: promo_state = «%», дата = % — '
      'ожидалось available без даты', v_state, v_at;
  end if;

  raise notice 'ТЕСТ 8в ok: available';

  -- 8г. active — продвижение идёт.
  perform public.activate_promotion(v_car, 7);

  select g.promo_state, g.promo_available_at into v_state, v_at
    from public.get_my_listings_stats() g
   where g.car_id = v_car;

  if v_state <> 'active' then
    raise exception 'ТЕСТ 8г ПРОВАЛЕН: promo_state = «%», ожидался active',
      v_state;
  end if;

  if v_at::date <> (now() + interval '7 days')::date then
    raise exception 'ТЕСТ 8г ПРОВАЛЕН: дата «включено до» % не равна '
      'сегодня + 7 дней', v_at;
  end if;

  raise notice 'ТЕСТ 8г ok: active до %', v_at;

  -- 8д. Повторное нажатие при действующем промо — отказ с датой.
  v_ok := false;
  begin
    perform public.activate_promotion(v_car, 7);
  exception when check_violation then
    v_ok := true;
    v_msg := sqlerrm;
  end;

  if not v_ok then
    raise exception 'ТЕСТ 8д ПРОВАЛЕН: повторное нажатие при действующем '
      'промо продлило срок вместо отказа';
  end if;

  if v_msg not like 'Продвижение уже включено до %' then
    raise exception 'ТЕСТ 8д ПРОВАЛЕН: текст отказа «%» не тот', v_msg;
  end if;

  raise notice 'ТЕСТ 8д ok: повтор при активном промо отклонён — «%»', v_msg;

  -- ==========================================================
  -- ТЕСТ 9. Чужое объявление продвинуть нельзя (регресс 0048).
  -- ==========================================================
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text,
    true
  );

  v_ok := false;
  begin
    perform public.activate_promotion(v_car, 7);
  exception when insufficient_privilege then
    v_ok := true;
  end;

  if not v_ok then
    raise exception 'ТЕСТ 9 ПРОВАЛЕН: чужое объявление продвинулось';
  end if;

  raise notice 'ТЕСТ 9 ok: чужое объявление защищено';

  raise notice '=== ВСЕ ТЕСТЫ 0092 ПРОЙДЕНЫ ===';
end $$;

-- Ничего не остаётся в базе: и объявление, и пользователь, и строки
-- кошелька исчезают вместе с транзакцией.
rollback;
