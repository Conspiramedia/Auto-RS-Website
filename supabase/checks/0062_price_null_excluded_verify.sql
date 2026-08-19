-- ============================================================
-- RS AUTO — ПРОВЕРКА 0062 (не миграция, запускать вручную).
-- ============================================================
-- Проверяет, что договорная цена (price is null) исключается из выдачи
-- при ЛЮБОЙ заданной границе цены и остаётся видимой, когда границы нет.
--
-- КАК ЗАПУСКАТЬ: скопировать целиком в SQL Editor после применения 0062.
-- Ожидаемый результат: во всех строках столбец ok = true.
--
-- БЕЗОПАСНОСТЬ ДАННЫХ. Файл создаёт временные объявления и УДАЛЯЕТ их в
-- конце. Всё завёрнуто в одну транзакцию с rollback, поэтому боевые
-- данные не меняются даже при обрыве посреди запуска. Тестовые строки
-- помечены городом «__CHECK_0062__», чтобы их нельзя было спутать с
-- настоящими и чтобы уборка не задела чужое.
--
-- ПОЧЕМУ ПРОВЕРЯЕМ ОБЕ ФУНКЦИИ. 0062 правит и выдачу, и счётчик: они
-- обязаны отбирать строки по одинаковому where, иначе сверки 0060
-- разойдутся. Здесь это проверяется явно, на тех же фильтрах.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Тестовые данные: три объявления одной марки в вымышленном городе.
-- ------------------------------------------------------------
-- user_id берём у любого существующего профиля: cars.user_id — внешний
-- ключ, произвольный uuid вставить нельзя. Строки всё равно временные.
with any_user as (
  select id from public.profiles limit 1
)
insert into public.cars (
  user_id, brand, model, year, mileage,
  body_type, transmission, fuel, currency,
  sale_price, city, status, is_for_sale, is_for_rent
)
select
  u.id, 'CheckBrand0062', v.model, 2015, 100000,
  'sedan', 'manual', 'petrol', 'EUR',
  v.price, '__CHECK_0062__', 'active', true, false
from any_user u,
  (values
    -- Договорная: цена не указана. Именно она не должна попадать
    -- в выдачу при заданной границе.
    ('Dogovorna', null::numeric),
    -- Дешёвое: попадает в «до 5000».
    ('Cheap',     3000::numeric),
    -- Дорогое: в «до 5000» не попадает, в «от 5000» — да.
    ('Expensive', 9000::numeric)
  ) as v(model, price);

-- ------------------------------------------------------------
-- Сверки.
-- ------------------------------------------------------------
with checks as (
  -- ---------- 1) Без фильтра цены: видны ВСЕ три ----------
  -- Договорное объявление не должно пропадать само по себе: 0062 меняет
  -- поведение только когда граница цены задана.
  select
    '1. без фильтра цены — видны все 3' as case_name,
    (select count(*) from public.search_cars_advanced(
      p_brand => 'CheckBrand0062', p_limit => 100000
    )) as actual,
    3 as expected

  -- ---------- 2) «до 5000»: договорное ИСКЛЮЧЕНО ----------
  -- Ключевая проверка бага. Раньше coalesce(..., 0) выдавал договорное
  -- за нулевое, и здесь возвращалось 2 (Dogovorna + Cheap).
  union all
  select
    '2. до 5000 — только Cheap (договорное исключено)',
    (select count(*) from public.search_cars_advanced(
      p_brand => 'CheckBrand0062', p_price_to => 5000, p_limit => 100000
    )),
    1

  -- ---------- 3) «до 5000»: договорного НЕТ поимённо ----------
  -- Считать строки мало: убеждаемся, что исключено именно договорное,
  -- а не какое-то другое объявление.
  union all
  select
    '3. до 5000 — Dogovorna отсутствует',
    (select count(*) from public.search_cars_advanced(
      p_brand => 'CheckBrand0062', p_price_to => 5000, p_limit => 100000
    ) where model = 'Dogovorna'),
    0

  -- ---------- 4) «от 5000»: договорное исключено ----------
  -- До 0062 здесь тоже было верно, но по случайности (0 < 5000).
  -- Фиксируем поведение, чтобы правка его не сломала.
  union all
  select
    '4. от 5000 — только Expensive',
    (select count(*) from public.search_cars_advanced(
      p_brand => 'CheckBrand0062', p_price_from => 5000, p_limit => 100000
    )),
    1

  -- ---------- 5) Обе границы: договорное исключено ----------
  union all
  select
    '5. 1000–20000 — Cheap и Expensive, без договорного',
    (select count(*) from public.search_cars_advanced(
      p_brand => 'CheckBrand0062',
      p_price_from => 1000, p_price_to => 20000, p_limit => 100000
    )),
    2

  -- ---------- 6) Счётчик согласован с выдачей: без фильтра ----------
  union all
  select
    '6. счётчик = выдача (без фильтра цены)',
    public.get_search_total_count(p_brand => 'CheckBrand0062'),
    (select count(*)::integer from public.search_cars_advanced(
      p_brand => 'CheckBrand0062', p_limit => 100000
    ))

  -- ---------- 7) Счётчик согласован с выдачей: «до 5000» ----------
  -- Если бы 0062 правила только выдачу, эта строка покраснела бы —
  -- вместе с двумя ценовыми сверками 0060.
  union all
  select
    '7. счётчик = выдача (до 5000)',
    public.get_search_total_count(
      p_brand => 'CheckBrand0062', p_price_to => 5000
    ),
    (select count(*)::integer from public.search_cars_advanced(
      p_brand => 'CheckBrand0062', p_price_to => 5000, p_limit => 100000
    ))

  -- ---------- 8) Счётчик согласован с выдачей: «от 5000» ----------
  union all
  select
    '8. счётчик = выдача (от 5000)',
    public.get_search_total_count(
      p_brand => 'CheckBrand0062', p_price_from => 5000
    ),
    (select count(*)::integer from public.search_cars_advanced(
      p_brand => 'CheckBrand0062', p_price_from => 5000, p_limit => 100000
    ))
)
select
  case_name        as "проверка",
  actual           as "получено",
  expected         as "ожидалось",
  actual = expected as ok
from checks
order by case_name;

-- Сводка: пустой результат = все проверки пройдены.
with checks as (
  select
    (select count(*) from public.search_cars_advanced(
      p_brand => 'CheckBrand0062', p_price_to => 5000, p_limit => 100000
    )) as to_5000,
    (select count(*) from public.search_cars_advanced(
      p_brand => 'CheckBrand0062', p_limit => 100000
    )) as no_filter
)
select 'РАСХОЖДЕНИЕ: договорная цена ведёт себя не как на сайте' as problem
from checks
where to_5000 <> 1 or no_filter <> 3;

-- ------------------------------------------------------------
-- Уборка. rollback отменяет и вставку тестовых строк, и всё остальное:
-- проверка ничего не оставляет после себя в базе.
-- ------------------------------------------------------------
rollback;
