-- ============================================================
-- AUTO.RS — Миграция 0031: Скрытые рекомендации («не интересует»)
-- ============================================================
-- Меню «три точки» на карточке (как на Avito → «Скрыть рекомендацию»):
--   • «Не интересует это объявление» — скрыть конкретный car_id;
--   • «Не подходит город или регион» — скрыть все объявления города.
--
-- Скрытия персональные (привязаны к auth.uid()) и постоянные: скрытое
-- не показывается в каталоге и после перезагрузки. Гость (uid = null)
-- ничего не скрывает — фильтр для него не применяется.
--
-- Храним ОДНОЙ таблицей с типом скрытия:
--   kind='car'  → задан car_id (city = null);
--   kind='city' → задан city   (car_id = null).
-- ============================================================

-- ------------------------------------------------------------
-- 1) ТАБЛИЦА hidden_cars
-- ------------------------------------------------------------
create table public.hidden_cars (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  kind       text        not null,                                -- 'car' | 'city'
  car_id     uuid        references public.cars (id) on delete cascade,
  city_norm  text,                                                -- нормализованный город (для kind='city')
  created_at timestamptz not null default now(),

  -- Ровно одно из полей заполнено — согласовано с kind.
  constraint chk_hidden_kind check (
    (kind = 'car'  and car_id is not null and city_norm is null)
    or
    (kind = 'city' and city_norm is not null and car_id is null)
  )
);

comment on table public.hidden_cars is
  'Скрытые рекомендации пользователя: конкретное объявление (kind=car) или целый город (kind=city)';

-- Уникальность скрытий: одно объявление / один город у пользователя — один раз.
-- Частичные уникальные индексы, т.к. NULL в UNIQUE не даёт нужной защиты.
create unique index uq_hidden_user_car
  on public.hidden_cars (user_id, car_id) where kind = 'car';
create unique index uq_hidden_user_city
  on public.hidden_cars (user_id, city_norm) where kind = 'city';

-- Индекс под выборку «всё скрытое пользователя» при фильтрации каталога.
create index idx_hidden_user on public.hidden_cars (user_id);

-- ------------------------------------------------------------
-- 2) RLS: пользователь работает только со своими скрытиями
-- ------------------------------------------------------------
alter table public.hidden_cars enable row level security;

create policy "hidden_select_own" on public.hidden_cars
  for select to authenticated using (auth.uid() = user_id);
create policy "hidden_insert_own" on public.hidden_cars
  for insert to authenticated with check (auth.uid() = user_id);
create policy "hidden_delete_own" on public.hidden_cars
  for delete to authenticated using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3) RPC: скрыть объявление / скрыть город
-- ------------------------------------------------------------
-- Скрыть конкретное объявление. Идемпотентно (повторный вызов — no-op).
create or replace function public.hide_car(p_car_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.hidden_cars (user_id, kind, car_id)
  values (v_user, 'car', p_car_id)
  on conflict do nothing;
end;
$$;

comment on function public.hide_car(uuid)
  is 'Скрыть объявление из каталога пользователя (kind=car)';

-- Скрыть все объявления города. Город нормализуем (двуалфавитность,
-- регистр, диакритика) — как и поиск/фильтры.
create or replace function public.hide_city(p_city text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_norm text := public.f_normalize(p_city);
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  if v_norm is null or btrim(v_norm) = '' then
    return; -- пустой город игнорируем
  end if;

  insert into public.hidden_cars (user_id, kind, city_norm)
  values (v_user, 'city', v_norm)
  on conflict do nothing;
end;
$$;

comment on function public.hide_city(text)
  is 'Скрыть все объявления города из каталога пользователя (kind=city)';

grant execute on function public.hide_car(uuid)  to authenticated;
grant execute on function public.hide_city(text) to authenticated;

-- ------------------------------------------------------------
-- 4) Фильтрация скрытого в search_cars_advanced
-- ------------------------------------------------------------
-- Пересоздаём функцию (сигнатура та же, что в 0030) — добавляем в WHERE
-- отсечение скрытых пользователем объявлений и городов. Для гостя
-- (auth.uid() = null) подзапросы пусты → ничего не отсекается.
create or replace function public.search_cars_advanced(
  p_listing_type text default null,
  p_search_query text default null,
  p_user_lat     double precision default null,
  p_user_lng     double precision default null,
  p_radius_km    double precision default null,
  p_brand        text default null,
  p_model        text default null,
  p_city         text default null,
  p_year_from    integer default null,
  p_year_to      integer default null,
  p_mileage_max  integer default null,
  p_price_from   numeric default null,
  p_price_to     numeric default null,
  p_body_type    text default null,
  p_transmission text default null,
  p_fuel         text default null,
  p_seed         integer default 0,
  p_offset       integer default 0,
  p_limit        integer default 20,
  p_shuffle_all  boolean default false
)
returns setof public.cars
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(trim(coalesce(p_search_query, '')), '') as raw_query,
      public.f_normalize(p_search_query)             as norm,
      auth.uid()                                     as uid,
      case
        when p_user_lat is not null and p_user_lng is not null
        then st_setsrid(st_makepoint(p_user_lng, p_user_lat), 4326)::geography
        else null
      end as user_point
  )
  select c.*
  from public.cars c, params p
  where
    c.status = 'active'
    and (
      p_listing_type is null
      or (p_listing_type = 'sale' and c.is_for_sale)
      or (p_listing_type = 'rent' and c.is_for_rent)
    )
    and (
      p.raw_query is null
      or public.f_normalize(c.brand) % p.norm
      or public.f_normalize(c.model) % p.norm
      or public.f_normalize(c.city)  % p.norm
      or public.f_normalize(c.brand) ilike '%' || p.norm || '%'
      or public.f_normalize(c.model) ilike '%' || p.norm || '%'
      or public.f_normalize(c.city)  ilike '%' || p.norm || '%'
    )
    and (
      p.user_point is null
      or p_radius_km is null
      or p_radius_km <= 0
      or (c.location is not null
          and st_dwithin(c.location, p.user_point, p_radius_km * 1000))
    )
    -- Фильтры
    and (p_brand is null or public.f_normalize(c.brand) = public.f_normalize(p_brand))
    and (p_model is null or public.f_normalize(c.model) = public.f_normalize(p_model))
    and (p_city  is null or public.f_normalize(c.city)  = public.f_normalize(p_city))
    and (p_year_from is null or c.year >= p_year_from)
    and (p_year_to   is null or c.year <= p_year_to)
    and (p_mileage_max is null or c.mileage is null or c.mileage <= p_mileage_max)
    and (p_price_from is null
         or coalesce(case when c.is_for_rent then c.rent_price_daily else c.sale_price end, 0) >= p_price_from)
    and (p_price_to is null
         or coalesce(case when c.is_for_rent then c.rent_price_daily else c.sale_price end, 0) <= p_price_to)
    and (p_body_type    is null or c.body_type::text    = p_body_type)
    and (p_transmission is null or c.transmission::text = p_transmission)
    and (p_fuel         is null or c.fuel::text         = p_fuel)

    -- СКРЫТЫЕ РЕКОМЕНДАЦИИ (только для авторизованного; у гостя uid=null →
    -- оба not exists истинны, ничего не отсекается).
    and (p.uid is null or not exists (
      select 1 from public.hidden_cars h
      where h.user_id = p.uid and h.kind = 'car' and h.car_id = c.id
    ))
    and (p.uid is null or not exists (
      select 1 from public.hidden_cars h
      where h.user_id = p.uid and h.kind = 'city'
        and h.city_norm = public.f_normalize(c.city)
    ))

  order by
    case
      when not p_shuffle_all
       and (select user_point from params) is not null
       and c.location is not null
      then st_distance(c.location, (select user_point from params))
    end asc nulls last,
    (not p_shuffle_all
      and c.created_at > now() - interval '3 days') desc,
    case
      when not p_shuffle_all and c.created_at > now() - interval '3 days'
      then c.created_at
    end desc,
    md5(c.id::text || p_seed::text)
  limit  p_limit
  offset p_offset;
$$;

comment on function public.search_cars_advanced is
  'Каталог v4: фильтры + гео + бесконечная «крутилка» + отсечение скрытых пользователем объявлений/городов.';

grant execute on function public.search_cars_advanced(
  text, text, double precision, double precision, double precision,
  text, text, text, integer, integer, integer, numeric, numeric, text, text, text,
  integer, integer, integer, boolean
) to anon, authenticated;
