-- ============================================================
-- AUTO.RS — Миграция 0057: перемешка смешанного фида, анти-дубль в v3,
--                          разделение демо-гибридов
-- ============================================================
-- Три независимые задачи, объединённые в одну миграцию, потому что все
-- три касаются одного сценария: смешанной ленты каталога на сайте.
--
-- 1) ПОРЯДОК ФИДА. Раньше выдача без явной сортировки шла по created_at,
--    а демо-аренда создавалась позже продажи — в результате лента
--    выглядела как «сначала все арендные, потом все продажные».
--    Группировка по типу сделки — не то, что должен видеть посетитель
--    смешанного каталога.
--
--    Новый порядок при p_sort = 'fresh':
--      промо (is_vip + не истёкший boosted_until) — сплошным блоком,
--      затем md5(id || current_date) — псевдослучайно.
--
--    ПОЧЕМУ current_date, А НЕ now(): порядок обязан быть СТАБИЛЕН
--    в течение суток. Краулер, обходящий каталог несколько раз за день,
--    должен видеть одну и ту же выдачу — иначе он считает страницу
--    нестабильной, а объявления кочуют между страницами пагинации и
--    часть не индексируется вовсе. Ровно та же причина, по которой на
--    сайте отключён seed-шафл приложения. При этом назавтра дата меняется
--    и лента обновляется — объявления получают новый шанс попасть наверх.
--
--    Явная сортировка (цена/год/пробег) работает как обычно: пользователь
--    попросил конкретный порядок, перемешивать его нельзя.
--
-- 2) АНТИ-ДУБЛЬ В create_car_v3. Проверка из 0037/0049 живёт только в
--    create_car_v2, которую вызывает приложение. Подача с сайта идёт
--    через v3 и до сих пор НЕ проверялась вовсе — двойной тап
--    «Опубликовать» создавал два объявления. Переносим ту же логику.
--
--    Тип сделки входит в условие через флаги is_for_sale/is_for_rent,
--    поэтому продажа и аренда одной машины дублями НЕ считаются:
--    у продажи (true, false), у аренды (false, true) — наборы разные,
--    условие не срабатывает, оба объявления публикуются. Это и есть
--    требуемое поведение «одна машина — две карточки».
--
-- 3) ДЕМО-ГИБРИДЫ. Два демо-объявления были выставлены одновременно на
--    продажу и в аренду. После отказа от типа «и то и другое» в форме
--    подачи такого состояния у новых объявлений не будет, а старое
--    ломает чтение микса. Разделяем каждое на две отдельные карточки.
-- ============================================================


-- ------------------------------------------------------------
-- 1) search_cars_public: перемешка в дефолтной сортировке
-- ------------------------------------------------------------
-- Сигнатура не меняется — только выражение в order by, поэтому
-- create or replace достаточно, drop не нужен.
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
      case
        when p_listing_type in ('sale', 'rent', 'both')
        then p_listing_type
        else 'sale'
      end as mode,
      -- Соль перемешки: одна на сутки. Меняется в полночь по времени
      -- сервера, и лента обновляется сама, без вмешательства.
      current_date::text as shuffle_salt
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
    -- УРОВЕНЬ 0: продвижение. Действует во всех режимах сортировки по
    -- умолчанию; при явной сортировке промо наверх не поднимается —
    -- пользователь попросил конкретный порядок.
    case when p.sort_key = 'fresh' then f.promoted_now end desc nulls last,

    -- УРОВЕНЬ 1: явная сортировка, если её выбрал пользователь.
    case when p.sort_key = 'price_asc'   then f.active_price end asc  nulls last,
    case when p.sort_key = 'price_desc'  then f.active_price end desc nulls last,
    case when p.sort_key = 'year_desc'   then f.year         end desc nulls last,
    case when p.sort_key = 'year_asc'    then f.year         end asc  nulls last,
    case when p.sort_key = 'mileage_asc' then f.mileage      end asc  nulls last,

    -- УРОВЕНЬ 2: перемешка для дефолтной выдачи. Порядок псевдослучайный,
    -- но одинаковый в течение суток — см. пояснение в шапке миграции.
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
  text, text, text, text, integer, integer, text)
  is 'Каталог сайта: промо → перемешка md5(id||current_date) в дефолтной выдаче (стабильна сутки), либо явная сортировка. total_count для пагинации';

grant execute on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 2) create_car_v3: защита от дублей
-- ------------------------------------------------------------
-- Логика перенесена из 0049 (актуальная версия для create_car_v2):
-- дублем считается объявление того же продавца с совпадением марки,
-- модели, года, ТИПА СДЕЛКИ, пробега и цены, в статусе moderation
-- или active.
--
-- Продажа и аренда одной машины проходят обе: пары флагов
-- (is_for_sale, is_for_rent) у них разные — (true,false) и (false,true).
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

  -- Тип сделки. 'both' по-прежнему принимается на уровне БД: приложение
  -- умеет создавать такие объявления через create_car_v2, и запрещать их
  -- здесь значило бы разойтись с ним. Форма подачи на сайте предлагает
  -- только 'sale' и 'rent' — это ограничение интерфейса, не схемы.
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

  -- ---------- Защита от дублей ----------
  -- is not distinct from вместо =: пробег и цена необязательны, а
  -- обычное сравнение с NULL даёт NULL, и два объявления без цены
  -- не считались бы дублями.
  if exists (
    select 1
    from public.cars c
    where c.user_id = v_user_id
      and lower(btrim(c.brand)) = lower(btrim(p_brand))
      and lower(btrim(c.model)) = lower(btrim(p_model))
      and c.year = p_year
      -- Тип сделки: именно это условие разрешает подать продажу и
      -- аренду одной машины двумя отдельными объявлениями.
      and c.is_for_sale = v_is_sale
      and c.is_for_rent = v_is_rent
      and c.mileage is not distinct from p_mileage
      -- Сравниваем ту цену, которая относится к типу сделки.
      and (
        (v_is_rent and not v_is_sale
          and c.rent_price_daily is not distinct from p_rent_price_daily)
        or (v_is_sale and not v_is_rent
          and c.sale_price is not distinct from p_sale_price)
        or (v_is_sale and v_is_rent
          and c.sale_price is not distinct from p_sale_price
          and c.rent_price_daily is not distinct from p_rent_price_daily)
      )
      and c.status in ('moderation', 'active')
  ) then
    raise exception
      'У вас уже есть такое объявление (%, % %, % г.). Дождитесь модерации или отредактируйте существующее.',
      case when v_is_rent and not v_is_sale then 'аренда' else 'продажа' end,
      p_brand, p_model, p_year
      using errcode = 'unique_violation';
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
    case when v_is_sale then p_sale_price end,
    case when v_is_rent then p_rent_price_daily end,
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
  is 'Подача с сайта: раздельные цены, залог, защита от дублей (тип сделки в условии — продажа и аренда одной машины разрешены)';

grant execute on function public.create_car_v3(
  text, text, text, integer, integer, numeric, numeric, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text) to authenticated;


-- ------------------------------------------------------------
-- 3) Разделение демо-гибридов на две карточки
-- ------------------------------------------------------------
-- ТОЛЬКО ДЛЯ DEV/STAGING, как и сиды 0054/0056: блок работает
-- исключительно с демо-продавцом и записями, помеченными [DEMO].
-- На боевой базе демо-данных нет, и блок просто ничего не найдёт.
--
-- Для каждого гибрида: создаём отдельное арендное объявление (копия с
-- ценой аренды и залогом), а исходное превращаем в чистую продажу.
-- Фотографии копируются, чтобы обе карточки выглядели одинаково.
do $$
declare
  v_user_id uuid := '00000000-0000-4000-a000-0000000000de';
  r         record;
  v_new_id  uuid;
begin
  for r in
    select *
    from public.cars
    where user_id = v_user_id
      and description like '%[DEMO]%'
      and is_for_sale
      and is_for_rent
  loop
    -- Новая карточка: только аренда.
    insert into public.cars (
      user_id, is_for_sale, is_for_rent,
      brand, model, year, mileage,
      body_type, transmission, fuel,
      currency, sale_price, rent_price_daily, deposit_amount,
      city, description, status, contact_phone, created_at
    )
    values (
      r.user_id, false, true,
      r.brand, r.model, r.year, r.mileage,
      r.body_type, r.transmission, r.fuel,
      r.currency, null, r.rent_price_daily, r.deposit_amount,
      r.city,
      '[DEMO] ' || r.brand || ' ' || r.model || ', ' || r.year ||
        '. Rent-a-car: puno kasko osiguranje, neograničena kilometraža, ' ||
        'preuzimanje u centru grada. Depozit ' || r.deposit_amount::text || ' EUR.',
      'active',
      r.contact_phone,
      -- Сдвигаем на минуту, чтобы created_at не совпадал с исходным.
      r.created_at + interval '1 minute'
    )
    returning id into v_new_id;

    -- Копируем фотографии на новую карточку.
    insert into public.car_images (car_id, image_url, order_index)
    select v_new_id, ci.image_url, ci.order_index
    from public.car_images ci
    where ci.car_id = r.id;

    -- Исходное объявление становится чистой продажей.
    update public.cars
    set is_for_rent      = false,
        rent_price_daily = null,
        deposit_amount   = 0,
        description      = '[DEMO] ' || r.brand || ' ' || r.model || ', ' ||
                           r.year || '. Redovno održavan, prvi vlasnik, ' ||
                           'servisna knjiga. Registrovan.'
    where id = r.id;
  end loop;
end $$;


-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ
-- ============================================================
-- Гибридов не должно остаться (hybrids = 0), общее число объявлений
-- вырастет на число разделённых (было 33 → станет 35):
--
--   select
--     count(*) filter (where is_for_sale and is_for_rent)     as hybrids,
--     count(*) filter (where is_for_sale and not is_for_rent) as sale_only,
--     count(*) filter (where is_for_rent and not is_for_sale) as rent_only,
--     count(*)                                                as total
--   from public.cars
--   where user_id = '00000000-0000-4000-a000-0000000000de';
--
-- Удаление демо-данных — по-прежнему docs/cleanup_demo.sql: новые
-- карточки созданы тем же продавцом и с меткой [DEMO].
-- ============================================================
