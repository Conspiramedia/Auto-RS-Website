-- ============================================================
-- AUTO.RS — Миграция 0012: Закрытие финансового контура брони
-- ============================================================
-- Дорабатываем cancel_booking (отмена оплаченной брони с возвратом/штрафом)
-- и добавляем complete_booking (завершение аренды + разблокировка payout).
-- Вся логика — на сервере (Thick Backend), SECURITY DEFINER.
--
-- Напоминание про суммы в броне (посчитаны триггером calc_booking_totals):
--   rent_subtotal       — доля владельца,
--   platform_commission — комиссия платформы (10%),
--   total_price         = rent_subtotal + platform_commission (платит клиент).
-- Правило "менее 24 часов": start_date <= current_date + 1 (тип date без времени).
-- ============================================================


-- ============================================================
-- 1) МОДЕРНИЗАЦИЯ cancel_booking(booking_id)
-- ------------------------------------------------------------
-- Разрешённые для отмены статусы: 'pending', 'confirmed', 'paid'.
-- Сценарии:
--   A) pending                      → cancelled, без денег.
--   B) confirmed + <24ч             → penalty (1 день), даты освобождаются.
--   C) confirmed + >24ч             → cancelled, refund прошлых payment (если были).
--   D) paid + >24ч (заблаговременно) → cancelled, полный refund клиенту,
--                                      payout владельца → 'failed' (выплаты не будет).
--   E) paid + <24ч (поздняя отмена)  → penalty (1 день) клиенту,
--                                      частичный refund = total_price - штраф,
--                                      payout владельца уменьшается до суммы штрафа
--                                      и переводится в 'completed' (компенсация).
-- ============================================================
create or replace function public.cancel_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking        public.bookings;
  v_prev_status    booking_status;   -- статус ДО отмены
  v_days           integer;
  v_penalty        numeric(12,2);
  v_paid_total     numeric(12,2);
  v_refund         numeric(12,2);
  v_payout_comp    numeric(12,2);   -- компенсация владельцу из штрафа (за вычетом комиссии)
  v_is_last_minute boolean;
  v_commission_rate constant numeric := 0.10;  -- стандартная комиссия платформы (как в calc_booking_totals)
begin
  -- Блокируем строку брони на время транзакции
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Отменить бронь может только её создатель (клиент)
  if v_booking.customer_id is distinct from auth.uid() then
    raise exception 'Недостаточно прав: отменить бронь может только её создатель'
      using errcode = 'insufficient_privilege';
  end if;

  -- Теперь отмена разрешена и из 'paid'
  if v_booking.status not in ('pending', 'confirmed', 'paid') then
    raise exception 'Бронь нельзя отменить: текущий статус = %', v_booking.status
      using errcode = 'check_violation';
  end if;

  -- Запоминаем исходный статус до перевода в cancelled
  v_prev_status := v_booking.status;

  -- "Менее 24 часов до начала": аренда стартует сегодня или завтра
  v_is_last_minute := (v_booking.start_date <= current_date + 1);

  -- Кол-во дней аренды (границы включительны) и стоимость 1 дня для штрафа
  v_days := (v_booking.end_date - v_booking.start_date) + 1;
  if v_days < 1 then
    v_days := 1;
  end if;
  v_penalty := round(v_booking.rent_subtotal / v_days, 2);

  -- Переводим бронь в cancelled (даты освобождаются)
  update public.bookings
     set status = 'cancelled'
   where id = v_booking.id
   returning * into v_booking;

  -- ------------------------------------------------------------
  -- ФИНАНСОВАЯ ЛОГИКА по исходному статусу
  -- ------------------------------------------------------------

  if v_prev_status = 'paid' then
    -- =========================================================
    -- ОТМЕНА ОПЛАЧЕННОЙ БРОНИ
    -- =========================================================
    if not v_is_last_minute then
      -- ---------- D) paid + >24ч: полный возврат ----------
      -- Возвращаем клиенту всю оплаченную сумму
      insert into public.transactions (booking_id, user_id, amount, currency, type, status)
      values (
        v_booking.id, v_booking.customer_id,
        v_booking.total_price, v_booking.currency::text,
        'refund', 'completed'
      );

      -- Выплаты владельцу не будет — гасим его pending payout
      update public.transactions
         set status = 'failed'
       where booking_id = v_booking.id
         and type = 'payout'
         and status = 'pending';

    else
      -- ---------- E) paid + <24ч: штраф + частичный возврат ----------
      -- Штраф (стоимость 1 дня) удерживается с клиента
      insert into public.transactions (booking_id, user_id, amount, currency, type, status)
      values (
        v_booking.id, v_booking.customer_id,
        v_penalty, v_booking.currency::text,
        'penalty', 'completed'
      );

      -- Частичный возврат клиенту = вся оплата минус штраф
      v_refund := v_booking.total_price - v_penalty;
      if v_refund < 0 then
        v_refund := 0;  -- страховка, если штраф вдруг больше оплаты
      end if;

      if v_refund > 0 then
        insert into public.transactions (booking_id, user_id, amount, currency, type, status)
        values (
          v_booking.id, v_booking.customer_id,
          v_refund, v_booking.currency::text,
          'refund', 'completed'
        );
      end if;

      -- Payout владельцу = штраф МИНУС стандартная комиссия платформы со штрафа.
      -- Платформа удерживает свои 10% и в этом сценарии; остаток — компенсация владельцу.
      -- Формула: payout_owner = штраф - (штраф × ставка_комиссии).
      v_payout_comp := round(v_penalty - (v_penalty * v_commission_rate), 2);
      update public.transactions
         set amount = v_payout_comp,
             status = 'completed'
       where booking_id = v_booking.id
         and type = 'payout'
         and status = 'pending';
    end if;

  elsif v_prev_status = 'confirmed' and v_is_last_minute then
    -- =========================================================
    -- B) confirmed + <24ч: штраф без предшествующей оплаты
    -- =========================================================
    insert into public.transactions (booking_id, user_id, amount, currency, type, status)
    values (
      v_booking.id, v_booking.customer_id,
      v_penalty, v_booking.currency::text,
      'penalty', 'completed'
    );

  else
    -- =========================================================
    -- A) pending  или  C) confirmed + >24ч: возврат прошлых оплат, если были
    -- =========================================================
    select coalesce(sum(t.amount), 0)
      into v_paid_total
    from public.transactions t
    where t.booking_id = v_booking.id
      and t.type = 'payment'
      and t.status = 'completed';

    if v_paid_total > 0 then
      insert into public.transactions (booking_id, user_id, amount, currency, type, status)
      values (
        v_booking.id, v_booking.customer_id,
        v_paid_total, v_booking.currency::text,
        'refund', 'completed'
      );
    end if;
  end if;

  return v_booking;
end;
$$;

comment on function public.cancel_booking(uuid)
  is 'Отмена брони (pending/confirmed/paid → cancelled) с корректным возвратом, штрафом и разрешением payout';


-- ============================================================
-- 2) complete_booking(booking_id) — ЗАВЕРШЕНИЕ АРЕНДЫ владельцем
-- ------------------------------------------------------------
-- Проверки:
--   * вызывающий = владелец машины (cars.user_id = auth.uid());
--   * текущий статус брони = 'paid'.
-- Действия:
--   * перевод брони 'paid' → 'completed';
--   * pending-payout по этой броне → 'completed' (владелец получает выплату).
-- ============================================================
create or replace function public.complete_booking(booking_id uuid)
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

  -- Право завершать аренду есть только у владельца машины
  select c.user_id
    into v_owner
  from public.cars c
  where c.id = v_booking.car_id;

  if v_owner is distinct from auth.uid() then
    raise exception 'Недостаточно прав: завершить аренду может только владелец машины'
      using errcode = 'insufficient_privilege';
  end if;

  -- Завершать можно только оплаченную бронь
  if v_booking.status <> 'paid' then
    raise exception 'Аренду нельзя завершить: текущий статус = %, ожидался paid', v_booking.status
      using errcode = 'check_violation';
  end if;

  -- Перевод брони в completed
  update public.bookings
     set status = 'completed'
   where id = v_booking.id
   returning * into v_booking;

  -- Разблокируем выплату владельцу: pending payout → completed
  update public.transactions
     set status = 'completed'
   where booking_id = v_booking.id
     and type = 'payout'
     and status = 'pending';

  return v_booking;
end;
$$;

comment on function public.complete_booking(uuid)
  is 'Завершение аренды владельцем (paid → completed) + перевод payout из pending в completed';


-- ============================================================
-- ПРАВА (пересоздание функций сбрасывает grant — выдаём заново)
-- ============================================================
grant execute on function public.cancel_booking(uuid)   to authenticated;
grant execute on function public.complete_booking(uuid) to authenticated;
