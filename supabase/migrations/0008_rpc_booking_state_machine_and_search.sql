-- ============================================================
-- AUTO.RS — Миграция 0008: Статусная машина броней + двуалфавитный поиск
-- ============================================================
-- Концепция Thick Backend (CLAUDE.md): смена статуса брони и поиск —
-- это критическая логика, поэтому она реализована серверными RPC.
-- Фронтенд FlutterFlow только вызывает эти функции.
--
-- Все функции — SECURITY DEFINER: они должны читать/писать bookings и cars
-- в обход RLS, но при этом САМИ строго проверяют права через auth.uid().
-- set search_path = public — защита от подмены пути поиска объектов.
-- ============================================================


-- ============================================================
-- 1) confirm_booking(booking_id) — ПОДТВЕРЖДЕНИЕ брони владельцем машины
-- ------------------------------------------------------------
-- Проверки:
--   * бронь существует;
--   * вызывающий = владелец машины (cars.user_id = auth.uid());
--   * текущий статус = 'pending';
--   * блокирующая проверка (FOR UPDATE): нет ли уже других confirmed-броней,
--     пересекающихся по датам с этой машиной (защита от гонок).
-- При успехе → 'confirmed'. Иначе → EXCEPTION.
--
-- Дополнительная страховка: даже если два владельца/устройства вызовут
-- функцию одновременно, EXCLUDE-констрейнт excl_no_overlap_confirmed
-- (миграция 0005) физически не даст записать пересечение.
-- ============================================================
create or replace function public.confirm_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_owner   uuid;
  v_conflicts integer;
begin
  -- Блокируем строку брони на время транзакции (FOR UPDATE),
  -- чтобы параллельные вызовы не подтвердили одну и ту же бронь дважды.
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  -- Бронь не найдена
  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Находим владельца машины по этой броне
  select c.user_id
    into v_owner
  from public.cars c
  where c.id = v_booking.car_id;

  -- Право подтверждать есть только у владельца машины
  if v_owner is distinct from auth.uid() then
    raise exception 'Недостаточно прав: подтвердить бронь может только владелец машины'
      using errcode = 'insufficient_privilege';
  end if;

  -- Подтверждать можно только заявку в статусе pending
  if v_booking.status <> 'pending' then
    raise exception 'Бронь нельзя подтвердить: текущий статус = %, ожидался pending', v_booking.status
      using errcode = 'check_violation';
  end if;

  -- Блокирующая проверка пересечений с уже подтверждёнными бронями этой машины.
  -- FOR UPDATE на конфликтующих строках не даст им измениться до конца транзакции.
  select count(*)
    into v_conflicts
  from public.bookings b
  where b.car_id = v_booking.car_id
    and b.id <> v_booking.id
    and b.status = 'confirmed'
    and daterange(b.start_date, b.end_date, '[]')
        && daterange(v_booking.start_date, v_booking.end_date, '[]')
  for update;

  if v_conflicts > 0 then
    raise exception 'Даты уже заняты другой подтверждённой бронью на эту машину'
      using errcode = 'exclusion_violation';
  end if;

  -- Всё чисто — переводим в confirmed
  update public.bookings
     set status = 'confirmed'
   where id = v_booking.id
   returning * into v_booking;

  return v_booking;
end;
$$;

comment on function public.confirm_booking(uuid)
  is 'Подтверждение брони владельцем машины (pending → confirmed) с блокирующей проверкой овербукинга';


-- ============================================================
-- 2) reject_booking(booking_id) — ОТКЛОНЕНИЕ брони владельцем машины
-- ------------------------------------------------------------
-- Проверки: права владельца машины + текущий статус = 'pending'.
-- Результат: 'pending' → 'rejected'. Даты остаются свободными.
-- ============================================================
create or replace function public.reject_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_owner   uuid;
begin
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  select c.user_id
    into v_owner
  from public.cars c
  where c.id = v_booking.car_id;

  if v_owner is distinct from auth.uid() then
    raise exception 'Недостаточно прав: отклонить бронь может только владелец машины'
      using errcode = 'insufficient_privilege';
  end if;

  -- Отклонять имеет смысл только заявку в ожидании
  if v_booking.status <> 'pending' then
    raise exception 'Бронь нельзя отклонить: текущий статус = %, ожидался pending', v_booking.status
      using errcode = 'check_violation';
  end if;

  update public.bookings
     set status = 'rejected'
   where id = v_booking.id
   returning * into v_booking;

  return v_booking;
end;
$$;

comment on function public.reject_booking(uuid)
  is 'Отклонение брони владельцем машины (pending → rejected)';


-- ============================================================
-- 3) cancel_booking(booking_id) — ОТМЕНА брони её создателем (клиентом)
-- ------------------------------------------------------------
-- Проверки: вызывающий = создатель брони (bookings.customer_id = auth.uid()).
-- ВНИМАНИЕ: в таблице bookings поле создателя называется customer_id,
-- а не user_id (см. миграцию 0005). Проверяем именно customer_id.
--
-- Отмена возможна из статусов 'pending' и 'confirmed'.
-- Если бронь была 'confirmed' — освобождаем даты и оставляем ЗАДЕЛ
-- под финансовую логику штрафа за позднюю отмену.
-- ============================================================
create or replace function public.cancel_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking          public.bookings;
  v_was_confirmed    boolean;
begin
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Отменить бронь может ТОЛЬКО её создатель (клиент)
  if v_booking.customer_id is distinct from auth.uid() then
    raise exception 'Недостаточно прав: отменить бронь может только её создатель'
      using errcode = 'insufficient_privilege';
  end if;

  -- Уже отменённую/отклонённую/завершённую бронь отменять нельзя
  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'Бронь нельзя отменить: текущий статус = %', v_booking.status
      using errcode = 'check_violation';
  end if;

  -- Запоминаем, была ли бронь подтверждённой (влияет на штрафную логику)
  v_was_confirmed := (v_booking.status = 'confirmed');

  update public.bookings
     set status = 'cancelled'
   where id = v_booking.id
   returning * into v_booking;

  -- ------------------------------------------------------------
  -- МЕСТО ДЛЯ ФИНАНСОВОЙ ЛОГИКИ ШТРАФА ЗА ОТМЕНУ ПОДТВЕРЖДЁННОЙ БРОНИ.
  -- Здесь при v_was_confirmed = true нужно будет:
  --   * рассчитать штраф (например, % от rent_subtotal или фикс. сумма,
  --     возможно в зависимости от близости start_date к текущей дате);
  --   * зафиксировать удержание/возврат депозита;
  --   * записать движение средств в будущую таблицу транзакций/расчётов.
  -- Реализуем на следующем шаге, когда согласуем правила штрафов.
  -- ------------------------------------------------------------
  if v_was_confirmed then
    -- задел под штраф; пока действий не выполняем
    null;
  end if;

  return v_booking;
end;
$$;

comment on function public.cancel_booking(uuid)
  is 'Отмена брони её создателем (pending/confirmed → cancelled). Задел под штраф при отмене confirmed';


-- ============================================================
-- 4) search_cars_v2(search_query) — ДВУАЛФАВИТНЫЙ ПОИСК (кириллица/латиница)
-- ------------------------------------------------------------
-- Нормализует запрос через f_normalize (lower + unaccent) и ищет по
-- нормализованным полям brand/model/city. Устойчив к диакритике
-- (Đ, Č, Š, Ž) и опечаткам за счёт триграмм (pg_trgm).
--
-- Задействует GIN-триграммные индексы из миграции 0003:
--   idx_cars_brand_norm / idx_cars_model_norm / idx_cars_city_norm.
-- Оператор % (word_similarity через ILIKE-триграммы) даёт нечёткое совпадение;
-- similarity() используется для ранжирования результатов по релевантности.
--
-- Возвращает только активные объявления (setof public.cars) — как в поиске UI.
-- ============================================================
create or replace function public.search_cars_v2(search_query text)
returns setof public.cars
language sql
stable
as $$
  with q as (
    -- Один раз нормализуем поисковый запрос
    select public.f_normalize(search_query) as norm
  )
  select c.*
  from public.cars c, q
  where c.status = 'active'
    and (
      -- Триграммное нечёткое совпадение по любому из полей
      public.f_normalize(c.brand) % q.norm
      or public.f_normalize(c.model) % q.norm
      or public.f_normalize(c.city)  % q.norm
      -- Плюс подстрочное совпадение (короткие запросы, где триграмм мало)
      or public.f_normalize(c.brand) ilike '%' || q.norm || '%'
      or public.f_normalize(c.model) ilike '%' || q.norm || '%'
      or public.f_normalize(c.city)  ilike '%' || q.norm || '%'
    )
  -- Ранжируем по максимальной похожести (сначала самые релевантные)
  order by greatest(
    similarity(public.f_normalize(c.brand), q.norm),
    similarity(public.f_normalize(c.model), q.norm),
    similarity(public.f_normalize(c.city),  q.norm)
  ) desc
  limit 50;
$$;

comment on function public.search_cars_v2(text)
  is 'Двуалфавитный (кириллица/латиница) нечёткий поиск авто по brand/model/city через unaccent + pg_trgm';


-- ============================================================
-- ПРАВА НА ВЫЗОВ RPC
-- ------------------------------------------------------------
-- Статусные функции — только для авторизованных пользователей.
-- Поиск доступен и гостям (anon), и авторизованным.
-- ============================================================
grant execute on function public.confirm_booking(uuid) to authenticated;
grant execute on function public.reject_booking(uuid)  to authenticated;
grant execute on function public.cancel_booking(uuid)  to authenticated;
grant execute on function public.search_cars_v2(text)  to anon, authenticated;
