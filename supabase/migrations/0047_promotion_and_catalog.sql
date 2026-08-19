-- ============================================================
-- AUTO.RS — Миграция 0047 (ЭТАП 0, ПАКЕТ D): продвижение и каталог
-- ============================================================
-- Продвижение объявления: платная (в будущем) услуга подъёма в выдаче.
-- НА ЭТАПЕ 0 ДЕНЬГИ ВЫКЛЮЧЕНЫ — активация работает только в режиме
-- «подарок»: списания с баланса нет, в кошельке фиксируется gift-транзакция
-- на 0 EUR... точнее, на символическую сумму (см. ниже причину), а paywall
-- не добавляется и не проектируется.
--
-- Состав:
--   1) поля cars.is_vip / cars.boosted_until + индекс;
--   2) RPC activate_promotion (режим «подарок»);
--   3) search_cars_advanced v5: промо-блок первым уровнем сортировки;
--   4) проверка нормализации и PostGIS-радиуса.
-- ============================================================


-- ============================================================
-- 1) ПОЛЯ ПРОДВИЖЕНИЯ В cars
-- ============================================================
-- Два поля вместо одного намеренно:
--   is_vip        — признак «объявление продвигается» (быстрый флаг для UI:
--                   значок VIP на карточке);
--   boosted_until — до какого момента действует продвижение.
--
-- Источник истины при сортировке — ОБА поля вместе: is_vip = true и
-- boosted_until > now(). Одного флага мало (он не истекает сам), одной даты
-- мало (нельзя отличить «никогда не продвигалось» от «истекло») — а главное,
-- пара позволяет снять продвижение мгновенно, не трогая дату.
alter table public.cars
  add column if not exists is_vip        boolean     not null default false,
  add column if not exists boosted_until timestamptz;

comment on column public.cars.is_vip
  is 'Признак продвижения. Действует только вместе с boosted_until > now()';
comment on column public.cars.boosted_until
  is 'Момент окончания продвижения. NULL — объявление никогда не продвигалось';

-- Частичный индекс под первый уровень сортировки каталога: в него попадают
-- только продвигаемые объявления, которых на площадке единицы процентов.
-- Полный индекс по is_vip был бы почти целиком из false и бесполезен.
create index if not exists idx_cars_promoted
  on public.cars (boosted_until desc)
  where is_vip;


-- ============================================================
-- 2) RPC: activate_promotion(p_car_id, p_days) — включить продвижение
-- ============================================================
-- Проверки по порядку: авторизация → объявление существует → вызывающий
-- владелец → статус допускает продвижение.
--
-- Продвигать можно только активное объявление: поднимать в выдаче карточку,
-- которая ещё на модерации, отклонена или уже продана, бессмысленно.
--
-- РЕЖИМ «ПОДАРОК» (Этап 0): с баланса НИЧЕГО НЕ СПИСЫВАЕТСЯ. Вместо этого в
-- кошелёк пишется gift-транзакция — она служит журналом выданных подарков:
-- по ней видно, кто и сколько промо получил бесплатно, и позже её легко
-- отличить от платных spend-операций.
--
-- Почему сумма подарка не 0: CHECK chk_wallet_amount_nonzero из Пакета A
-- запрещает нулевые операции (строка без движения денег — мусор в истории).
-- Поэтому фиксируем НОМИНАЛЬНУЮ стоимость услуги как подарок: пользователь
-- получил на баланс условную стоимость промо и тут же её «израсходовал»
-- бесплатно. Баланс при этом растёт на номинал — на Этапе 0 это безопасно,
-- потратить его некуда (spend_balance не вызывается ниоткуда), а когда
-- включатся деньги, activate_promotion станет вызывать spend_balance и
-- парная gift-транзакция исчезнет.
--
-- Продление: повторный вызов на уже продвигаемом объявлении ДОБАВЛЯЕТ дни к
-- остатку, а не обнуляет его — иначе пользователь терял бы оплаченное время.
-- ============================================================
create or replace function public.activate_promotion(
  p_car_id uuid,
  p_days   integer default 7
)
returns public.cars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_car   public.cars;
  v_days  integer;
  v_from  timestamptz;
  -- Номинальная стоимость продвижения (EUR). На Этапе 0 не списывается —
  -- используется только как сумма подарочной транзакции. Когда подключим
  -- прайс, значение переедет в отдельную таблицу тарифов.
  v_price numeric(10,2);
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку: параллельные вызовы не должны дважды продлить срок.
  select c.* into v_car
    from public.cars c
   where c.id = p_car_id
   for update;

  if v_car.id is null then
    raise exception 'Объявление не найдено'
      using errcode = 'no_data_found';
  end if;

  if v_car.user_id <> v_user then
    raise exception 'Продвигать можно только своё объявление'
      using errcode = 'insufficient_privilege';
  end if;

  if v_car.status <> 'active' then
    raise exception 'Продвигать можно только активное объявление (текущий статус: %)',
      v_car.status
      using errcode = 'check_violation';
  end if;

  -- Срок: по умолчанию 7 дней, разумные границы против опечаток и абьюза.
  v_days := coalesce(p_days, 7);
  if v_days < 1 or v_days > 30 then
    raise exception 'Срок продвижения должен быть от 1 до 30 дней'
      using errcode = 'check_violation';
  end if;

  -- Продление: если продвижение ещё действует, отсчитываем от его окончания.
  v_from := greatest(coalesce(v_car.boosted_until, now()), now());

  -- Номинал: 1 EUR за сутки продвижения. Значение условное — прайса нет.
  v_price := (v_days * 1.00)::numeric(10,2);

  -- Журнал подарка. Списания нет: деньги на Этапе 0 выключены.
  insert into public.wallet_transactions (user_id, type, amount, description, car_id)
  values (
    v_user,
    'gift',
    v_price,
    format('Продвижение «%s %s» на %s дн. (подарок)', v_car.brand, v_car.model, v_days),
    p_car_id
  );

  update public.cars
     set is_vip        = true,
         boosted_until = v_from + make_interval(days => v_days),
         updated_at    = now()
   where id = p_car_id
  returning * into v_car;

  return v_car;
end;
$$;

comment on function public.activate_promotion(uuid, integer)
  is 'Включает продвижение своего активного объявления. Этап 0: режим «подарок», списания нет';

grant execute on function public.activate_promotion(uuid, integer) to authenticated;


-- ------------------------------------------------------------
-- Обслуживание: гасим флаг у объявлений с истёкшим сроком.
-- ------------------------------------------------------------
-- Строго говоря, сортировка и так проверяет boosted_until > now(), поэтому
-- истёкшее промо в выдачу не попадёт даже с поднятым флагом. Но флаг читает
-- ещё и UI (значок VIP на карточке), поэтому его нужно гасить — иначе
-- карточка носила бы значок бесконечно.
--
-- Вызывать по расписанию раз в сутки (см. раздел про планировщик в отчёте).
create or replace function public.expire_promotions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.cars
     set is_vip = false
   where is_vip
     and (boosted_until is null or boosted_until <= now());

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.expire_promotions()
  is 'Снимает флаг is_vip с объявлений, чьё продвижение истекло. Вызывать по расписанию';

revoke execute on function public.expire_promotions() from anon, authenticated;


-- ============================================================
-- 3) search_cars_advanced v5 — промо-блок в выдаче
-- ============================================================
-- СИГНАТУРА НЕ МЕНЯЕТСЯ: те же 20 параметров в том же порядке, что в
-- версии из 0031. Клиент трогать не нужно, PostgREST-перегрузки не возникает.
--
-- Меняется ТОЛЬКО блок ORDER BY: перед всей прежней логикой добавлен нулевой
-- уровень — активное промо.
--
-- Ключевое требование заказчика (п.4): промо НЕ должно попадать в
-- псевдослучайный шафл md5(id || seed). В прежней сортировке последней
-- строкой стоит именно md5 — он и перемешивает всю выдачу. Если бы промо
-- сортировалось только им, продвинутые объявления разбрелись бы по списку и
-- услуга потеряла смысл.
--
-- Решение: промо-объявления отделены первым выражением сортировки
-- (is_promoted desc), поэтому они всегда идут сплошным блоком в начале.
-- ВНУТРИ блока они упорядочены по boosted_until desc — свежекуплённое
-- продвижение выше, а не случайно. md5 применяется только к остальным.
--
-- Три особенности сохранены без изменений:
--   * гео-сортировка по st_distance при заданных координатах;
--   * приоритет свежих объявлений (моложе 3 дней);
--   * «бесконечная крутилка» md5(id || seed) для остальных.
-- ============================================================
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
    -- Оба условия обязательны: флаг без срока (или с истёкшим) продвижением
    -- не считается. Промо идёт сплошным блоком в начале выдачи и не
    -- участвует в шафле — это и есть смысл услуги.
    (c.is_vip and c.boosted_until is not null and c.boosted_until > now()) desc,

    -- Внутри промо-блока: чем позже куплено продвижение, тем выше.
    -- Детерминированный порядок вместо случайного.
    case
      when c.is_vip and c.boosted_until is not null and c.boosted_until > now()
      then c.boosted_until
    end desc nulls last,

    -- ---------- УРОВЕНЬ 1: БЛИЗОСТЬ (PostGIS) ----------
    case
      when not p_shuffle_all
       and (select user_point from params) is not null
       and c.location is not null
      then st_distance(c.location, (select user_point from params))
    end asc nulls last,

    -- ---------- УРОВЕНЬ 2: СВЕЖИЕ ОБЪЯВЛЕНИЯ ----------
    (not p_shuffle_all
      and c.created_at > now() - interval '3 days') desc,
    case
      when not p_shuffle_all and c.created_at > now() - interval '3 days'
      then c.created_at
    end desc,

    -- ---------- УРОВЕНЬ 3: «БЕСКОНЕЧНАЯ КРУТИЛКА» ----------
    -- Псевдослучайный, но стабильный при одном seed порядок. Промо сюда уже
    -- не попадает — оно отсортировано уровнем 0.
    md5(c.id::text || p_seed::text)
  limit  p_limit
  offset p_offset;
$$;

comment on function public.search_cars_advanced is
  'Каталог v5: промо-блок первым, затем гео → свежие → шафл. Фильтры, двуалфавитность (f_normalize), PostGIS-радиус';

grant execute on function public.search_cars_advanced(
  text, text, double precision, double precision, double precision,
  text, text, text, integer, integer, integer, numeric, numeric, text, text, text,
  integer, integer, integer, boolean
) to anon, authenticated;


-- ============================================================
-- 4) ПРОВЕРКА НОРМАЛИЗАЦИИ И POSTGIS (требование п.5)
-- ============================================================
-- Аудит показал, что обе подсистемы на месте (миграция 0003). Здесь —
-- идемпотентная страховка: если объект уже существует, ничего не произойдёт.
--
-- Нормализация двуалфавитности реализована НЕ отдельными колонками _norm,
-- а функциональными индексами поверх f_normalize. Это сознательный выбор:
-- колонки _norm потребовали бы триггеров синхронизации и backfill при каждом
-- изменении brand/model/city, а функциональный индекс не может рассинхронизироваться
-- с данными в принципе. Планировщик использует его для тех же запросов.
-- ============================================================

-- Расширения (создаются в 0001; повтор безопасен).
create extension if not exists unaccent;
create extension if not exists pg_trgm;
create extension if not exists postgis;

-- IMMUTABLE-обёртка нормализации. Обязана быть immutable, иначе её нельзя
-- использовать в индексном выражении.
create or replace function public.f_normalize(txt text)
returns text
language sql
immutable
as $$
  select lower(public.unaccent('public.unaccent', coalesce(txt, '')));
$$;

comment on function public.f_normalize(text)
  is 'Нормализация текста: unaccent + lower. Основа двуалфавитного поиска (кириллица/латиница, Đ Č Š Ž)';

-- Триграммные индексы под нечёткий поиск по нормализованным полям.
create index if not exists idx_cars_brand_norm
  on public.cars using gin (public.f_normalize(brand) gin_trgm_ops);
create index if not exists idx_cars_model_norm
  on public.cars using gin (public.f_normalize(model) gin_trgm_ops);
create index if not exists idx_cars_city_norm
  on public.cars using gin (public.f_normalize(city) gin_trgm_ops);

-- Геоиндекс под st_dwithin / st_distance («машины рядом со мной»).
create index if not exists idx_cars_location
  on public.cars using gist (location);


-- ============================================================
-- 5) КАБИНЕТ ПРОДАВЦА: статус продвижения в списке объявлений
-- ============================================================
-- get_my_listings_stats из Пакета B возвращала метрики без сведений о промо,
-- поэтому кабинет не смог бы показать, продвигается ли объявление сейчас, и
-- до какого момента. Добавляем два поля; остальной контракт не меняется.
--
-- Сигнатура returns table меняется, поэтому функцию нужно удалить перед
-- пересозданием: CREATE OR REPLACE не умеет менять состав возвращаемых
-- колонок и упал бы с ошибкой.
-- ============================================================
drop function if exists public.get_my_listings_stats();

create or replace function public.get_my_listings_stats()
returns table (
  car_id      uuid,
  brand       text,
  model       text,
  year        integer,
  city        text,
  status      text,
  sale_price  numeric,
  rent_price_daily numeric,
  currency    text,
  photo_url   text,
  views       integer,
  favorites   integer,
  contacts    integer,
  is_promoted boolean,
  boosted_until timestamptz,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.brand,
    c.model,
    c.year,
    c.city,
    c.status::text,
    c.sale_price,
    c.rent_price_daily,
    c.currency::text,
    (select ci.image_url from public.car_images ci
      where ci.car_id = c.id
      order by ci.order_index asc
      limit 1) as photo_url,
    coalesce(s.views, 0),
    coalesce(s.favorites, 0),
    coalesce(s.contacts, 0),
    -- Действует ли продвижение прямо сейчас: флаг сам по себе не истекает,
    -- поэтому проверяем его вместе со сроком.
    (c.is_vip and c.boosted_until is not null and c.boosted_until > now()),
    c.boosted_until,
    c.created_at
  from public.cars c
  left join public.listing_stats s on s.car_id = c.id
  where c.user_id = auth.uid()
  order by c.created_at desc;
$$;

comment on function public.get_my_listings_stats()
  is 'Мои объявления со статистикой и статусом продвижения — для кабинета продавца';

grant execute on function public.get_my_listings_stats() to authenticated;
