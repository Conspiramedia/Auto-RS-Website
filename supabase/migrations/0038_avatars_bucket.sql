-- ============================================================
-- AUTO.RS — Миграция 0038: Bucket для аватаров пользователей
-- ============================================================
-- Колонка profiles.avatar_url уже есть (0002), но не было хранилища под
-- сами файлы. Заводим публичный bucket 'avatars' с теми же принципами RLS,
-- что и car-images: читают все (аватар виден в чатах/объявлениях), пишет
-- пользователь только в свою папку "<uid>/…".
--
-- Путь файла: "<uid>/avatar.jpg" (первый сегмент = auth.uid()).
-- ============================================================

-- Публичный bucket (файлы доступны по прямой ссылке — аватар показывается
-- в UI без подписанных URL).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- ---------- SELECT: чтение доступно всем (anon + authenticated) ----------
drop policy if exists "avatars_read_all" on storage.objects;
create policy "avatars_read_all"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- ---------- INSERT: загрузка только в свою папку ----------
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- UPDATE: изменять только свои файлы (upsert аватара) ----------
drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- DELETE: удалять только свои файлы ----------
drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
