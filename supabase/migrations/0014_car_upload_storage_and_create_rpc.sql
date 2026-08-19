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
