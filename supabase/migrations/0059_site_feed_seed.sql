-- ============================================================
-- AUTO.RS — Миграция 0059: seed перемешки для бесконечной ленты сайта.
-- ============================================================
-- ЗАЧЕМ. Каталог сайта переводится на бесконечную подгрузку по образцу
-- приложения App Baza (lib/features/listings/presentation/providers/
-- listings_feed_provider.dart). Там лента «никогда не заканчивается»:
-- когда сервер отдал все объявления текущего круга, клиент начинает
-- НОВЫЙ круг с другим порядком, и пользователь шва не видит.
--
-- Для этого сервер обязан уметь перемешивать по ПРОИЗВОЛЬНОЙ соли,
-- которую задаёт клиент. Сейчас соль зашита намертво: current_date
-- (миграция 0057). Она стабильна в течение суток — это правильно для
-- пагинации и для краулера, но означает, что второй круг повторит
-- первый в том же порядке.
--
-- ЧТО МЕНЯЕТСЯ. У search_cars_public появляются два НЕОБЯЗАТЕЛЬНЫХ
-- параметра:
--   p_seed        — соль перемешки. NULL (по умолчанию) = прежнее
--                   поведение, current_date. Любое число = свой порядок.
--   p_shuffle_all — на кругах 2+ отключает подъём промо-объявлений
--                   наверх. Иначе каждый круг начинался бы с одних и тех
--                   же продвигаемых карточек, и повтор бросался бы
--                   в глаза — та же причина, что в App Baza.
--
-- СОВМЕСТИМОСТЬ. Оба параметра со значениями по умолчанию и добавлены
-- В КОНЕЦ списка, поэтому все существующие вызовы (приложение, SSG
-- страниц марок и моделей, sitemap) продолжают работать без правок и
-- получают ровно тот же детерминированный порядок, что и раньше.
-- Это требование задачи: SEO-страницы обязаны остаться стабильными.
--
-- ПОВТОРНЫЙ ЗАПУСК БЕЗОПАСЕН: create or replace function.
-- ============================================================

create or replace function public.search_cars_public(
  p_search_query text    default null,
  p_brand        text    default null,
  p_model        text    default null,
  p_city         text    default null,
  p_year_from    integer default null,
  p_year_to      integer default null,
  p_mileage_max  integer default null,
  p_price_from   numeric default null,
  p_price_to     numeric default null,
  p_body_type    text    default null,
  p_transmission text    default null,
  p_fuel         text    default null,
  p_sort         text    default 'fresh',
  p_offset       integer default 0,
  p_limit        integer default 24,
  p_listing_type text    default 'sale',
  -- Соль перемешки для бесконечной ленты. NULL = current_date.
  p_seed         integer default null,
  -- Круги 2+: полная перетасовка без блока промо сверху.
  p_shuffle_all  boolean default false
)
returns table (
  id               uuid,
  brand            text,
  model            text,
  year             integer,
  mileage          integer,
  body_type        text,
  transmission     text,
  fuel             text,
  currency         text,
  sale_price       numeric,
  rent_price_daily numeric,
  deposit_amount   numeric,
  is_for_sale      boolean,
  is_for_rent      boolean,
  city             text,
  status           text,
  is_promoted      boolean,
  site_url         text,
  photo_url        text,
  seller_kind      text,
  created_at       timestamptz,
  total_count      bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(trim(coalesce(p_search_query, '')), '')  as raw_query,
      public.f_normalize(p_search_query)              as norm,
      greatest(coalesce(p_offset, 0), 0)              as safe_offset,
      least(greatest(coalesce(p_limit, 24), 1), 100)  as safe_limit,
      case
        when p_sort in ('fresh', 'price_asc', 'price_desc',
                        'year_desc', 'year_asc', 'mileage_asc')
        then p_sort
        else 'fresh'
      end as sort_key,
      case
        when p_listing_type in ('sale', 'rent', 'both')
        then p_listing_type
        else 'sale'
      end as mode,
      -- Соль перемешки. Клиентский seed имеет приоритет; без него —
      -- прежнее поведение: одна соль на сутки, стабильная для краулера
      -- и для offset-пагинации.
      coalesce(p_seed::text, current_date::text) as shuffle_salt,
      -- Поднимать ли промо наверх. На кругах 2+ (p_shuffle_all) — нет.
      coalesce(p_shuffle_all, false) as shuffle_all
  ),
  filtered as (
    select
      c.*,
      (c.is_vip and c.boosted_until is not null and c.boosted_until > now())
        as promoted_now,
      case when p.mode = 'rent' then c.rent_price_daily else c.sale_price end
        as active_price,
      count(*) over () as total_rows
    from public.cars c, params p
    where
      c.status = 'active'
      and (
        (p.mode = 'sale' and c.is_for_sale)
        or (p.mode = 'rent' and c.is_for_rent)
        or (p.mode = 'both' and (c.is_for_sale or c.is_for_rent))
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
      and (p_brand is null or public.f_normalize(c.brand) = public.f_normalize(p_brand))
      and (p_model is null or public.f_normalize(c.model) = public.f_normalize(p_model))
      and (p_city  is null or public.f_normalize(c.city)  = public.f_normalize(p_city))
      and (p_year_from is null or c.year >= p_year_from)
      and (p_year_to   is null or c.year <= p_year_to)
      and (p_mileage_max is null or c.mileage is null or c.mileage <= p_mileage_max)
      and (p_price_from is null
           or (case when p.mode = 'rent' then c.rent_price_daily else c.sale_price end)
              >= p_price_from)
      and (p_price_to is null
           or (case when p.mode = 'rent' then c.rent_price_daily else c.sale_price end)
              <= p_price_to)
      and (p_body_type    is null or c.body_type::text    = p_body_type)
      and (p_transmission is null or c.transmission::text = p_transmission)
      and (p_fuel         is null or c.fuel::text         = p_fuel)
  )
  select
    f.id, f.brand, f.model, f.year, f.mileage,
    f.body_type::text, f.transmission::text, f.fuel::text,
    f.currency::text,
    f.sale_price, f.rent_price_daily, f.deposit_amount,
    f.is_for_sale, f.is_for_rent,
    f.city, f.status::text,
    f.promoted_now,
    public.f_car_site_url(f.id),
    (select ci.image_url from public.car_images ci
      where ci.car_id = f.id
      order by ci.order_index asc
      limit 1),
    pr.seller_kind,
    f.created_at,
    f.total_rows
  from filtered f
  join public.profiles pr on pr.id = f.user_id,
       params p
  order by
    -- УРОВЕНЬ 0: продвижение. Действует в дефолтной выдаче, НО не на
    -- кругах 2+ бесконечной ленты: там shuffle_all = true, и промо
    -- участвует в общей перетасовке наравне со всеми. Иначе каждый
    -- новый круг открывался бы теми же продвигаемыми карточками.
    case
      when p.sort_key = 'fresh' and not p.shuffle_all
      then f.promoted_now
    end desc nulls last,

    -- УРОВЕНЬ 1: явная сортировка, если её выбрал пользователь.
    case when p.sort_key = 'price_asc'   then f.active_price end asc  nulls last,
    case when p.sort_key = 'price_desc'  then f.active_price end desc nulls last,
    case when p.sort_key = 'year_desc'   then f.year         end desc nulls last,
    case when p.sort_key = 'year_asc'    then f.year         end asc  nulls last,
    case when p.sort_key = 'mileage_asc' then f.mileage      end asc  nulls last,

    -- УРОВЕНЬ 2: перемешка для дефолтной выдачи. Порядок псевдослучайный,
    -- но одинаковый для всех страниц одного круга (одна соль) — это и
    -- делает offset-пагинацию корректной: без стабильного порядка одно
    -- объявление попало бы на две страницы, а другое — ни на одну.
    -- Здесь же решается задача смешанного фида: md5 не зависит ни от
    -- created_at, ни от типа сделки, поэтому продажа и аренда идут
    -- вперемешку, а не двумя блоками.
    case
      when p.sort_key = 'fresh'
      then md5(f.id::text || p.shuffle_salt)
    end,

    -- ФИНАЛЬНЫЙ ТАЙБРЕЙК. Обязателен: без него строки с равными
    -- значениями могут менять порядок между запросами, и одно
    -- объявление попадёт на две страницы пагинации, а другое — ни на одну.
    f.id
  limit  (select safe_limit  from params)
  offset (select safe_offset from params);
$$;

comment on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text, integer, boolean)
  is 'Каталог сайта: промо → перемешка md5(id||seed). p_seed задаёт круг бесконечной ленты (NULL = current_date, стабильно сутки); p_shuffle_all убирает промо-блок на кругах 2+. total_count для пагинации';

-- Права: те же, что у прежней версии функции.
revoke all on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text, integer, boolean) from public;
grant execute on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text, integer, boolean)
  to anon, authenticated;

-- ============================================================
-- ⚠️ ВАЖНО ПРО СТАРУЮ СИГНАТУРУ.
-- create or replace НЕ заменяет функцию с другим числом параметров —
-- он создаёт ПЕРЕГРУЗКУ. После применения в схеме окажутся две версии
-- search_cars_public: с 16 и с 18 аргументами. Вызовы по имени
-- параметров (так работает supabase-js) уйдут в 18-аргументную, но
-- держать мёртвую перегрузку незачем — она путает и может дать
-- неоднозначность при вызове с позиционными аргументами.
--
-- Удаляем прежнюю версию ЯВНО, по её точной сигнатуре:
drop function if exists public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text);

-- ПРОВЕРКА после применения:
--
--   -- 1. Прежнее поведение (без seed) — порядок стабилен:
--   select id from public.search_cars_public(p_limit => 5);
--   select id from public.search_cars_public(p_limit => 5);
--   -- обе выборки обязаны совпасть
--
--   -- 2. Разные seed дают разный порядок:
--   select id from public.search_cars_public(p_limit => 5, p_seed => 111);
--   select id from public.search_cars_public(p_limit => 5, p_seed => 222);
--
--   -- 3. Одна перегрузка, а не две:
--   select count(*) from pg_proc where proname = 'search_cars_public';
--   -- ожидается 1
-- ============================================================
