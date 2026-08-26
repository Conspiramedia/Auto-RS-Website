-- ============================================================
-- RS AUTO — ТЕСТ пометки возвратов в очереди модерации (0091).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл создаёт временных
-- пользователей и объявления; всё идёт в одной транзакции, которая в
-- конце откатывается.
--
-- Очередь читается ОТ РОЛИ authenticated с claims администратора:
-- admin_moderation_queue первой строкой проверяет is_admin(), и под
-- postgres она отказала бы (профиля с таким id нет), а тест, который
-- ловит отказ вместо данных, ничего бы не проверил.
--
-- ЧТО ПРОВЕРЯЕТСЯ:
--   1) объявление, снятое администратором и исправленное владельцем,
--      помечено returned_after_decision и несёт причину снятия;
--   2) то же для отклонённого (car_rejected) — второй путь возврата;
--   3) первая подача НЕ помечена и причины не несёт;
--   4) возвраты идут ВЫШЕ первых подач, даже если поданы позже;
--   5) внутри групп сохраняется FIFO — кто дольше ждёт, тот выше.
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
-- 1) Подопытные: администратор и владелец.
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
    ('00000000-0000-4000-f200-0000000000d1', v_instance, 'authenticated',
     'authenticated', 'q-admin@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    ('00000000-0000-4000-f200-0000000000d2', v_instance, 'authenticated',
     'authenticated', 'q-owner@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.profiles
    (id, email, full_name, seller_kind, trusted_seller, role, is_admin, locale)
  values
    ('00000000-0000-4000-f200-0000000000d1', 'q-admin@rsauto.test',
     'Q Admin', 'private', false, 'admin', true, 'ru'),
    ('00000000-0000-4000-f200-0000000000d2', 'q-owner@rsauto.test',
     'Q Owner', 'private', false, 'seller', false, 'ru')
  on conflict (id) do update
    set is_admin = excluded.is_admin,
        email    = excluded.email;
end $$;


-- ------------------------------------------------------------
-- Помощники.
-- ------------------------------------------------------------
-- ВАЖНО: очередь сортирует по created_at, поэтому даты подачи задаются
-- явно. Без этого все объявления теста получили бы now() с разницей в
-- микросекунды, и проверка порядка зависела бы от скорости машины.
create or replace function pg_temp.mk_car(
  p_status  text,
  p_created timestamptz,
  p_brand   text default 'Skoda'
)
returns uuid
language plpgsql
as $fn$
declare
  v_id uuid;
begin
  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    currency, sale_price, city, contact_phone, status, created_at
  )
  values (
    '00000000-0000-4000-f200-0000000000d2', true, false,
    p_brand, 'Octavia', 2021, 42000,
    'EUR', 17400, 'Beograd', '+381641234567', p_status::car_status, p_created
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

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


-- ============================================================
-- ПОДГОТОВКА СОСТОЯНИЯ
-- ============================================================
-- Четыре объявления в moderation, три пути попадания:
--   A — снято админом, затем исправлено владельцем (подано раньше всех);
--   B — отклонено админом, затем исправлено (подано позже A);
--   C — первая подача, САМАЯ СТАРАЯ из всех;
--   D — первая подача, самая свежая.
-- Порядок в очереди обязан быть: A, B (возвраты, FIFO между собой),
-- затем C, D (первые подачи, FIFO). Заметьте: C старше A, и если бы
-- сортировка шла только по дате, C стояло бы первым — именно это и
-- проверяет тест 4.
do $$
declare
  v_a uuid;
  v_b uuid;
begin
  -- A: active → админ снял → владелец исправил (moderation).
  v_a := pg_temp.mk_car('active', now() - interval '3 days', 'Audi');

  perform pg_temp.act_as('00000000-0000-4000-f200-0000000000d1');
  set local role authenticated;
  perform public.admin_set_car_status(
    v_a, 'archived', 'уберите номер телефона из текста описания'
  );
  reset role;

  -- Правку имитируем прямым UPDATE: важен факт «объявление снова в
  -- moderation после решения админа», а не путь, которым оно туда
  -- попало. Сам путь через update_car_v3 проверяется в тесте 0090.
  update public.cars
     set status = 'moderation', archived_by = null, archived_reason = null
   where id = v_a;

  -- B: moderation → админ отклонил → владелец исправил.
  v_b := pg_temp.mk_car('moderation', now() - interval '2 days', 'BMW');

  perform pg_temp.act_as('00000000-0000-4000-f200-0000000000d1');
  set local role authenticated;
  perform public.reject_car(v_b, 'на снимках другой автомобиль, замените фотографии');
  reset role;

  update public.cars
     set status = 'moderation', moderation_comment = null
   where id = v_b;

  -- C и D: обычные первые подачи. C — самая старая из всех четырёх.
  perform pg_temp.mk_car('moderation', now() - interval '5 days', 'Fiat');
  perform pg_temp.mk_car('moderation', now() - interval '1 day',  'Opel');
end $$;


-- ============================================================
-- ТЕСТЫ 1–3. ПОМЕТКА И ПРИЧИНА
-- ============================================================
do $$
declare
  v_flag   boolean;
  v_reason text;
begin
  perform pg_temp.act_as('00000000-0000-4000-f200-0000000000d1');
  set local role authenticated;

  -- --- 1) Снятое админом и исправленное ---
  select q.returned_after_decision, q.last_decision_reason
    into v_flag, v_reason
    from public.admin_moderation_queue(100, 0) q
   where q.brand = 'Audi';

  if v_flag is not true then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: объявление, снятое администратором и '
      'исправленное владельцем, не помечено как возврат. Модератор '
      'увидит его как обычную новую подачу.';
  end if;

  if v_reason is null or v_reason not ilike '%телефон%' then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: причина снятия «%», ожидалась про телефон в '
      'описании', v_reason;
  end if;

  -- --- 2) Отклонённое и исправленное ---
  select q.returned_after_decision, q.last_decision_reason
    into v_flag, v_reason
    from public.admin_moderation_queue(100, 0) q
   where q.brand = 'BMW';

  if v_flag is not true then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: отклонённое и исправленное объявление не '
      'помечено как возврат';
  end if;

  if v_reason is null or v_reason not ilike '%другой автомобиль%' then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: причина отклонения «%»', v_reason;
  end if;

  -- --- 3) Первая подача ---
  select q.returned_after_decision, q.last_decision_reason
    into v_flag, v_reason
    from public.admin_moderation_queue(100, 0) q
   where q.brand = 'Fiat';

  if v_flag is not false then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: первая подача помечена как возврат — метка '
      'потеряет смысл, если стоит у всех';
  end if;

  if v_reason is not null then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: у первой подачи причина «%», ожидался null',
      v_reason;
  end if;

  reset role;

  raise notice 'ТЕСТЫ 1–3 ok: возвраты помечены, первая подача — нет';
end $$;


-- ============================================================
-- ТЕСТЫ 4–5. ПОРЯДОК ОЧЕРЕДИ
-- ============================================================
do $$
declare
  v_order text[];
begin
  perform pg_temp.act_as('00000000-0000-4000-f200-0000000000d1');
  set local role authenticated;

  select array_agg(q.brand order by q.ord)
    into v_order
    from (
      select brand, row_number() over () as ord
        from public.admin_moderation_queue(100, 0)
    ) q;

  reset role;

  -- 4) Возвраты выше первых подач, хотя Fiat подан раньше всех.
  if v_order[1] <> 'Audi' or v_order[2] <> 'BMW' then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: порядок очереди %, ожидались первыми возвраты '
      'Audi и BMW. Продавец, исправивший замечание, ждёт наравне с '
      'новыми подачами.', v_order;
  end if;

  -- 5) Внутри групп FIFO: Fiat (5 дней) выше Opel (1 день).
  if v_order[3] <> 'Fiat' or v_order[4] <> 'Opel' then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: порядок первых подач %, ожидался FIFO — Fiat '
      'старше Opel', v_order;
  end if;

  raise notice 'ТЕСТЫ 4–5 ok: возвраты первыми, внутри групп FIFO';
end $$;


-- ------------------------------------------------------------
-- Откат: тест не оставляет следов в базе.
-- ------------------------------------------------------------
rollback;

\echo ''
\echo '================================================='
\echo 'ТЕСТЫ ОЧЕРЕДИ МОДЕРАЦИИ ПРОЙДЕНЫ. Транзакция откачена.'
\echo '================================================='
