-- ============================================================
-- AUTO.RS — Миграция 0052: данные для SEO-страниц сайта
-- ============================================================
-- ЗАЧЕМ:
--   SEO-страницы /cars/{brand}/ и /cars/{brand}/{model}/ и файл sitemap.xml
--   строятся на сервере Next.js. Собирать их из справочника car_brands /
--   car_models НЕЛЬЗЯ: справочник пополняется по факту подачи объявления и
--   содержит в том числе марки, у которых сейчас нет ни одного активного
--   объявления на продажу. Такая страница отдаст пустой каталог, а массово
--   проиндексированные пустые страницы — прямой путь к пессимизации сайта.
--
--   Поэтому источником для SEO-страниц служат САМИ ОБЪЯВЛЕНИЯ: в выдачу
--   попадают только те марки/модели/города, где есть живой контент, и сразу
--   с количеством — оно нужно и в заголовке страницы («BMW: 42 объявления»),
--   и для приоритета в sitemap.
--
-- Все функции — SECURITY DEFINER + grant для anon: сайт ходит в Supabase
-- под анонимным ключом, без service_role.
-- ============================================================


-- ------------------------------------------------------------
-- 1) get_site_brands() — марки с активными объявлениями
-- ------------------------------------------------------------
-- brand_slug — то, что попадёт в URL: /cars/{brand_slug}/. Строим его на
-- сервере, а не на клиенте, чтобы адрес был единым для сайта, sitemap и
-- будущих ссылок из приложения; расхождение слагов дало бы дубли страниц.
--
-- Правило слага: f_normalize (снимает регистр и диакритику Đ Č Š Ž), затем
-- любая последовательность не-буквенно-цифровых символов → дефис, и обрезка
-- дефисов по краям. «Mercedes-Benz» → «mercedes-benz», «Škoda» → «skoda».
-- ------------------------------------------------------------
create or replace function public.f_slugify(txt text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both '-' from
    regexp_replace(public.f_normalize(coalesce(txt, '')), '[^a-z0-9]+', '-', 'g')
  );
$$;

comment on function public.f_slugify(text)
  is 'URL-слаг из произвольного текста: нормализация (unaccent+lower) + замена разделителей на дефис';

grant execute on function public.f_slugify(text) to anon, authenticated;


create or replace function public.get_site_brands()
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
  -- Группируем по нормализованному имени: «BMW» и «bmw», введённые разными
  -- продавцами, — одна марка и одна страница. Для показа берём max(brand):
  -- нужен один детерминированный вариант написания из имеющихся.
  select
    max(c.brand)                  as brand,
    public.f_slugify(c.brand)     as brand_slug,
    count(*)                      as cars_count
  from public.cars c
  where c.status = 'active' and c.is_for_sale
  group by public.f_slugify(c.brand)
  -- Пустой слаг возможен только при мусорном названии (одни спецсимволы) —
  -- такая страница не имеет адреса, исключаем.
  having public.f_slugify(max(c.brand)) <> ''
  order by count(*) desc, max(c.brand);
$$;

comment on function public.get_site_brands()
  is 'Марки, у которых есть активные объявления на продажу, со слагом и счётчиком. Источник для /cars/{brand} и sitemap';

grant execute on function public.get_site_brands() to anon, authenticated;


-- ------------------------------------------------------------
-- 2) get_site_models(p_brand) — модели марки с активными объявлениями
-- ------------------------------------------------------------
-- Марка принимается и как слаг, и как обычное название: страница знает слаг
-- из URL, а вызов из другого места удобнее делать по имени. Сравнение идёт
-- по слагу с обеих сторон, поэтому оба варианта совпадут.
-- ------------------------------------------------------------
create or replace function public.get_site_models(p_brand text)
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
    and c.is_for_sale
    and public.f_slugify(c.brand) = public.f_slugify(p_brand)
  group by public.f_slugify(c.model)
  having public.f_slugify(max(c.model)) <> ''
  order by count(*) desc, max(c.model);
$$;

comment on function public.get_site_models(text)
  is 'Модели указанной марки с активными объявлениями. Марка принимается слагом или названием';

grant execute on function public.get_site_models(text) to anon, authenticated;


-- ------------------------------------------------------------
-- 3) get_site_cities() — города с активными объявлениями
-- ------------------------------------------------------------
-- Нужны для фильтра города в каталоге и для блока перелинковки на главной.
-- ------------------------------------------------------------
create or replace function public.get_site_cities()
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
  where c.status = 'active' and c.is_for_sale
  group by public.f_slugify(c.city)
  having public.f_slugify(max(c.city)) <> ''
  order by count(*) desc, max(c.city);
$$;

comment on function public.get_site_cities()
  is 'Города с активными объявлениями на продажу, со слагом и счётчиком';

grant execute on function public.get_site_cities() to anon, authenticated;


-- ------------------------------------------------------------
-- 4) get_sitemap_cars(p_offset, p_limit) — карточки для sitemap.xml
-- ------------------------------------------------------------
-- Отдаём МИНИМУМ полей: id и дату изменения. Тянуть для sitemap полные
-- строки объявлений незачем — на больших объёмах это лишний трафик и память.
--
-- Пагинация обязательна: sitemap ограничен 50 000 URL на файл, и генератор
-- обходит базу порциями, формируя при необходимости sitemap-index.
--
-- В sitemap попадают ТОЛЬКО active: проданные (sold) открываются по прямой
-- ссылке, но продвигать их в индексе не нужно.
--
-- Порядок по id (а не по дате) — стабилен при пагинации: новые объявления,
-- появляющиеся между запросами страниц, не сдвигают уже отданные строки.
-- ------------------------------------------------------------
create or replace function public.get_sitemap_cars(
  p_offset integer default 0,
  p_limit  integer default 5000
)
returns table (
  id         uuid,
  site_url   text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    public.f_car_site_url(c.id),
    c.updated_at
  from public.cars c
  where c.status = 'active' and c.is_for_sale
  order by c.id
  limit  least(greatest(coalesce(p_limit, 5000), 1), 50000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.get_sitemap_cars(integer, integer)
  is 'Активные объявления на продажу для sitemap.xml: id, канонический URL, дата изменения';

grant execute on function public.get_sitemap_cars(integer, integer) to anon, authenticated;


-- ------------------------------------------------------------
-- 5) get_site_stats() — счётчики для главной страницы
-- ------------------------------------------------------------
-- Один вызов вместо трёх отдельных запросов при серверном рендере главной.
-- ------------------------------------------------------------
create or replace function public.get_site_stats()
returns table (
  cars_total   bigint,
  brands_total bigint,
  cities_total bigint,
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
    (select count(distinct public.f_slugify(brand)) from public.cars
      where status = 'active' and is_for_sale),
    (select count(distinct public.f_slugify(city)) from public.cars
      where status = 'active' and is_for_sale),
    -- Дилеры считаются только те, у кого есть живые объявления: пустая
    -- витрина в счётчике на главной вводила бы в заблуждение.
    (select count(distinct c.user_id)
      from public.cars c
      join public.profiles p on p.id = c.user_id
      where c.status = 'active' and c.is_for_sale
        and p.seller_kind = 'dealer');
$$;

comment on function public.get_site_stats()
  is 'Счётчики для главной: активные объявления, марки, города, дилеры с объявлениями';

grant execute on function public.get_site_stats() to anon, authenticated;


-- ------------------------------------------------------------
-- 6) get_car_images(p_car_id) — галерея карточки
-- ------------------------------------------------------------
-- car_images читается публично политикой car_images_read_all, но галерея
-- обязана показывать фото только тех объявлений, которые сайт вправе
-- открыть (active/sold) — иначе по прямому запросу утекут фотографии
-- объявлений, висящих на модерации или отклонённых.
-- ------------------------------------------------------------
create or replace function public.get_car_images(p_car_id uuid)
returns table (
  id          uuid,
  image_url   text,
  order_index integer
)
language sql
stable
security definer
set search_path = public
as $$
  select ci.id, ci.image_url, ci.order_index
  from public.car_images ci
  join public.cars c on c.id = ci.car_id
  where ci.car_id = p_car_id
    -- Те же правила видимости, что и в get_car_details (миграция 0048).
    and (
      c.status in ('active', 'sold')
      or c.user_id = auth.uid()
      or public.is_admin()
    )
  order by ci.order_index asc;
$$;

comment on function public.get_car_images(uuid)
  is 'Фотографии объявления по порядку. Видимость совпадает с get_car_details';

grant execute on function public.get_car_images(uuid) to anon, authenticated;
