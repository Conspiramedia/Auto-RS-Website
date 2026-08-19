-- ============================================================
-- 0066 — ОТКАТ: вернуть anon в политики чтения бакетов
-- ============================================================
-- Применять ТОЛЬКО если после миграции 0066 проверка в инкогнито
-- показала, что у гостя не грузятся фото каталога, карточки или
-- аватарки.
--
-- Возвращает ровно то состояние, что было до 0066: SELECT на
-- storage.objects для ролей anon и authenticated.
--
-- ПОСЛЕ ОТКАТА два предупреждения public_bucket_allows_listing
-- вернутся в Advisor — это ожидаемо и принимается осознанно:
-- работающие картинки важнее косметики линтера.
-- ============================================================

begin;

drop policy if exists "car_images_read_all" on storage.objects;
create policy "car_images_read_all"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'car-images');

drop policy if exists "avatars_read_all" on storage.objects;
create policy "avatars_read_all"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'avatars');

commit;
