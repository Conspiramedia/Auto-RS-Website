-- ============================================================
-- AUTO.RS — Миграция 0023: Избранное (Favorites / Bookmarks)
-- ============================================================
-- Закладки пользователя на объявления. Одна машина у пользователя — одна
-- закладка (UNIQUE). Управление «лайком» одной кнопкой через toggle_favorite.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА: favorites
-- ============================================================
create table public.favorites (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  car_id      uuid        not null references public.cars (id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- Одна и та же машина не может быть в избранном дважды у одного пользователя
  constraint uq_favorites_user_car unique (user_id, car_id)
);

comment on table public.favorites is 'Избранные объявления пользователя (закладки)';

-- Индекс под выборку "моё избранное" (свежие сверху)
create index idx_favorites_user on public.favorites (user_id, created_at desc);


-- ============================================================
-- RLS: пользователь работает только со своими закладками
-- ============================================================
alter table public.favorites enable row level security;

-- SELECT: только свои
create policy "favorites_select_own" on public.favorites
  for select to authenticated using (auth.uid() = user_id);

-- INSERT: только от своего имени
create policy "favorites_insert_own" on public.favorites
  for insert to authenticated with check (auth.uid() = user_id);

-- DELETE: только свои
create policy "favorites_delete_own" on public.favorites
  for delete to authenticated using (auth.uid() = user_id);


-- ============================================================
-- 2) VIEW: favorites_with_car_details
-- ------------------------------------------------------------
-- Закладки + данные машины + первое фото для списка «Избранное» в FlutterFlow.
-- security_invoker = true → VIEW наследует RLS favorites (пользователь видит
-- только свои закладки). price отдаём оба (продажа/аренда) — карточка покажет
-- нужную по флагам is_for_sale/is_for_rent.
-- ============================================================
create or replace view public.favorites_with_car_details
with (security_invoker = true)
as
select
  f.id,
  f.user_id,
  f.car_id,
  f.created_at,

  -- Данные объявления
  c.brand,
  c.model,
  c.year,
  c.city,
  c.is_for_sale,
  c.is_for_rent,
  c.sale_price,
  c.rent_price_daily,
  c.currency,
  c.rating_avg,
  c.reviews_count,
  c.status,

  -- Первое фото машины (минимальный order_index)
  img.image_url as car_photo

from public.favorites f
join public.cars c on c.id = f.car_id
left join lateral (
  select ci.image_url
  from public.car_images ci
  where ci.car_id = f.car_id
  order by ci.order_index asc
  limit 1
) img on true;

comment on view public.favorites_with_car_details
  is 'Избранное + данные машины и первое фото. RLS наследуется от favorites (security_invoker)';


-- ============================================================
-- 3) RPC toggle_favorite(p_car_id) — переключатель «лайка»
-- ------------------------------------------------------------
-- user_id = auth.uid(). Если машина уже в избранном — удаляет (возвращает
-- false = убрано из избранного). Если нет — добавляет (возвращает true).
-- Одна кнопка на клиенте без ветвления.
-- ============================================================
create or replace function public.toggle_favorite(p_car_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_exists boolean;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Есть ли уже закладка на эту машину
  select exists (
    select 1 from public.favorites
    where user_id = v_user and car_id = p_car_id
  ) into v_exists;

  if v_exists then
    -- Была в избранном — удаляем
    delete from public.favorites
    where user_id = v_user and car_id = p_car_id;
    return false;  -- убрано из избранного
  else
    -- Не было — добавляем. ON CONFLICT — страховка от гонки
    -- (двойной тап не создаст дубль благодаря UNIQUE-констрейнту).
    insert into public.favorites (user_id, car_id)
    values (v_user, p_car_id)
    on conflict (user_id, car_id) do nothing;
    return true;   -- добавлено в избранное
  end if;
end;
$$;

comment on function public.toggle_favorite(uuid)
  is 'Переключатель избранного: удаляет (false) или добавляет (true) закладку. user_id = auth.uid()';

grant execute on function public.toggle_favorite(uuid) to authenticated;
