-- ============================================================
-- AUTO.RS — Миграция 0013: VIEW bookings_with_car
-- ============================================================
-- Упрощает списки в кабинете броней FlutterFlow: отдаёт бронь вместе
-- с данными машины и её владельцем (owner_id) одним запросом, без ручного
-- JOIN на клиенте.
--
-- security_invoker = true — КЛЮЧЕВОЙ момент безопасности: VIEW применяет
-- RLS-политики ВЫЗЫВАЮЩЕГО пользователя (а не владельца VIEW). То есть
-- каждый видит ровно те брони, что разрешают политики bookings/cars
-- (bookings_select_involved из миграции 0007). Без этого флага VIEW
-- обходила бы RLS и раскрывала чужие данные.
-- ============================================================
create or replace view public.bookings_with_car
with (security_invoker = true)
as
select
  b.id,
  b.car_id,
  b.customer_id,
  c.user_id            as owner_id,       -- владелец машины (фильтр вкладки владельца)
  c.brand,
  c.model,
  c.year,
  c.city,
  b.start_date,
  b.end_date,
  b.rent_subtotal,
  b.platform_commission,
  b.deposit_amount,
  b.total_price,
  b.currency,
  b.status,
  b.created_at
from public.bookings b
join public.cars c on c.id = b.car_id;

comment on view public.bookings_with_car
  is 'Брони + данные машины и owner_id. RLS вызывающего (security_invoker). Для кабинета броней FlutterFlow';
