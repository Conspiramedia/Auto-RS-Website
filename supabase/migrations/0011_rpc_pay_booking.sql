-- ============================================================
-- AUTO.RS — Миграция 0011: RPC pay_booking (фиксация оплаты)
-- ============================================================
-- ВНИМАНИЕ по порядку применения: эта миграция ОТДЕЛЕНА от 0010,
-- потому что новое значение ENUM 'paid' (добавленное в 0010) нельзя
-- использовать в той же транзакции, где оно объявлено. К моменту
-- применения 0011 значение 'paid' уже закоммичено — функция его видит.
--
-- Логика pay_booking:
--   * бронь должна быть в статусе 'confirmed';
--   * вызвать может только создатель брони (customer_id = auth.uid());
--   * перевод брони в 'paid';
--   * INSERT транзакции клиента: type='payment', status='completed',
--     amount = total_price (полная сумма, которую платит клиент);
--   * INSERT транзакции владельца машины: type='payout', status='pending',
--     amount = rent_subtotal (доля владельца; выплата после аренды).
--   Комиссия платформы = platform_commission (остаётся у платформы,
--   отдельной транзакцией не проводится — это разница между payment и payout).
-- ============================================================
create or replace function public.pay_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_owner   uuid;          -- владелец машины (получатель payout)
begin
  -- Блокируем бронь на время транзакции, чтобы исключить двойную оплату
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Оплатить бронь может только её создатель (клиент)
  if v_booking.customer_id is distinct from auth.uid() then
    raise exception 'Недостаточно прав: оплатить бронь может только её создатель'
      using errcode = 'insufficient_privilege';
  end if;

  -- Оплата возможна только из статуса 'confirmed'
  if v_booking.status <> 'confirmed' then
    raise exception 'Бронь нельзя оплатить: текущий статус = %, ожидался confirmed', v_booking.status
      using errcode = 'check_violation';
  end if;

  -- Находим владельца машины — получателя выплаты
  select c.user_id
    into v_owner
  from public.cars c
  where c.id = v_booking.car_id;

  if v_owner is null then
    raise exception 'Не найден владелец машины по броне %', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Переводим бронь в 'paid'
  update public.bookings
     set status = 'paid'
   where id = v_booking.id
   returning * into v_booking;

  -- ---------- ТРАНЗАКЦИЯ КЛИЕНТА: оплата ----------
  -- Клиент платит полную стоимость брони (аренда + комиссия платформы)
  insert into public.transactions (booking_id, user_id, amount, currency, type, status)
  values (
    v_booking.id,
    v_booking.customer_id,
    v_booking.total_price,          -- полная сумма к оплате
    v_booking.currency::text,
    'payment',
    'completed'
  );

  -- ---------- ТРАНЗАКЦИЯ ВЛАДЕЛЬЦА: выплата ----------
  -- Владелец получает свою долю (rent_subtotal). Статус 'pending' —
  -- выплата фактически произойдёт после завершения аренды.
  -- Комиссия платформы (platform_commission) = total_price - rent_subtotal
  -- остаётся у платформы и отдельной транзакцией не оформляется.
  insert into public.transactions (booking_id, user_id, amount, currency, type, status)
  values (
    v_booking.id,
    v_owner,
    v_booking.rent_subtotal,        -- доля владельца (90% в терминах комиссии 10%)
    v_booking.currency::text,
    'payout',
    'pending'
  );

  return v_booking;
end;
$$;

comment on function public.pay_booking(uuid)
  is 'Фиксация оплаты брони (confirmed → paid): payment клиента + pending payout владельцу; комиссия остаётся у платформы';


-- ============================================================
-- ПРАВА: оплачивать может только авторизованный пользователь
-- ============================================================
grant execute on function public.pay_booking(uuid) to authenticated;
