-- ============================================================
-- AUTO.RS — Миграция 0005: Таблица bookings (бронирования аренды)
-- ============================================================
-- Модель подтверждения: "Заявка → Ручное подтверждение владельцем".
-- Финансовые поля (rent_subtotal, platform_commission, total_price)
-- заполняются ТОЛЬКО триггером на сервере — клиент их не передаёт
-- (защита от подмены цены во FlutterFlow). См. миграцию 0006.
-- ============================================================

create table public.bookings (
  id                  uuid            primary key default uuid_generate_v4(),
  car_id              uuid            not null references public.cars (id) on delete cascade,
  customer_id         uuid            not null references public.profiles (id) on delete cascade, -- кто арендует

  start_date          date            not null,        -- дата начала аренды (включительно)
  end_date            date            not null,        -- дата окончания аренды (включительно)

  -- Финансовые поля. Заполняются триггером calc_booking_totals (миграция 0006).
  -- Клиент из FlutterFlow эти значения передать не может — они перезаписываются на сервере.
  rent_subtotal       numeric(12,2)   not null default 0,   -- кол-во суток × rent_price_daily
  platform_commission numeric(12,2)   not null default 0,   -- 10% от rent_subtotal (комиссия платформы)
  deposit_amount      numeric(12,2)   not null default 0,   -- залог: снимок из cars на момент брони
  total_price         numeric(12,2)   not null default 0,   -- rent_subtotal + platform_commission (депозит показывается отдельно)
  currency            currency_code   not null default 'EUR',

  status              booking_status  not null default 'pending',
  created_at          timestamptz     not null default now(),
  updated_at          timestamptz     not null default now(),

  -- Дата окончания не может быть раньше даты начала
  constraint chk_booking_dates check (end_date >= start_date)
);

comment on table public.bookings is 'Бронирования аренды. Финансы считает триггер, не клиент';

create index idx_bookings_car_id      on public.bookings (car_id);
create index idx_bookings_customer_id on public.bookings (customer_id);
create index idx_bookings_status      on public.bookings (status);


-- ============================================================
-- ЗАЩИТА ОТ ОВЕРБУКИНГА (главный уровень — на уровне БД).
-- Даты блокируются ТОЛЬКО подтверждёнными бронями (confirmed).
-- pending-заявки календарь НЕ занимают: несколько клиентов могут
-- подать заявку на одни даты, а владелец подтвердит одну.
-- EXCLUDE физически не даст записать вторую confirmed-бронь
-- на пересекающиеся даты (защита от race condition).
-- daterange('[]') — обе границы включительно (день выезда занят целиком).
-- ============================================================
alter table public.bookings
  add constraint excl_no_overlap_confirmed
  exclude using gist (
    car_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
  where (status = 'confirmed');
