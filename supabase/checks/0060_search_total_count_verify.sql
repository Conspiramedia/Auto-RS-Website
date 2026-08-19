-- ============================================================
-- RS AUTO — ПРОВЕРКА 0060 (не миграция, запускать вручную).
-- ============================================================
-- Файл НЕ применяется автоматически и ничего не меняет в схеме. Это
-- набор сверок: количество из get_search_total_count обязано совпадать
-- с числом строк, которые реально отдаёт search_cars_advanced на тех же
-- фильтрах. Расхождение означает, что блоки where разошлись.
--
-- КАК ЗАПУСКАТЬ: скопировать в SQL Editor после применения 0060.
-- Ожидаемый результат: во всех строках столбец ok = true.
--
-- Почему сравниваем с limit 100000, а не со страницей: search_cars_advanced
-- по умолчанию отдаёт 20 строк, и сравнение с count(*) без снятия лимита
-- было бы бессмысленным. Порядок (seed/shuffle) на количество не влияет.
-- ============================================================

with checks as (
  -- ---------- 1) Без фильтров: весь активный каталог ----------
  select
    'без фильтров' as case_name,
    public.get_search_total_count() as counted,
    (select count(*) from public.search_cars_advanced(
      p_limit => 100000
    )) as listed

  -- ---------- 2) Тип объявления: продажа ----------
  union all
  select
    'listing_type = sale',
    public.get_search_total_count(p_listing_type => 'sale'),
    (select count(*) from public.search_cars_advanced(
      p_listing_type => 'sale', p_limit => 100000
    ))

  -- ---------- 3) Тип объявления: аренда ----------
  union all
  select
    'listing_type = rent',
    public.get_search_total_count(p_listing_type => 'rent'),
    (select count(*) from public.search_cars_advanced(
      p_listing_type => 'rent', p_limit => 100000
    ))

  -- ---------- 4) Двуалфавитность: кириллица находит латиницу ----------
  -- Ключевая проверка f_normalize: «Фолксваген» обязано найти
  -- «Volkswagen», и счётчик обязан посчитать ровно те же строки.
  union all
  select
    'поиск кириллицей',
    public.get_search_total_count(p_search_query => 'Фолксваген'),
    (select count(*) from public.search_cars_advanced(
      p_search_query => 'Фолксваген', p_limit => 100000
    ))

  -- ---------- 5) Поиск латиницей ----------
  union all
  select
    'поиск латиницей',
    public.get_search_total_count(p_search_query => 'Volkswagen'),
    (select count(*) from public.search_cars_advanced(
      p_search_query => 'Volkswagen', p_limit => 100000
    ))

  -- ---------- 6) Диакритика: Škoda через голую латиницу ----------
  union all
  select
    'диакритика (Skoda)',
    public.get_search_total_count(p_search_query => 'Skoda'),
    (select count(*) from public.search_cars_advanced(
      p_search_query => 'Skoda', p_limit => 100000
    ))

  -- ---------- 7) Марка + город ----------
  union all
  select
    'brand + city',
    public.get_search_total_count(
      p_brand => 'Volkswagen', p_city => 'Beograd'
    ),
    (select count(*) from public.search_cars_advanced(
      p_brand => 'Volkswagen', p_city => 'Beograd', p_limit => 100000
    ))

  -- ---------- 8) Диапазон годов ----------
  union all
  select
    'год 2015–2020',
    public.get_search_total_count(p_year_from => 2015, p_year_to => 2020),
    (select count(*) from public.search_cars_advanced(
      p_year_from => 2015, p_year_to => 2020, p_limit => 100000
    ))

  -- ---------- 9) Пробег: объявления без пробега НЕ отсекаются ----------
  -- Тонкое место: условие в выдаче пропускает mileage is null. Если бы
  -- счётчик его не повторил, число оказалось бы меньше выдачи.
  union all
  select
    'пробег до 150000',
    public.get_search_total_count(p_mileage_max => 150000),
    (select count(*) from public.search_cars_advanced(
      p_mileage_max => 150000, p_limit => 100000
    ))

  -- ---------- 10) Цена: берётся по типу сделки, coalesce(...,0) ----------
  union all
  select
    'цена 1000–20000',
    public.get_search_total_count(
      p_price_from => 1000, p_price_to => 20000
    ),
    (select count(*) from public.search_cars_advanced(
      p_price_from => 1000, p_price_to => 20000, p_limit => 100000
    ))

  -- ---------- 11) Характеристики (enum-поля) ----------
  union all
  select
    'КПП automatic',
    public.get_search_total_count(p_transmission => 'automatic'),
    (select count(*) from public.search_cars_advanced(
      p_transmission => 'automatic', p_limit => 100000
    ))

  -- ---------- 12) Комбинация фильтров ----------
  union all
  select
    'комбинация',
    public.get_search_total_count(
      p_listing_type => 'sale',
      p_year_from    => 2010,
      p_price_to     => 30000,
      p_fuel         => 'diesel'
    ),
    (select count(*) from public.search_cars_advanced(
      p_listing_type => 'sale',
      p_year_from    => 2010,
      p_price_to     => 30000,
      p_fuel         => 'diesel',
      p_limit        => 100000
    ))

  -- ---------- 13) Заведомо пустая выборка ----------
  -- Обе функции обязаны сойтись и на нуле: счётчик не должен «находить»
  -- строки там, где выдача пуста.
  union all
  select
    'пустая выборка',
    public.get_search_total_count(p_brand => 'НетТакойМарки'),
    (select count(*) from public.search_cars_advanced(
      p_brand => 'НетТакойМарки', p_limit => 100000
    ))
)
select
  case_name    as "проверка",
  counted      as "get_search_total_count",
  listed       as "search_cars_advanced",
  counted = listed as ok
from checks
order by ok, case_name;

-- Сводка: если хотя бы одна проверка не сошлась — запрос вернёт строку.
-- Пустой результат = все проверки пройдены.
with checks as (
  select public.get_search_total_count() as c,
         (select count(*) from public.search_cars_advanced(p_limit => 100000)) as l
)
select 'РАСХОЖДЕНИЕ: счётчик и выдача не совпадают' as problem
from checks where c <> l;
