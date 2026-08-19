-- ============================================================
-- AUTO.RS — СВОДНЫЙ SQL ВСЕХ МИГРАЦИЙ (0001–0026)
-- ============================================================
-- Сгенерировано автоматически из supabase/migrations/.
-- ПОРЯДОК ВАЖЕН — выполнять сверху вниз в Supabase SQL Editor.
--
-- ВНИМАНИЕ: если выполняете ВЕСЬ файл разом и получаете ошибку вида
-- 'unsafe use of new value of enum' — выполните файл ДВУМЯ частями:
-- сначала до маркера [SPLIT POINT], нажмите Run, затем остальное.
-- Причина: ALTER TYPE ADD VALUE (paid/draft) нельзя использовать в той
-- же транзакции, где значение объявлено.
-- ============================================================


-- ############################################################
-- >>> МИГРАЦИЯ: 0001_extensions_and_enums.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0001: Расширения и перечисляемые типы (ENUM)
-- Рынок: Сербия. Валюта БД по умолчанию: EUR. Кодировка: UTF-8.
-- ============================================================
-- Назначение файла: подключаем необходимые расширения PostgreSQL
-- и объявляем все ENUM-типы проекта. Это фундамент — выполняется
-- ПЕРВЫМ, до создания таблиц.
-- ============================================================

-- ---------- РАСШИРЕНИЯ ----------
-- uuid-ossp — генерация UUID (в Supabase обычно уже включено)
create extension if not exists "uuid-ossp";

-- btree_gist — необходим для составного GiST-индекса в EXCLUDE-констрейнте,
-- который физически запрещает пересечение дат аренды по одной машине.
create extension if not exists "btree_gist";

-- unaccent — снятие диакритики для нормализации сербского текста
-- (Đ, Č, Š, Ž → d, c, s, z). Используется в поиске по маркам/моделям/городам.
create extension if not exists "unaccent";

-- pg_trgm — триграммный поиск (нечёткое совпадение, LIKE/ILIKE по индексу).
-- Помогает при двуалфавитном поиске и опечатках.
create extension if not exists "pg_trgm";

-- postgis — геолокация и поиск по радиусу ("машины рядом в Белграде/Нови-Саде").
-- Требование CLAUDE.md по специфике авто-рынка Сербии.
create extension if not exists "postgis";


-- ============================================================
-- ПЕРЕЧИСЛЯЕМЫЕ ТИПЫ (ENUM)
-- Защищают БД от некорректных значений и удобно биндятся
-- в выпадающие списки (Dropdown) FlutterFlow.
-- ============================================================

-- Роль пользователя в системе
create type user_role as enum ('client', 'seller', 'admin');

-- Статус объявления:
--   moderation — по умолчанию сразу после создания (ждёт одобрения админом),
--   active     — одобрено админом (видно всем в поиске),
--   archived   — скрыто владельцем,
--   rejected   — отклонено модератором,
--   sold       — продано (для блока купли/продажи).
create type car_status as enum ('moderation', 'active', 'archived', 'rejected', 'sold');

-- Тип кузова
create type body_type as enum (
  'sedan', 'hatchback', 'suv', 'crossover', 'coupe',
  'wagon', 'minivan', 'pickup', 'convertible', 'van'
);

-- Тип коробки передач
create type transmission_type as enum ('manual', 'automatic', 'robot', 'variator');

-- Тип топлива
create type fuel_type as enum ('petrol', 'diesel', 'hybrid', 'electric', 'gas');

-- Статус брони:
--   pending   — заявка подана (даты НЕ блокируются),
--   confirmed — подтверждена владельцем (даты жёстко блокируются),
--   rejected  — отклонена владельцем,
--   cancelled — отменена клиентом,
--   completed — аренда завершена.
create type booking_status as enum ('pending', 'confirmed', 'rejected', 'cancelled', 'completed');

-- Валюта расчётов (по умолчанию EUR для рынка Сербии; RSD — для показа на клиенте)
create type currency_code as enum ('EUR', 'RSD');


-- ############################################################
-- >>> МИГРАЦИЯ: 0002_table_profiles.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0002: Таблица profiles (профили пользователей)
-- ============================================================
-- Расширяет системную таблицу auth.users (стандарт Supabase).
-- id профиля = id пользователя из системы аутентификации.
-- ============================================================

create table public.profiles (
  id            uuid          primary key references auth.users (id) on delete cascade,
  email         text          not null unique,
  full_name     text,                                  -- ФИО (UTF-8: кириллица/латиница)
  phone         text,                                  -- телефон (текст: возможны +, коды стран)
  role          user_role     not null default 'client',
  avatar_url    text,                                  -- ссылка на аватар (Supabase Storage)
  created_at    timestamptz   not null default now(),  -- дата регистрации
  updated_at    timestamptz   not null default now()
);

comment on table public.profiles is 'Профили пользователей, расширяют auth.users';


-- ============================================================
-- АВТО-СОЗДАНИЕ ПРОФИЛЯ при регистрации нового пользователя.
-- Триггер на auth.users: как только Supabase создаёт запись в auth.users,
-- автоматически создаётся связанная строка в public.profiles.
-- Это избавляет фронтенд FlutterFlow от ручного создания профиля.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer                 -- выполняется с правами владельца: нужен доступ к public.profiles
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    -- Пытаемся достать имя из метаданных регистрации (если фронтенд их передал)
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  );
  return new;
end;
$$;

-- Вешаем триггер на системную таблицу auth.users
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ############################################################
-- >>> МИГРАЦИЯ: 0003_table_cars.sql
-- ############################################################

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


-- ############################################################
-- >>> МИГРАЦИЯ: 0004_table_car_images.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0004: Таблица car_images (фото объявлений)
-- ============================================================
-- Один автомобиль — много фото (связь 1:N).
-- Ссылки указывают на файлы в Supabase Storage.
-- ============================================================

create table public.car_images (
  id           uuid         primary key default uuid_generate_v4(),
  car_id       uuid         not null references public.cars (id) on delete cascade, -- при удалении авто фото удаляются каскадно
  image_url    text         not null,                 -- ссылка на файл в Supabase Storage
  order_index  integer      not null default 0,       -- порядок отображения фото в галерее
  created_at   timestamptz  not null default now()
);

comment on table public.car_images is 'Фотографии объявлений (1:N к cars)';

-- Индекс покрывает выборку фото конкретной машины в правильном порядке
create index idx_car_images_car_id on public.car_images (car_id, order_index);


-- ############################################################
-- >>> МИГРАЦИЯ: 0005_table_bookings.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0005: Таблица bookings (бронирования аренды)
-- ============================================================
-- Модель подтверждения: "Заявка → Ручное подтверждение владельцем".
-- Финансовые поля (rent_subtotal, platform_commission, total_price)
-- заполняются ТОЛЬКО триггером на сервере — клиент их не передаёт
-- (защита от подмены цены во FlutterFlow). См. миграцию 0006.
-- ============================================================

create table public.bookings (
  id                  uuid            primary key default uuid_generate_v4(),
  car_id              uuid            not null references public.cars (id) on delete cascade,
  customer_id         uuid            not null references public.profiles (id) on delete cascade, -- кто арендует

  start_date          date            not null,        -- дата начала аренды (включительно)
  end_date            date            not null,        -- дата окончания аренды (включительно)

  -- Финансовые поля. Заполняются триггером calc_booking_totals (миграция 0006).
  -- Клиент из FlutterFlow эти значения передать не может — они перезаписываются на сервере.
  rent_subtotal       numeric(12,2)   not null default 0,   -- кол-во суток × rent_price_daily
  platform_commission numeric(12,2)   not null default 0,   -- 10% от rent_subtotal (комиссия платформы)
  deposit_amount      numeric(12,2)   not null default 0,   -- залог: снимок из cars на момент брони
  total_price         numeric(12,2)   not null default 0,   -- rent_subtotal + platform_commission (депозит показывается отдельно)
  currency            currency_code   not null default 'EUR',

  status              booking_status  not null default 'pending',
  created_at          timestamptz     not null default now(),
  updated_at          timestamptz     not null default now(),

  -- Дата окончания не может быть раньше даты начала
  constraint chk_booking_dates check (end_date >= start_date)
);

comment on table public.bookings is 'Бронирования аренды. Финансы считает триггер, не клиент';

create index idx_bookings_car_id      on public.bookings (car_id);
create index idx_bookings_customer_id on public.bookings (customer_id);
create index idx_bookings_status      on public.bookings (status);


-- ============================================================
-- ЗАЩИТА ОТ ОВЕРБУКИНГА (главный уровень — на уровне БД).
-- Даты блокируются ТОЛЬКО подтверждёнными бронями (confirmed).
-- pending-заявки календарь НЕ занимают: несколько клиентов могут
-- подать заявку на одни даты, а владелец подтвердит одну.
-- EXCLUDE физически не даст записать вторую confirmed-бронь
-- на пересекающиеся даты (защита от race condition).
-- daterange('[]') — обе границы включительно (день выезда занят целиком).
-- ============================================================
alter table public.bookings
  add constraint excl_no_overlap_confirmed
  exclude using gist (
    car_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
  where (status = 'confirmed');


-- ############################################################
-- >>> МИГРАЦИЯ: 0006_functions_and_triggers.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0006: Бизнес-логика (Thick Backend)
-- ============================================================
-- Вся критическая логика на стороне Supabase (требование CLAUDE.md):
--   1) расчёт стоимости брони на сервере (триггер),
--   2) проверка доступности машины на даты (RPC для FlutterFlow),
--   3) авто-обновление updated_at.
-- ============================================================


-- ============================================================
-- 1) РАСЧЁТ СТОИМОСТИ БРОНИ НА СЕРВЕРЕ (триггер before insert/update)
-- ------------------------------------------------------------
-- Формула:
--   rent_subtotal       = кол-во суток × rent_price_daily
--   platform_commission = rent_subtotal × 10%
--   total_price         = rent_subtotal + platform_commission
--   deposit_amount      = снимок из cars (в total НЕ входит, комиссией НЕ облагается)
-- Клиент передаёт только car_id, customer_id, start_date, end_date.
-- Все денежные поля перезаписываются здесь — подмена цены невозможна.
-- ============================================================
create or replace function public.calc_booking_totals()
returns trigger
language plpgsql
as $$
declare
  v_daily     numeric(12,2);
  v_deposit   numeric(12,2);
  v_currency  currency_code;
  v_days      integer;
  v_commission_rate constant numeric := 0.10;  -- фиксированная комиссия платформы 10% (MVP)
begin
  -- Тянем актуальную дневную цену, залог и валюту из объявления
  select rent_price_daily, deposit_amount, currency
    into v_daily, v_deposit, v_currency
  from public.cars
  where id = new.car_id;

  if v_daily is null then
    raise exception 'У объявления % не задана цена аренды (rent_price_daily)', new.car_id;
  end if;

  -- Кол-во суток. Границы включительны: с 1 по 5 число = 5 суток → +1.
  v_days := (new.end_date - new.start_date) + 1;

  -- Считаем финансы на сервере
  new.rent_subtotal       := v_daily * v_days;
  new.platform_commission := round(new.rent_subtotal * v_commission_rate, 2);
  new.deposit_amount      := coalesce(v_deposit, 0);
  new.total_price         := new.rent_subtotal + new.platform_commission; -- депозит показывается отдельно
  new.currency            := v_currency;
  new.updated_at          := now();

  return new;
end;
$$;

-- Пересчёт при вставке и при изменении дат/машины
create trigger trg_bookings_calc_totals
  before insert or update of start_date, end_date, car_id on public.bookings
  for each row execute function public.calc_booking_totals();


-- ============================================================
-- 2) ПРОВЕРКА ДОСТУПНОСТИ (RPC для вызова из FlutterFlow)
-- ------------------------------------------------------------
-- Возвращает TRUE, если машина свободна на весь период [p_start; p_end].
-- Свободно = нет пересечений с ПОДТВЕРЖДЁННЫМИ (confirmed) бронями.
-- pending-заявки доступность не блокируют.
-- Вызов из FlutterFlow: Supabase RPC → is_car_available.
-- ============================================================
create or replace function public.is_car_available(
  p_car_id uuid,
  p_start  date,
  p_end    date
)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1
    from public.bookings b
    where b.car_id = p_car_id
      and b.status = 'confirmed'   -- только подтверждённые брони блокируют даты
      and daterange(b.start_date, b.end_date, '[]')
          && daterange(p_start, p_end, '[]')
  );
$$;


-- ============================================================
-- 3) АВТО-ОБНОВЛЕНИЕ updated_at
-- ------------------------------------------------------------
-- Универсальный триггер: при любом UPDATE проставляет updated_at = now().
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_cars_updated_at
  before update on public.cars
  for each row execute function public.set_updated_at();


-- ############################################################
-- >>> МИГРАЦИЯ: 0007_rls_policies.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0007: Row Level Security (RLS)
-- ============================================================
-- Требование CLAUDE.md: для КАЖДОЙ таблицы включаем RLS.
-- По умолчанию доступ закрыт; чтение/запись — строго по auth.uid().
-- После включения RLS без политик доступ закрыт полностью.
-- ============================================================

alter table public.profiles   enable row level security;
alter table public.cars       enable row level security;
alter table public.car_images enable row level security;
alter table public.bookings   enable row level security;


-- ============================================================
-- ТАБЛИЦА: cars
-- ============================================================

-- SELECT (публично): гость/анон видит ТОЛЬКО активные объявления.
-- moderation/archived/rejected/sold для чужих скрыты.
create policy "cars_select_active_public" on public.cars
  for select using (status = 'active');

-- SELECT (владелец): видит ВСЕ свои объявления, включая
-- moderation/archived/rejected (иначе не увидит свои неактивные).
-- Несколько SELECT-политик объединяются по OR.
create policy "cars_select_own_all" on public.cars
  for select to authenticated using (auth.uid() = user_id);

-- INSERT: создавать можно только от своего имени
-- (with check не даст подставить чужой user_id).
create policy "cars_insert_own" on public.cars
  for insert to authenticated with check (auth.uid() = user_id);

-- UPDATE: править можно только свои строки.
create policy "cars_update_own" on public.cars
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE: удалять можно только свои строки.
create policy "cars_delete_own" on public.cars
  for delete to authenticated using (auth.uid() = user_id);


-- ============================================================
-- ТАБЛИЦА: profiles
-- ============================================================
-- Каждый видит и правит только свой профиль.
-- (Роль 'admin' и публичный просмотр контактов продавца
--  добавим отдельными политиками на следующем шаге при необходимости.)
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ============================================================
-- ТАБЛИЦА: car_images
-- ============================================================
-- SELECT: фото активных машин видят все (в т.ч. гость).
create policy "car_images_select_public" on public.car_images
  for select using (
    exists (
      select 1 from public.cars c
      where c.id = car_images.car_id and c.status = 'active'
    )
  );

-- ALL (insert/update/delete): управлять фото может только владелец машины.
create policy "car_images_modify_owner" on public.car_images
  for all to authenticated
  using (
    exists (
      select 1 from public.cars c
      where c.id = car_images.car_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.cars c
      where c.id = car_images.car_id and c.user_id = auth.uid()
    )
  );


-- ============================================================
-- ТАБЛИЦА: bookings
-- ============================================================
-- SELECT: бронь видят арендатор (свои) и владелец машины (брони на своё авто).
create policy "bookings_select_involved" on public.bookings
  for select to authenticated
  using (
    auth.uid() = customer_id
    or exists (
      select 1 from public.cars c
      where c.id = bookings.car_id and c.user_id = auth.uid()
    )
  );

-- INSERT: бронь создаёт только сам клиент (от своего имени).
create policy "bookings_insert_own" on public.bookings
  for insert to authenticated with check (auth.uid() = customer_id);

-- UPDATE: обновлять бронь может арендатор (отмена) ИЛИ владелец машины
-- (подтверждение/отклонение). Тонкое разграничение "кто какой статус ставит"
-- вынесем в отдельные RPC-функции (confirm/reject/cancel) на следующем шаге.
create policy "bookings_update_involved" on public.bookings
  for update to authenticated
  using (
    auth.uid() = customer_id
    or exists (
      select 1 from public.cars c
      where c.id = bookings.car_id and c.user_id = auth.uid()
    )
  );


-- ############################################################
-- >>> МИГРАЦИЯ: 0008_rpc_booking_state_machine_and_search.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0008: Статусная машина броней + двуалфавитный поиск
-- ============================================================
-- Концепция Thick Backend (CLAUDE.md): смена статуса брони и поиск —
-- это критическая логика, поэтому она реализована серверными RPC.
-- Фронтенд FlutterFlow только вызывает эти функции.
--
-- Все функции — SECURITY DEFINER: они должны читать/писать bookings и cars
-- в обход RLS, но при этом САМИ строго проверяют права через auth.uid().
-- set search_path = public — защита от подмены пути поиска объектов.
-- ============================================================


-- ============================================================
-- 1) confirm_booking(booking_id) — ПОДТВЕРЖДЕНИЕ брони владельцем машины
-- ------------------------------------------------------------
-- Проверки:
--   * бронь существует;
--   * вызывающий = владелец машины (cars.user_id = auth.uid());
--   * текущий статус = 'pending';
--   * блокирующая проверка (FOR UPDATE): нет ли уже других confirmed-броней,
--     пересекающихся по датам с этой машиной (защита от гонок).
-- При успехе → 'confirmed'. Иначе → EXCEPTION.
--
-- Дополнительная страховка: даже если два владельца/устройства вызовут
-- функцию одновременно, EXCLUDE-констрейнт excl_no_overlap_confirmed
-- (миграция 0005) физически не даст записать пересечение.
-- ============================================================
create or replace function public.confirm_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_owner   uuid;
  v_conflicts integer;
begin
  -- Блокируем строку брони на время транзакции (FOR UPDATE),
  -- чтобы параллельные вызовы не подтвердили одну и ту же бронь дважды.
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  -- Бронь не найдена
  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Находим владельца машины по этой броне
  select c.user_id
    into v_owner
  from public.cars c
  where c.id = v_booking.car_id;

  -- Право подтверждать есть только у владельца машины
  if v_owner is distinct from auth.uid() then
    raise exception 'Недостаточно прав: подтвердить бронь может только владелец машины'
      using errcode = 'insufficient_privilege';
  end if;

  -- Подтверждать можно только заявку в статусе pending
  if v_booking.status <> 'pending' then
    raise exception 'Бронь нельзя подтвердить: текущий статус = %, ожидался pending', v_booking.status
      using errcode = 'check_violation';
  end if;

  -- Блокирующая проверка пересечений с уже подтверждёнными бронями этой машины.
  -- FOR UPDATE на конфликтующих строках не даст им измениться до конца транзакции.
  select count(*)
    into v_conflicts
  from public.bookings b
  where b.car_id = v_booking.car_id
    and b.id <> v_booking.id
    and b.status = 'confirmed'
    and daterange(b.start_date, b.end_date, '[]')
        && daterange(v_booking.start_date, v_booking.end_date, '[]')
  for update;

  if v_conflicts > 0 then
    raise exception 'Даты уже заняты другой подтверждённой бронью на эту машину'
      using errcode = 'exclusion_violation';
  end if;

  -- Всё чисто — переводим в confirmed
  update public.bookings
     set status = 'confirmed'
   where id = v_booking.id
   returning * into v_booking;

  return v_booking;
end;
$$;

comment on function public.confirm_booking(uuid)
  is 'Подтверждение брони владельцем машины (pending → confirmed) с блокирующей проверкой овербукинга';


-- ============================================================
-- 2) reject_booking(booking_id) — ОТКЛОНЕНИЕ брони владельцем машины
-- ------------------------------------------------------------
-- Проверки: права владельца машины + текущий статус = 'pending'.
-- Результат: 'pending' → 'rejected'. Даты остаются свободными.
-- ============================================================
create or replace function public.reject_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_owner   uuid;
begin
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  select c.user_id
    into v_owner
  from public.cars c
  where c.id = v_booking.car_id;

  if v_owner is distinct from auth.uid() then
    raise exception 'Недостаточно прав: отклонить бронь может только владелец машины'
      using errcode = 'insufficient_privilege';
  end if;

  -- Отклонять имеет смысл только заявку в ожидании
  if v_booking.status <> 'pending' then
    raise exception 'Бронь нельзя отклонить: текущий статус = %, ожидался pending', v_booking.status
      using errcode = 'check_violation';
  end if;

  update public.bookings
     set status = 'rejected'
   where id = v_booking.id
   returning * into v_booking;

  return v_booking;
end;
$$;

comment on function public.reject_booking(uuid)
  is 'Отклонение брони владельцем машины (pending → rejected)';


-- ============================================================
-- 3) cancel_booking(booking_id) — ОТМЕНА брони её создателем (клиентом)
-- ------------------------------------------------------------
-- Проверки: вызывающий = создатель брони (bookings.customer_id = auth.uid()).
-- ВНИМАНИЕ: в таблице bookings поле создателя называется customer_id,
-- а не user_id (см. миграцию 0005). Проверяем именно customer_id.
--
-- Отмена возможна из статусов 'pending' и 'confirmed'.
-- Если бронь была 'confirmed' — освобождаем даты и оставляем ЗАДЕЛ
-- под финансовую логику штрафа за позднюю отмену.
-- ============================================================
create or replace function public.cancel_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking          public.bookings;
  v_was_confirmed    boolean;
begin
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Отменить бронь может ТОЛЬКО её создатель (клиент)
  if v_booking.customer_id is distinct from auth.uid() then
    raise exception 'Недостаточно прав: отменить бронь может только её создатель'
      using errcode = 'insufficient_privilege';
  end if;

  -- Уже отменённую/отклонённую/завершённую бронь отменять нельзя
  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'Бронь нельзя отменить: текущий статус = %', v_booking.status
      using errcode = 'check_violation';
  end if;

  -- Запоминаем, была ли бронь подтверждённой (влияет на штрафную логику)
  v_was_confirmed := (v_booking.status = 'confirmed');

  update public.bookings
     set status = 'cancelled'
   where id = v_booking.id
   returning * into v_booking;

  -- ------------------------------------------------------------
  -- МЕСТО ДЛЯ ФИНАНСОВОЙ ЛОГИКИ ШТРАФА ЗА ОТМЕНУ ПОДТВЕРЖДЁННОЙ БРОНИ.
  -- Здесь при v_was_confirmed = true нужно будет:
  --   * рассчитать штраф (например, % от rent_subtotal или фикс. сумма,
  --     возможно в зависимости от близости start_date к текущей дате);
  --   * зафиксировать удержание/возврат депозита;
  --   * записать движение средств в будущую таблицу транзакций/расчётов.
  -- Реализуем на следующем шаге, когда согласуем правила штрафов.
  -- ------------------------------------------------------------
  if v_was_confirmed then
    -- задел под штраф; пока действий не выполняем
    null;
  end if;

  return v_booking;
end;
$$;

comment on function public.cancel_booking(uuid)
  is 'Отмена брони её создателем (pending/confirmed → cancelled). Задел под штраф при отмене confirmed';


-- ============================================================
-- 4) search_cars_v2(search_query) — ДВУАЛФАВИТНЫЙ ПОИСК (кириллица/латиница)
-- ------------------------------------------------------------
-- Нормализует запрос через f_normalize (lower + unaccent) и ищет по
-- нормализованным полям brand/model/city. Устойчив к диакритике
-- (Đ, Č, Š, Ž) и опечаткам за счёт триграмм (pg_trgm).
--
-- Задействует GIN-триграммные индексы из миграции 0003:
--   idx_cars_brand_norm / idx_cars_model_norm / idx_cars_city_norm.
-- Оператор % (word_similarity через ILIKE-триграммы) даёт нечёткое совпадение;
-- similarity() используется для ранжирования результатов по релевантности.
--
-- Возвращает только активные объявления (setof public.cars) — как в поиске UI.
-- ============================================================
create or replace function public.search_cars_v2(search_query text)
returns setof public.cars
language sql
stable
as $$
  with q as (
    -- Один раз нормализуем поисковый запрос
    select public.f_normalize(search_query) as norm
  )
  select c.*
  from public.cars c, q
  where c.status = 'active'
    and (
      -- Триграммное нечёткое совпадение по любому из полей
      public.f_normalize(c.brand) % q.norm
      or public.f_normalize(c.model) % q.norm
      or public.f_normalize(c.city)  % q.norm
      -- Плюс подстрочное совпадение (короткие запросы, где триграмм мало)
      or public.f_normalize(c.brand) ilike '%' || q.norm || '%'
      or public.f_normalize(c.model) ilike '%' || q.norm || '%'
      or public.f_normalize(c.city)  ilike '%' || q.norm || '%'
    )
  -- Ранжируем по максимальной похожести (сначала самые релевантные)
  order by greatest(
    similarity(public.f_normalize(c.brand), q.norm),
    similarity(public.f_normalize(c.model), q.norm),
    similarity(public.f_normalize(c.city),  q.norm)
  ) desc
  limit 50;
$$;

comment on function public.search_cars_v2(text)
  is 'Двуалфавитный (кириллица/латиница) нечёткий поиск авто по brand/model/city через unaccent + pg_trgm';


-- ============================================================
-- ПРАВА НА ВЫЗОВ RPC
-- ------------------------------------------------------------
-- Статусные функции — только для авторизованных пользователей.
-- Поиск доступен и гостям (anon), и авторизованным.
-- ============================================================
grant execute on function public.confirm_booking(uuid) to authenticated;
grant execute on function public.reject_booking(uuid)  to authenticated;
grant execute on function public.cancel_booking(uuid)  to authenticated;
grant execute on function public.search_cars_v2(text)  to anon, authenticated;


-- ############################################################
-- >>> МИГРАЦИЯ: 0009_transactions_and_cancel_penalty.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0009: Таблица transactions + финансовая логика отмены
-- ============================================================
-- Концепция Thick Backend (CLAUDE.md): движение средств (штрафы, возвраты)
-- фиксируется только на сервере. Клиент напрямую в transactions писать
-- не может — записи создаёт SECURITY DEFINER функция cancel_booking.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА: transactions (учёт движения средств по броням)
-- ------------------------------------------------------------
-- type   — тип операции: 'payment' (оплата), 'refund' (возврат),
--          'penalty' (штраф за позднюю отмену), 'payout' (выплата владельцу).
-- status — статус операции: 'pending', 'completed', 'failed'.
-- Валюта по умолчанию 'RSD' — по требованию ТЗ этого шага
--   (в отличие от bookings, где расчётная валюта EUR).
-- ============================================================
create table public.transactions (
  id          uuid          primary key default gen_random_uuid(),
  -- При удалении брони транзакцию НЕ удаляем, а обнуляем ссылку —
  -- финансовая история должна сохраняться.
  booking_id  uuid          references public.bookings (id) on delete set null,
  user_id     uuid          not null references auth.users (id) on delete cascade,
  amount      numeric(12,2) not null,
  currency    text          not null default 'RSD',
  type        text          not null,     -- 'payment' | 'refund' | 'penalty' | 'payout'
  status      text          not null,     -- 'pending' | 'completed' | 'failed'
  created_at  timestamptz   not null default now(),

  -- Ограничиваем допустимые значения type/status на уровне БД
  constraint chk_tx_type   check (type   in ('payment', 'refund', 'penalty', 'payout')),
  constraint chk_tx_status check (status in ('pending', 'completed', 'failed'))
);

comment on table public.transactions is 'Учёт движения средств по броням (оплаты, возвраты, штрафы, выплаты)';

create index idx_transactions_user_id    on public.transactions (user_id);
create index idx_transactions_booking_id on public.transactions (booking_id);


-- ============================================================
-- RLS для transactions
-- ------------------------------------------------------------
-- SELECT: пользователь видит только свои транзакции.
-- INSERT/UPDATE/DELETE напрямую ЗАПРЕЩЕНЫ (политик на запись нет) —
-- писать может только SECURITY DEFINER функция, которая обходит RLS.
-- ============================================================
alter table public.transactions enable row level security;

create policy "transactions_select_own" on public.transactions
  for select to authenticated using (auth.uid() = user_id);


-- ============================================================
-- 2) МОДЕРНИЗАЦИЯ cancel_booking(booking_id)
-- ------------------------------------------------------------
-- Отмена брони её создателем (customer_id = auth.uid()).
-- Финансовая логика:
--   * Бронь была 'confirmed' И до начала аренды < 24 часов:
--       - штраф = стоимость 1 дня аренды (rent_subtotal / кол-во дней);
--       - INSERT в transactions: type='penalty', status='completed'.
--   * Бронь была 'confirmed', но до начала > 24 часов, ИЛИ была 'pending':
--       - штраф = 0;
--       - если по броне были транзакции type='payment' → создаём 'refund'
--         на сумму этих оплат.
--
-- Про "< 24 часа": start_date хранится типом date (без времени),
-- поэтому трактуем как "аренда начинается сегодня или завтра"
-- (start_date <= current_date + 1) — это ближайшее корректное к 24 часам.
-- ============================================================
create or replace function public.cancel_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking       public.bookings;
  v_was_confirmed boolean;
  v_days          integer;
  v_penalty       numeric(12,2);
  v_paid_total    numeric(12,2);
  v_is_last_minute boolean;
begin
  -- Блокируем строку брони на время транзакции
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Отменить бронь может ТОЛЬКО её создатель (клиент).
  -- Поле создателя в bookings — customer_id (не user_id).
  if v_booking.customer_id is distinct from auth.uid() then
    raise exception 'Недостаточно прав: отменить бронь может только её создатель'
      using errcode = 'insufficient_privilege';
  end if;

  -- Отменять можно только из pending/confirmed
  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'Бронь нельзя отменить: текущий статус = %', v_booking.status
      using errcode = 'check_violation';
  end if;

  v_was_confirmed := (v_booking.status = 'confirmed');

  -- Переводим бронь в cancelled (даты освобождаются)
  update public.bookings
     set status = 'cancelled'
   where id = v_booking.id
   returning * into v_booking;

  -- ------------------------------------------------------------
  -- ФИНАНСОВАЯ ЛОГИКА
  -- ------------------------------------------------------------

  -- "Менее 24 часов до начала": аренда стартует сегодня или завтра
  v_is_last_minute := (v_booking.start_date <= current_date + 1);

  if v_was_confirmed and v_is_last_minute then
    -- ---------- ШТРАФ ЗА ПОЗДНЮЮ ОТМЕНУ ----------
    -- Кол-во дней аренды (границы включительны, как в calc_booking_totals)
    v_days := (v_booking.end_date - v_booking.start_date) + 1;

    -- Штраф = стоимость 1 дня аренды = rent_subtotal / кол-во дней.
    -- Защита от деления на ноль (v_days всегда >= 1, но перестрахуемся).
    if v_days < 1 then
      v_days := 1;
    end if;
    v_penalty := round(v_booking.rent_subtotal / v_days, 2);

    insert into public.transactions (booking_id, user_id, amount, currency, type, status)
    values (
      v_booking.id,
      v_booking.customer_id,
      v_penalty,
      v_booking.currency::text,   -- валюта берётся из брони
      'penalty',
      'completed'
    );

  else
    -- ---------- БЕЗ ШТРАФА: возможен ВОЗВРАТ ----------
    -- Считаем сумму ранее проведённых оплат по этой броне
    select coalesce(sum(t.amount), 0)
      into v_paid_total
    from public.transactions t
    where t.booking_id = v_booking.id
      and t.type = 'payment'
      and t.status = 'completed';

    -- Если были оплаты — оформляем полный возврат
    if v_paid_total > 0 then
      insert into public.transactions (booking_id, user_id, amount, currency, type, status)
      values (
        v_booking.id,
        v_booking.customer_id,
        v_paid_total,
        v_booking.currency::text,
        'refund',
        'completed'
      );
    end if;
  end if;

  return v_booking;
end;
$$;

comment on function public.cancel_booking(uuid)
  is 'Отмена брони клиентом (pending/confirmed → cancelled) + штраф за позднюю отмену или возврат оплат';


-- ============================================================
-- ПРАВА
-- ------------------------------------------------------------
-- Пересоздание функции сбрасывает grant — выдаём заново.
-- ============================================================
grant execute on function public.cancel_booking(uuid) to authenticated;


-- ############################################################
-- >>> МИГРАЦИЯ: 0010_pay_booking_and_payout.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0010: Фиксация оплаты брони + выплата владельцу
-- ============================================================
-- Концепция Thick Backend (CLAUDE.md): оплата и распределение средств
-- (комиссия платформы / выплата владельцу) считаются только на сервере.
--
-- ВАЖНО про суммы. В брони уже посчитано триггером calc_booking_totals:
--   rent_subtotal        — стоимость аренды (доля владельца),
--   platform_commission  — 10% комиссия платформы,
--   total_price          = rent_subtotal + platform_commission (платит клиент).
-- Поэтому payout владельцу = rent_subtotal, комиссия = platform_commission.
-- Это исключает двойной учёт комиссии (иначе 10% брались бы ещё и с наценки).
-- ============================================================


-- ============================================================
-- 1) ДОБАВЛЯЕМ СТАТУС 'paid' В ENUM booking_status
-- ------------------------------------------------------------
-- В исходном ENUM (миграция 0001) статуса 'paid' не было.
-- ALTER TYPE ... ADD VALUE нельзя выполнять внутри блока транзакции
-- вместе с его использованием, поэтому добавляем отдельной командой
-- с IF NOT EXISTS (идемпотентность при повторном прогоне).
-- Порядок: paid ставим после confirmed по смыслу жизненного цикла.
-- ============================================================
alter type booking_status add value if not exists 'paid' after 'confirmed';


-- ============================================================
-- 2) ГАРАНТИЯ ПОДДЕРЖКИ ТИПОВ ТРАНЗАКЦИЙ
-- ------------------------------------------------------------
-- В миграции 0009 CHECK уже разрешает 'payment','refund','penalty','payout'.
-- Пересоздаём ограничение идемпотентно — на случай, если БД разворачивали
-- со старой версией схемы. Значения не меняем, просто подтверждаем набор.
-- ============================================================
alter table public.transactions
  drop constraint if exists chk_tx_type;

alter table public.transactions
  add constraint chk_tx_type
  check (type in ('payment', 'refund', 'penalty', 'payout'));


-- ============================================================
-- [SPLIT POINT #1] — РАЗРЫВ ТРАНЗАКЦИИ
-- ------------------------------------------------------------
-- Значение enum 'paid' (добавлено выше в 0010) нельзя использовать в той же
-- транзакции. COMMIT ниже фиксирует его ДО того, как pay_booking (0011)
-- начнёт его применять. Если выполняете файл разом и получаете ошибку
-- 'unsafe use of new value' — остановитесь здесь, нажмите Run, затем
-- продолжите с этой точки.
-- ============================================================
commit;

-- ############################################################
-- >>> МИГРАЦИЯ: 0011_rpc_pay_booking.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0011: RPC pay_booking (фиксация оплаты)
-- ============================================================
-- ВНИМАНИЕ по порядку применения: эта миграция ОТДЕЛЕНА от 0010,
-- потому что новое значение ENUM 'paid' (добавленное в 0010) нельзя
-- использовать в той же транзакции, где оно объявлено. К моменту
-- применения 0011 значение 'paid' уже закоммичено — функция его видит.
--
-- Логика pay_booking:
--   * бронь должна быть в статусе 'confirmed';
--   * вызвать может только создатель брони (customer_id = auth.uid());
--   * перевод брони в 'paid';
--   * INSERT транзакции клиента: type='payment', status='completed',
--     amount = total_price (полная сумма, которую платит клиент);
--   * INSERT транзакции владельца машины: type='payout', status='pending',
--     amount = rent_subtotal (доля владельца; выплата после аренды).
--   Комиссия платформы = platform_commission (остаётся у платформы,
--   отдельной транзакцией не проводится — это разница между payment и payout).
-- ============================================================
create or replace function public.pay_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_owner   uuid;          -- владелец машины (получатель payout)
begin
  -- Блокируем бронь на время транзакции, чтобы исключить двойную оплату
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Оплатить бронь может только её создатель (клиент)
  if v_booking.customer_id is distinct from auth.uid() then
    raise exception 'Недостаточно прав: оплатить бронь может только её создатель'
      using errcode = 'insufficient_privilege';
  end if;

  -- Оплата возможна только из статуса 'confirmed'
  if v_booking.status <> 'confirmed' then
    raise exception 'Бронь нельзя оплатить: текущий статус = %, ожидался confirmed', v_booking.status
      using errcode = 'check_violation';
  end if;

  -- Находим владельца машины — получателя выплаты
  select c.user_id
    into v_owner
  from public.cars c
  where c.id = v_booking.car_id;

  if v_owner is null then
    raise exception 'Не найден владелец машины по броне %', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Переводим бронь в 'paid'
  update public.bookings
     set status = 'paid'
   where id = v_booking.id
   returning * into v_booking;

  -- ---------- ТРАНЗАКЦИЯ КЛИЕНТА: оплата ----------
  -- Клиент платит полную стоимость брони (аренда + комиссия платформы)
  insert into public.transactions (booking_id, user_id, amount, currency, type, status)
  values (
    v_booking.id,
    v_booking.customer_id,
    v_booking.total_price,          -- полная сумма к оплате
    v_booking.currency::text,
    'payment',
    'completed'
  );

  -- ---------- ТРАНЗАКЦИЯ ВЛАДЕЛЬЦА: выплата ----------
  -- Владелец получает свою долю (rent_subtotal). Статус 'pending' —
  -- выплата фактически произойдёт после завершения аренды.
  -- Комиссия платформы (platform_commission) = total_price - rent_subtotal
  -- остаётся у платформы и отдельной транзакцией не оформляется.
  insert into public.transactions (booking_id, user_id, amount, currency, type, status)
  values (
    v_booking.id,
    v_owner,
    v_booking.rent_subtotal,        -- доля владельца (90% в терминах комиссии 10%)
    v_booking.currency::text,
    'payout',
    'pending'
  );

  return v_booking;
end;
$$;

comment on function public.pay_booking(uuid)
  is 'Фиксация оплаты брони (confirmed → paid): payment клиента + pending payout владельцу; комиссия остаётся у платформы';


-- ============================================================
-- ПРАВА: оплачивать может только авторизованный пользователь
-- ============================================================
grant execute on function public.pay_booking(uuid) to authenticated;


-- ############################################################
-- >>> МИГРАЦИЯ: 0012_cancel_refund_and_complete_booking.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0012: Закрытие финансового контура брони
-- ============================================================
-- Дорабатываем cancel_booking (отмена оплаченной брони с возвратом/штрафом)
-- и добавляем complete_booking (завершение аренды + разблокировка payout).
-- Вся логика — на сервере (Thick Backend), SECURITY DEFINER.
--
-- Напоминание про суммы в броне (посчитаны триггером calc_booking_totals):
--   rent_subtotal       — доля владельца,
--   platform_commission — комиссия платформы (10%),
--   total_price         = rent_subtotal + platform_commission (платит клиент).
-- Правило "менее 24 часов": start_date <= current_date + 1 (тип date без времени).
-- ============================================================


-- ============================================================
-- 1) МОДЕРНИЗАЦИЯ cancel_booking(booking_id)
-- ------------------------------------------------------------
-- Разрешённые для отмены статусы: 'pending', 'confirmed', 'paid'.
-- Сценарии:
--   A) pending                      → cancelled, без денег.
--   B) confirmed + <24ч             → penalty (1 день), даты освобождаются.
--   C) confirmed + >24ч             → cancelled, refund прошлых payment (если были).
--   D) paid + >24ч (заблаговременно) → cancelled, полный refund клиенту,
--                                      payout владельца → 'failed' (выплаты не будет).
--   E) paid + <24ч (поздняя отмена)  → penalty (1 день) клиенту,
--                                      частичный refund = total_price - штраф,
--                                      payout владельца уменьшается до суммы штрафа
--                                      и переводится в 'completed' (компенсация).
-- ============================================================
create or replace function public.cancel_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking        public.bookings;
  v_prev_status    booking_status;   -- статус ДО отмены
  v_days           integer;
  v_penalty        numeric(12,2);
  v_paid_total     numeric(12,2);
  v_refund         numeric(12,2);
  v_payout_comp    numeric(12,2);   -- компенсация владельцу из штрафа (за вычетом комиссии)
  v_is_last_minute boolean;
  v_commission_rate constant numeric := 0.10;  -- стандартная комиссия платформы (как в calc_booking_totals)
begin
  -- Блокируем строку брони на время транзакции
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Отменить бронь может только её создатель (клиент)
  if v_booking.customer_id is distinct from auth.uid() then
    raise exception 'Недостаточно прав: отменить бронь может только её создатель'
      using errcode = 'insufficient_privilege';
  end if;

  -- Теперь отмена разрешена и из 'paid'
  if v_booking.status not in ('pending', 'confirmed', 'paid') then
    raise exception 'Бронь нельзя отменить: текущий статус = %', v_booking.status
      using errcode = 'check_violation';
  end if;

  -- Запоминаем исходный статус до перевода в cancelled
  v_prev_status := v_booking.status;

  -- "Менее 24 часов до начала": аренда стартует сегодня или завтра
  v_is_last_minute := (v_booking.start_date <= current_date + 1);

  -- Кол-во дней аренды (границы включительны) и стоимость 1 дня для штрафа
  v_days := (v_booking.end_date - v_booking.start_date) + 1;
  if v_days < 1 then
    v_days := 1;
  end if;
  v_penalty := round(v_booking.rent_subtotal / v_days, 2);

  -- Переводим бронь в cancelled (даты освобождаются)
  update public.bookings
     set status = 'cancelled'
   where id = v_booking.id
   returning * into v_booking;

  -- ------------------------------------------------------------
  -- ФИНАНСОВАЯ ЛОГИКА по исходному статусу
  -- ------------------------------------------------------------

  if v_prev_status = 'paid' then
    -- =========================================================
    -- ОТМЕНА ОПЛАЧЕННОЙ БРОНИ
    -- =========================================================
    if not v_is_last_minute then
      -- ---------- D) paid + >24ч: полный возврат ----------
      -- Возвращаем клиенту всю оплаченную сумму
      insert into public.transactions (booking_id, user_id, amount, currency, type, status)
      values (
        v_booking.id, v_booking.customer_id,
        v_booking.total_price, v_booking.currency::text,
        'refund', 'completed'
      );

      -- Выплаты владельцу не будет — гасим его pending payout
      update public.transactions
         set status = 'failed'
       where booking_id = v_booking.id
         and type = 'payout'
         and status = 'pending';

    else
      -- ---------- E) paid + <24ч: штраф + частичный возврат ----------
      -- Штраф (стоимость 1 дня) удерживается с клиента
      insert into public.transactions (booking_id, user_id, amount, currency, type, status)
      values (
        v_booking.id, v_booking.customer_id,
        v_penalty, v_booking.currency::text,
        'penalty', 'completed'
      );

      -- Частичный возврат клиенту = вся оплата минус штраф
      v_refund := v_booking.total_price - v_penalty;
      if v_refund < 0 then
        v_refund := 0;  -- страховка, если штраф вдруг больше оплаты
      end if;

      if v_refund > 0 then
        insert into public.transactions (booking_id, user_id, amount, currency, type, status)
        values (
          v_booking.id, v_booking.customer_id,
          v_refund, v_booking.currency::text,
          'refund', 'completed'
        );
      end if;

      -- Payout владельцу = штраф МИНУС стандартная комиссия платформы со штрафа.
      -- Платформа удерживает свои 10% и в этом сценарии; остаток — компенсация владельцу.
      -- Формула: payout_owner = штраф - (штраф × ставка_комиссии).
      v_payout_comp := round(v_penalty - (v_penalty * v_commission_rate), 2);
      update public.transactions
         set amount = v_payout_comp,
             status = 'completed'
       where booking_id = v_booking.id
         and type = 'payout'
         and status = 'pending';
    end if;

  elsif v_prev_status = 'confirmed' and v_is_last_minute then
    -- =========================================================
    -- B) confirmed + <24ч: штраф без предшествующей оплаты
    -- =========================================================
    insert into public.transactions (booking_id, user_id, amount, currency, type, status)
    values (
      v_booking.id, v_booking.customer_id,
      v_penalty, v_booking.currency::text,
      'penalty', 'completed'
    );

  else
    -- =========================================================
    -- A) pending  или  C) confirmed + >24ч: возврат прошлых оплат, если были
    -- =========================================================
    select coalesce(sum(t.amount), 0)
      into v_paid_total
    from public.transactions t
    where t.booking_id = v_booking.id
      and t.type = 'payment'
      and t.status = 'completed';

    if v_paid_total > 0 then
      insert into public.transactions (booking_id, user_id, amount, currency, type, status)
      values (
        v_booking.id, v_booking.customer_id,
        v_paid_total, v_booking.currency::text,
        'refund', 'completed'
      );
    end if;
  end if;

  return v_booking;
end;
$$;

comment on function public.cancel_booking(uuid)
  is 'Отмена брони (pending/confirmed/paid → cancelled) с корректным возвратом, штрафом и разрешением payout';


-- ============================================================
-- 2) complete_booking(booking_id) — ЗАВЕРШЕНИЕ АРЕНДЫ владельцем
-- ------------------------------------------------------------
-- Проверки:
--   * вызывающий = владелец машины (cars.user_id = auth.uid());
--   * текущий статус брони = 'paid'.
-- Действия:
--   * перевод брони 'paid' → 'completed';
--   * pending-payout по этой броне → 'completed' (владелец получает выплату).
-- ============================================================
create or replace function public.complete_booking(booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_owner   uuid;
begin
  select b.*
    into v_booking
  from public.bookings b
  where b.id = booking_id
  for update;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', booking_id
      using errcode = 'no_data_found';
  end if;

  -- Право завершать аренду есть только у владельца машины
  select c.user_id
    into v_owner
  from public.cars c
  where c.id = v_booking.car_id;

  if v_owner is distinct from auth.uid() then
    raise exception 'Недостаточно прав: завершить аренду может только владелец машины'
      using errcode = 'insufficient_privilege';
  end if;

  -- Завершать можно только оплаченную бронь
  if v_booking.status <> 'paid' then
    raise exception 'Аренду нельзя завершить: текущий статус = %, ожидался paid', v_booking.status
      using errcode = 'check_violation';
  end if;

  -- Перевод брони в completed
  update public.bookings
     set status = 'completed'
   where id = v_booking.id
   returning * into v_booking;

  -- Разблокируем выплату владельцу: pending payout → completed
  update public.transactions
     set status = 'completed'
   where booking_id = v_booking.id
     and type = 'payout'
     and status = 'pending';

  return v_booking;
end;
$$;

comment on function public.complete_booking(uuid)
  is 'Завершение аренды владельцем (paid → completed) + перевод payout из pending в completed';


-- ============================================================
-- ПРАВА (пересоздание функций сбрасывает grant — выдаём заново)
-- ============================================================
grant execute on function public.cancel_booking(uuid)   to authenticated;
grant execute on function public.complete_booking(uuid) to authenticated;


-- ############################################################
-- >>> МИГРАЦИЯ: 0013_view_bookings_with_car.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0013: VIEW bookings_with_car
-- ============================================================
-- Упрощает списки в кабинете броней FlutterFlow: отдаёт бронь вместе
-- с данными машины и её владельцем (owner_id) одним запросом, без ручного
-- JOIN на клиенте.
--
-- security_invoker = true — КЛЮЧЕВОЙ момент безопасности: VIEW применяет
-- RLS-политики ВЫЗЫВАЮЩЕГО пользователя (а не владельца VIEW). То есть
-- каждый видит ровно те брони, что разрешают политики bookings/cars
-- (bookings_select_involved из миграции 0007). Без этого флага VIEW
-- обходила бы RLS и раскрывала чужие данные.
-- ============================================================
create or replace view public.bookings_with_car
with (security_invoker = true)
as
select
  b.id,
  b.car_id,
  b.customer_id,
  c.user_id            as owner_id,       -- владелец машины (фильтр вкладки владельца)
  c.brand,
  c.model,
  c.year,
  c.city,
  b.start_date,
  b.end_date,
  b.rent_subtotal,
  b.platform_commission,
  b.deposit_amount,
  b.total_price,
  b.currency,
  b.status,
  b.created_at
from public.bookings b
join public.cars c on c.id = b.car_id;

comment on view public.bookings_with_car
  is 'Брони + данные машины и owner_id. RLS вызывающего (security_invoker). Для кабинета броней FlutterFlow';


-- ############################################################
-- >>> МИГРАЦИЯ: 0014_car_upload_storage_and_create_rpc.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0014: Загрузка объявлений, бакет фото, create_car_v2
-- ============================================================
-- ВНИМАНИЕ по нумерации: 0013 уже занят (VIEW bookings_with_car),
-- поэтому эта миграция — 0014.
--
-- Содержимое:
--   1) выравнивание ENUM car_status и дефолта status в cars;
--   2) Storage-бакет car-images + RLS-политики (папка = auth.uid());
--   3) RPC create_car_v2 (SECURITY DEFINER) с PostGIS и записью фото в car_images.
-- ============================================================


-- ============================================================
-- 1) ENUM car_status и поле cars.status
-- ------------------------------------------------------------
-- Исходный набор (миграция 0001): moderation, active, archived, rejected, sold.
-- ТЗ просит: draft, moderation, active, rejected, archived.
-- Решение: ДОБАВЛЯЕМ недостающее 'draft'. Значение 'sold' НЕ удаляем —
-- удаление значения из ENUM в PostgreSQL невозможно без пересоздания типа,
-- а на него завязана таблица cars. Итоговый набор — надмножество требуемого,
-- ничего существующего не ломает.
-- 'draft' ставим первым по смыслу жизненного цикла (черновик до отправки).
-- ADD VALUE IF NOT EXISTS — идемпотентно при повторном прогоне.
-- ============================================================
alter type car_status add value if not exists 'draft' before 'moderation';

-- Дефолт статуса для новых объявлений — moderation (как и было). Подтверждаем явно.
alter table public.cars
  alter column status set default 'moderation';

-- Поле location уже имеет тип geography(point, 4326) (миграция 0003).
-- Подтверждаем наличие геоиндекса (создастся, только если его нет).
create index if not exists idx_cars_location on public.cars using gist (location);


-- ============================================================
-- 2) STORAGE: бакет car-images + RLS
-- ------------------------------------------------------------
-- Бакет публичный на ЧТЕНИЕ (фото объявлений видны всем), но запись —
-- только авторизованным и строго в свою папку.
-- Структура путей в бакете: "<auth.uid()>/<car_id>/<file>.jpg".
-- Первая часть пути (папка верхнего уровня) = ID пользователя.
-- ============================================================

-- Создаём бакет идемпотентно. public = true → файлы доступны по прямой ссылке.
insert into storage.buckets (id, name, public)
values ('car-images', 'car-images', true)
on conflict (id) do nothing;

-- Политики на storage.objects действуют в разрезе bucket_id = 'car-images'.
-- storage.foldername(name) возвращает массив сегментов пути;
-- элемент [1] — папка верхнего уровня, её и сравниваем с auth.uid().

-- ---------- SELECT: чтение доступно всем (anon + authenticated) ----------
drop policy if exists "car_images_read_all" on storage.objects;
create policy "car_images_read_all"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'car-images');

-- ---------- INSERT: загрузка только в свою папку ----------
drop policy if exists "car_images_insert_own" on storage.objects;
create policy "car_images_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'car-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- UPDATE: изменять только свои файлы (в своей папке) ----------
drop policy if exists "car_images_update_own" on storage.objects;
create policy "car_images_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'car-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'car-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- DELETE: удалять только свои файлы ----------
drop policy if exists "car_images_delete_own" on storage.objects;
create policy "car_images_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'car-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================
-- 3) RPC create_car_v2
-- ------------------------------------------------------------
-- Создаёт объявление + записи фото в car_images одной транзакцией.
-- SECURITY DEFINER: чтобы гарантированно писать в cars/car_images,
-- но user_id ЖЁСТКО берётся из auth.uid() — подставить чужой нельзя.
--
-- Маппинг цены по listing_type (в cars два ценовых поля):
--   'sale' → is_for_sale=true,  sale_price=price
--   'rent' → is_for_rent=true,  rent_price_daily=price
--   'both' → обе цели, price трактуем как цену аренды/сутки,
--            а для продажи цену задаём тем же price (при необходимости
--            редактируется позже; для MVP достаточно).
--
-- Гео: lat/lng → ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography.
-- ВАЖНО: в ST_MakePoint порядок именно (lng, lat) — сначала долгота!
-- Если lat/lng не переданы (NULL) — location остаётся NULL.
--
-- Возвращает UUID созданного автомобиля.
-- ============================================================
create or replace function public.create_car_v2(
  listing_type text,
  brand        text,
  model        text,
  year         integer,
  mileage      integer,
  price        numeric,
  currency     text,
  city         text,
  lat          double precision,
  lng          double precision,
  photo_urls   text[]
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
  v_sale     numeric(12,2);
  v_rent     numeric(12,2);
  v_location geography(point, 4326);
  v_url      text;
  v_idx      integer := 0;
begin
  -- Только авторизованный может создавать объявление
  if v_user_id is null then
    raise exception 'Требуется авторизация для создания объявления'
      using errcode = 'insufficient_privilege';
  end if;

  -- Маппинг назначения и цены по типу объявления
  if listing_type = 'sale' then
    v_is_sale := true;
    v_sale := price;
  elsif listing_type = 'rent' then
    v_is_rent := true;
    v_rent := price;
  elsif listing_type = 'both' then
    v_is_sale := true;
    v_is_rent := true;
    v_sale := price;   -- для MVP: одна цена; уточняется при редактировании
    v_rent := price;
  else
    raise exception 'Некорректный listing_type = % (ожидалось sale/rent/both)', listing_type
      using errcode = 'check_violation';
  end if;

  -- Собираем PostGIS-точку из координат (порядок аргументов: долгота, широта!)
  if lat is not null and lng is not null then
    v_location := st_setsrid(st_makepoint(lng, lat), 4326)::geography;
  end if;

  -- Создаём объявление. Статус по умолчанию 'moderation' проставит БД.
  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    currency, sale_price, rent_price_daily,
    city, location
  )
  values (
    v_user_id, v_is_sale, v_is_rent,
    brand, model, year, mileage,
    coalesce(currency, 'EUR')::currency_code, v_sale, v_rent,
    city, v_location
  )
  returning id into v_car_id;

  -- Разворачиваем массив ссылок в строки car_images с сохранением порядка.
  -- order_index = позиция в массиве (0,1,2,...) — так галерея покажет фото
  -- ровно в том порядке, в котором пользователь их загрузил.
  if photo_urls is not null then
    foreach v_url in array photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (v_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_car_id;
end;
$$;

comment on function public.create_car_v2(text, text, text, integer, integer, numeric, text, text, double precision, double precision, text[])
  is 'Создание объявления (PostGIS-локация) + запись фото в car_images. user_id = auth.uid()';


-- ============================================================
-- ПРАВА: создавать объявление может только авторизованный
-- ============================================================
grant execute on function public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text, double precision, double precision, text[]
) to authenticated;


-- ============================================================
-- [SPLIT POINT #2] — РАЗРЫВ ТРАНЗАКЦИИ
-- ------------------------------------------------------------
-- Значение enum 'draft' (добавлено выше в 0014) фиксируем COMMIT, чтобы
-- последующие миграции могли на него опираться без ошибки транзакции.
-- ============================================================
commit;

-- ############################################################
-- >>> МИГРАЦИЯ: 0015_admin_roles_and_moderation.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0015: Ролевая модель админа + модерация объявлений
-- ============================================================
-- Добавляем флаг администратора, причину отклонения и RPC модерации.
-- Вся логика смены статуса — на сервере (Thick Backend), SECURITY DEFINER,
-- с жёсткой проверкой прав администратора.
-- ============================================================


-- ============================================================
-- 1) Поле moderation_comment в cars (причина отклонения)
-- ============================================================
alter table public.cars
  add column if not exists moderation_comment text;  -- причина reject от модератора, nullable

comment on column public.cars.moderation_comment
  is 'Причина отклонения объявления модератором (заполняется reject_car, очищается approve_car)';


-- ============================================================
-- 2) Роль администратора: поле is_admin в profiles
-- ------------------------------------------------------------
-- Профиль хранится в public.profiles (миграция 0002). Роль user_role
-- там уже есть, но для простого и быстрого гейта модерации добавляем
-- явный булев флаг is_admin (default false).
-- ============================================================
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_admin
  is 'Признак администратора (доступ к модерации объявлений)';


-- ============================================================
-- ХЕЛПЕР: public.is_admin() — проверка, что текущий пользователь админ.
-- ------------------------------------------------------------
-- SECURITY DEFINER + stable: функция читает profiles В ОБХОД RLS.
-- Это важно по двум причинам:
--   1) исключаем бесконечную рекурсию политик (политика cars читает profiles,
--      у которой свои политики);
--   2) политика profiles_select_own отдаёт пользователю только свою строку —
--      и этого как раз достаточно, но definer-доступ надёжнее и переиспользуем.
-- Возвращает true только если у auth.uid() профиль с is_admin = true.
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_admin = true
  );
$$;

comment on function public.is_admin()
  is 'true, если текущий пользователь (auth.uid()) — администратор';

grant execute on function public.is_admin() to authenticated;


-- ============================================================
-- RLS: админ видит объявления в статусах moderation и rejected
-- ------------------------------------------------------------
-- Обычный публичный SELECT (миграция 0007) отдаёт только 'active'.
-- Владельцу видны все его объявления. Эта политика ДОБАВЛЯЕТ админу
-- доступ к чужим объявлениям на модерации/отклонённым (несколько
-- SELECT-политик объединяются по OR).
-- ============================================================
drop policy if exists "cars_select_admin_moderation" on public.cars;
create policy "cars_select_admin_moderation"
  on public.cars
  for select
  to authenticated
  using (
    status in ('moderation', 'rejected')
    and public.is_admin()
  );


-- ============================================================
-- 3) RPC модерации (SECURITY DEFINER, только для админов)
-- ============================================================

-- ---------- approve_car: перевод в active ----------
-- Проверка прав админа. Статус → 'active', moderation_comment очищается.
create or replace function public.approve_car(car_id uuid)
returns public.cars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_car public.cars;
begin
  -- Гейт по роли администратора
  if not public.is_admin() then
    raise exception 'Недостаточно прав: модерация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку объявления на время транзакции
  select c.* into v_car
  from public.cars c
  where c.id = car_id
  for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', car_id
      using errcode = 'no_data_found';
  end if;

  -- Одобрять имеет смысл объявление на модерации (или ранее отклонённое —
  -- повторная подача). Из терминальных статусов не трогаем.
  if v_car.status not in ('moderation', 'rejected') then
    raise exception 'Объявление нельзя одобрить: текущий статус = %', v_car.status
      using errcode = 'check_violation';
  end if;

  update public.cars
     set status = 'active',
         moderation_comment = null   -- очищаем причину отклонения
   where id = car_id
   returning * into v_car;

  return v_car;
end;
$$;

comment on function public.approve_car(uuid)
  is 'Одобрение объявления администратором (moderation/rejected → active), очистка комментария';


-- ---------- reject_car: перевод в rejected с причиной ----------
-- Проверка прав админа. Статус → 'rejected', записываем comment.
create or replace function public.reject_car(car_id uuid, comment text)
returns public.cars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_car public.cars;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: модерация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  select c.* into v_car
  from public.cars c
  where c.id = car_id
  for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', car_id
      using errcode = 'no_data_found';
  end if;

  -- Отклонять имеет смысл объявление на модерации
  if v_car.status <> 'moderation' then
    raise exception 'Объявление нельзя отклонить: текущий статус = %, ожидался moderation', v_car.status
      using errcode = 'check_violation';
  end if;

  update public.cars
     set status = 'rejected',
         moderation_comment = comment   -- фиксируем причину отклонения
   where id = car_id
   returning * into v_car;

  return v_car;
end;
$$;

comment on function public.reject_car(uuid, text)
  is 'Отклонение объявления администратором (moderation → rejected) с записью причины';


-- ============================================================
-- ПРАВА: вызывать RPC модерации могут только авторизованные
-- (внутри дополнительно проверяется is_admin()).
-- ============================================================
grant execute on function public.approve_car(uuid)       to authenticated;
grant execute on function public.reject_car(uuid, text)  to authenticated;


-- ############################################################
-- >>> МИГРАЦИЯ: 0016_chats_and_messages.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0016: Внутренние чаты покупатель ↔ продавец
-- ============================================================
-- Модуль переписки, привязанной к объявлению (cars). Один чат — это диалог
-- между покупателем (buyer) и продавцом (seller) по конкретной машине.
-- Создание чата — только через RPC start_chat (Thick Backend); прямой INSERT
-- в chats закрыт RLS. Сообщения пишут только участники чата.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА: chats (диалоги по объявлению)
-- ============================================================
create table public.chats (
  id          uuid        primary key default gen_random_uuid(),
  car_id      uuid        not null references public.cars (id) on delete cascade,      -- к какому объявлению
  buyer_id    uuid        not null references auth.users (id) on delete cascade,       -- покупатель (инициатор)
  seller_id   uuid        not null references auth.users (id) on delete cascade,       -- продавец (владелец авто)
  created_at  timestamptz not null default now()
);

comment on table public.chats is 'Диалоги покупатель↔продавец, привязанные к объявлению';

-- Уникальность диалога: одна пара (buyer, seller) по одной машине = один чат.
-- Нужен и для логики "найти существующий или создать", и как защита от гонок
-- (двойной тап «Написать» не создаст два чата — второй INSERT упрётся в индекс).
create unique index uq_chats_car_buyer_seller
  on public.chats (car_id, buyer_id, seller_id);

-- Индексы под выборку "мои чаты"
create index idx_chats_buyer  on public.chats (buyer_id);
create index idx_chats_seller on public.chats (seller_id);
create index idx_chats_car    on public.chats (car_id);


-- ============================================================
-- 2) ТАБЛИЦА: messages (сообщения в чате)
-- ============================================================
create table public.messages (
  id          uuid        primary key default gen_random_uuid(),
  chat_id     uuid        not null references public.chats (id) on delete cascade,     -- в каком чате
  sender_id   uuid        not null references auth.users (id) on delete cascade,       -- кто отправил
  text        text        not null,
  is_read     boolean     not null default false,                                      -- прочитано получателем
  created_at  timestamptz not null default now()
);

comment on table public.messages is 'Сообщения внутри чатов';

-- Индекс под ленту сообщений чата в хронологическом порядке
create index idx_messages_chat on public.messages (chat_id, created_at);


-- ============================================================
-- 3) RLS
-- ============================================================
alter table public.chats    enable row level security;
alter table public.messages enable row level security;

-- ---------- chats ----------
-- SELECT: видит только участник чата (buyer или seller).
create policy "chats_select_participant" on public.chats
  for select to authenticated
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- INSERT напрямую ЗАПРЕЩЁН: политики на insert нет — чат создаётся
-- только через SECURITY DEFINER функцию start_chat (она обходит RLS).

-- ---------- messages ----------
-- SELECT: сообщения видит только участник соответствующего чата.
create policy "messages_select_participant" on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );

-- INSERT: писать может только участник чата, и только от своего имени
-- (sender_id = auth.uid() — нельзя подставить чужого отправителя).
create policy "messages_insert_participant" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );

-- UPDATE: разрешаем участнику помечать сообщения прочитанными (is_read).
-- Ограничение "менять можно только is_read" удобнее контролировать
-- отдельной RPC mark_messages_read; здесь даём базовый доступ участнику.
create policy "messages_update_participant" on public.messages
  for update to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );


-- ============================================================
-- 4) RPC start_chat(p_car_id) — создать чат или вернуть существующий
-- ------------------------------------------------------------
-- buyer_id  = auth.uid() (инициатор — текущий пользователь).
-- seller_id = cars.user_id по p_car_id (владелец объявления).
-- Защита: нельзя начать чат с самим собой.
-- Идемпотентность: если чат (car, buyer, seller) уже есть — вернуть его id,
-- иначе создать новый. ON CONFLICT по уникальному индексу защищает от гонок.
-- ============================================================
create or replace function public.start_chat(p_car_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer   uuid := auth.uid();
  v_seller  uuid;
  v_chat_id uuid;
begin
  -- Требуется авторизация
  if v_buyer is null then
    raise exception 'Требуется авторизация для начала чата'
      using errcode = 'insufficient_privilege';
  end if;

  -- Находим продавца (владельца машины)
  select c.user_id
    into v_seller
  from public.cars c
  where c.id = p_car_id;

  if v_seller is null then
    raise exception 'Объявление % не найдено', p_car_id
      using errcode = 'no_data_found';
  end if;

  -- Нельзя писать самому себе
  if v_buyer = v_seller then
    raise exception 'Нельзя начать чат с самим собой'
      using errcode = 'check_violation';
  end if;

  -- Ищем существующий чат по этой комбинации
  select id
    into v_chat_id
  from public.chats
  where car_id = p_car_id
    and buyer_id = v_buyer
    and seller_id = v_seller;

  if v_chat_id is not null then
    return v_chat_id;   -- чат уже есть — возвращаем его
  end if;

  -- Создаём новый чат. ON CONFLICT — страховка от гонок:
  -- если параллельный вызов успел создать чат, берём существующий id.
  insert into public.chats (car_id, buyer_id, seller_id)
  values (p_car_id, v_buyer, v_seller)
  on conflict (car_id, buyer_id, seller_id) do update
    set car_id = excluded.car_id   -- no-op апдейт, чтобы RETURNING вернул строку
  returning id into v_chat_id;

  return v_chat_id;
end;
$$;

comment on function public.start_chat(uuid)
  is 'Создаёт чат покупатель↔продавец по объявлению или возвращает существующий (идемпотентно)';


-- ============================================================
-- ПРАВА
-- ============================================================
grant execute on function public.start_chat(uuid) to authenticated;


-- ============================================================
-- REALTIME: включаем репликацию таблицы messages
-- ------------------------------------------------------------
-- Без этого клиентский Stream (messagesStream) не будет получать
-- новые сообщения в реальном времени. Оборачиваем в DO-блок с проверкой,
-- т.к. повторное ADD TABLE уже добавленной таблицы вызывает ошибку.
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;


-- ############################################################
-- >>> МИГРАЦИЯ: 0017_rpc_search_cars_advanced.sql
-- ############################################################

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


-- ############################################################
-- >>> МИГРАЦИЯ: 0018_view_chats_with_details.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0018: VIEW chats_with_details + счётчик непрочитанных
-- ============================================================
-- Экран «Мои диалоги» (My Chats): список чатов с данными машины,
-- профилем СОБЕСЕДНИКА (не себя) и числом непрочитанных сообщений.
--
-- security_invoker = true — VIEW применяет RLS вызывающего пользователя
-- (политики chats/messages/cars/profiles из предыдущих миграций), поэтому
-- пользователь увидит только свои чаты. Собеседник и счётчик вычисляются
-- относительно auth.uid().
-- ============================================================


-- ============================================================
-- VIEW: chats_with_details
-- ------------------------------------------------------------
-- Для каждого чата:
--   opponent_id   — ID собеседника (динамически: если я buyer → seller, иначе buyer);
--   opponent_name / opponent_avatar — профиль собеседника;
--   brand/model/car_photo — данные объявления и первое фото (order_index ASC);
--   unread_count  — непрочитанные ВХОДЯЩИЕ сообщения (чужие, is_read=false);
--   last_message_at — время последнего сообщения (для сортировки списка).
-- ============================================================
create or replace view public.chats_with_details
with (security_invoker = true)
as
select
  ch.id,
  ch.car_id,
  ch.buyer_id,
  ch.seller_id,
  ch.created_at,

  -- Собеседник = НЕ текущий пользователь.
  -- Если auth.uid() — покупатель, то собеседник продавец, и наоборот.
  case when ch.buyer_id = auth.uid() then ch.seller_id else ch.buyer_id end
    as opponent_id,

  -- Профиль собеседника (подтягиваем по вычисленному opponent_id)
  opp.full_name  as opponent_name,
  opp.avatar_url as opponent_avatar,

  -- Данные объявления
  c.brand,
  c.model,
  c.year,

  -- Первое фото машины (минимальный order_index). LATERAL берёт одну строку.
  img.image_url as car_photo,

  -- Непрочитанные ВХОДЯЩИЕ: чужие (sender_id != auth.uid()) и is_read = false
  (
    select count(*)
    from public.messages m
    where m.chat_id = ch.id
      and m.is_read = false
      and m.sender_id <> auth.uid()
  )::int as unread_count,

  -- Время последнего сообщения в чате (null, если сообщений ещё нет)
  (
    select max(m.created_at)
    from public.messages m
    where m.chat_id = ch.id
  ) as last_message_at

from public.chats ch
-- Собеседник: соединяем профиль по динамически вычисленному ID
left join public.profiles opp
  on opp.id = case when ch.buyer_id = auth.uid() then ch.seller_id else ch.buyer_id end
-- Данные машины
join public.cars c
  on c.id = ch.car_id
-- Первое фото объявления по порядку галереи
left join lateral (
  select ci.image_url
  from public.car_images ci
  where ci.car_id = ch.car_id
  order by ci.order_index asc
  limit 1
) img on true;

comment on view public.chats_with_details
  is 'Чаты + собеседник (динамически) + данные машины + счётчик непрочитанных. RLS вызывающего';


-- ============================================================
-- RPC: unread_count_for_chat(p_chat_id) — счётчик непрочитанных для одного чата
-- ------------------------------------------------------------
-- Отдельная функция на случай, если счётчик нужен точечно (например,
-- обновить бэйдж конкретного чата без перезапроса всей VIEW).
-- security_invoker по умолчанию (invoker) + проверка через RLS messages.
-- ============================================================
create or replace function public.unread_count_for_chat(p_chat_id uuid)
returns integer
language sql
stable
as $$
  select count(*)::int
  from public.messages m
  where m.chat_id = p_chat_id
    and m.is_read = false
    and m.sender_id <> auth.uid();
$$;

comment on function public.unread_count_for_chat(uuid)
  is 'Число непрочитанных входящих сообщений в чате для текущего пользователя';

grant execute on function public.unread_count_for_chat(uuid) to authenticated;


-- ============================================================
-- RPC: total_unread_count() — всего непрочитанных по всем чатам
-- ------------------------------------------------------------
-- Для бэйджа на иконке «Чаты» в нижней навигации.
-- RLS messages_select_participant сам ограничит выборку чатами пользователя.
-- ============================================================
create or replace function public.total_unread_count()
returns integer
language sql
stable
as $$
  select count(*)::int
  from public.messages m
  where m.is_read = false
    and m.sender_id <> auth.uid();
$$;

comment on function public.total_unread_count()
  is 'Суммарное число непрочитанных сообщений пользователя (для бэйджа навигации)';

grant execute on function public.total_unread_count() to authenticated;


-- ############################################################
-- >>> МИГРАЦИЯ: 0019_kyc_verification.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0019: Верификация документов пользователей (KYC)
-- ============================================================
-- Пользователь загружает документы в ПРИВАТНЫЙ бакет, отправляет на проверку;
-- админ подтверждает/отклоняет. Документы (паспорт, права) видны только
-- владельцу и админам. Вся логовая логика — на сервере (Thick Backend).
-- ============================================================


-- ============================================================
-- 1) ENUM статуса верификации + поля в profiles
-- ============================================================
create type verification_status_type as enum (
  'unverified',  -- документы не подавались (по умолчанию)
  'pending',     -- поданы, ждут проверки админом
  'verified',    -- подтверждены
  'rejected'     -- отклонены (см. verification_comment)
);

alter table public.profiles
  add column if not exists verification_status verification_status_type
    not null default 'unverified',
  add column if not exists passport_url         text,   -- ссылка на паспорт (приватный бакет)
  add column if not exists driver_license_url   text,   -- ссылка на в/у (приватный бакет)
  add column if not exists verification_comment text;   -- причина отклонения от админа

comment on column public.profiles.verification_status is 'Статус KYC-верификации пользователя';
comment on column public.profiles.verification_comment is 'Причина отклонения документов модератором';


-- ============================================================
-- 2) ПРИВАТНЫЙ бакет user-documents + жёсткие RLS
-- ------------------------------------------------------------
-- public = false — файлы НЕ доступны по прямой ссылке; доступ только через
-- подписанные URL (signed URL) и только тем, кому разрешают политики.
-- Структура пути: "<auth.uid()>/<файл>" — первый сегмент = ID владельца.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('user-documents', 'user-documents', false)
on conflict (id) do nothing;

-- ---------- SELECT: только владелец ИЛИ админ ----------
-- Владелец: первый сегмент пути = его uid.
-- Админ: public.is_admin() = true (функция из миграции 0015).
-- Анонимам и прочим — доступ закрыт (нет ветки to anon).
drop policy if exists "user_docs_select_owner_or_admin" on storage.objects;
create policy "user_docs_select_owner_or_admin"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'user-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- ---------- INSERT: только владелец в свою папку ----------
drop policy if exists "user_docs_insert_own" on storage.objects;
create policy "user_docs_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- UPDATE: только владелец своей папки ----------
drop policy if exists "user_docs_update_own" on storage.objects;
create policy "user_docs_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- DELETE: только владелец своей папки ----------
drop policy if exists "user_docs_delete_own" on storage.objects;
create policy "user_docs_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================
-- 3) RPC submit_verification — отправка документов на проверку
-- ------------------------------------------------------------
-- Обновляет профиль текущего пользователя: записывает URL документов,
-- статус → 'pending', очищает предыдущий комментарий отклонения.
-- ============================================================
create or replace function public.submit_verification(
  p_passport_url       text,
  p_driver_license_url text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Требуем хотя бы один документ (защита от пустой отправки)
  if coalesce(nullif(trim(p_passport_url), ''), nullif(trim(p_driver_license_url), '')) is null then
    raise exception 'Загрузите хотя бы один документ для верификации'
      using errcode = 'check_violation';
  end if;

  update public.profiles
     set passport_url         = p_passport_url,
         driver_license_url   = p_driver_license_url,
         verification_status  = 'pending',
         verification_comment = null    -- сбрасываем прошлую причину отклонения
   where id = auth.uid()
   returning * into v_profile;

  return v_profile;
end;
$$;

comment on function public.submit_verification(text, text)
  is 'Отправка документов KYC на проверку (status → pending) текущим пользователем';

grant execute on function public.submit_verification(text, text) to authenticated;


-- ============================================================
-- 4) RPC модерации документов (только админ)
-- ============================================================

-- ---------- approve_user_verification: → verified ----------
create or replace function public.approve_user_verification(p_user_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: верификация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
     set verification_status  = 'verified',
         verification_comment = null
   where id = p_user_id
   returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Пользователь % не найден', p_user_id
      using errcode = 'no_data_found';
  end if;

  return v_profile;
end;
$$;

comment on function public.approve_user_verification(uuid)
  is 'Подтверждение KYC администратором (status → verified)';

grant execute on function public.approve_user_verification(uuid) to authenticated;


-- ---------- reject_user_verification: → rejected + причина ----------
create or replace function public.reject_user_verification(
  p_user_id uuid,
  p_comment text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: верификация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
     set verification_status  = 'rejected',
         verification_comment = p_comment
   where id = p_user_id
   returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Пользователь % не найден', p_user_id
      using errcode = 'no_data_found';
  end if;

  return v_profile;
end;
$$;

comment on function public.reject_user_verification(uuid, text)
  is 'Отклонение KYC администратором (status → rejected) с записью причины';

grant execute on function public.reject_user_verification(uuid, text) to authenticated;


-- ============================================================
-- 5) RLS: админ читает ВСЕ профили (для очереди KYC)
-- ------------------------------------------------------------
-- Базовая политика profiles_select_own (миграция 0007) отдаёт пользователю
-- только его собственный профиль. Эта политика ДОБАВЛЯЕТ админу доступ на
-- чтение всех профилей (несколько SELECT-политик объединяются по OR),
-- чтобы собрать очередь верификации (profiles в статусе pending).
-- Проверка через public.is_admin() (миграция 0015).
-- ============================================================
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
  on public.profiles
  for select
  to authenticated
  using (public.is_admin());


-- ############################################################
-- >>> МИГРАЦИЯ: 0020_enforce_verified_booking.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0020: Серверный гейт верификации на бронирование
-- ============================================================
-- Вторая (реальная) линия обороны гейта верификации. Клиентский гейт
-- во FlutterFlow — это UX; настоящую защиту даёт этот триггер: он не даст
-- создать бронь пользователю без пройденной верификации, даже если UI обойдён
-- (прямой INSERT в bookings). Соответствует принципу Thick Backend (CLAUDE.md).
-- ============================================================

create or replace function public.enforce_verified_booking()
returns trigger
language plpgsql
as $$
declare
  v_status verification_status_type;
begin
  -- Тянем статус верификации арендатора (создателя брони)
  select verification_status
    into v_status
  from public.profiles
  where id = new.customer_id;

  -- Бронировать может только верифицированный пользователь
  if v_status is distinct from 'verified' then
    raise exception 'Бронирование доступно только верифицированным пользователям'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function public.enforce_verified_booking()
  is 'Гейт: запрещает создание брони, если customer не прошёл верификацию (verified)';

-- Триггер срабатывает ДО вставки брони — неверифицированный INSERT отклоняется.
create trigger trg_enforce_verified_booking
  before insert on public.bookings
  for each row execute function public.enforce_verified_booking();


-- ############################################################
-- >>> МИГРАЦИЯ: 0021_get_vendor_balance.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0021: Баланс владельца (вендора)
-- ============================================================
-- Доступный баланс вендора = сумма завершённых выплат (payout/completed).
-- Выплаты переходят в completed при завершении аренды (complete_booking,
-- миграция 0012). Пока аренда не завершена, payout висит в pending и в
-- баланс не попадает. Так владелец видит реально заработанное.
-- ============================================================
create or replace function public.get_vendor_balance(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  -- coalesce → 0.0, если выплат ещё не было
  select coalesce(sum(t.amount), 0.0)::numeric
  from public.transactions t
  where t.user_id = p_user_id
    and t.type = 'payout'
    and t.status = 'completed';
$$;

comment on function public.get_vendor_balance(uuid)
  is 'Доступный баланс владельца: сумма завершённых выплат (payout/completed). 0.0 если выплат нет';

-- Доступно авторизованным. Функция считает баланс по переданному p_user_id;
-- на клиенте передаём currentUser.uid (свой баланс).
grant execute on function public.get_vendor_balance(uuid) to authenticated;


-- ############################################################
-- >>> МИГРАЦИЯ: 0022_reviews_and_ratings.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0022: Отзывы и рейтинги после аренды
-- ============================================================
-- Отзыв можно оставить только по ЗАВЕРШЁННОЙ (completed) броне, один отзыв
-- на бронь (UNIQUE booking_id). Средний рейтинг и число отзывов машины
-- пересчитываются триггером автоматически при любом изменении reviews.
-- ============================================================


-- ============================================================
-- 1) Поля рейтинга в cars + индекс для сортировки каталога
-- ============================================================
alter table public.cars
  add column if not exists rating_avg    numeric(3,2) not null default 0.00,  -- средний балл 0.00..5.00
  add column if not exists reviews_count integer      not null default 0;      -- число отзывов

comment on column public.cars.rating_avg    is 'Средний рейтинг машины (пересчитывается триггером)';
comment on column public.cars.reviews_count is 'Количество отзывов (пересчитывается триггером)';

-- Индекс под сортировку "сначала с высоким рейтингом" в каталоге.
-- rating_avg по убыванию, reviews_count по убыванию — при равном балле выше
-- те, у кого больше отзывов (надёжнее).
create index if not exists idx_cars_rating
  on public.cars (rating_avg desc, reviews_count desc);


-- ============================================================
-- 2) ТАБЛИЦА: reviews
-- ============================================================
create table public.reviews (
  id           uuid        primary key default gen_random_uuid(),
  -- UNIQUE: один отзыв на одну бронь
  booking_id   uuid        not null unique references public.bookings (id) on delete cascade,
  car_id       uuid        not null references public.cars (id) on delete cascade,
  customer_id  uuid        not null references auth.users (id) on delete cascade,
  rating       integer     not null,
  comment      text,
  created_at   timestamptz not null default now(),

  -- Оценка строго 1..5
  constraint chk_review_rating check (rating between 1 and 5)
);

comment on table public.reviews is 'Отзывы по завершённым арендам (1 отзыв на бронь)';

create index idx_reviews_car_id on public.reviews (car_id);


-- ============================================================
-- ТРИГГЕР-ГЕЙТ: отзыв только по завершённой (completed) броне,
-- и только автором этой брони. CHECK не может читать другую таблицу,
-- поэтому проверяем триггером BEFORE INSERT.
-- ============================================================
create or replace function public.check_review_allowed()
returns trigger
language plpgsql
as $$
declare
  v_booking public.bookings;
begin
  select b.* into v_booking
  from public.bookings b
  where b.id = new.booking_id;

  if v_booking.id is null then
    raise exception 'Бронь % не найдена', new.booking_id
      using errcode = 'no_data_found';
  end if;

  -- Отзыв оставляет только автор брони
  if v_booking.customer_id is distinct from new.customer_id then
    raise exception 'Отзыв может оставить только автор брони'
      using errcode = 'insufficient_privilege';
  end if;

  -- Только по завершённой аренде
  if v_booking.status <> 'completed' then
    raise exception 'Отзыв можно оставить только по завершённой аренде (статус completed)'
      using errcode = 'check_violation';
  end if;

  -- car_id отзыва должен соответствовать машине брони (защита от подмены)
  new.car_id := v_booking.car_id;

  return new;
end;
$$;

create trigger tg_check_review_allowed
  before insert on public.reviews
  for each row execute function public.check_review_allowed();


-- ============================================================
-- 3) RLS для reviews
-- ============================================================
alter table public.reviews enable row level security;

-- SELECT: отзывы видят все (гости и авторизованные) — публичный рейтинг.
create policy "reviews_select_public" on public.reviews
  for select using (true);

-- INSERT: только автор брони (customer_id = auth.uid()) и только по
-- завершённой броне (EXISTS-проверка дублирует триггер — двойная защита).
create policy "reviews_insert_own_completed" on public.reviews
  for insert to authenticated
  with check (
    auth.uid() = customer_id
    and exists (
      select 1 from public.bookings b
      where b.id = reviews.booking_id
        and b.customer_id = auth.uid()
        and b.status = 'completed'
    )
  );


-- ============================================================
-- 4) ТРИГГЕР tg_update_car_rating — авто-пересчёт рейтинга машины
-- ------------------------------------------------------------
-- AFTER INSERT/UPDATE/DELETE: пересчитывает AVG(rating) и COUNT(*) для
-- затронутой машины и атомарно обновляет cars.rating_avg / reviews_count.
-- При DELETE берём car_id из OLD, иначе из NEW. При UPDATE со сменой car_id
-- (маловероятно, но возможно) пересчитываем обе машины.
-- ============================================================
create or replace function public.update_car_rating()
returns trigger
language plpgsql
as $$
declare
  v_car_id uuid;
begin
  -- Определяем затронутую машину
  if tg_op = 'DELETE' then
    v_car_id := old.car_id;
  else
    v_car_id := new.car_id;
  end if;

  -- Пересчёт и атомарное обновление агрегатов машины.
  -- coalesce(avg, 0) — если отзывов не осталось, рейтинг обнуляется.
  update public.cars c
     set rating_avg = coalesce((
           select round(avg(r.rating), 2)
           from public.reviews r
           where r.car_id = v_car_id
         ), 0.00),
         reviews_count = (
           select count(*)
           from public.reviews r
           where r.car_id = v_car_id
         )
   where c.id = v_car_id;

  -- Если UPDATE сменил car_id — пересчитываем и старую машину
  if tg_op = 'UPDATE' and old.car_id is distinct from new.car_id then
    update public.cars c
       set rating_avg = coalesce((
             select round(avg(r.rating), 2)
             from public.reviews r
             where r.car_id = old.car_id
           ), 0.00),
           reviews_count = (
             select count(*)
             from public.reviews r
             where r.car_id = old.car_id
           )
     where c.id = old.car_id;
  end if;

  return null;  -- AFTER-триггер: возвращаемое значение игнорируется
end;
$$;

comment on function public.update_car_rating()
  is 'Пересчёт cars.rating_avg и reviews_count при изменении reviews';

create trigger tg_update_car_rating
  after insert or update or delete on public.reviews
  for each row execute function public.update_car_rating();


-- ############################################################
-- >>> МИГРАЦИЯ: 0023_favorites.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0023: Избранное (Favorites / Bookmarks)
-- ============================================================
-- Закладки пользователя на объявления. Одна машина у пользователя — одна
-- закладка (UNIQUE). Управление «лайком» одной кнопкой через toggle_favorite.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА: favorites
-- ============================================================
create table public.favorites (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  car_id      uuid        not null references public.cars (id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- Одна и та же машина не может быть в избранном дважды у одного пользователя
  constraint uq_favorites_user_car unique (user_id, car_id)
);

comment on table public.favorites is 'Избранные объявления пользователя (закладки)';

-- Индекс под выборку "моё избранное" (свежие сверху)
create index idx_favorites_user on public.favorites (user_id, created_at desc);


-- ============================================================
-- RLS: пользователь работает только со своими закладками
-- ============================================================
alter table public.favorites enable row level security;

-- SELECT: только свои
create policy "favorites_select_own" on public.favorites
  for select to authenticated using (auth.uid() = user_id);

-- INSERT: только от своего имени
create policy "favorites_insert_own" on public.favorites
  for insert to authenticated with check (auth.uid() = user_id);

-- DELETE: только свои
create policy "favorites_delete_own" on public.favorites
  for delete to authenticated using (auth.uid() = user_id);


-- ============================================================
-- 2) VIEW: favorites_with_car_details
-- ------------------------------------------------------------
-- Закладки + данные машины + первое фото для списка «Избранное» в FlutterFlow.
-- security_invoker = true → VIEW наследует RLS favorites (пользователь видит
-- только свои закладки). price отдаём оба (продажа/аренда) — карточка покажет
-- нужную по флагам is_for_sale/is_for_rent.
-- ============================================================
create or replace view public.favorites_with_car_details
with (security_invoker = true)
as
select
  f.id,
  f.user_id,
  f.car_id,
  f.created_at,

  -- Данные объявления
  c.brand,
  c.model,
  c.year,
  c.city,
  c.is_for_sale,
  c.is_for_rent,
  c.sale_price,
  c.rent_price_daily,
  c.currency,
  c.rating_avg,
  c.reviews_count,
  c.status,

  -- Первое фото машины (минимальный order_index)
  img.image_url as car_photo

from public.favorites f
join public.cars c on c.id = f.car_id
left join lateral (
  select ci.image_url
  from public.car_images ci
  where ci.car_id = f.car_id
  order by ci.order_index asc
  limit 1
) img on true;

comment on view public.favorites_with_car_details
  is 'Избранное + данные машины и первое фото. RLS наследуется от favorites (security_invoker)';


-- ============================================================
-- 3) RPC toggle_favorite(p_car_id) — переключатель «лайка»
-- ------------------------------------------------------------
-- user_id = auth.uid(). Если машина уже в избранном — удаляет (возвращает
-- false = убрано из избранного). Если нет — добавляет (возвращает true).
-- Одна кнопка на клиенте без ветвления.
-- ============================================================
create or replace function public.toggle_favorite(p_car_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_exists boolean;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Есть ли уже закладка на эту машину
  select exists (
    select 1 from public.favorites
    where user_id = v_user and car_id = p_car_id
  ) into v_exists;

  if v_exists then
    -- Была в избранном — удаляем
    delete from public.favorites
    where user_id = v_user and car_id = p_car_id;
    return false;  -- убрано из избранного
  else
    -- Не было — добавляем. ON CONFLICT — страховка от гонки
    -- (двойной тап не создаст дубль благодаря UNIQUE-констрейнту).
    insert into public.favorites (user_id, car_id)
    values (v_user, p_car_id)
    on conflict (user_id, car_id) do nothing;
    return true;   -- добавлено в избранное
  end if;
end;
$$;

comment on function public.toggle_favorite(uuid)
  is 'Переключатель избранного: удаляет (false) или добавляет (true) закладку. user_id = auth.uid()';

grant execute on function public.toggle_favorite(uuid) to authenticated;


-- ############################################################
-- >>> МИГРАЦИЯ: 0024_notifications.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0024: Уведомления + авто-генерация триггерами
-- ============================================================
-- Системные алерты пользователям при новых сообщениях и смене статуса броней.
-- Запись в notifications делают только триггеры (SECURITY DEFINER),
-- прямой клиентский INSERT закрыт RLS. Пользователь читает свои уведомления
-- и помечает их прочитанными.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА: notifications
-- ------------------------------------------------------------
-- type      — категория: 'chat_message' | 'booking_status_changed' | ...
-- action_id — ID связанной сущности (chat_id / booking_id) для перехода
--             по тапу на уведомление.
-- ============================================================
create table public.notifications (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,  -- получатель
  title       text        not null,
  body        text,
  type        text        not null,
  action_id   uuid,                                                                -- chat_id / booking_id
  is_read     boolean     not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.notifications is 'Системные уведомления пользователей (генерируются триггерами)';

-- Индекс под выборку "мои уведомления" и подсчёт непрочитанных
create index idx_notifications_user
  on public.notifications (user_id, created_at desc);
create index idx_notifications_unread
  on public.notifications (user_id) where not is_read;


-- ============================================================
-- RLS: пользователь видит и помечает прочитанными только свои
-- ------------------------------------------------------------
-- INSERT напрямую ЗАПРЕЩЁН (политики на insert нет) — пишут только триггеры
-- через SECURITY DEFINER, обходя RLS.
-- ============================================================
alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications
  for select to authenticated using (auth.uid() = user_id);

-- UPDATE: владелец может менять свои уведомления (в первую очередь is_read)
create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ============================================================
-- 2) ТРИГГЕР tg_notify_on_message — уведомление о новом сообщении
-- ------------------------------------------------------------
-- AFTER INSERT на messages. Определяет получателя (второй участник чата)
-- и создаёт уведомление с обрезанным до 50 символов текстом.
-- SECURITY DEFINER — чтобы писать в notifications в обход RLS.
-- ============================================================
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat        public.chats;
  v_recipient   uuid;
  v_preview     text;
begin
  -- Находим чат сообщения
  select * into v_chat
  from public.chats
  where id = new.chat_id;

  if v_chat.id is null then
    return new;  -- на всякий случай: нет чата — молча выходим
  end if;

  -- Получатель = участник чата, который НЕ отправитель
  if new.sender_id = v_chat.buyer_id then
    v_recipient := v_chat.seller_id;
  else
    v_recipient := v_chat.buyer_id;
  end if;

  -- Превью текста: обрезаем до 50 символов, длинный — с многоточием
  v_preview := left(new.text, 50);
  if length(new.text) > 50 then
    v_preview := v_preview || '…';
  end if;

  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_recipient,
    'Новое сообщение',
    v_preview,
    'chat_message',
    new.chat_id            -- по тапу открыть этот чат
  );

  return new;
end;
$$;

create trigger tg_notify_on_message
  after insert on public.messages
  for each row execute function public.notify_on_message();


-- ============================================================
-- 3) ТРИГГЕР tg_notify_on_booking_status — уведомления по броням
-- ------------------------------------------------------------
-- AFTER INSERT OR UPDATE OF status на bookings.
--   INSERT           → уведомление ВЛАДЕЛЬЦУ машины ("Новый запрос на аренду").
--   UPDATE статуса   → уведомление КЛИЕНТУ, текст зависит от нового статуса.
-- SECURITY DEFINER для записи в notifications.
-- ============================================================
create or replace function public.notify_on_booking_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_title  text;
  v_body   text;
begin
  if tg_op = 'INSERT' then
    -- Новая бронь — уведомляем владельца машины
    select user_id into v_owner
    from public.cars
    where id = new.car_id;

    if v_owner is not null then
      insert into public.notifications (user_id, title, body, type, action_id)
      values (
        v_owner,
        'Новый запрос на аренду',
        'Поступил новый запрос на бронирование вашего автомобиля',
        'booking_status_changed',
        new.id
      );
    end if;

    return new;
  end if;

  -- UPDATE: реагируем только если статус реально изменился
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- Текст под новый статус (адресат — клиент)
    case new.status
      when 'confirmed' then v_title := 'Бронь подтверждена';
                            v_body  := 'Владелец подтвердил вашу бронь. Можно переходить к оплате.';
      when 'paid'      then v_title := 'Бронь оплачена';
                            v_body  := 'Оплата прошла успешно. Хорошей поездки!';
      when 'rejected'  then v_title := 'Бронь отклонена';
                            v_body  := 'К сожалению, владелец отклонил вашу бронь.';
      when 'cancelled' then v_title := 'Бронь отменена';
                            v_body  := 'Бронирование было отменено.';
      when 'completed' then v_title := 'Аренда завершена';
                            v_body  := 'Аренда завершена. Оставьте отзыв о поездке!';
      else v_title := null;  -- прочие статусы уведомлением не сопровождаем
    end case;

    if v_title is not null then
      insert into public.notifications (user_id, title, body, type, action_id)
      values (
        new.customer_id,     -- уведомляем клиента
        v_title,
        v_body,
        'booking_status_changed',
        new.id
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger tg_notify_on_booking_status
  after insert or update of status on public.bookings
  for each row execute function public.notify_on_booking_status();


-- ============================================================
-- REALTIME: включаем репликацию notifications
-- ------------------------------------------------------------
-- Чтобы бэйдж и лента уведомлений обновлялись в реальном времени.
-- Идемпотентно (DO-блок с проверкой), чтобы повторный прогон не падал.
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;


-- ############################################################
-- >>> МИГРАЦИЯ: 0025_notify_on_kyc_status.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0025: Уведомления о смене KYC-статуса
-- ============================================================
-- Триггер на profiles: при смене verification_status создаёт уведомление
-- пользователю. Активирует ветку 'kyc_status_changed' в диспетчере переходов
-- экрана уведомлений. Запись в notifications — SECURITY DEFINER (обход RLS).
-- ============================================================
create or replace function public.notify_on_kyc_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Реагируем только на реальное изменение статуса верификации
  if new.verification_status is distinct from old.verification_status then

    if new.verification_status = 'verified' then
      insert into public.notifications (user_id, title, body, type, action_id)
      values (
        new.id,
        'Верификация пройдена!',
        'Ваш профиль успешно подтвержден. Теперь вам доступна аренда авто.',
        'kyc_status_changed',
        new.id
      );

    elsif new.verification_status = 'rejected' then
      insert into public.notifications (user_id, title, body, type, action_id)
      values (
        new.id,
        'Документы отклонены',
        -- Текст причины из verification_comment; подстраховка на случай null
        coalesce(new.verification_comment, 'Проверьте документы и подайте повторно.'),
        'kyc_status_changed',
        new.id
      );
    end if;

  end if;

  return new;
end;
$$;

comment on function public.notify_on_kyc_status()
  is 'Уведомление пользователю при смене KYC-статуса (verified / rejected)';

-- AFTER UPDATE OF verification_status — срабатывает только при изменении этой колонки
create trigger tg_notify_on_kyc_status
  after update of verification_status on public.profiles
  for each row execute function public.notify_on_kyc_status();


-- ############################################################
-- >>> МИГРАЦИЯ: 0026_profile_user_type.sql
-- ############################################################

-- ============================================================
-- AUTO.RS — Миграция 0026: Тип пользователя (customer / vendor)
-- ============================================================
-- Разделение пользователей на клиентов и арендодателей/продавцов.
-- Плюс флаг role_selected — прошёл ли пользователь онбординг выбора роли
-- (нужен, чтобы отличить «первый вход» от осознанно выбранного 'customer').
-- ============================================================

alter table public.profiles
  -- Тип пользователя. default 'customer' — чтобы значение всегда было валидным.
  add column if not exists user_type text not null default 'customer',
  -- Прошёл ли онбординг выбора роли. false у новых → показываем Bottom Sheet.
  add column if not exists role_selected boolean not null default false;

-- Ограничиваем допустимые значения user_type
alter table public.profiles
  drop constraint if exists chk_user_type;
alter table public.profiles
  add constraint chk_user_type check (user_type in ('customer', 'vendor'));

comment on column public.profiles.user_type
  is 'Тип пользователя: customer (ищет машину) / vendor (сдаёт/продаёт)';
comment on column public.profiles.role_selected
  is 'true, если пользователь прошёл онбординг выбора роли';

-- ============================================================
-- AUTO.RS — Миграция 0029: Справочник марок и моделей
-- ============================================================
-- Раньше марка/модель хранились только текстом в public.cars, а списки
-- в фильтрах собирались distinct'ом из объявлений — пустой каталог до
-- появления объявлений и уязвимость к опечаткам.
--
-- Вводим два справочника:
--   car_brands  — марки (Audi, BMW, Zastava…)
--   car_models  — модели, привязанные к марке (brand_id → car_brands.id)
--
-- Автопополнение: триггер на public.cars при вставке/обновлении заносит
-- новую марку/модель в справочник, если её там ещё нет. Так каталог
-- растёт «по факту» новых объявлений — как и просил заказчик.
--
-- Нормализация (f_normalize = unaccent+lower) обеспечивает двуалфавитность
-- и защиту от дублей по регистру/диакритике. Уникальность — по *_norm.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ТАБЛИЦА МАРОК
-- ------------------------------------------------------------
create table public.car_brands (
  id         uuid        primary key default uuid_generate_v4(),
  name       text        not null,                              -- отображаемое название (латиница как в источнике)
  -- Нормализованное имя. GENERATED — считается самой БД, руками не задать,
  -- всегда согласовано с name. На нём держится уникальность и поиск.
  name_norm  text        generated always as (public.f_normalize(name)) stored,
  created_at timestamptz not null default now(),

  constraint uq_car_brands_norm unique (name_norm)
);

comment on table public.car_brands is 'Справочник марок авто (нормализованная уникальность name_norm)';

-- ------------------------------------------------------------
-- 2. ТАБЛИЦА МОДЕЛЕЙ
-- ------------------------------------------------------------
create table public.car_models (
  id         uuid        primary key default uuid_generate_v4(),
  brand_id   uuid        not null references public.car_brands (id) on delete cascade,
  name       text        not null,
  name_norm  text        generated always as (public.f_normalize(name)) stored,
  created_at timestamptz not null default now(),

  -- Модель уникальна В ПРЕДЕЛАХ марки: 'RX' есть и у Lexus, и у Exeed.
  constraint uq_car_models_brand_norm unique (brand_id, name_norm)
);

comment on table public.car_models is 'Справочник моделей авто, привязанных к марке';

-- Индексы под выборки: модели марки + триграммный нечёткий поиск.
create index idx_car_models_brand_id  on public.car_models (brand_id);
create index idx_car_brands_name_trgm on public.car_brands using gin (name_norm gin_trgm_ops);
create index idx_car_models_name_trgm on public.car_models using gin (name_norm gin_trgm_ops);

-- ------------------------------------------------------------
-- 3. RLS: справочник читают все, пишут только через триггер/админ
-- ------------------------------------------------------------
alter table public.car_brands enable row level security;
alter table public.car_models enable row level security;

-- Чтение доступно гостям и авторизованным (нужно для фильтров каталога).
create policy "car_brands_select_all" on public.car_brands
  for select using (true);
create policy "car_models_select_all" on public.car_models
  for select using (true);

-- Прямых INSERT/UPDATE/DELETE политик НЕ создаём: обычные пользователи
-- не правят справочник напрямую. Наполнение идёт через SECURITY DEFINER
-- триггер (обходит RLS) и через сид/админ-скрипты под service_role.

-- ------------------------------------------------------------
-- 4. АВТОПОПОЛНЕНИЕ СПРАВОЧНИКА ИЗ ОБЪЯВЛЕНИЙ
-- ------------------------------------------------------------
-- При создании/изменении объявления гарантируем наличие его марки и
-- модели в справочнике. Работает как «расширение по факту»: продавец
-- ввёл новую модель — она сразу появляется в каталоге фильтров.
--
-- SECURITY DEFINER — чтобы вставка в справочник прошла в обход RLS.
-- on conflict do nothing — идемпотентно, гонок не боится (уник-констрейнт).
create or replace function public.f_ensure_brand_model()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand_id uuid;
begin
  -- Пустые/пробельные значения игнорируем (в cars они not null, но перестрахуемся).
  if new.brand is null or btrim(new.brand) = '' then
    return new;
  end if;

  -- Марка: вставляем при отсутствии, затем достаём id по нормализованному имени.
  insert into public.car_brands (name)
  values (btrim(new.brand))
  on conflict (name_norm) do nothing;

  select id into v_brand_id
  from public.car_brands
  where name_norm = public.f_normalize(new.brand);

  -- Модель: только если задана и марка найдена.
  if v_brand_id is not null and new.model is not null and btrim(new.model) <> '' then
    insert into public.car_models (brand_id, name)
    values (v_brand_id, btrim(new.model))
    on conflict (brand_id, name_norm) do nothing;
  end if;

  return new;
end;
$$;

comment on function public.f_ensure_brand_model()
  is 'Триггерная: заносит марку/модель объявления в справочник (идемпотентно)';

-- Триггер срабатывает только когда марка/модель заданы или изменились,
-- чтобы не дёргать справочник на каждом апдейте цены/статуса.
create trigger trg_cars_ensure_brand_model
  after insert or update of brand, model on public.cars
  for each row
  execute function public.f_ensure_brand_model();

-- ------------------------------------------------------------
-- 5. RPC ДЛЯ ФРОНТА: списки марок и моделей
-- ------------------------------------------------------------
-- Фронт FlutterFlow вызывает эти функции для выпадающих списков фильтров,
-- вместо сбора distinct из объявлений.

-- Список всех марок (алфавит). Возвращаем id — удобно для каскада моделей.
create or replace function public.get_car_brands()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name
  from public.car_brands b
  order by b.name;
$$;

comment on function public.get_car_brands() is 'Список марок для фильтров каталога';

-- Модели выбранной марки. Марку принимаем и по id, и по названию —
-- что удобнее фронту. Хотя бы один параметр должен быть задан.
create or replace function public.get_car_models(
  p_brand_id   uuid default null,
  p_brand_name text default null
)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.name
  from public.car_models m
  join public.car_brands b on b.id = m.brand_id
  where
    (p_brand_id   is not null and b.id = p_brand_id)
    or (p_brand_name is not null
        and b.name_norm = public.f_normalize(p_brand_name))
  order by m.name;
$$;

comment on function public.get_car_models(uuid, text)
  is 'Модели выбранной марки (по id или названию) для каскадных фильтров';

-- Права на чтение справочника — гостям и авторизованным.
grant execute on function public.get_car_brands()            to anon, authenticated;
grant execute on function public.get_car_models(uuid, text)  to anon, authenticated;

-- ============================================================
-- AUTO.RS — Миграция 0030: Бесконечная лента каталога («крутилка»)
-- ============================================================
-- ЗАЧЕМ:
--   Каталог не должен «заканчиваться». Когда клиент долистал все
--   объявления текущего круга, он начинает новый круг: новый seed,
--   offset = 0, полная перетасовка — и продолжает подгрузку тех же
--   объявлений в новом случайном порядке. Заглушка нужна только когда
--   объявлений вообще нет (0 строк по фильтру).
--
-- ЧТО МЕНЯЕМ в search_cars_advanced:
--   + p_seed        integer  — seed круга (стабильный псевдослучайный порядок)
--   + p_offset      integer  — смещение пагинации внутри круга
--   + p_limit       integer  — размер страницы (было жёстко 100)
--   + p_shuffle_all boolean  — true → полная перетасовка (круги 2+),
--                              false → свежие сверху + хвост по seed (круг 1)
--
--   Порядок при одном seed СТАБИЛЕН (md5 от id+seed) — offset-пагинация
--   не «плывёт»: ни дублей, ни пропусков при скролле внутри круга.
--
--   Гео-сортировка (по близости) при p_shuffle_all=false и заданных
--   координатах сохраняется приоритетной — «рядом со мной» важнее рандома.
--
-- Сигнатура меняется → удаляем старую 16-параметровую версию (перегрузка).
-- ============================================================
drop function if exists public.search_cars_advanced(
  text, text, double precision, double precision, double precision,
  text, text, text, integer, integer, integer, numeric, numeric, text, text, text
);

create or replace function public.search_cars_advanced(
  p_listing_type text default null,             -- 'sale' | 'rent' | null
  p_search_query text default null,             -- строка поиска | null
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
  -- НОВОЕ: бесконечная лента
  p_seed         integer default 0,             -- seed круга
  p_offset       integer default 0,             -- смещение пагинации
  p_limit        integer default 20,            -- размер страницы
  p_shuffle_all  boolean default false          -- true → полный шафл (круги 2+)
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
    -- 1) Гео-близость (если заданы координаты и это НЕ круг полного шафла).
    --    «Рядом со мной» приоритетнее рандома на первом круге.
    case
      when not p_shuffle_all
       and (select user_point from params) is not null
       and c.location is not null
      then st_distance(c.location, (select user_point from params))
    end asc nulls last,
    -- 2) Блок «свежих» наверху — ТОЛЬКО на первом круге (p_shuffle_all=false).
    --    На кругах 2+ выражение ложно для всех строк → ключ «выключается»,
    --    остаётся чистый псевдослучайный порядок по seed (ключ 4).
    (not p_shuffle_all
      and c.created_at > now() - interval '3 days') desc,
    -- 3) Внутри блока свежих — новые выше.
    case
      when not p_shuffle_all and c.created_at > now() - interval '3 days'
      then c.created_at
    end desc,
    -- 4) Стабильный псевдослучайный порядок по seed: один seed — один и тот
    --    же порядок на все страницы круга (offset-пагинация не «плывёт»),
    --    новый seed — новая перетасовка.
    md5(c.id::text || p_seed::text)
  limit  p_limit
  offset p_offset;
$$;

comment on function public.search_cars_advanced is
  'Каталог v3: фильтры + гео + бесконечная «крутилка» (seed/offset/shuffle_all). Первый круг — свежие/близкие сверху, хвост по seed; круги 2+ — полная перетасовка.';

-- Права: доступно гостям и авторизованным
grant execute on function public.search_cars_advanced(
  text, text, double precision, double precision, double precision,
  text, text, text, integer, integer, integer, numeric, numeric, text, text, text,
  integer, integer, integer, boolean
) to anon, authenticated;

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

-- ============================================================
-- AUTO.RS — Миграция 0033: create_car_v2 + кузов/КПП/топливо
-- ============================================================
-- Форма подачи объявления должна собирать те же характеристики, что и
-- фильтры каталога. Добавляем в RPC три НЕОБЯЗАТЕЛЬНЫХ параметра:
--   p_body_type    body_type          (тип кузова)
--   p_transmission transmission_type  (коробка передач)
--   p_fuel         fuel_type          (топливо)
-- NULL — характеристика не указана (в cars эти поля nullable).
--
-- Сигнатура меняется → удаляем старую версию (перегрузка → неоднозначность
-- в PostgREST). Тело — как в 0014, плюс запись новых полей.
-- ============================================================
drop function if exists public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[]
);

create or replace function public.create_car_v2(
  listing_type   text,
  brand          text,
  model          text,
  year           integer,
  mileage        integer,
  price          numeric,
  currency       text,
  city           text,
  lat            double precision,
  lng            double precision,
  photo_urls     text[],
  -- НОВОЕ: характеристики (как в фильтрах). NULL = не указано.
  p_body_type    body_type         default null,
  p_transmission transmission_type default null,
  p_fuel         fuel_type         default null
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
  v_sale     numeric(12,2);
  v_rent     numeric(12,2);
  v_location geography(point, 4326);
  v_url      text;
  v_idx      integer := 0;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация для создания объявления'
      using errcode = 'insufficient_privilege';
  end if;

  -- Маппинг назначения и цены по типу объявления
  if listing_type = 'sale' then
    v_is_sale := true;
    v_sale := price;
  elsif listing_type = 'rent' then
    v_is_rent := true;
    v_rent := price;
  elsif listing_type = 'both' then
    v_is_sale := true;
    v_is_rent := true;
    v_sale := price;
    v_rent := price;
  else
    raise exception 'Некорректный listing_type = % (ожидалось sale/rent/both)', listing_type
      using errcode = 'check_violation';
  end if;

  -- PostGIS-точка из координат (порядок: долгота, широта!)
  if lat is not null and lng is not null then
    v_location := st_setsrid(st_makepoint(lng, lat), 4326)::geography;
  end if;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    body_type, transmission, fuel,
    currency, sale_price, rent_price_daily,
    city, location
  )
  values (
    v_user_id, v_is_sale, v_is_rent,
    brand, model, year, mileage,
    p_body_type, p_transmission, p_fuel,
    coalesce(currency, 'EUR')::currency_code, v_sale, v_rent,
    city, v_location
  )
  returning id into v_car_id;

  -- Фото → car_images с сохранением порядка
  if photo_urls is not null then
    foreach v_url in array photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (v_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_car_id;
end;
$$;

comment on function public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type
) is 'Создание объявления (+кузов/КПП/топливо, PostGIS-локация, фото). user_id = auth.uid()';

grant execute on function public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type
) to authenticated;

-- ============================================================
-- AUTO.RS — Миграция 0034: Цена необязательна + описание в RPC
-- ============================================================
-- 1) Цена перестаёт быть обязательной: объявление можно опубликовать без
--    цены — в каталоге и карточке она отображается как «Договорная».
--    Снимаем constraints chk_sale_price / chk_rent_price (миграция 0003),
--    которые требовали цену при is_for_sale / is_for_rent.
-- 2) create_car_v2 принимает описание (p_description). Колонка
--    cars.description уже существует (0003) — просто заполняем её.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Снимаем обязательность цены
-- ------------------------------------------------------------
alter table public.cars drop constraint if exists chk_sale_price;
alter table public.cars drop constraint if exists chk_rent_price;

-- ------------------------------------------------------------
-- 2) create_car_v2 + описание. Сигнатура меняется → удаляем версию 0033.
-- ------------------------------------------------------------
drop function if exists public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type
);

create or replace function public.create_car_v2(
  listing_type   text,
  brand          text,
  model          text,
  year           integer,
  mileage        integer,
  price          numeric,                        -- NULL → «Договорная»
  currency       text,
  city           text,
  lat            double precision,
  lng            double precision,
  photo_urls     text[],
  p_body_type    body_type         default null,
  p_transmission transmission_type default null,
  p_fuel         fuel_type         default null,
  p_description  text              default null  -- НОВОЕ: описание (до 6000)
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
  v_sale     numeric(12,2);
  v_rent     numeric(12,2);
  v_location geography(point, 4326);
  v_url      text;
  v_idx      integer := 0;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация для создания объявления'
      using errcode = 'insufficient_privilege';
  end if;

  -- Маппинг назначения. Цена может быть NULL (тогда «Договорная»).
  if listing_type = 'sale' then
    v_is_sale := true;
    v_sale := price;
  elsif listing_type = 'rent' then
    v_is_rent := true;
    v_rent := price;
  elsif listing_type = 'both' then
    v_is_sale := true;
    v_is_rent := true;
    v_sale := price;
    v_rent := price;
  else
    raise exception 'Некорректный listing_type = % (ожидалось sale/rent/both)', listing_type
      using errcode = 'check_violation';
  end if;

  if lat is not null and lng is not null then
    v_location := st_setsrid(st_makepoint(lng, lat), 4326)::geography;
  end if;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    body_type, transmission, fuel,
    currency, sale_price, rent_price_daily,
    city, description, location
  )
  values (
    v_user_id, v_is_sale, v_is_rent,
    brand, model, year, mileage,
    p_body_type, p_transmission, p_fuel,
    coalesce(currency, 'EUR')::currency_code, v_sale, v_rent,
    city, nullif(btrim(coalesce(p_description, '')), ''), v_location
  )
  returning id into v_car_id;

  if photo_urls is not null then
    foreach v_url in array photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (v_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_car_id;
end;
$$;

comment on function public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text
) is 'Создание объявления (+кузов/КПП/топливо/описание, цена опциональна). user_id = auth.uid()';

grant execute on function public.create_car_v2(
  text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text
) to authenticated;

