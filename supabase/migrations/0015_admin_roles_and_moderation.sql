-- ============================================================
-- AUTO.RS — Миграция 0015: Ролевая модель админа + модерация объявлений
-- ============================================================
-- Добавляем флаг администратора, причину отклонения и RPC модерации.
-- Вся логика смены статуса — на сервере (Thick Backend), SECURITY DEFINER,
-- с жёсткой проверкой прав администратора.
-- ============================================================


-- ============================================================
-- 1) Поле moderation_comment в cars (причина отклонения)
-- ============================================================
alter table public.cars
  add column if not exists moderation_comment text;  -- причина reject от модератора, nullable

comment on column public.cars.moderation_comment
  is 'Причина отклонения объявления модератором (заполняется reject_car, очищается approve_car)';


-- ============================================================
-- 2) Роль администратора: поле is_admin в profiles
-- ------------------------------------------------------------
-- Профиль хранится в public.profiles (миграция 0002). Роль user_role
-- там уже есть, но для простого и быстрого гейта модерации добавляем
-- явный булев флаг is_admin (default false).
-- ============================================================
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_admin
  is 'Признак администратора (доступ к модерации объявлений)';


-- ============================================================
-- ХЕЛПЕР: public.is_admin() — проверка, что текущий пользователь админ.
-- ------------------------------------------------------------
-- SECURITY DEFINER + stable: функция читает profiles В ОБХОД RLS.
-- Это важно по двум причинам:
--   1) исключаем бесконечную рекурсию политик (политика cars читает profiles,
--      у которой свои политики);
--   2) политика profiles_select_own отдаёт пользователю только свою строку —
--      и этого как раз достаточно, но definer-доступ надёжнее и переиспользуем.
-- Возвращает true только если у auth.uid() профиль с is_admin = true.
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_admin = true
  );
$$;

comment on function public.is_admin()
  is 'true, если текущий пользователь (auth.uid()) — администратор';

grant execute on function public.is_admin() to authenticated;


-- ============================================================
-- RLS: админ видит объявления в статусах moderation и rejected
-- ------------------------------------------------------------
-- Обычный публичный SELECT (миграция 0007) отдаёт только 'active'.
-- Владельцу видны все его объявления. Эта политика ДОБАВЛЯЕТ админу
-- доступ к чужим объявлениям на модерации/отклонённым (несколько
-- SELECT-политик объединяются по OR).
-- ============================================================
drop policy if exists "cars_select_admin_moderation" on public.cars;
create policy "cars_select_admin_moderation"
  on public.cars
  for select
  to authenticated
  using (
    status in ('moderation', 'rejected')
    and public.is_admin()
  );


-- ============================================================
-- 3) RPC модерации (SECURITY DEFINER, только для админов)
-- ============================================================

-- ---------- approve_car: перевод в active ----------
-- Проверка прав админа. Статус → 'active', moderation_comment очищается.
create or replace function public.approve_car(car_id uuid)
returns public.cars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_car public.cars;
begin
  -- Гейт по роли администратора
  if not public.is_admin() then
    raise exception 'Недостаточно прав: модерация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку объявления на время транзакции
  select c.* into v_car
  from public.cars c
  where c.id = car_id
  for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', car_id
      using errcode = 'no_data_found';
  end if;

  -- Одобрять имеет смысл объявление на модерации (или ранее отклонённое —
  -- повторная подача). Из терминальных статусов не трогаем.
  if v_car.status not in ('moderation', 'rejected') then
    raise exception 'Объявление нельзя одобрить: текущий статус = %', v_car.status
      using errcode = 'check_violation';
  end if;

  update public.cars
     set status = 'active',
         moderation_comment = null   -- очищаем причину отклонения
   where id = car_id
   returning * into v_car;

  return v_car;
end;
$$;

comment on function public.approve_car(uuid)
  is 'Одобрение объявления администратором (moderation/rejected → active), очистка комментария';


-- ---------- reject_car: перевод в rejected с причиной ----------
-- Проверка прав админа. Статус → 'rejected', записываем comment.
create or replace function public.reject_car(car_id uuid, comment text)
returns public.cars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_car public.cars;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: модерация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  select c.* into v_car
  from public.cars c
  where c.id = car_id
  for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', car_id
      using errcode = 'no_data_found';
  end if;

  -- Отклонять имеет смысл объявление на модерации
  if v_car.status <> 'moderation' then
    raise exception 'Объявление нельзя отклонить: текущий статус = %, ожидался moderation', v_car.status
      using errcode = 'check_violation';
  end if;

  update public.cars
     set status = 'rejected',
         moderation_comment = comment   -- фиксируем причину отклонения
   where id = car_id
   returning * into v_car;

  return v_car;
end;
$$;

comment on function public.reject_car(uuid, text)
  is 'Отклонение объявления администратором (moderation → rejected) с записью причины';


-- ============================================================
-- ПРАВА: вызывать RPC модерации могут только авторизованные
-- (внутри дополнительно проверяется is_admin()).
-- ============================================================
grant execute on function public.approve_car(uuid)       to authenticated;
grant execute on function public.reject_car(uuid, text)  to authenticated;
