-- ============================================================
-- AUTO.RS — Миграция 0028: Фильтр по модели в search_cars_advanced
-- ============================================================
-- Добавляем параметр p_model между p_brand и p_city.
-- Старая 15-параметровая версия удаляется (перегрузка → неоднозначность).
-- ============================================================
drop function if exists public.search_cars_advanced(
  text, text, double precision, double precision, double precision,
  text, text, integer, integer, integer, numeric, numeric, text, text, text
);

create or replace function public.search_cars_advanced(
  p_listing_type text default null,
  p_search_query text default null,
  p_user_lat     double precision default null,
  p_user_lng     double precision default null,
  p_radius_km    double precision default null,
  p_brand        text default null,
  p_model        text default null,             -- НОВОЕ: модель
  p_city         text default null,
  p_year_from    integer default null,
  p_year_to      integer default null,
  p_mileage_max  integer default null,
  p_price_from   numeric default null,
  p_price_to     numeric default null,
  p_body_type    text default null,
  p_transmission text default null,
  p_fuel         text default null
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

  order by
    case
      when (select user_point from params) is not null and c.location is not null
      then st_distance(c.location, (select user_point from params))
      else null
    end asc nulls last,
    c.created_at desc
  limit 100;
$$;

grant execute on function public.search_cars_advanced(
  text, text, double precision, double precision, double precision,
  text, text, text, integer, integer, integer, numeric, numeric, text, text, text
) to anon, authenticated;
