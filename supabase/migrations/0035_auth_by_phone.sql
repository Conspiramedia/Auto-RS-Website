-- ============================================================
-- AUTO.RS — Миграция 0035: Авторизация по телефону (без пароля и email)
-- ============================================================
-- Переход на вход по номеру телефона + одноразовый код из SMS (OTP).
-- Регистрации/пароля больше нет: аккаунт создаётся Supabase Auth при
-- первом подтверждении номера. Телефон = идентификатор пользователя.
--
-- Что делает миграция:
--   1) profiles.email перестаёт быть обязательным (телефон-аккаунты без email).
--   2) profiles.phone получает УНИКАЛЬНОСТЬ (один номер — один профиль),
--      но только для заполненных значений (частичный уникальный индекс).
--   3) Триггер handle_new_user учится писать phone из auth.users и не падать,
--      когда email отсутствует.
-- ============================================================


-- ---------- 1) email больше не обязателен ----------
-- При входе по телефону auth.users.email = null, поэтому снимаем NOT NULL.
-- Прежний UNIQUE на email мешает нескольким телефон-аккаунтам без email
-- (несколько NULL допустимы, но пустые строки — нет). Заменяем его на
-- ЧАСТИЧНЫЙ уникальный индекс: уникальность проверяется только для
-- реально заданных email.
alter table public.profiles
  alter column email drop not null;

-- Снимаем табличное ограничение UNIQUE(email), созданное в 0002.
-- Имя ограничения по умолчанию — profiles_email_key.
alter table public.profiles
  drop constraint if exists profiles_email_key;

-- Уникальность email — только для непустых значений.
create unique index if not exists profiles_email_unique
  on public.profiles (email)
  where email is not null;


-- ---------- 2) Уникальность телефона ----------
-- Один номер = один аккаунт. Частичный индекс: старые профили с phone = null
-- не конфликтуют между собой.
create unique index if not exists profiles_phone_unique
  on public.profiles (phone)
  where phone is not null;

comment on column public.profiles.phone
  is 'Телефон в формате E.164 (+381…). Идентификатор аккаунта при входе по SMS.';


-- ---------- 3) Триггер авто-создания профиля ----------
-- Переписываем handle_new_user: теперь пользователь может прийти как с email
-- (старый способ), так и с phone (новый OTP-вход). Пишем оба поля из
-- auth.users; отсутствующее остаётся NULL. full_name по-прежнему берём из
-- метаданных, если фронт их передал (при OTP-входе имени нет — будет NULL).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer                 -- права владельца: доступ к public.profiles
set search_path = public
as $$
begin
  insert into public.profiles (id, email, phone, full_name)
  values (
    new.id,
    new.email,                                       -- NULL при входе по телефону
    new.phone,                                       -- NULL при входе по email
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  );
  return new;
end;
$$;

-- Триггер on_auth_user_created уже создан в 0002 и ссылается на эту функцию
-- по имени, поэтому пересоздавать его не нужно — replace функции достаточно.
