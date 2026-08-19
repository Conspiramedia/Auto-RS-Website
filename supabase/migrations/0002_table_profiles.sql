-- ============================================================
-- AUTO.RS — Миграция 0002: Таблица profiles (профили пользователей)
-- ============================================================
-- Расширяет системную таблицу auth.users (стандарт Supabase).
-- id профиля = id пользователя из системы аутентификации.
-- ============================================================

create table public.profiles (
  id            uuid          primary key references auth.users (id) on delete cascade,
  email         text          not null unique,
  full_name     text,                                  -- ФИО (UTF-8: кириллица/латиница)
  phone         text,                                  -- телефон (текст: возможны +, коды стран)
  role          user_role     not null default 'client',
  avatar_url    text,                                  -- ссылка на аватар (Supabase Storage)
  created_at    timestamptz   not null default now(),  -- дата регистрации
  updated_at    timestamptz   not null default now()
);

comment on table public.profiles is 'Профили пользователей, расширяют auth.users';


-- ============================================================
-- АВТО-СОЗДАНИЕ ПРОФИЛЯ при регистрации нового пользователя.
-- Триггер на auth.users: как только Supabase создаёт запись в auth.users,
-- автоматически создаётся связанная строка в public.profiles.
-- Это избавляет фронтенд FlutterFlow от ручного создания профиля.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer                 -- выполняется с правами владельца: нужен доступ к public.profiles
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    -- Пытаемся достать имя из метаданных регистрации (если фронтенд их передал)
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  );
  return new;
end;
$$;

-- Вешаем триггер на системную таблицу auth.users
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
