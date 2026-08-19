-- ============================================================
-- RS AUTO — 0061: сортировка выдачи в каталоге приложения.
-- ============================================================
-- ЗАЧЕМ: на сайте пользователь выбирает порядок выдачи (SortSelect →
-- p_sort в search_cars_public): свежие, цена, год, пробег. В приложении
-- такого выбора не было вовсе — порядок задавала сама RPC. Приложение
-- должно повторять сайт, поэтому тот же выбор появляется и здесь.
--
-- ПОЧЕМУ НЕ ПЕРЕИСПОЛЬЗУЕМ search_cars_public: она рассчитана на сайт —
-- отдаёт только продажу, не учитывает hidden_cars, не умеет гео-радиус
-- и «бесконечную крутилку». Для каталога приложения это потеря функций.
--
-- ЧТО МЕНЯЕТСЯ: у search_cars_advanced появляется НЕОБЯЗАТЕЛЬНЫЙ
-- параметр p_sort со значением по умолчанию 'fresh'. Блок where не
-- тронут вовсе; переписан только order by.
--
-- СОВМЕСТИМОСТЬ: параметр добавлен ПОСЛЕДНИМ и имеет default, поэтому
-- существующие вызовы (и приложения, и сайта) продолжают работать без
-- изменений и получают прежний порядок.
--
-- ПОЧЕМУ СНАЧАЛА DROP. В PostgreSQL функции различаются по СПИСКУ
-- АРГУМЕНТОВ: добавление 21-го параметра создаёт не замену, а вторую
-- перегрузку — create or replace здесь не помогает. Две перегрузки, у
-- которых все параметры имеют умолчания, делают вызов неоднозначным:
--   * psql отвечает «function name is not unique»;
--   * PostgREST не может выбрать функцию, и вызовы приложения падают.
-- Поэтому старая 20-параметровая версия удаляется явно, до создания
-- новой. Сигнатура указана целиком — drop по одному имени невозможен
-- ровно по той же причине.
--
-- ВАЖНО ПРО СЧЁТЧИК: get_search_total_count (миграция 0060) НЕ трогаем.
-- Порядок строк на их количество не влияет, а сигнатура счётчика
-- намеренно не содержит параметров сортировки.
--
-- ПРОМО: поднимается наверх ТОЛЬКО при сортировке 'fresh' — то же
-- правило, что на сайте. Если человек явно попросил «сначала дешёвые»,
-- нарушать этот порядок рекламой нельзя: это выглядит как обман.
-- Точно так же ведут себя крупные площадки.
-- ============================================================

-- Старая версия (20 параметров, без p_sort). if exists — чтобы миграция
-- прошла и на чистой базе, где функции ещё нет.
drop function if exists public.search_cars_advanced(
  text, text, double precision, double precision, double precision,
  text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text,
  integer, integer, integer, boolean
);

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
  p_shuffle_all  boolean default false,
  p_sort         text default 'fresh'
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
      -- Нормализация поискового запроса: unaccent + lower. Обеспечивает
      -- двуалфавитность (кириллица/латиница) и снятие диакритики Đ Č Š Ž.
      public.f_normalize(p_search_query)             as norm,
      auth.uid()                                     as uid,
      -- Точка пользователя для PostGIS-радиуса. SRID 4326 = широта/долгота.
      case
        when p_user_lat is not null and p_user_lng is not null
        then st_setsrid(st_makepoint(p_user_lng, p_user_lat), 4326)::geography
        else null
      end as user_point,
      -- Неизвестное значение молча трактуется как 'fresh': выдача обязана
      -- отдать контент даже при кривом параметре, а не упасть.
      case
        when p_sort in ('fresh', 'price_asc', 'price_desc',
                        'year_desc', 'year_asc', 'mileage_asc')
        then p_sort
        else 'fresh'
      end as sort_key
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
    ))

  order by
    -- ---------- УРОВЕНЬ 0: АКТИВНОЕ ПРОДВИЖЕНИЕ ----------
    -- Только в дефолтной сортировке. При явно выбранном порядке (цена,
    -- год, пробег) промо не поднимается — см. пояснение в шапке файла.
    case
      when (select sort_key from params) = 'fresh'
      then (c.is_vip and c.boosted_until is not null and c.boosted_until > now())
    end desc nulls last,

    -- Внутри промо-блока: чем позже куплено продвижение, тем выше.
    case
      when (select sort_key from params) = 'fresh'
       and c.is_vip and c.boosted_until is not null and c.boosted_until > now()
      then c.boosted_until
    end desc nulls last,

    -- ---------- ЯВНО ВЫБРАННЫЙ ПОРЯДОК ----------
    -- NULLS LAST везде, где поле необязательное: объявления без цены или
    -- пробега уходят в конец, а не всплывают наверх при сортировке по
    -- возрастанию. Цена берётся по типу сделки — той же формулой, что в
    -- фильтре цены выше, иначе аренда сортировалась бы по пустому
    -- sale_price и вся ушла бы в хвост.
    case
      when (select sort_key from params) = 'price_asc'
      then coalesce(case when c.is_for_rent then c.rent_price_daily else c.sale_price end, null)
    end asc nulls last,
    case
      when (select sort_key from params) = 'price_desc'
      then coalesce(case when c.is_for_rent then c.rent_price_daily else c.sale_price end, null)
    end desc nulls last,
    case when (select sort_key from params) = 'year_desc'   then c.year    end desc nulls last,
    case when (select sort_key from params) = 'year_asc'    then c.year    end asc  nulls last,
    case when (select sort_key from params) = 'mileage_asc' then c.mileage end asc  nulls last,

    -- ---------- ДЕФОЛТНЫЙ ПОРЯДОК ('fresh') ----------
    -- Прежнее поведение v5 сохранено полностью: близость (PostGIS) →
    -- свежие объявления → «бесконечная крутилка». При выбранной вручную
    -- сортировке эти уровни не участвуют: их case-выражения дают null.

    -- Близость.
    case
      when (select sort_key from params) = 'fresh'
       and not p_shuffle_all
       and (select user_point from params) is not null
       and c.location is not null
      then st_distance(c.location, (select user_point from params))
    end asc nulls last,

    -- Свежие объявления (моложе 3 дней) — выше.
    case
      when (select sort_key from params) = 'fresh'
      then (not p_shuffle_all and c.created_at > now() - interval '3 days')
    end desc nulls last,
    case
      when (select sort_key from params) = 'fresh'
       and not p_shuffle_all
       and c.created_at > now() - interval '3 days'
      then c.created_at
    end desc,

    -- «Бесконечная крутилка»: псевдослучайный, но стабильный при одном
    -- seed порядок. Только для 'fresh' — при явной сортировке случайность
    -- сломала бы выбранный пользователем порядок.
    case
      when (select sort_key from params) = 'fresh'
      then md5(c.id::text || p_seed::text)
    end,

    -- ФИНАЛЬНЫЙ ТАЙБРЕЙК — обязателен. Без него строки с одинаковым
    -- значением сортировки могут менять относительный порядок между
    -- запросами, из-за чего одно объявление попадёт на две страницы, а
    -- другое не попадёт ни на одну. id уникален и стабилен.
    c.id
  limit  p_limit
  offset p_offset;
$$;

comment on function public.search_cars_advanced(
  text, text, double precision, double precision, double precision,
  text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text,
  integer, integer, integer, boolean, text
) is
  'Каталог v6: выбор порядка (p_sort), промо-блок только при fresh, затем гео → свежие → шафл. Фильтры, двуалфавитность (f_normalize), PostGIS-радиус';

grant execute on function public.search_cars_advanced(
  text, text, double precision, double precision, double precision,
  text, text, text, integer, integer, integer, numeric, numeric, text, text, text,
  integer, integer, integer, boolean, text
) to anon, authenticated;
