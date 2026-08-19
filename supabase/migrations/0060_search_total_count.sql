-- ============================================================
-- RS AUTO — 0060: общее количество результатов поиска.
-- ============================================================
-- ЗАЧЕМ: search_cars_advanced отдаёт страницу строк (limit/offset) и не
-- сообщает, сколько объявлений подходит под фильтр целиком. Из-за этого
-- каталог приложения не мог показать «Найдено: N», а при бесконечной
-- ленте счёт загруженных карточек к общему количеству отношения не имеет.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ПАРАМЕТР В search_cars_advanced:
--   1) Сигнатура работающей RPC не меняется вовсе — приложение и сайт
--      продолжают вызывать её как раньше, PostREST-перегрузки не возникает.
--   2) Количество нужно один раз при смене фильтров, а страницы
--      догружаются при каждой прокрутке. Отдельный вызов не тащит
--      count(*) по всей выборке на каждую страницу ленты.
--
-- ГЛАВНОЕ ТРЕБОВАНИЕ: условия отбора обязаны совпадать с
-- search_cars_advanced v5 (миграция 0047) ОДИН В ОДИН, иначе «Найдено: 42»
-- разойдётся с фактической выдачей. Блок where ниже перенесён из неё
-- дословно; отброшены только order by, limit и offset — на количество
-- строк они не влияют.
--
-- Поэтому НЕ приняты параметры p_seed и p_shuffle_all: они управляют
-- исключительно порядком строк. Пагинация (p_offset/p_limit) по той же
-- причине тоже отсутствует.
--
-- ВАЖНО ПРО СКРЫТЫЕ ОБЪЯВЛЕНИЯ: функция security definer, но auth.uid()
-- внутри неё возвращает пользователя вызывающего запроса. Поэтому
-- «скрытые рекомендации» (hidden_cars) вычитаются из счётчика ровно так
-- же, как из выдачи, и число совпадает у каждого пользователя со своим
-- списком скрытого.
-- ============================================================

create or replace function public.get_search_total_count(
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
  p_fuel         text default null
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(trim(coalesce(p_search_query, '')), '') as raw_query,
      -- Нормализация поискового запроса: unaccent + lower. Обеспечивает
      -- двуалфавитность (кириллица/латиница) и снятие диакритики Đ Č Š Ž.
      public.f_normalize(p_search_query)             as norm,
      auth.uid()                                     as uid,
      -- Точка пользователя для PostGIS-радиуса. SRID 4326 = широта/долгота.
      case
        when p_user_lat is not null and p_user_lng is not null
        then st_setsrid(st_makepoint(p_user_lng, p_user_lat), 4326)::geography
        else null
      end as user_point
  )
  select count(*)::integer
  from public.cars c, params p
  where
    c.status = 'active'
    and (
      p_listing_type is null
      or (p_listing_type = 'sale' and c.is_for_sale)
      or (p_listing_type = 'rent' and c.is_for_rent)
    )
    -- Поиск по строке: триграммное совпадение (%) плюс подстрока, всё поверх
    -- f_normalize — «БМВ» находит «BMW», «Beograd» находит «Београд».
    and (
      p.raw_query is null
      or public.f_normalize(c.brand) % p.norm
      or public.f_normalize(c.model) % p.norm
      or public.f_normalize(c.city)  % p.norm
      or public.f_normalize(c.brand) ilike '%' || p.norm || '%'
      or public.f_normalize(c.model) ilike '%' || p.norm || '%'
      or public.f_normalize(c.city)  ilike '%' || p.norm || '%'
    )
    -- PostGIS-радиус: st_dwithin по географии, радиус в километрах → метры.
    -- Использует GIST-индекс idx_cars_location.
    and (
      p.user_point is null
      or p_radius_km is null
      or p_radius_km <= 0
      or (c.location is not null
          and st_dwithin(c.location, p.user_point, p_radius_km * 1000))
    )
    -- Фильтры (нормализация текстовых полей — та же f_normalize)
    and (p_brand is null or public.f_normalize(c.brand) = public.f_normalize(p_brand))
    and (p_model is null or public.f_normalize(c.model) = public.f_normalize(p_model))
    and (p_city  is null or public.f_normalize(c.city)  = public.f_normalize(p_city))
    and (p_year_from is null or c.year >= p_year_from)
    and (p_year_to   is null or c.year <= p_year_to)
    -- Объявления без указанного пробега проходят фильтр — так же, как в
    -- выдаче: «до 100 000 км» не должно прятать машину без данных.
    and (p_mileage_max is null or c.mileage is null or c.mileage <= p_mileage_max)
    and (p_price_from is null
         or coalesce(case when c.is_for_rent then c.rent_price_daily else c.sale_price end, 0) >= p_price_from)
    and (p_price_to is null
         or coalesce(case when c.is_for_rent then c.rent_price_daily else c.sale_price end, 0) <= p_price_to)
    and (p_body_type    is null or c.body_type::text    = p_body_type)
    and (p_transmission is null or c.transmission::text = p_transmission)
    and (p_fuel         is null or c.fuel::text         = p_fuel)

    -- СКРЫТЫЕ РЕКОМЕНДАЦИИ (только для авторизованного; у гостя uid = null →
    -- оба not exists истинны, ничего не отсекается).
    and (p.uid is null or not exists (
      select 1 from public.hidden_cars h
      where h.user_id = p.uid and h.kind = 'car' and h.car_id = c.id
    ))
    and (p.uid is null or not exists (
      select 1 from public.hidden_cars h
      where h.user_id = p.uid and h.kind = 'city'
        and h.city_norm = public.f_normalize(c.city)
    ));
$$;

comment on function public.get_search_total_count is
  'Количество объявлений под фильтрами каталога. Условия where идентичны search_cars_advanced v5 (0047); порядок и пагинация не применяются';

-- Права те же, что у search_cars_advanced: каталог читают и гости (anon),
-- это требование SEO и открытой витрины.
grant execute on function public.get_search_total_count(
  text, text, double precision, double precision, double precision,
  text, text, text, integer, integer, integer, numeric, numeric, text, text, text
) to anon, authenticated;
