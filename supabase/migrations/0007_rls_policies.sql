-- ============================================================
-- AUTO.RS — Миграция 0007: Row Level Security (RLS)
-- ============================================================
-- Требование CLAUDE.md: для КАЖДОЙ таблицы включаем RLS.
-- По умолчанию доступ закрыт; чтение/запись — строго по auth.uid().
-- После включения RLS без политик доступ закрыт полностью.
-- ============================================================

alter table public.profiles   enable row level security;
alter table public.cars       enable row level security;
alter table public.car_images enable row level security;
alter table public.bookings   enable row level security;


-- ============================================================
-- ТАБЛИЦА: cars
-- ============================================================

-- SELECT (публично): гость/анон видит ТОЛЬКО активные объявления.
-- moderation/archived/rejected/sold для чужих скрыты.
create policy "cars_select_active_public" on public.cars
  for select using (status = 'active');

-- SELECT (владелец): видит ВСЕ свои объявления, включая
-- moderation/archived/rejected (иначе не увидит свои неактивные).
-- Несколько SELECT-политик объединяются по OR.
create policy "cars_select_own_all" on public.cars
  for select to authenticated using (auth.uid() = user_id);

-- INSERT: создавать можно только от своего имени
-- (with check не даст подставить чужой user_id).
create policy "cars_insert_own" on public.cars
  for insert to authenticated with check (auth.uid() = user_id);

-- UPDATE: править можно только свои строки.
create policy "cars_update_own" on public.cars
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE: удалять можно только свои строки.
create policy "cars_delete_own" on public.cars
  for delete to authenticated using (auth.uid() = user_id);


-- ============================================================
-- ТАБЛИЦА: profiles
-- ============================================================
-- Каждый видит и правит только свой профиль.
-- (Роль 'admin' и публичный просмотр контактов продавца
--  добавим отдельными политиками на следующем шаге при необходимости.)
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ============================================================
-- ТАБЛИЦА: car_images
-- ============================================================
-- SELECT: фото активных машин видят все (в т.ч. гость).
create policy "car_images_select_public" on public.car_images
  for select using (
    exists (
      select 1 from public.cars c
      where c.id = car_images.car_id and c.status = 'active'
    )
  );

-- ALL (insert/update/delete): управлять фото может только владелец машины.
create policy "car_images_modify_owner" on public.car_images
  for all to authenticated
  using (
    exists (
      select 1 from public.cars c
      where c.id = car_images.car_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.cars c
      where c.id = car_images.car_id and c.user_id = auth.uid()
    )
  );


-- ============================================================
-- ТАБЛИЦА: bookings
-- ============================================================
-- SELECT: бронь видят арендатор (свои) и владелец машины (брони на своё авто).
create policy "bookings_select_involved" on public.bookings
  for select to authenticated
  using (
    auth.uid() = customer_id
    or exists (
      select 1 from public.cars c
      where c.id = bookings.car_id and c.user_id = auth.uid()
    )
  );

-- INSERT: бронь создаёт только сам клиент (от своего имени).
create policy "bookings_insert_own" on public.bookings
  for insert to authenticated with check (auth.uid() = customer_id);

-- UPDATE: обновлять бронь может арендатор (отмена) ИЛИ владелец машины
-- (подтверждение/отклонение). Тонкое разграничение "кто какой статус ставит"
-- вынесем в отдельные RPC-функции (confirm/reject/cancel) на следующем шаге.
create policy "bookings_update_involved" on public.bookings
  for update to authenticated
  using (
    auth.uid() = customer_id
    or exists (
      select 1 from public.cars c
      where c.id = bookings.car_id and c.user_id = auth.uid()
    )
  );
