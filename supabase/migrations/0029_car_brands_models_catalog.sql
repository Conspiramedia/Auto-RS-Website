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
-- 6. НАЧАЛЬНОЕ НАПОЛНЕНИЕ (сид)
-- ============================================================
-- Полный список марок и моделей (латиница). Опечатки источника исправлены
-- (Cupra, Lynk & Co). Добавлены массовые для сербского рынка марки/модели,
-- которых не было в присланном файле (Lada, Zastava, Yugo, недостающие
-- модельные ряды VW/Opel/Ford/Renault/Mercedes/Audi/BMW/Toyota/Hyundai/Kia
-- и т.д.). Идемпотентно: on conflict do nothing.
-- ============================================================

-- Марки
insert into public.car_brands (name) values
  ('Acura'),
  ('Afeela'),
  ('Alfa Romeo'),
  ('Alpine'),
  ('Aston Martin'),
  ('Audi'),
  ('Avatr'),
  ('Baojun'),
  ('Bentley'),
  ('BMW'),
  ('Bugatti'),
  ('Buick'),
  ('BYD'),
  ('Cadillac'),
  ('Changan'),
  ('Chery'),
  ('Chevrolet'),
  ('Chrysler'),
  ('Citroen'),
  ('Cupra'),
  ('Dacia'),
  ('Daewoo'),
  ('Daihatsu'),
  ('Denza'),
  ('Dodge'),
  ('Dongfeng'),
  ('Exeed'),
  ('Ferrari'),
  ('Fiat'),
  ('Fisker'),
  ('Ford'),
  ('Forthing'),
  ('Foton'),
  ('GAC'),
  ('Geely'),
  ('Genesis'),
  ('GMC'),
  ('Great Wall'),
  ('Haval'),
  ('Hiphi'),
  ('Honda'),
  ('Hongqi'),
  ('Hummer'),
  ('Hyundai'),
  ('Ineos'),
  ('Infiniti'),
  ('Isuzu'),
  ('Iveco'),
  ('JAC'),
  ('Jaecoo'),
  ('Jaguar'),
  ('Jeep'),
  ('Jetour'),
  ('Jetta'),
  ('Kia'),
  ('Koenigsegg'),
  ('Lada'),
  ('Lamborghini'),
  ('Lancia'),
  ('Land Rover'),
  ('Leapmotor'),
  ('Lexus'),
  ('Li Auto'),
  ('Lincoln'),
  ('Lotus'),
  ('Lucid'),
  ('Lynk & Co'),
  ('M-Hero'),
  ('Mahindra'),
  ('Maserati'),
  ('Maxus'),
  ('Maybach'),
  ('Mazda'),
  ('McLaren'),
  ('Mercedes-Benz'),
  ('MG'),
  ('Mini'),
  ('Mitsubishi'),
  ('Moskvich'),
  ('Neta'),
  ('Nio'),
  ('Nissan'),
  ('Omoda'),
  ('Opel'),
  ('Pagani'),
  ('Peugeot'),
  ('Polestar'),
  ('Pontiac'),
  ('Porsche'),
  ('Proton'),
  ('Ram'),
  ('Ravon'),
  ('Renault'),
  ('Rimac'),
  ('Rivian'),
  ('Rolls-Royce'),
  ('Rover'),
  ('Saab'),
  ('Scion'),
  ('Seat'),
  ('Seres'),
  ('Skoda'),
  ('Smart'),
  ('SsangYong'),
  ('Subaru'),
  ('Suzuki'),
  ('Tank'),
  ('Tata'),
  ('Tesla'),
  ('Togg'),
  ('Toyota'),
  ('Trabant'),
  ('Vauxhall'),
  ('Venucia'),
  ('Volkswagen'),
  ('Volvo'),
  ('Voya'),
  ('Wartburg'),
  ('Wuling'),
  ('Xpeng'),
  ('Yangwang'),
  ('Yugo'),
  ('Zastava'),
  ('Zeekr')
on conflict (name_norm) do nothing;

-- Модели (привязка к марке по name_norm через подзапрос)
insert into public.car_models (brand_id, name) values
  ((select id from public.car_brands where name_norm = public.f_normalize('Acura')), 'MDX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Acura')), 'RDX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Acura')), 'TLX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Acura')), 'Integra'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Acura')), 'ZDX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Afeela')), 'Prototype'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Alfa Romeo')), 'Giulia'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Alfa Romeo')), 'Stelvio'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Alfa Romeo')), 'Tonale'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Alfa Romeo')), 'Junior'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Alpine')), 'A110'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Alpine')), 'A290'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Aston Martin')), 'DB12'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Aston Martin')), 'Vantage'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Aston Martin')), 'DBX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Aston Martin')), 'DBS'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'A4'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'A6'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'Q5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'Q7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'e-tron GT'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'Q8 e-tron'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'A1'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'A3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'A5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'A7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'A8'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'Q2'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'Q3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'Q4 e-tron'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Audi')), 'Q8'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Avatr')), '07'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Avatr')), '11'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Avatr')), '12'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Baojun')), 'Yep'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Baojun')), 'Cloud'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Baojun')), 'RC-5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Bentley')), 'Continental GT'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Bentley')), 'Bentayga'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Bentley')), 'Flying Spur'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), '3 Series'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), '5 Series'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), 'X5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), 'X7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), 'i4'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), 'iX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), '1 Series'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), '2 Series'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), 'X1'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), 'X3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BMW')), 'X6'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Bugatti')), 'Chiron'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Bugatti')), 'Tourbillon'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Bugatti')), 'Bolide'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Buick')), 'Enclave'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Buick')), 'Encore'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Buick')), 'Regal'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Buick')), 'GL8'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BYD')), 'Han'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BYD')), 'Tang'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BYD')), 'Seal'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BYD')), 'Dolphin'),
  ((select id from public.car_brands where name_norm = public.f_normalize('BYD')), 'Seagull'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Cadillac')), 'Escalade'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Cadillac')), 'XT5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Cadillac')), 'Lyriq'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Cadillac')), 'CT5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Changan')), 'UNI-K'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Changan')), 'UNI-V'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Changan')), 'CS55 Plus'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Changan')), 'Hunter'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chery')), 'Tiggo 7 Pro Max'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chery')), 'Tiggo 8 Pro Max'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chery')), 'Arrizo 8'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chery')), 'Tiggo 4 Pro'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chevrolet')), 'Tahoe'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chevrolet')), 'Suburban'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chevrolet')), 'Corvette'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chevrolet')), 'Camaro'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chevrolet')), 'Bolt EV'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chrysler')), 'Pacifica'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Chrysler')), '300'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Citroen')), 'C4'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Citroen')), 'C5 Aircross'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Citroen')), 'C3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Citroen')), 'Berlingo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Citroen')), 'C3 Aircross'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Citroen')), 'C4 Cactus'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Citroen')), 'Jumpy'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Cupra')), 'Formentor'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Cupra')), 'Born'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Cupra')), 'Tavascan'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Cupra')), 'Leon'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dacia')), 'Duster'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dacia')), 'Sandero'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dacia')), 'Logan'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dacia')), 'Spring'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dacia')), 'Jogger'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dacia')), 'Lodgy'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dacia')), 'Dokker'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Daewoo')), 'Nexia'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Daewoo')), 'Matiz'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Daewoo')), 'Lanos'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Daewoo')), 'Gentra'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Daihatsu')), 'Terios'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Daihatsu')), 'Copen'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Daihatsu')), 'Tanto'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Denza')), 'D9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Denza')), 'N7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Denza')), 'Z9 GT'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dodge')), 'Charger'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dodge')), 'Challenger'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dodge')), 'Durango'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dodge')), 'Hornet'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dongfeng')), 'Shine Max'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dongfeng')), 'Huge'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dongfeng')), 'Mage'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Dongfeng')), 'Box'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Exeed')), 'RX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Exeed')), 'VX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Exeed')), 'TXL'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Exeed')), 'LX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ferrari')), 'Purosangue'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ferrari')), 'Roma'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ferrari')), '296 GTB'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ferrari')), 'SF90 Stradale'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Fiat')), '500'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Fiat')), 'Panda'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Fiat')), 'Tipo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Fiat')), 'Doblo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Fiat')), 'Punto'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Fiat')), 'Bravo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Fiat')), 'Freemont'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Fiat')), '500X'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Fisker')), 'Ocean'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ford')), 'Focus'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ford')), 'Explorer'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ford')), 'Mustang'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ford')), 'F-150'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ford')), 'Kuga'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ford')), 'Fiesta'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ford')), 'Mondeo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ford')), 'Puma'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ford')), 'S-Max'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ford')), 'Transit'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Forthing')), 'T5 Evo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Forthing')), 'Yacht'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Foton')), 'Tunland'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Foton')), 'Sauvana'),
  ((select id from public.car_brands where name_norm = public.f_normalize('GAC')), 'GS8'),
  ((select id from public.car_brands where name_norm = public.f_normalize('GAC')), 'M8'),
  ((select id from public.car_brands where name_norm = public.f_normalize('GAC')), 'GS3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Geely')), 'Monjaro'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Geely')), 'Coolray'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Geely')), 'Tugella'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Geely')), 'Preface'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Geely')), 'Atlas'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Genesis')), 'GV80'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Genesis')), 'GV70'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Genesis')), 'G80'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Genesis')), 'G70'),
  ((select id from public.car_brands where name_norm = public.f_normalize('GMC')), 'Yukon'),
  ((select id from public.car_brands where name_norm = public.f_normalize('GMC')), 'Sierra'),
  ((select id from public.car_brands where name_norm = public.f_normalize('GMC')), 'Yukon Denali'),
  ((select id from public.car_brands where name_norm = public.f_normalize('GMC')), 'Hummer EV'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Great Wall')), 'Poer'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Great Wall')), 'Poer KingKong'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Great Wall')), 'Wingle'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Haval')), 'Jolion'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Haval')), 'Dargo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Haval')), 'F7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Haval')), 'H9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Haval')), 'H6'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hiphi')), 'HiPhi X'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hiphi')), 'HiPhi Z'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hiphi')), 'HiPhi Y'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Honda')), 'Civic'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Honda')), 'Accord'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Honda')), 'CR-V'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Honda')), 'Pilot'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Honda')), 'HR-V'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hongqi')), 'H5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hongqi')), 'HS5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hongqi')), 'H9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hongqi')), 'E-HS9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hummer')), 'H2'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hummer')), 'H3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'Solaris'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'Creta'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'Tucson'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'Santa Fe'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'Sonata'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'Ioniq 5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'i10'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'i20'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'i30'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'Kona'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'Bayon'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Hyundai')), 'Accent'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ineos')), 'Grenadier'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Infiniti')), 'QX60'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Infiniti')), 'QX80'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Infiniti')), 'QX50'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Infiniti')), 'Q50'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Isuzu')), 'D-Max'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Isuzu')), 'MU-X'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Iveco')), 'Daily'),
  ((select id from public.car_brands where name_norm = public.f_normalize('JAC')), 'JS6'),
  ((select id from public.car_brands where name_norm = public.f_normalize('JAC')), 'JS4'),
  ((select id from public.car_brands where name_norm = public.f_normalize('JAC')), 'T8 Pro'),
  ((select id from public.car_brands where name_norm = public.f_normalize('JAC')), 'T9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jaecoo')), 'J7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jaecoo')), 'J8'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jaguar')), 'F-Pace'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jaguar')), 'I-Pace'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jaguar')), 'XF'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jeep')), 'Grand Cherokee'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jeep')), 'Wrangler'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jeep')), 'Compass'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jeep')), 'Avenger'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jetour')), 'Dashing'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jetour')), 'T2'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jetour')), 'X70 Plus'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jetour')), 'X90 Plus'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jetta')), 'VA3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jetta')), 'VS5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Jetta')), 'VS7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'Rio'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'Sportage'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'K5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'Sorento'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'Ceed'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'EV9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'Picanto'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'Cee''d'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'Stonic'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'Niro'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'Soul'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Kia')), 'Venga'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Koenigsegg')), 'Jesko'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Koenigsegg')), 'Gemera'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Koenigsegg')), 'CC850'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lada')), 'Niva'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lada')), 'Vesta'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lada')), 'Granta'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lada')), 'Priora'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lada')), 'Samara'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lada')), '110'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lada')), 'Kalina'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lamborghini')), 'Urus'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lamborghini')), 'Revuelto'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lamborghini')), 'Temerario'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lancia')), 'Ypsilon'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lancia')), 'Delta'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lancia')), 'Musa'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Land Rover')), 'Range Rover'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Land Rover')), 'Defender'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Land Rover')), 'Discovery'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Land Rover')), 'Evoque'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Leapmotor')), 'C11'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Leapmotor')), 'C10'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Leapmotor')), 'T03'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lexus')), 'RX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lexus')), 'NX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lexus')), 'LX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lexus')), 'ES'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lexus')), 'IS'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Li Auto')), 'L6'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Li Auto')), 'L7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Li Auto')), 'L8'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Li Auto')), 'L9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Li Auto')), 'Mega'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lincoln')), 'Navigator'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lincoln')), 'Aviator'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lincoln')), 'Nautilus'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lotus')), 'Eletre'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lotus')), 'Emeya'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lotus')), 'Emira'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lucid')), 'Air'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lucid')), 'Gravity'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lynk & Co')), '01'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lynk & Co')), '03'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lynk & Co')), '05'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Lynk & Co')), '08'),
  ((select id from public.car_brands where name_norm = public.f_normalize('M-Hero')), '917'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mahindra')), 'Scorpio'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mahindra')), 'XUV700'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mahindra')), 'Thar'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Maserati')), 'Grecale'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Maserati')), 'Levante'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Maserati')), 'Ghibli'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Maserati')), 'MC20'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Maxus')), 'G90'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Maxus')), 'Mifa 9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Maxus')), 'T90'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Maybach')), 'S-Class'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Maybach')), 'GLS'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Maybach')), 'EQS SUV'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mazda')), 'CX-5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mazda')), 'Mazda 6'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mazda')), 'Mazda 3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mazda')), 'CX-30'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mazda')), 'CX-90'),
  ((select id from public.car_brands where name_norm = public.f_normalize('McLaren')), 'Artura'),
  ((select id from public.car_brands where name_norm = public.f_normalize('McLaren')), '750S'),
  ((select id from public.car_brands where name_norm = public.f_normalize('McLaren')), 'P1'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'C-Class'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'E-Class'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'S-Class'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'GLC'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'GLE'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'G-Class'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'A-Class'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'B-Class'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'CLA'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'GLA'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'GLB'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'GLK'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'Sprinter'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mercedes-Benz')), 'Vito'),
  ((select id from public.car_brands where name_norm = public.f_normalize('MG')), 'MG 4 EV'),
  ((select id from public.car_brands where name_norm = public.f_normalize('MG')), 'MG 5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('MG')), 'Cyberster'),
  ((select id from public.car_brands where name_norm = public.f_normalize('MG')), 'ZS'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mini')), 'Cooper'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mini')), 'Countryman'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mini')), 'Aceman'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mitsubishi')), 'Outlander'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mitsubishi')), 'Pajero Sport'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mitsubishi')), 'ASX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mitsubishi')), 'L200'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Mitsubishi')), 'Eclipse Cross'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Moskvich')), '3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Moskvich')), '6'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Moskvich')), '412'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Moskvich')), '2141'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Neta')), 'Neta V'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Neta')), 'Neta U'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Neta')), 'Neta S'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nio')), 'ET5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nio')), 'ET7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nio')), 'ES6'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nio')), 'EC7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nio')), 'EL8'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nissan')), 'Qashqai'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nissan')), 'X-Trail'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nissan')), 'Juke'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nissan')), 'Patrol'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nissan')), 'Leaf'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nissan')), 'Micra'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nissan')), 'Note'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Nissan')), 'Navara'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Omoda')), 'C5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Omoda')), 'S5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Opel')), 'Astra'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Opel')), 'Mokka'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Opel')), 'Grandland'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Opel')), 'Corsa'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Opel')), 'Insignia'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Opel')), 'Zafira'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Opel')), 'Meriva'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Opel')), 'Vectra'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Pagani')), 'Utopia'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Pagani')), 'Huayra'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Peugeot')), '3008'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Peugeot')), '5008'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Peugeot')), '208'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Peugeot')), '408'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Peugeot')), '308'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Peugeot')), '2008'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Peugeot')), 'Partner'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Peugeot')), 'Rifter'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Polestar')), 'Polestar 2'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Polestar')), 'Polestar 3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Polestar')), 'Polestar 4'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Pontiac')), 'GTO'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Pontiac')), 'Firebird'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Pontiac')), 'Vibe'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Porsche')), 'Cayenne'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Porsche')), 'Macan'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Porsche')), '911'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Porsche')), 'Panamera'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Porsche')), 'Taycan'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Proton')), 'X50'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Proton')), 'X70'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Proton')), 'Saga'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ram')), '1500'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ram')), '2500'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ram')), 'TRX'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ravon')), 'R2'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ravon')), 'R4'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Ravon')), 'Nexia R3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Logan'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Duster'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Sandero'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Captur'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Scenic E-Tech'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Clio'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Megane'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Talisman'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Kadjar'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Arkana'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Twingo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Kangoo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Renault')), 'Espace'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Rimac')), 'Nevera'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Rivian')), 'R1T'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Rivian')), 'R1S'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Rivian')), 'R2'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Rolls-Royce')), 'Cullinan'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Rolls-Royce')), 'Ghost'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Rolls-Royce')), 'Phantom'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Rolls-Royce')), 'Spectre'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Rover')), '75'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Rover')), '25'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Saab')), '9-3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Saab')), '9-5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Scion')), 'tC'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Scion')), 'xB'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Seat')), 'Leon'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Seat')), 'Ibiza'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Seat')), 'Ateca'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Seat')), 'Arona'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Seat')), 'Tarraco'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Seat')), 'Toledo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Seres')), 'Aito M5'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Seres')), 'Aito M7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Seres')), 'Aito M9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Skoda')), 'Octavia'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Skoda')), 'Rapid'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Skoda')), 'Kodiaq'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Skoda')), 'Karoq'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Skoda')), 'Superb'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Skoda')), 'Fabia'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Skoda')), 'Scala'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Skoda')), 'Kamiq'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Skoda')), 'Enyaq'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Smart')), '#1'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Smart')), '#3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Smart')), 'Fortwo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('SsangYong')), 'Rexton'),
  ((select id from public.car_brands where name_norm = public.f_normalize('SsangYong')), 'Korando'),
  ((select id from public.car_brands where name_norm = public.f_normalize('SsangYong')), 'Actyon'),
  ((select id from public.car_brands where name_norm = public.f_normalize('SsangYong')), 'Torres'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Subaru')), 'Forester'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Subaru')), 'Outback'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Subaru')), 'Impreza'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Subaru')), 'XV / Crosstrek'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Suzuki')), 'Vitara'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Suzuki')), 'Jimny'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Suzuki')), 'Swift'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Suzuki')), 'Grand Vitara'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tank')), '300'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tank')), '400'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tank')), '500'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tank')), '700'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tata')), 'Nexon'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tata')), 'Harrier'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tata')), 'Safari'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tata')), 'Punch'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tesla')), 'Model 3'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tesla')), 'Model Y'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tesla')), 'Model S'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tesla')), 'Model X'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Tesla')), 'Cybertruck'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Togg')), 'T10X'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'Camry'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'Corolla'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'RAV4'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'Land Cruiser Prado'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'Land Cruiser 300'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'Hilux'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'Yaris'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'Auris'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'C-HR'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'Aygo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'Avensis'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Toyota')), 'Proace'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Trabant')), '601'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Vauxhall')), 'Corsa'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Vauxhall')), 'Astra'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Vauxhall')), 'Mokka'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Venucia')), 'V-Online'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Venucia')), 'Star'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'Polo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'Golf'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'Tiguan'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'Passat'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'Touareg'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'ID.4'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'Caddy'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'Amarok'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'T-Roc'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'T-Cross'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volkswagen')), 'Up'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volvo')), 'XC60'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volvo')), 'XC90'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volvo')), 'XC40'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volvo')), 'S60'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Volvo')), 'EX30'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Voya')), 'Free'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Voya')), 'Dream'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Voya')), 'Passion'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Wartburg')), '353'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Wuling')), 'Hongguang Mini EV'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Wuling')), 'Bingo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Wuling')), 'Starlight'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Xpeng')), 'G6'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Xpeng')), 'G9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Xpeng')), 'P7'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Xpeng')), 'X9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Yangwang')), 'U8'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Yangwang')), 'U9'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Yugo')), 'Koral'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Yugo')), 'Florida'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Yugo')), 'Tempo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zastava')), 'Yugo'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zastava')), '128'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zastava')), '101'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zastava')), 'Koral'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zastava')), 'Skala'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zastava')), '10'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zeekr')), '001'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zeekr')), '007'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zeekr')), 'X'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zeekr')), '009'),
  ((select id from public.car_brands where name_norm = public.f_normalize('Zeekr')), 'Mix')
on conflict (brand_id, name_norm) do nothing;
