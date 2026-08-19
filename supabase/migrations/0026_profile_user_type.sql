-- ============================================================
-- AUTO.RS — Миграция 0026: Тип пользователя (customer / vendor)
-- ============================================================
-- Разделение пользователей на клиентов и арендодателей/продавцов.
-- Плюс флаг role_selected — прошёл ли пользователь онбординг выбора роли
-- (нужен, чтобы отличить «первый вход» от осознанно выбранного 'customer').
-- ============================================================

alter table public.profiles
  -- Тип пользователя. default 'customer' — чтобы значение всегда было валидным.
  add column if not exists user_type text not null default 'customer',
  -- Прошёл ли онбординг выбора роли. false у новых → показываем Bottom Sheet.
  add column if not exists role_selected boolean not null default false;

-- Ограничиваем допустимые значения user_type
alter table public.profiles
  drop constraint if exists chk_user_type;
alter table public.profiles
  add constraint chk_user_type check (user_type in ('customer', 'vendor'));

comment on column public.profiles.user_type
  is 'Тип пользователя: customer (ищет машину) / vendor (сдаёт/продаёт)';
comment on column public.profiles.role_selected
  is 'true, если пользователь прошёл онбординг выбора роли';
