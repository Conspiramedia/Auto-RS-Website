-- ============================================================
-- AUTO.RS — Миграция 0051: публичный каталог для САЙТА (Next.js)
-- ============================================================
-- ЗАЧЕМ ОТДЕЛЬНЫЕ ФУНКЦИИ, А НЕ ПРАВКА search_cars_advanced:
--   Приложение уже вызывает search_cars_advanced и search_cars_with_links
--   с фиксированными сигнатурами (20 параметров). Менять их нельзя —
--   сломаются живые вызовы Flutter. Поэтому миграция строго АДДИТИВНАЯ:
--   добавляются новые функции, существующие не трогаются вовсе.
--
-- ЧЕМ САЙТ ОТЛИЧАЕТСЯ ОТ ПРИЛОЖЕНИЯ:
--   1. НЕТ ШАФЛА. В приложении порядок псевдослучайный (md5(id||seed)) —
--      это осознанная механика «бесконечной крутилки». Для поискового
--      краулера такой порядок недопустим: при каждом обходе он видит
--      разный список на одном URL, что мешает индексации и вызывает
--      дубли. На сайте порядок ДЕТЕРМИНИРОВАН и задаётся p_sort.
--   2. ТОЛЬКО ПРОДАЖА. На старте сайт показывает исключительно
--      is_for_sale = true; аренда выключена продуктовым решением.
--      Фильтр зашит внутрь функции, а не передаётся параметром, —
--      чтобы клиент не мог случайно вытащить арендные объявления.
--   3. TOTAL_COUNT. Без общего числа результатов нельзя построить
--      пагинацию и rel=next/prev, а они обязательны для SEO-страниц.
--   4. НЕТ ПЕРСОНАЛИЗАЦИИ. hidden_cars (скрытые рекомендации) на сайте
--      не применяются: страница обязана быть одинаковой для гостя и для
--      краулера, иначе получаем cloaking-подобное расхождение выдачи.
--
-- ЦЕНА: на сайте это всегда sale_price (аренды нет), поэтому фильтры
--   price_from/price_to и сортировка по цене работают по одному полю —
--   без ветвления rent/sale, как в приложении.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Индексы под детерминированные сортировки сайта
-- ------------------------------------------------------------
-- Все выборки сайта всегда содержат условие status='active' AND is_for_sale,
-- поэтому индексы делаем ЧАСТИЧНЫМИ: они в разы компактнее полных и
-- покрывают ровно тот срез, который читает каталог.
-- Отдельный индекс на каждую сортировку не нужен — Postgres умеет читать
-- btree в обратном порядке, поэтому один индекс обслуживает и ASC, и DESC.

create index if not exists idx_cars_site_created
  on public.cars (created_at desc)
  where status = 'active' and is_for_sale;

create index if not exists idx_cars_site_price
  on public.cars (sale_price)
  where status = 'active' and is_for_sale;

create index if not exists idx_cars_site_year
  on public.cars (year)
  where status = 'active' and is_for_sale;

create index if not exists idx_cars_site_mileage
  on public.cars (mileage)
  where status = 'active' and is_for_sale;


-- ------------------------------------------------------------
-- 2) search_cars_public(...) — каталог сайта с сортировкой и total_count
-- ------------------------------------------------------------
-- total_count возвращается ОДНОЙ КОЛОНКОЙ В КАЖДОЙ СТРОКЕ через оконную
-- функцию count(*) over (). Это осознанный выбор: альтернатива —
-- второй запрос на подсчёт — означала бы два прохода по одному и тому же
-- набору фильтров и риск рассинхрона между страницей и счётчиком.
-- Оконная функция считает по полному отфильтрованному набору ДО применения
-- limit/offset, поэтому число корректно для любой страницы.
--
-- ДОПУСТИМЫЕ ЗНАЧЕНИЯ p_sort:
--   'fresh'        — свежие первыми (ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ для сайта)
--   'price_asc'    — цена по возрастанию
--   'price_desc'   — цена по убыванию
--   'year_desc'    — год: новее первыми
--   'year_asc'     — год: старее первыми
--   'mileage_asc'  — пробег: меньше первыми
-- Неизвестное значение молча трактуется как 'fresh': каталог обязан
-- отдать контент даже при кривом query-параметре в URL, а не упасть 500 —
-- иначе краулер получит ошибку на мусорной ссылке.
--
-- ПРОМО (is_vip + boosted_until > now()) поднимается наверх ТОЛЬКО при
-- сортировке 'fresh'. Если пользователь явно выбрал «сначала дешёвые»,
-- нарушать этот порядок рекламой нельзя — это ломает ожидание и выглядит
-- как обман. Так же поступают все крупные площадки.
-- ------------------------------------------------------------
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
  p_limit        integer default 24
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
      -- Пустая строка и строка из пробелов — это ОТСУТСТВИЕ запроса,
      -- а не запрос по пустому значению: '?q=' в URL не должен обнулять выдачу.
      nullif(trim(coalesce(p_search_query, '')), '') as raw_query,
      -- Нормализация: unaccent + lower. Даёт двуалфавитность
      -- (кириллица/латиница) и снятие диакритики Đ Č Š Ž.
      public.f_normalize(p_search_query)             as norm,
      -- Санитизация пагинации. Отрицательный offset — ошибка SQL, а такие
      -- значения легко приходят из ручного URL; поэтому зажимаем здесь.
      -- Верхняя граница limit защищает от выкачивания базы одним запросом.
      greatest(coalesce(p_offset, 0), 0)             as safe_offset,
      least(greatest(coalesce(p_limit, 24), 1), 100) as safe_limit,
      -- Приводим сорт к известному набору один раз, чтобы ниже не повторять
      -- coalesce в каждом выражении order by.
      case
        when p_sort in ('fresh', 'price_asc', 'price_desc',
                        'year_desc', 'year_asc', 'mileage_asc')
        then p_sort
        else 'fresh'
      end as sort_key
  ),
  filtered as (
    select
      c.*,
      -- Промо действует только когда флаг И срок актуальны одновременно:
      -- is_vip без даты (или с истёкшей) продвижением не считается.
      (c.is_vip and c.boosted_until is not null and c.boosted_until > now())
        as promoted_now,
      -- Счёт по всему отфильтрованному набору, до limit/offset.
      count(*) over () as total_rows
    from public.cars c, params p
    where
      c.status = 'active'
      -- Жёсткая граница продукта: сайт — только продажа.
      and c.is_for_sale
      -- Поиск строкой: триграммное совпадение (%) плюс подстрока — оба
      -- поверх f_normalize. «БМВ» находит «BMW», «Beograd» — «Београд».
      and (
        p.raw_query is null
        or public.f_normalize(c.brand) % p.norm
        or public.f_normalize(c.model) % p.norm
        or public.f_normalize(c.city)  % p.norm
        or public.f_normalize(c.brand) ilike '%' || p.norm || '%'
        or public.f_normalize(c.model) ilike '%' || p.norm || '%'
        or public.f_normalize(c.city)  ilike '%' || p.norm || '%'
      )
      -- Точные фильтры по справочным полям — тоже через нормализацию,
      -- чтобы /cars/bmw и /cars/BMW вели на один и тот же набор.
      and (p_brand is null or public.f_normalize(c.brand) = public.f_normalize(p_brand))
      and (p_model is null or public.f_normalize(c.model) = public.f_normalize(p_model))
      and (p_city  is null or public.f_normalize(c.city)  = public.f_normalize(p_city))
      and (p_year_from is null or c.year >= p_year_from)
      and (p_year_to   is null or c.year <= p_year_to)
      -- Пробег NULL (не указан) не отсекаем: объявление без пробега всё
      -- равно валидно и должно попадать в выдачу.
      and (p_mileage_max is null or c.mileage is null or c.mileage <= p_mileage_max)
      -- Цена: только sale_price, аренды на сайте нет. Объявления с NULL
      -- («Договорная») при заданной границе цены исключаются — сравнить
      -- договорную цену с числовым фильтром невозможно.
      and (p_price_from is null or c.sale_price >= p_price_from)
      and (p_price_to   is null or c.sale_price <= p_price_to)
      and (p_body_type    is null or c.body_type::text    = p_body_type)
      and (p_transmission is null or c.transmission::text = p_transmission)
      and (p_fuel         is null or c.fuel::text         = p_fuel)
  )
  select
    f.id, f.brand, f.model, f.year, f.mileage,
    f.body_type::text, f.transmission::text, f.fuel::text,
    f.currency::text, f.sale_price,
    f.city, f.status::text,
    f.promoted_now,
    public.f_car_site_url(f.id),
    -- Первое фото по порядку — обложка карточки в каталоге и OG-превью.
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
    -- Промо-блок — только в дефолтной сортировке (см. пояснение выше).
    case when p.sort_key = 'fresh' then f.promoted_now end desc nulls last,
    -- Далее выбранный пользователем порядок. NULLS LAST везде, где поле
    -- необязательное: объявления без цены/пробега уходят в конец, а не
    -- всплывают наверх при сортировке по возрастанию.
    case when p.sort_key = 'price_asc'   then f.sale_price end asc  nulls last,
    case when p.sort_key = 'price_desc'  then f.sale_price end desc nulls last,
    case when p.sort_key = 'year_desc'   then f.year       end desc nulls last,
    case when p.sort_key = 'year_asc'    then f.year       end asc  nulls last,
    case when p.sort_key = 'mileage_asc' then f.mileage    end asc  nulls last,
    case when p.sort_key = 'fresh'       then f.created_at end desc nulls last,
    -- ФИНАЛЬНЫЙ ТАЙБРЕЙК — обязателен. Без него строки с одинаковым
    -- значением сортировки могут менять относительный порядок между
    -- запросами, из-за чего одно объявление попадёт на две страницы
    -- пагинации, а другое не попадёт ни на одну. id уникален и стабилен.
    f.id
  limit  (select safe_limit  from params)
  offset (select safe_offset from params);
$$;

comment on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer)
  is 'Каталог САЙТА: только продажа, детерминированная сортировка (p_sort), total_count для пагинации. Без шафла и персонализации';

grant execute on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer) to anon, authenticated;


-- ------------------------------------------------------------
-- 3) get_similar_cars(p_car_id, p_limit) — похожие объявления на карточке
-- ------------------------------------------------------------
-- Блок «похожие» нужен и пользователю, и SEO: он даёт внутреннюю перелинковку
-- между карточками, без которой глубокие страницы плохо обходятся краулером.
--
-- Ранжирование по близости: сначала та же марка И модель, затем та же марка,
-- затем тот же город. Внутри — по разнице цены, чтобы предложения были
-- сопоставимы по бюджету, а не «Logan рядом с Porsche».
-- ------------------------------------------------------------
create or replace function public.get_similar_cars(
  p_car_id uuid,
  p_limit  integer default 8
)
returns table (
  id          uuid,
  brand       text,
  model       text,
  year        integer,
  mileage     integer,
  currency    text,
  sale_price  numeric,
  city        text,
  site_url    text,
  photo_url   text
)
language sql
stable
security definer
set search_path = public
as $$
  with src as (
    -- Исходное объявление. Берём его напрямую: функция SECURITY DEFINER,
    -- а отдаём только неперсональные поля, поэтому обхода RLS здесь
    -- достаточно и безопасно.
    select c.brand, c.model, c.city, c.sale_price
    from public.cars c
    where c.id = p_car_id
  )
  select
    c.id, c.brand, c.model, c.year, c.mileage,
    c.currency::text, c.sale_price, c.city,
    public.f_car_site_url(c.id),
    (select ci.image_url from public.car_images ci
      where ci.car_id = c.id
      order by ci.order_index asc
      limit 1)
  from public.cars c, src s
  where
    c.status = 'active'
    and c.is_for_sale
    -- Само объявление в список похожих попасть не должно.
    and c.id <> p_car_id
    -- Отсекаем совсем нерелевантное: связь хотя бы по марке или городу.
    and (
      public.f_normalize(c.brand) = public.f_normalize(s.brand)
      or public.f_normalize(c.city) = public.f_normalize(s.city)
    )
  order by
    -- Уровень близости: 0 — марка+модель, 1 — марка, 2 — только город.
    case
      when public.f_normalize(c.brand) = public.f_normalize(s.brand)
       and public.f_normalize(c.model) = public.f_normalize(s.model) then 0
      when public.f_normalize(c.brand) = public.f_normalize(s.brand) then 1
      else 2
    end asc,
    -- Внутри уровня — минимальная разница в цене. NULL (договорная) в конец.
    case
      when c.sale_price is not null and s.sale_price is not null
      then abs(c.sale_price - s.sale_price)
    end asc nulls last,
    -- Стабильный тайбрейк, чтобы блок не «дрожал» между рендерами SSR.
    c.id
  limit least(greatest(coalesce(p_limit, 8), 1), 24);
$$;

comment on function public.get_similar_cars(uuid, integer)
  is 'Похожие объявления для карточки сайта: марка+модель → марка → город, далее по близости цены';

grant execute on function public.get_similar_cars(uuid, integer) to anon, authenticated;
