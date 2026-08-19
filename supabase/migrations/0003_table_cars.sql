-- ============================================================
-- AUTO.RS — Миграция 0003: Таблица cars (объявления об авто)
-- ============================================================
-- Гибридная таблица: одно объявление может одновременно быть
-- и на продажу (is_for_sale), и в аренду (is_for_rent).
-- ============================================================

create table public.cars (
  id                uuid          primary key default uuid_generate_v4(),
  user_id           uuid          not null references public.profiles (id) on delete cascade, -- владелец объявления

  -- Флаги назначения (машина может продаваться, сдаваться или и то и другое)
  is_for_sale       boolean       not null default false,
  is_for_rent       boolean       not null default false,

  -- Характеристики автомобиля (UTF-8 для сербских названий)
  brand             text          not null,            -- марка
  model             text          not null,            -- модель
  year              integer       not null,            -- год выпуска
  mileage           integer,                           -- пробег, км
  body_type         body_type,                         -- тип кузова
  transmission      transmission_type,                 -- коробка передач
  fuel              fuel_type,                          -- тип топлива

  -- Финансы (numeric — деньги НИКОГДА не хранятся во float)
  currency          currency_code not null default 'EUR',   -- валюта расчётов, по умолчанию EUR
  sale_price        numeric(12,2),                           -- цена продажи
  rent_price_daily  numeric(12,2),                           -- цена аренды в сутки
  deposit_amount    numeric(12,2) not null default 0,        -- залог: прибавляется к чеку, комиссией НЕ облагается

  -- Локация и контент
  city              text          not null,            -- город (UTF-8)
  description       text,                              -- описание

  -- Геолокация (PostGIS) для поиска по радиусу. Заполняется опционально.
  -- SRID 4326 — стандартные широта/долгота (WGS 84).
  location          geography(point, 4326),

  -- Служебное. По умолчанию moderation — объявление ждёт одобрения админом.
  status            car_status    not null default 'moderation',
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),

  -- Гарантии целостности бизнес-логики на уровне БД:
  constraint chk_purpose     check (is_for_sale or is_for_rent),                       -- хотя бы одна цель
  constraint chk_sale_price  check (not is_for_sale or sale_price is not null),        -- продаётся → есть цена продажи
  constraint chk_rent_price  check (not is_for_rent or rent_price_daily is not null),  -- сдаётся → есть цена аренды
  constraint chk_deposit     check (deposit_amount >= 0),
  constraint chk_year        check (year between 1900 and extract(year from now())::int + 1)
);

comment on table public.cars is 'Объявления об автомобилях (продажа и/или аренда)';


-- ============================================================
-- ИНДЕКСЫ под самые частые фильтры маркетплейса
-- ============================================================
create index idx_cars_user_id     on public.cars (user_id);
create index idx_cars_status      on public.cars (status);

-- Частичные индексы: компактнее и быстрее для фильтров "только аренда" / "только продажа"
create index idx_cars_for_sale    on public.cars (is_for_sale) where is_for_sale;
create index idx_cars_for_rent    on public.cars (is_for_rent) where is_for_rent;

create index idx_cars_city        on public.cars (city);
create index idx_cars_brand_model on public.cars (brand, model);

-- Геоиндекс (PostGIS) для поиска "рядом со мной"
create index idx_cars_location    on public.cars using gist (location);

-- ============================================================
-- НОРМАЛИЗАЦИЯ ТЕКСТА для двуалфавитного поиска (кириллица/латиница).
-- Требование CLAUDE.md: марка/модель/город должны нормализоваться.
-- Триграммные индексы поверх unaccent+lower дают быстрый нечёткий поиск
-- независимо от диакритики (Đ, Č, Š, Ž) и регистра.
-- IMMUTABLE-обёртка над unaccent нужна, чтобы функцию можно было
-- использовать в индексном выражении.
-- ============================================================
create or replace function public.f_normalize(txt text)
returns text
language sql
immutable
as $$
  select lower(public.unaccent('public.unaccent', coalesce(txt, '')));
$$;

create index idx_cars_brand_norm on public.cars using gin (public.f_normalize(brand) gin_trgm_ops);
create index idx_cars_model_norm on public.cars using gin (public.f_normalize(model) gin_trgm_ops);
create index idx_cars_city_norm  on public.cars using gin (public.f_normalize(city)  gin_trgm_ops);
