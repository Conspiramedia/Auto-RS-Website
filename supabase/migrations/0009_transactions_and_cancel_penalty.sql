-- ============================================================
-- AUTO.RS — Миграция 0009: Таблица transactions + финансовая логика отмены
-- ============================================================
-- Концепция Thick Backend (CLAUDE.md): движение средств (штрафы, возвраты)
-- фиксируется только на сервере. Клиент напрямую в transactions писать
-- не может — записи создаёт SECURITY DEFINER функция cancel_booking.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА: transactions (учёт движения средств по броням)
-- ------------------------------------------------------------
-- type   — тип операции: 'payment' (оплата), 'refund' (возврат),
--          'penalty' (штраф за позднюю отмену), 'payout' (выплата владельцу).
-- status — статус операции: 'pending', 'completed', 'failed'.
-- Валюта по умолчанию 'RSD' — по требованию ТЗ этого шага
--   (в отличие от bookings, где расчётная валюта EUR).
-- ============================================================
create table public.transactions (
  id          uuid          primary key default gen_random_uuid(),
  -- При удалении брони транзакцию НЕ удаляем, а обнуляем ссылку —
  -- финансовая история должна сохраняться.
  booking_id  uuid          references public.bookings (id) on delete set null,
  user_id     uuid          not null references auth.users (id) on delete cascade,
  amount      numeric(12,2) not null,
  currency    text          not null default 'RSD',
  type        text          not null,     -- 'payment' | 'refund' | 'penalty' | 'payout'
  status      text          not null,     -- 'pending' | 'completed' | 'failed'
  created_at  timestamptz   not null default now(),

  -- Ограничиваем допустимые значения type/status на уровне БД
  constraint chk_tx_type   check (type   in ('payment', 'refund', 'penalty', 'payout')),
  constraint chk_tx_status check (status in ('pending', 'completed', 'failed'))
);

comment on table public.transactions is 'Учёт движения средств по броням (оплаты, возвраты, штрафы, выплаты)';

create index idx_transactions_user_id    on public.transactions (user_id);
create index idx_transactions_booking_id on public.transactions (booking_id);


-- ============================================================
-- RLS для transactions
-- ------------------------------------------------------------
-- SELECT: пользователь видит только свои транзакции.
-- INSERT/UPDATE/DELETE напрямую ЗАПРЕЩЕНЫ (политик на запись нет) —
-- писать может только SECURITY DEFINER функция, которая обходит RLS.
-- ============================================================
alter table public.transactions enable row level security;

create policy "transactions_select_own" on public.transactions
  for select to authenticated using (auth.uid() = user_id);


-- ============================================================
-- 2) МОДЕРНИЗАЦИЯ cancel_booking(booking_id)
-- ------------------------------------------------------------
-- Отмена брони её создателем (customer_id = auth.uid()).
-- Финансовая логика:
--   * Бронь была 'confirmed' И до начала аренды < 24 часов:
--       - штраф = стоимость 1 дня аренды (rent_subtotal / кол-во дней);
--       - INSERT в transactions: type='penalty', status='completed'.
--   * Бронь была 'confirmed', но до начала > 24 часов, ИЛИ была 'pending':
--       - штраф = 0;
--       - если по броне были транзакции type='payment' → создаём 'refund'
--         на сумму этих оплат.
--
-- Про "< 24 часа": start_date хранится типом date (без времени),
-- поэтому трактуем как "аренда начинается сегодня или завтра"
-- (start_date <= current_date + 1) — это ближайшее корректное к 24 часам.
-- ============================================================
create or replace function public.cancel_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking       public.bookings;
  v_was_confirmed boolean;
  v_days          integer;
  v_penalty       numeric(12,2);
  v_paid_total    numeric(12,2);
  v_is_last_minute boolean;
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

  -- Отменить бронь может ТОЛЬКО её создатель (клиент).
  -- Поле создателя в bookings — customer_id (не user_id).
  if v_booking.customer_id is distinct from auth.uid() then
    raise exception 'Недостаточно прав: отменить бронь может только её создатель'
      using errcode = 'insufficient_privilege';
  end if;

  -- Отменять можно только из pending/confirmed
  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'Бронь нельзя отменить: текущий статус = %', v_booking.status
      using errcode = 'check_violation';
  end if;

  v_was_confirmed := (v_booking.status = 'confirmed');

  -- Переводим бронь в cancelled (даты освобождаются)
  update public.bookings
     set status = 'cancelled'
   where id = v_booking.id
   returning * into v_booking;

  -- ------------------------------------------------------------
  -- ФИНАНСОВАЯ ЛОГИКА
  -- ------------------------------------------------------------

  -- "Менее 24 часов до начала": аренда стартует сегодня или завтра
  v_is_last_minute := (v_booking.start_date <= current_date + 1);

  if v_was_confirmed and v_is_last_minute then
    -- ---------- ШТРАФ ЗА ПОЗДНЮЮ ОТМЕНУ ----------
    -- Кол-во дней аренды (границы включительны, как в calc_booking_totals)
    v_days := (v_booking.end_date - v_booking.start_date) + 1;

    -- Штраф = стоимость 1 дня аренды = rent_subtotal / кол-во дней.
    -- Защита от деления на ноль (v_days всегда >= 1, но перестрахуемся).
    if v_days < 1 then
      v_days := 1;
    end if;
    v_penalty := round(v_booking.rent_subtotal / v_days, 2);

    insert into public.transactions (booking_id, user_id, amount, currency, type, status)
    values (
      v_booking.id,
      v_booking.customer_id,
      v_penalty,
      v_booking.currency::text,   -- валюта берётся из брони
      'penalty',
      'completed'
    );

  else
    -- ---------- БЕЗ ШТРАФА: возможен ВОЗВРАТ ----------
    -- Считаем сумму ранее проведённых оплат по этой броне
    select coalesce(sum(t.amount), 0)
      into v_paid_total
    from public.transactions t
    where t.booking_id = v_booking.id
      and t.type = 'payment'
      and t.status = 'completed';

    -- Если были оплаты — оформляем полный возврат
    if v_paid_total > 0 then
      insert into public.transactions (booking_id, user_id, amount, currency, type, status)
      values (
        v_booking.id,
        v_booking.customer_id,
        v_paid_total,
        v_booking.currency::text,
        'refund',
        'completed'
      );
    end if;
  end if;

  return v_booking;
end;
$$;

comment on function public.cancel_booking(uuid)
  is 'Отмена брони клиентом (pending/confirmed → cancelled) + штраф за позднюю отмену или возврат оплат';


-- ============================================================
-- ПРАВА
-- ------------------------------------------------------------
-- Пересоздание функции сбрасывает grant — выдаём заново.
-- ============================================================
grant execute on function public.cancel_booking(uuid) to authenticated;
