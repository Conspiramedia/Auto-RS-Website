-- ============================================================
-- AUTO.RS — Миграция 0019: Верификация документов пользователей (KYC)
-- ============================================================
-- Пользователь загружает документы в ПРИВАТНЫЙ бакет, отправляет на проверку;
-- админ подтверждает/отклоняет. Документы (паспорт, права) видны только
-- владельцу и админам. Вся логовая логика — на сервере (Thick Backend).
-- ============================================================


-- ============================================================
-- 1) ENUM статуса верификации + поля в profiles
-- ============================================================
create type verification_status_type as enum (
  'unverified',  -- документы не подавались (по умолчанию)
  'pending',     -- поданы, ждут проверки админом
  'verified',    -- подтверждены
  'rejected'     -- отклонены (см. verification_comment)
);

alter table public.profiles
  add column if not exists verification_status verification_status_type
    not null default 'unverified',
  add column if not exists passport_url         text,   -- ссылка на паспорт (приватный бакет)
  add column if not exists driver_license_url   text,   -- ссылка на в/у (приватный бакет)
  add column if not exists verification_comment text;   -- причина отклонения от админа

comment on column public.profiles.verification_status is 'Статус KYC-верификации пользователя';
comment on column public.profiles.verification_comment is 'Причина отклонения документов модератором';


-- ============================================================
-- 2) ПРИВАТНЫЙ бакет user-documents + жёсткие RLS
-- ------------------------------------------------------------
-- public = false — файлы НЕ доступны по прямой ссылке; доступ только через
-- подписанные URL (signed URL) и только тем, кому разрешают политики.
-- Структура пути: "<auth.uid()>/<файл>" — первый сегмент = ID владельца.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('user-documents', 'user-documents', false)
on conflict (id) do nothing;

-- ---------- SELECT: только владелец ИЛИ админ ----------
-- Владелец: первый сегмент пути = его uid.
-- Админ: public.is_admin() = true (функция из миграции 0015).
-- Анонимам и прочим — доступ закрыт (нет ветки to anon).
drop policy if exists "user_docs_select_owner_or_admin" on storage.objects;
create policy "user_docs_select_owner_or_admin"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'user-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- ---------- INSERT: только владелец в свою папку ----------
drop policy if exists "user_docs_insert_own" on storage.objects;
create policy "user_docs_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- UPDATE: только владелец своей папки ----------
drop policy if exists "user_docs_update_own" on storage.objects;
create policy "user_docs_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- DELETE: только владелец своей папки ----------
drop policy if exists "user_docs_delete_own" on storage.objects;
create policy "user_docs_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================
-- 3) RPC submit_verification — отправка документов на проверку
-- ------------------------------------------------------------
-- Обновляет профиль текущего пользователя: записывает URL документов,
-- статус → 'pending', очищает предыдущий комментарий отклонения.
-- ============================================================
create or replace function public.submit_verification(
  p_passport_url       text,
  p_driver_license_url text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Требуем хотя бы один документ (защита от пустой отправки)
  if coalesce(nullif(trim(p_passport_url), ''), nullif(trim(p_driver_license_url), '')) is null then
    raise exception 'Загрузите хотя бы один документ для верификации'
      using errcode = 'check_violation';
  end if;

  update public.profiles
     set passport_url         = p_passport_url,
         driver_license_url   = p_driver_license_url,
         verification_status  = 'pending',
         verification_comment = null    -- сбрасываем прошлую причину отклонения
   where id = auth.uid()
   returning * into v_profile;

  return v_profile;
end;
$$;

comment on function public.submit_verification(text, text)
  is 'Отправка документов KYC на проверку (status → pending) текущим пользователем';

grant execute on function public.submit_verification(text, text) to authenticated;


-- ============================================================
-- 4) RPC модерации документов (только админ)
-- ============================================================

-- ---------- approve_user_verification: → verified ----------
create or replace function public.approve_user_verification(p_user_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: верификация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
     set verification_status  = 'verified',
         verification_comment = null
   where id = p_user_id
   returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Пользователь % не найден', p_user_id
      using errcode = 'no_data_found';
  end if;

  return v_profile;
end;
$$;

comment on function public.approve_user_verification(uuid)
  is 'Подтверждение KYC администратором (status → verified)';

grant execute on function public.approve_user_verification(uuid) to authenticated;


-- ---------- reject_user_verification: → rejected + причина ----------
create or replace function public.reject_user_verification(
  p_user_id uuid,
  p_comment text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: верификация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
     set verification_status  = 'rejected',
         verification_comment = p_comment
   where id = p_user_id
   returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Пользователь % не найден', p_user_id
      using errcode = 'no_data_found';
  end if;

  return v_profile;
end;
$$;

comment on function public.reject_user_verification(uuid, text)
  is 'Отклонение KYC администратором (status → rejected) с записью причины';

grant execute on function public.reject_user_verification(uuid, text) to authenticated;


-- ============================================================
-- 5) RLS: админ читает ВСЕ профили (для очереди KYC)
-- ------------------------------------------------------------
-- Базовая политика profiles_select_own (миграция 0007) отдаёт пользователю
-- только его собственный профиль. Эта политика ДОБАВЛЯЕТ админу доступ на
-- чтение всех профилей (несколько SELECT-политик объединяются по OR),
-- чтобы собрать очередь верификации (profiles в статусе pending).
-- Проверка через public.is_admin() (миграция 0015).
-- ============================================================
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
  on public.profiles
  for select
  to authenticated
  using (public.is_admin());
