-- ============================================================
-- AUTO.RS — Миграция 0006: Бизнес-логика (Thick Backend)
-- ============================================================
-- Вся критическая логика на стороне Supabase (требование CLAUDE.md):
--   1) расчёт стоимости брони на сервере (триггер),
--   2) проверка доступности машины на даты (RPC для FlutterFlow),
--   3) авто-обновление updated_at.
-- ============================================================


-- ============================================================
-- 1) РАСЧЁТ СТОИМОСТИ БРОНИ НА СЕРВЕРЕ (триггер before insert/update)
-- ------------------------------------------------------------
-- Формула:
--   rent_subtotal       = кол-во суток × rent_price_daily
--   platform_commission = rent_subtotal × 10%
--   total_price         = rent_subtotal + platform_commission
--   deposit_amount      = снимок из cars (в total НЕ входит, комиссией НЕ облагается)
-- Клиент передаёт только car_id, customer_id, start_date, end_date.
-- Все денежные поля перезаписываются здесь — подмена цены невозможна.
-- ============================================================
create or replace function public.calc_booking_totals()
returns trigger
language plpgsql
as $$
declare
  v_daily     numeric(12,2);
  v_deposit   numeric(12,2);
  v_currency  currency_code;
  v_days      integer;
  v_commission_rate constant numeric := 0.10;  -- фиксированная комиссия платформы 10% (MVP)
begin
  -- Тянем актуальную дневную цену, залог и валюту из объявления
  select rent_price_daily, deposit_amount, currency
    into v_daily, v_deposit, v_currency
  from public.cars
  where id = new.car_id;

  if v_daily is null then
    raise exception 'У объявления % не задана цена аренды (rent_price_daily)', new.car_id;
  end if;

  -- Кол-во суток. Границы включительны: с 1 по 5 число = 5 суток → +1.
  v_days := (new.end_date - new.start_date) + 1;

  -- Считаем финансы на сервере
  new.rent_subtotal       := v_daily * v_days;
  new.platform_commission := round(new.rent_subtotal * v_commission_rate, 2);
  new.deposit_amount      := coalesce(v_deposit, 0);
  new.total_price         := new.rent_subtotal + new.platform_commission; -- депозит показывается отдельно
  new.currency            := v_currency;
  new.updated_at          := now();

  return new;
end;
$$;

-- Пересчёт при вставке и при изменении дат/машины
create trigger trg_bookings_calc_totals
  before insert or update of start_date, end_date, car_id on public.bookings
  for each row execute function public.calc_booking_totals();


-- ============================================================
-- 2) ПРОВЕРКА ДОСТУПНОСТИ (RPC для вызова из FlutterFlow)
-- ------------------------------------------------------------
-- Возвращает TRUE, если машина свободна на весь период [p_start; p_end].
-- Свободно = нет пересечений с ПОДТВЕРЖДЁННЫМИ (confirmed) бронями.
-- pending-заявки доступность не блокируют.
-- Вызов из FlutterFlow: Supabase RPC → is_car_available.
-- ============================================================
create or replace function public.is_car_available(
  p_car_id uuid,
  p_start  date,
  p_end    date
)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1
    from public.bookings b
    where b.car_id = p_car_id
      and b.status = 'confirmed'   -- только подтверждённые брони блокируют даты
      and daterange(b.start_date, b.end_date, '[]')
          && daterange(p_start, p_end, '[]')
  );
$$;


-- ============================================================
-- 3) АВТО-ОБНОВЛЕНИЕ updated_at
-- ------------------------------------------------------------
-- Универсальный триггер: при любом UPDATE проставляет updated_at = now().
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_cars_updated_at
  before update on public.cars
  for each row execute function public.set_updated_at();
