-- ============================================================
-- AUTO.RS — Миграция 0017: Расширенный поиск каталога (гео + фильтры)
-- ============================================================
-- Единая RPC для Главного экрана каталога: объединяет фильтр по типу
-- объявления (продажа/аренда), двуалфавитный триграммный поиск и
-- гео-фильтрацию по радиусу через PostGIS (ST_DWithin).
-- Все аргументы опциональны: NULL/пусто — фильтр не применяется.
-- ============================================================
create or replace function public.search_cars_advanced(
  p_listing_type text default null,             -- 'sale' | 'rent' | null (любой)
  p_search_query text default null,             -- строка поиска | null
  p_user_lat     double precision default null, -- широта пользователя
  p_user_lng     double precision default null, -- долгота пользователя
  p_radius_km    double precision default null  -- радиус поиска, км (>0 — включает гео-фильтр)
)
returns setof public.cars
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    -- Нормализуем поисковый запрос один раз (lower + unaccent).
    -- Если запрос пуст/NULL — norm будет NULL и поиск по тексту не применится.
    select
      nullif(trim(coalesce(p_search_query, '')), '') as raw_query,
      public.f_normalize(p_search_query)             as norm,
      -- Точку пользователя строим только если обе координаты заданы
      case
        when p_user_lat is not null and p_user_lng is not null
        then st_setsrid(st_makepoint(p_user_lng, p_user_lat), 4326)::geography
        else null
      end as user_point
  )
  select c.*
  from public.cars c, params p
  where
    -- (а) только активные объявления
    c.status = 'active'

    -- (б) фильтр по типу объявления (строгий, если тип передан)
    and (
      p_listing_type is null
      or (p_listing_type = 'sale' and c.is_for_sale)
      or (p_listing_type = 'rent' and c.is_for_rent)
    )

    -- (в) текстовый поиск: применяем только если запрос непустой.
    --     Триграммное нечёткое совпадение (%) + подстрока (ilike) по
    --     нормализованным brand/model/city — устойчиво к диакритике и опечаткам.
    and (
      p.raw_query is null
      or public.f_normalize(c.brand) % p.norm
      or public.f_normalize(c.model) % p.norm
      or public.f_normalize(c.city)  % p.norm
      or public.f_normalize(c.brand) ilike '%' || p.norm || '%'
      or public.f_normalize(c.model) ilike '%' || p.norm || '%'
      or public.f_normalize(c.city)  ilike '%' || p.norm || '%'
    )

    -- (г) гео-фильтр по радиусу: только если заданы координаты и радиус > 0
    --     и у объявления есть координаты. ST_DWithin для geography считает
    --     расстояние по сфере в МЕТРАХ, поэтому радиус переводим км → м (×1000).
    and (
      p.user_point is null
      or p_radius_km is null
      or p_radius_km <= 0
      or (
        c.location is not null
        and st_dwithin(c.location, p.user_point, p_radius_km * 1000)
      )
    )

  -- Сортировка: если задана точка пользователя — по возрастанию расстояния
  -- (ближайшие сверху); иначе — свежие объявления первыми.
  order by
    case
      when (select user_point from params) is not null and c.location is not null
      then st_distance(c.location, (select user_point from params))
      else null
    end asc nulls last,
    c.created_at desc
  limit 100;
$$;

comment on function public.search_cars_advanced(text, text, double precision, double precision, double precision)
  is 'Каталог: фильтр по типу + двуалфавитный триграммный поиск + гео-радиус (ST_DWithin). Только active';


-- ============================================================
-- ПРАВА: поиск доступен гостям и авторизованным
-- ============================================================
grant execute on function public.search_cars_advanced(
  text, text, double precision, double precision, double precision
) to anon, authenticated;
