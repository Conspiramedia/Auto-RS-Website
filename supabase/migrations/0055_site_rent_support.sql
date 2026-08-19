-- ============================================================
-- AUTO.RS — Миграция 0055: поддержка аренды на сайте
-- ============================================================
-- Три задачи:
--   1. search_cars_public получает p_listing_type ('sale' | 'rent' | 'both')
--      и перестаёт быть жёстко привязанной к продаже;
--   2. появляется create_car_v3 — подача с РАЗДЕЛЬНЫМИ ценами продажи и
--      аренды и с депозитом;
--   3. SEO-справочники (марки/модели/города, sitemap) учатся фильтровать
--      по типу объявления, иначе страницы /rent строились бы по товарам,
--      которых в аренде нет.
--
-- СОВМЕСТИМОСТЬ: миграция строго аддитивная.
--   * search_cars_public пересоздаётся с НОВЫМ параметром В КОНЦЕ списка
--     и значением по умолчанию 'sale'. Прежние вызовы сайта (без этого
--     параметра) продолжают работать и по-прежнему отдают только продажу.
--   * create_car_v2 НЕ трогается — её вызывает приложение.
--     Для сайта заводится create_car_v3 рядом.
--   * get_site_brands/models/cities получают необязательный параметр;
--     вызовы без него ведут себя как раньше.
--
-- ПОЧЕМУ create_car_v3, а не правка v2: у v2 один параметр price, который
-- при listing_type='both' копируется И в цену продажи, И в цену аренды.
-- Для машины, которая продаётся за 12 000 € и сдаётся за 40 €/сутки, это
-- бессмысленно. Менять сигнатуру v2 нельзя — на неё завязано приложение.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Индексы под выдачу аренды
-- ------------------------------------------------------------
-- Зеркало индексов продажи из миграции 0051. Частичные: в них попадают
-- только активные арендные объявления, а их на площадке меньшинство.
create index if not exists idx_cars_site_rent_created
  on public.cars (created_at desc)
  where status = 'active' and is_for_rent;

create index if not exists idx_cars_site_rent_price
  on public.cars (rent_price_daily)
  where status = 'active' and is_for_rent;


-- ------------------------------------------------------------
-- 2) search_cars_public с p_listing_type
-- ------------------------------------------------------------
-- Прежняя версия имела 15 параметров и возвращала таблицу без полей
-- аренды. Здесь добавляются:
--   вход:  p_listing_type ('sale' | 'rent' | 'both'), последним параметром;
--   выход: rent_price_daily, deposit_amount, is_for_sale, is_for_rent.
--
-- Старую функцию сначала удаляем: CREATE OR REPLACE не может изменить
-- набор колонок в RETURNS TABLE.
--
-- ЦЕНА ЗАВИСИТ ОТ РЕЖИМА. В аренде фильтры p_price_from/p_price_to и
-- сортировки price_asc/price_desc работают по rent_price_daily, в продаже —
-- по sale_price. Иначе «до 50 €» в аренде не нашло бы ничего: суточные
-- ставки на два порядка меньше цен продажи.
drop function if exists public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer);

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
  -- Новый параметр — последним, со значением по умолчанию: вызовы,
  -- написанные до этой миграции, не ломаются.
  p_listing_type text    default 'sale'
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
      -- Неизвестное значение трактуем как 'sale': страница обязана
      -- отдать контент даже при мусоре в адресе, а не упасть.
      case
        when p_listing_type in ('sale', 'rent', 'both')
        then p_listing_type
        else 'sale'
      end as mode
  ),
  filtered as (
    select
      c.*,
      (c.is_vip and c.boosted_until is not null and c.boosted_until > now())
        as promoted_now,
      -- Цена, по которой идут фильтр и сортировка в текущем режиме.
      case when p.mode = 'rent' then c.rent_price_daily else c.sale_price end
        as active_price,
      count(*) over () as total_rows
    from public.cars c, params p
    where
      c.status = 'active'
      -- Режим витрины. 'both' показывает и то и другое — используется
      -- общим поиском, отдельной страницы у него нет.
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
      -- Границы цены применяются к активной для режима цене.
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
    case when p.sort_key = 'fresh' then f.promoted_now end desc nulls last,
    case when p.sort_key = 'price_asc'   then f.active_price end asc  nulls last,
    case when p.sort_key = 'price_desc'  then f.active_price end desc nulls last,
    case when p.sort_key = 'year_desc'   then f.year         end desc nulls last,
    case when p.sort_key = 'year_asc'    then f.year         end asc  nulls last,
    case when p.sort_key = 'mileage_asc' then f.mileage      end asc  nulls last,
    case when p.sort_key = 'fresh'       then f.created_at   end desc nulls last,
    -- Стабильный тайбрейк: без него строки с равными значениями
    -- перескакивали бы между страницами пагинации.
    f.id
  limit  (select safe_limit  from params)
  offset (select safe_offset from params);
$$;

comment on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text)
  is 'Каталог сайта: p_listing_type sale/rent/both, детерминированная сортировка, total_count. Цена и сортировка по цене зависят от режима';

grant execute on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 3) get_similar_cars — похожие в том же режиме
-- ------------------------------------------------------------
-- Показывать в блоке «похожие» на арендной карточке машины, которые
-- только продаются, бессмысленно: пользователь ищет аренду.
drop function if exists public.get_similar_cars(uuid, integer);

create or replace function public.get_similar_cars(
  p_car_id uuid,
  p_limit  integer default 8,
  -- 'auto' — определить режим по самому объявлению: арендному подбираем
  -- арендные, остальным — продаваемые.
  p_listing_type text default 'auto'
)
returns table (
  id               uuid,
  brand            text,
  model            text,
  year             integer,
  mileage          integer,
  currency         text,
  sale_price       numeric,
  rent_price_daily numeric,
  is_for_sale      boolean,
  is_for_rent      boolean,
  city             text,
  site_url         text,
  photo_url        text
)
language sql
stable
security definer
set search_path = public
as $$
  with src as (
    select
      c.brand, c.model, c.city, c.sale_price, c.rent_price_daily,
      c.is_for_rent,
      -- Режим подбора: явно заданный либо выведенный из объявления.
      case
        when p_listing_type in ('sale', 'rent') then p_listing_type
        when c.is_for_rent and not c.is_for_sale then 'rent'
        else 'sale'
      end as mode
    from public.cars c
    where c.id = p_car_id
  )
  select
    c.id, c.brand, c.model, c.year, c.mileage,
    c.currency::text, c.sale_price, c.rent_price_daily,
    c.is_for_sale, c.is_for_rent,
    c.city,
    public.f_car_site_url(c.id),
    (select ci.image_url from public.car_images ci
      where ci.car_id = c.id
      order by ci.order_index asc
      limit 1)
  from public.cars c, src s
  where
    c.status = 'active'
    and c.id <> p_car_id
    and ((s.mode = 'rent' and c.is_for_rent) or (s.mode = 'sale' and c.is_for_sale))
    and (
      public.f_normalize(c.brand) = public.f_normalize(s.brand)
      or public.f_normalize(c.city) = public.f_normalize(s.city)
    )
  order by
    case
      when public.f_normalize(c.brand) = public.f_normalize(s.brand)
       and public.f_normalize(c.model) = public.f_normalize(s.model) then 0
      when public.f_normalize(c.brand) = public.f_normalize(s.brand) then 1
      else 2
    end asc,
    -- Близость цены считается по той цене, которая относится к режиму.
    case
      when s.mode = 'rent'
       and c.rent_price_daily is not null and s.rent_price_daily is not null
      then abs(c.rent_price_daily - s.rent_price_daily)
      when s.mode = 'sale'
       and c.sale_price is not null and s.sale_price is not null
      then abs(c.sale_price - s.sale_price)
    end asc nulls last,
    c.id
  limit least(greatest(coalesce(p_limit, 8), 1), 24);
$$;

comment on function public.get_similar_cars(uuid, integer, text)
  is 'Похожие объявления в том же режиме (продажа/аренда). auto — режим берётся из самого объявления';

grant execute on function public.get_similar_cars(uuid, integer, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 4) SEO-справочники с фильтром по типу
-- ------------------------------------------------------------
-- Без параметра ведут себя как прежде (только продажа), поэтому старые
-- вызовы страниц /cars остаются рабочими.
drop function if exists public.get_site_brands();

create or replace function public.get_site_brands(
  p_listing_type text default 'sale'
)
returns table (
  brand       text,
  brand_slug  text,
  cars_count  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    max(c.brand),
    public.f_slugify(c.brand),
    count(*)
  from public.cars c
  where c.status = 'active'
    and (
      (coalesce(p_listing_type, 'sale') = 'sale' and c.is_for_sale)
      or (p_listing_type = 'rent' and c.is_for_rent)
      or (p_listing_type = 'both' and (c.is_for_sale or c.is_for_rent))
    )
  group by public.f_slugify(c.brand)
  having public.f_slugify(max(c.brand)) <> ''
  order by count(*) desc, max(c.brand);
$$;

comment on function public.get_site_brands(text)
  is 'Марки с активными объявлениями заданного типа (sale/rent/both), со слагом и счётчиком';

grant execute on function public.get_site_brands(text) to anon, authenticated;


drop function if exists public.get_site_models(text);

create or replace function public.get_site_models(
  p_brand        text,
  p_listing_type text default 'sale'
)
returns table (
  brand       text,
  brand_slug  text,
  model       text,
  model_slug  text,
  cars_count  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    max(c.brand),
    public.f_slugify(max(c.brand)),
    max(c.model),
    public.f_slugify(c.model),
    count(*)
  from public.cars c
  where c.status = 'active'
    and (
      (coalesce(p_listing_type, 'sale') = 'sale' and c.is_for_sale)
      or (p_listing_type = 'rent' and c.is_for_rent)
      or (p_listing_type = 'both' and (c.is_for_sale or c.is_for_rent))
    )
    and public.f_slugify(c.brand) = public.f_slugify(p_brand)
  group by public.f_slugify(c.model)
  having public.f_slugify(max(c.model)) <> ''
  order by count(*) desc, max(c.model);
$$;

comment on function public.get_site_models(text, text)
  is 'Модели марки с активными объявлениями заданного типа. Марка принимается слагом или названием';

grant execute on function public.get_site_models(text, text) to anon, authenticated;


drop function if exists public.get_site_cities();

create or replace function public.get_site_cities(
  p_listing_type text default 'sale'
)
returns table (
  city       text,
  city_slug  text,
  cars_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    max(c.city),
    public.f_slugify(c.city),
    count(*)
  from public.cars c
  where c.status = 'active'
    and (
      (coalesce(p_listing_type, 'sale') = 'sale' and c.is_for_sale)
      or (p_listing_type = 'rent' and c.is_for_rent)
      or (p_listing_type = 'both' and (c.is_for_sale or c.is_for_rent))
    )
  group by public.f_slugify(c.city)
  having public.f_slugify(max(c.city)) <> ''
  order by count(*) desc, max(c.city);
$$;

comment on function public.get_site_cities(text)
  is 'Города с активными объявлениями заданного типа, со слагом и счётчиком';

grant execute on function public.get_site_cities(text) to anon, authenticated;


-- ------------------------------------------------------------
-- 5) get_sitemap_cars — учитывает обе витрины
-- ------------------------------------------------------------
-- В sitemap должны попадать и арендные карточки: у них те же адреса
-- /car/{id}, но раньше фильтр по is_for_sale их отсекал.
drop function if exists public.get_sitemap_cars(integer, integer);

create or replace function public.get_sitemap_cars(
  p_offset integer default 0,
  p_limit  integer default 5000,
  p_listing_type text default 'both'
)
returns table (
  id          uuid,
  site_url    text,
  updated_at  timestamptz,
  is_for_sale boolean,
  is_for_rent boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    public.f_car_site_url(c.id),
    c.updated_at,
    c.is_for_sale,
    c.is_for_rent
  from public.cars c
  where c.status = 'active'
    and (
      (p_listing_type = 'sale' and c.is_for_sale)
      or (p_listing_type = 'rent' and c.is_for_rent)
      or (coalesce(p_listing_type, 'both') = 'both'
          and (c.is_for_sale or c.is_for_rent))
    )
  order by c.id
  limit  least(greatest(coalesce(p_limit, 5000), 1), 50000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.get_sitemap_cars(integer, integer, text)
  is 'Активные объявления для sitemap.xml. По умолчанию both — в карту попадают и продажа, и аренда';

grant execute on function public.get_sitemap_cars(integer, integer, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 6) get_site_stats — счётчики по обеим витринам
-- ------------------------------------------------------------
drop function if exists public.get_site_stats();

create or replace function public.get_site_stats()
returns table (
  cars_total    bigint,
  rent_total    bigint,
  brands_total  bigint,
  cities_total  bigint,
  dealers_total bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.cars
      where status = 'active' and is_for_sale),
    (select count(*) from public.cars
      where status = 'active' and is_for_rent),
    (select count(distinct public.f_slugify(brand)) from public.cars
      where status = 'active' and (is_for_sale or is_for_rent)),
    (select count(distinct public.f_slugify(city)) from public.cars
      where status = 'active' and (is_for_sale or is_for_rent)),
    (select count(distinct c.user_id)
      from public.cars c
      join public.profiles p on p.id = c.user_id
      where c.status = 'active' and (c.is_for_sale or c.is_for_rent)
        and p.seller_kind = 'dealer');
$$;

comment on function public.get_site_stats()
  is 'Счётчики для главной: объявления о продаже, об аренде, марки, города, дилеры';

grant execute on function public.get_site_stats() to anon, authenticated;


-- ------------------------------------------------------------
-- 7) create_car_v3 — подача с раздельными ценами и депозитом
-- ------------------------------------------------------------
-- Отличия от v2 (её оставляем нетронутой для приложения):
--   * p_sale_price и p_rent_price_daily вместо одного price;
--   * p_deposit_amount — залог, которого в v2 не было вовсе
--     (объявления создавались с deposit_amount = 0);
--   * проверка соответствия цен выбранному типу выполняется здесь,
--     до вставки, чтобы вернуть понятную ошибку вместо нарушения
--     табличного constraint.
--
-- Цена может быть NULL — это «Договорная», допустимое состояние.
-- Но для аренды NULL опаснее: суточная ставка — основной параметр
-- выбора, поэтому для 'rent' и 'both' она обязательна (этого же
-- требует constraint chk_rent_price на таблице).
create or replace function public.create_car_v3(
  p_listing_type     text,
  p_brand            text,
  p_model            text,
  p_year             integer,
  p_mileage          integer,
  p_sale_price       numeric,
  p_rent_price_daily numeric,
  p_deposit_amount   numeric,
  p_currency         text,
  p_city             text,
  p_lat              double precision,
  p_lng              double precision,
  p_photo_urls       text[],
  p_body_type        body_type         default null,
  p_transmission     transmission_type default null,
  p_fuel             fuel_type         default null,
  p_description      text              default null,
  p_phone            text              default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_car_id   uuid;
  v_is_sale  boolean := false;
  v_is_rent  boolean := false;
  v_location geography(point, 4326);
  v_url      text;
  v_idx      integer := 0;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация для создания объявления'
      using errcode = 'insufficient_privilege';
  end if;

  if p_listing_type = 'sale' then
    v_is_sale := true;
  elsif p_listing_type = 'rent' then
    v_is_rent := true;
  elsif p_listing_type = 'both' then
    v_is_sale := true;
    v_is_rent := true;
  else
    raise exception 'Некорректный listing_type = % (ожидалось sale/rent/both)', p_listing_type
      using errcode = 'check_violation';
  end if;

  -- Суточная ставка обязательна везде, где объявление сдаётся.
  if v_is_rent and p_rent_price_daily is null then
    raise exception 'Для аренды требуется цена за сутки'
      using errcode = 'check_violation';
  end if;

  if p_rent_price_daily is not null and p_rent_price_daily <= 0 then
    raise exception 'Цена аренды должна быть больше нуля'
      using errcode = 'check_violation';
  end if;

  if p_sale_price is not null and p_sale_price <= 0 then
    raise exception 'Цена продажи должна быть больше нуля'
      using errcode = 'check_violation';
  end if;

  if p_deposit_amount is not null and p_deposit_amount < 0 then
    raise exception 'Залог не может быть отрицательным'
      using errcode = 'check_violation';
  end if;

  if p_lat is not null and p_lng is not null then
    v_location := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    body_type, transmission, fuel,
    currency, sale_price, rent_price_daily, deposit_amount,
    city, description, contact_phone, location
  )
  values (
    v_user_id, v_is_sale, v_is_rent,
    p_brand, p_model, p_year, p_mileage,
    p_body_type, p_transmission, p_fuel,
    coalesce(p_currency, 'EUR')::currency_code,
    -- Цену продажи сохраняем только когда объявление действительно
    -- продаётся: иначе в базе останется «висящая» цена, которая всплывёт
    -- при смене типа объявления.
    case when v_is_sale then p_sale_price end,
    case when v_is_rent then p_rent_price_daily end,
    -- Залог осмыслен только для аренды. not null default 0 на колонке.
    case when v_is_rent then coalesce(p_deposit_amount, 0) else 0 end,
    p_city,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    v_location
  )
  returning id into v_car_id;

  if p_photo_urls is not null then
    foreach v_url in array p_photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (v_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_car_id;
end;
$$;

comment on function public.create_car_v3(
  text, text, text, integer, integer, numeric, numeric, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text)
  is 'Подача объявления с сайта: раздельные цены продажи и аренды, залог. create_car_v2 не заменяет — её использует приложение';

grant execute on function public.create_car_v3(
  text, text, text, integer, integer, numeric, numeric, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text) to authenticated;
