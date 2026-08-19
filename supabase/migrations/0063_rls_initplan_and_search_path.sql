-- ============================================================
-- 0063 — RLS initplan + фиксация search_path у INVOKER-функций
-- ============================================================
-- Снимает два предупреждения Supabase Security/Performance Advisor,
-- НЕ меняя ни прав доступа, ни бизнес-логики.
--
-- 1) auth_rls_initplan (38 политик в public).
--    В условии вида `auth.uid() = user_id` PostgreSQL вычисляет
--    auth.uid() ДЛЯ КАЖДОЙ СТРОКИ выборки. Обёртка `(select auth.uid())`
--    превращает вызов в InitPlan — он считается один раз на запрос.
--    Результат сравнения тот же, поэтому набор видимых строк не меняется;
--    выигрыш заметен на больших выборках (каталог cars, лента).
--
-- 2) function_search_path_mutable (10 функций).
--    Без фиксации search_path имя таблицы внутри функции резолвится по
--    схемам вызывающего. Все эти функции — SECURITY INVOKER (работают с
--    правами вызывающего), поэтому захвата привилегий тут нет, но
--    зафиксировать путь всё равно правильно: поведение перестаёт зависеть
--    от search_path сессии.
--
-- ЧТО НАМЕРЕННО НЕ ТРОГАЕМ:
--   · storage.objects — чужая системная схема (12 политик). ALTER там
--     упирается в права владельца, как и на spatial_ref_sys.
--   · 9 пар multiple_permissive_policies — раздельные политики читаются
--     лучше, а схлопывание задело бы логику админского доступа.
--   · public.spatial_ref_sys — системная таблица PostGIS, владелец
--     расширение, ALTER невозможен (42501 must be owner).
--
-- ВСЁ ОДНОЙ ТРАНЗАКЦИЕЙ: при любой ошибке не применится ничего, база
-- останется с прежними политиками. Промежуточного состояния, в котором
-- политика удалена, а новая не создана, не существует.
-- ============================================================

begin;


-- ------------------------------------------------------------
-- 1) ПОЛИТИКИ: drop + create с обёрткой (select auth.uid())
-- ------------------------------------------------------------
-- Пары drop/create идут вплотную, чтобы правка каждой политики
-- читалась целиком. drop policy if exists — на случай, если политику
-- уже сняли вручную; create упадёт, если политика осталась.


-- ==================== cars ====================

drop policy if exists "cars_select_own_all" on public.cars;
create policy "cars_select_own_all" on public.cars
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "cars_insert_own" on public.cars;
create policy "cars_insert_own" on public.cars
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "cars_update_own" on public.cars;
create policy "cars_update_own" on public.cars
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "cars_delete_own" on public.cars;
create policy "cars_delete_own" on public.cars
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ==================== profiles ====================

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ==================== car_images ====================

drop policy if exists "car_images_modify_owner" on public.car_images;
create policy "car_images_modify_owner" on public.car_images
  for all to authenticated
  using (
    exists (
      select 1 from public.cars c
      where c.id = car_images.car_id and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.cars c
      where c.id = car_images.car_id and c.user_id = (select auth.uid())
    )
  );

-- ==================== bookings ====================

drop policy if exists "bookings_select_involved" on public.bookings;
create policy "bookings_select_involved" on public.bookings
  for select to authenticated
  using (
    (select auth.uid()) = customer_id
    or exists (
      select 1 from public.cars c
      where c.id = bookings.car_id and c.user_id = (select auth.uid())
    )
  );

drop policy if exists "bookings_insert_own" on public.bookings;
create policy "bookings_insert_own" on public.bookings
  for insert to authenticated with check ((select auth.uid()) = customer_id);

drop policy if exists "bookings_update_involved" on public.bookings;
create policy "bookings_update_involved" on public.bookings
  for update to authenticated
  using (
    (select auth.uid()) = customer_id
    or exists (
      select 1 from public.cars c
      where c.id = bookings.car_id and c.user_id = (select auth.uid())
    )
  );

-- ==================== transactions ====================

drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);

-- ==================== chats ====================

drop policy if exists "chats_select_participant" on public.chats;
create policy "chats_select_participant" on public.chats
  for select to authenticated
  using ((select auth.uid()) = buyer_id or (select auth.uid()) = seller_id);

-- ==================== messages ====================

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant" on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
    )
  );

drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_insert_participant" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
        and not exists (
          select 1 from public.user_blocks ub
          where ub.blocked_id = (select auth.uid())
            and ub.blocker_id = case
              when c.buyer_id = (select auth.uid()) then c.seller_id
              else c.buyer_id
            end
        )
    )
  );

drop policy if exists "messages_update_participant" on public.messages;
create policy "messages_update_participant" on public.messages
  for update to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
    )
  );

-- ==================== reviews ====================

drop policy if exists "reviews_insert_own_completed" on public.reviews;
create policy "reviews_insert_own_completed" on public.reviews
  for insert to authenticated
  with check (
    (select auth.uid()) = customer_id
    and exists (
      select 1 from public.bookings b
      where b.id = reviews.booking_id
        and b.customer_id = (select auth.uid())
        and b.status = 'completed'
    )
  );

-- ==================== favorites ====================

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ==================== notifications ====================

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ==================== hidden_cars ====================

drop policy if exists "hidden_select_own" on public.hidden_cars;
create policy "hidden_select_own" on public.hidden_cars
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "hidden_insert_own" on public.hidden_cars;
create policy "hidden_insert_own" on public.hidden_cars
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "hidden_delete_own" on public.hidden_cars;
create policy "hidden_delete_own" on public.hidden_cars
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ==================== chat_prefs ====================

drop policy if exists "chat_prefs_select_own" on public.chat_prefs;
create policy "chat_prefs_select_own" on public.chat_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "chat_prefs_insert_own" on public.chat_prefs;
create policy "chat_prefs_insert_own" on public.chat_prefs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "chat_prefs_update_own" on public.chat_prefs;
create policy "chat_prefs_update_own" on public.chat_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "chat_prefs_delete_own" on public.chat_prefs;
create policy "chat_prefs_delete_own" on public.chat_prefs
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ==================== user_blocks ====================

drop policy if exists "user_blocks_select_involved" on public.user_blocks;
create policy "user_blocks_select_involved" on public.user_blocks
  for select to authenticated
  using (blocker_id = (select auth.uid()) or blocked_id = (select auth.uid()));

drop policy if exists "user_blocks_insert_own" on public.user_blocks;
create policy "user_blocks_insert_own" on public.user_blocks
  for insert to authenticated
  with check (blocker_id = (select auth.uid()));

drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own" on public.user_blocks
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- ==================== wallet_transactions ====================

drop policy if exists "wallet_tx_select_own" on public.wallet_transactions;
create policy "wallet_tx_select_own" on public.wallet_transactions
  for select to authenticated using ((select auth.uid()) = user_id);

-- ==================== listing_stats ====================

drop policy if exists "listing_stats_select_owner" on public.listing_stats;
create policy "listing_stats_select_owner" on public.listing_stats
  for select to authenticated
  using (
    exists (
      select 1 from public.cars c
      where c.id = listing_stats.car_id
        and c.user_id = (select auth.uid())
    )
  );

-- ==================== saved_searches ====================

drop policy if exists "saved_searches_select_own" on public.saved_searches;
create policy "saved_searches_select_own" on public.saved_searches
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "saved_searches_update_own" on public.saved_searches;
create policy "saved_searches_update_own" on public.saved_searches
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "saved_searches_delete_own" on public.saved_searches;
create policy "saved_searches_delete_own" on public.saved_searches
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ==================== push_queue ====================

drop policy if exists "push_queue_select_own" on public.push_queue;
create policy "push_queue_select_own" on public.push_queue
  for select to authenticated using ((select auth.uid()) = user_id);

-- ==================== user_push_tokens ====================

drop policy if exists "push_tokens_select_own" on public.user_push_tokens;
create policy "push_tokens_select_own" on public.user_push_tokens
  for select to authenticated using ((select auth.uid()) = user_id);

-- ------------------------------------------------------------
-- 2) ФУНКЦИИ: фиксация search_path
-- ------------------------------------------------------------
-- ALTER FUNCTION ... SET search_path меняет ТОЛЬКО настройку функции.
-- Тело не пересоздаётся, поэтому переписать логику здесь физически
-- нечем — это самый безопасный способ снять предупреждение.
--
-- Все 10 функций — SECURITY INVOKER. Функции с SECURITY DEFINER
-- (их 77) уже имеют search_path с момента создания, их не трогаем.


-- calc_booking_totals — триггер: считает суммы брони перед вставкой
alter function public.calc_booking_totals() set search_path = public;

-- check_review_allowed — триггер: пускает отзыв только после завершённой брони
alter function public.check_review_allowed() set search_path = public;

-- enforce_verified_booking — триггер: требует пройденный KYC для брони
alter function public.enforce_verified_booking() set search_path = public;

-- f_normalize — нормализация текста (кириллица/латиница) для поиска
alter function public.f_normalize(text) set search_path = public;

-- is_car_available — проверка занятости машины на диапазон дат
alter function public.is_car_available(uuid, date, date) set search_path = public;

-- search_cars_v2 — полнотекстовый поиск по объявлениям
alter function public.search_cars_v2(text) set search_path = public;

-- set_updated_at — триггер: проставляет updated_at при UPDATE
alter function public.set_updated_at() set search_path = public;

-- total_unread_count — счётчик непрочитанных по всем чатам
alter function public.total_unread_count() set search_path = public;

-- unread_count_for_chat — счётчик непрочитанных в одном чате
alter function public.unread_count_for_chat(uuid) set search_path = public;

-- update_car_rating — триггер: пересчитывает рейтинг машины по отзывам
alter function public.update_car_rating() set search_path = public;


commit;

-- ============================================================
-- ПОСЛЕ ПРИМЕНЕНИЯ
-- ============================================================
-- Прогнать supabase/checks/0063_rls_verify.sql и сверить вывод с
-- прогоном ДО миграции: расхождений быть не должно ни в одной строке.
-- ============================================================