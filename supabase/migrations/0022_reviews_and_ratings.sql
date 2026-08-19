-- ============================================================
-- AUTO.RS — Миграция 0022: Отзывы и рейтинги после аренды
-- ============================================================
-- Отзыв можно оставить только по ЗАВЕРШЁННОЙ (completed) броне, один отзыв
-- на бронь (UNIQUE booking_id). Средний рейтинг и число отзывов машины
-- пересчитываются триггером автоматически при любом изменении reviews.
-- ============================================================


-- ============================================================
-- 1) Поля рейтинга в cars + индекс для сортировки каталога
-- ============================================================
alter table public.cars
  add column if not exists rating_avg    numeric(3,2) not null default 0.00,  -- средний балл 0.00..5.00
  add column if not exists reviews_count integer      not null default 0;      -- число отзывов

comment on column public.cars.rating_avg    is 'Средний рейтинг машины (пересчитывается триггером)';
comment on column public.cars.reviews_count is 'Количество отзывов (пересчитывается триггером)';

-- Индекс под сортировку "сначала с высоким рейтингом" в каталоге.
-- rating_avg по убыванию, reviews_count по убыванию — при равном балле выше
-- те, у кого больше отзывов (надёжнее).
create index if not exists idx_cars_rating
  on public.cars (rating_avg desc, reviews_count desc);


-- ============================================================
-- 2) ТАБЛИЦА: reviews
-- ============================================================
create table public.reviews (
  id           uuid        primary key default gen_random_uuid(),
  -- UNIQUE: один отзыв на одну бронь
  booking_id   uuid        not null unique references public.bookings (id) on delete cascade,
  car_id       uuid        not null references public.cars (id) on delete cascade,
  customer_id  uuid        not null references auth.users (id) on delete cascade,
  rating       integer     not null,
  comment      text,
  created_at   timestamptz not null default now(),

  -- Оценка строго 1..5
  constraint chk_review_rating check (rating between 1 and 5)
);

comment on table public.reviews is 'Отзывы по завершённым арендам (1 отзыв на бронь)';

create index idx_reviews_car_id on public.reviews (car_id);


-- ============================================================
-- ТРИГГЕР-ГЕЙТ: отзыв только по завершённой (completed) броне,
-- и только автором этой брони. CHECK не может читать другую таблицу,
-- поэтому проверяем триггером BEFORE INSERT.
-- ============================================================
create or replace function public.check_review_allowed()
returns trigger
language plpgsql
as $$
declare
  v_booking public.bookings;
begin
  select b.* into v_booking
  from public.bookings b
  where b.id = new.booking_id;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', new.booking_id
      using errcode = 'no_data_found';
  end if;

  -- Отзыв оставляет только автор брони
  if v_booking.customer_id is distinct from new.customer_id then
    raise exception 'Отзыв может оставить только автор брони'
      using errcode = 'insufficient_privilege';
  end if;

  -- Только по завершённой аренде
  if v_booking.status <> 'completed' then
    raise exception 'Отзыв можно оставить только по завершённой аренде (статус completed)'
      using errcode = 'check_violation';
  end if;

  -- car_id отзыва должен соответствовать машине брони (защита от подмены)
  new.car_id := v_booking.car_id;

  return new;
end;
$$;

create trigger tg_check_review_allowed
  before insert on public.reviews
  for each row execute function public.check_review_allowed();


-- ============================================================
-- 3) RLS для reviews
-- ============================================================
alter table public.reviews enable row level security;

-- SELECT: отзывы видят все (гости и авторизованные) — публичный рейтинг.
create policy "reviews_select_public" on public.reviews
  for select using (true);

-- INSERT: только автор брони (customer_id = auth.uid()) и только по
-- завершённой броне (EXISTS-проверка дублирует триггер — двойная защита).
create policy "reviews_insert_own_completed" on public.reviews
  for insert to authenticated
  with check (
    auth.uid() = customer_id
    and exists (
      select 1 from public.bookings b
      where b.id = reviews.booking_id
        and b.customer_id = auth.uid()
        and b.status = 'completed'
    )
  );


-- ============================================================
-- 4) ТРИГГЕР tg_update_car_rating — авто-пересчёт рейтинга машины
-- ------------------------------------------------------------
-- AFTER INSERT/UPDATE/DELETE: пересчитывает AVG(rating) и COUNT(*) для
-- затронутой машины и атомарно обновляет cars.rating_avg / reviews_count.
-- При DELETE берём car_id из OLD, иначе из NEW. При UPDATE со сменой car_id
-- (маловероятно, но возможно) пересчитываем обе машины.
-- ============================================================
create or replace function public.update_car_rating()
returns trigger
language plpgsql
as $$
declare
  v_car_id uuid;
begin
  -- Определяем затронутую машину
  if tg_op = 'DELETE' then
    v_car_id := old.car_id;
  else
    v_car_id := new.car_id;
  end if;

  -- Пересчёт и атомарное обновление агрегатов машины.
  -- coalesce(avg, 0) — если отзывов не осталось, рейтинг обнуляется.
  update public.cars c
     set rating_avg = coalesce((
           select round(avg(r.rating), 2)
           from public.reviews r
           where r.car_id = v_car_id
         ), 0.00),
         reviews_count = (
           select count(*)
           from public.reviews r
           where r.car_id = v_car_id
         )
   where c.id = v_car_id;

  -- Если UPDATE сменил car_id — пересчитываем и старую машину
  if tg_op = 'UPDATE' and old.car_id is distinct from new.car_id then
    update public.cars c
       set rating_avg = coalesce((
             select round(avg(r.rating), 2)
             from public.reviews r
             where r.car_id = old.car_id
           ), 0.00),
           reviews_count = (
             select count(*)
             from public.reviews r
             where r.car_id = old.car_id
           )
     where c.id = old.car_id;
  end if;

  return null;  -- AFTER-триггер: возвращаемое значение игнорируется
end;
$$;

comment on function public.update_car_rating()
  is 'Пересчёт cars.rating_avg и reviews_count при изменении reviews';

create trigger tg_update_car_rating
  after insert or update or delete on public.reviews
  for each row execute function public.update_car_rating();
