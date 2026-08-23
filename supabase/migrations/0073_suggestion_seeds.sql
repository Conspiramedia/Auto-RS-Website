-- ============================================================
-- AUTO.RS — Миграция 0073: заготовки для подсказок в строке поиска.
-- ============================================================
-- ЗАЧЕМ. Строка поиска каталога показывает вращающиеся подсказки вида
-- «BMW X5, 2019», «Audi do 15.000 €», «Dizel u Beogradu». Фразы обязаны
-- строиться по ЖИВЫМ данным: подсказка, ведущая в пустую выдачу, хуже
-- её отсутствия — человек решает, что поиск сломан.
--
-- КОГДА ВЫЗЫВАЕТСЯ. ТОЛЬКО НА СБОРКЕ САЙТА (scripts/generate-suggestions.ts
-- в npm-скрипте prebuild). С клиента и со страниц эта функция не
-- вызывается никогда, и вот почему:
--   * страницы каталога кэшируются (revalidate = 120), поэтому запрос
--     в рантайме всё равно замёрз бы в кэше вместе со страницей — то
--     есть «свежести» не дал бы, а нагрузку на базу дал бы на каждом
--     холодном рендере;
--   * список подсказок, меняющийся между рендерами, ломает SSR:
--     сервер и клиент разошлись бы в разметке;
--   * фразы «BMW X5, 2019» устаревают месяцами, а не минутами —
--     частота пересборки сайта здесь более чем достаточна.
-- Результат генератор записывает в lib/searchSuggestions.ts, который
-- лежит в git: сборка не падает, даже когда база недоступна.
--
-- ЧТО ОТДАЁТ. Не готовые фразы, а ЗАГОТОВКИ — сырые комбинации со
-- счётчиками. Склейка текста и склонение («u Beogradu» / «в Белграде»)
-- живут на стороне генератора: это работа со словарями локалей, а не
-- с данными, и в SQL ей делать нечего.
--
-- ПОРОГ. Комбинация возвращается, только если под неё есть минимум
-- p_min_count объявлений (по умолчанию 3). Одиночное объявление
-- продадут завтра, и подсказка станет ссылкой в пустоту.
--
-- ТОЛЬКО status = 'active' и только продажа (is_for_sale). Проданные,
-- архивные и снятые с публикации в подсказки не попадают — как и в
-- sitemap (см. 0052). Аренда исключена намеренно: у неё свои цены за
-- сутки, и фраза «Audi до 15 000 €» рядом с арендной ставкой читалась
-- бы как ошибка.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- get_suggestion_seeds(p_min_count, p_limit_per_kind)
-- ------------------------------------------------------------
-- Три вида заготовок в одной таблице, различаются колонкой kind.
-- Неиспользуемые для данного вида колонки приходят как NULL:
--
--   kind = 'brand_model_year'  → brand, model, year
--   kind = 'brand_price'       → brand, price_bucket
--   kind = 'fuel_city'         → fuel, city
--
-- Одна функция вместо трёх: генератор ходит в базу один раз, а на
-- стороне SQL это три ветки union all с общим фильтром. Три отдельные
-- RPC означали бы три круга сетевой задержки на сборке и три места,
-- где нужно одинаково повторить условие «active и на продажу».
--
-- price_bucket — ОКРУГЛЁННАЯ ВВЕРХ граница цены для фразы «до N €».
-- Берётся 60-й процентиль цен марки и округляется вверх до 500 €:
--   * процентиль, а не среднее — среднее уводит вверх один Rolls-Royce
--     в выдаче, и подсказка «Audi до 210 000 €» теряет смысл;
--   * 60-й, а не медиана — под фразу «до N» должно попадать заметно
--     больше половины предложений, иначе выдача выглядит скудной;
--   * округление до 500 — «до 15 000 €» читается как ориентир,
--     «до 14 837 €» как машинный мусор.
-- ------------------------------------------------------------
create or replace function public.get_suggestion_seeds(
  p_min_count      integer default 3,
  p_limit_per_kind integer default 40
)
returns table (
  kind         text,
  brand        text,
  model        text,
  year         integer,
  fuel         text,
  city         text,
  price_bucket integer,
  cars_count   bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  -- Общая выборка: то, что вообще может попасть в подсказки.
  with base as (
    select
      c.brand,
      c.model,
      c.year,
      c.fuel,
      c.city,
      c.sale_price
    from public.cars c
    where c.status = 'active'
      and c.is_for_sale
      -- Цена обязательна: без неё нельзя ни построить «до N €», ни
      -- показать осмысленную выдачу по подсказке.
      and c.sale_price is not null
      and c.sale_price > 0
      -- Пустые строки в марке/модели/городе встречаются в старых
      -- записях: в подсказку такая комбинация превратилась бы в
      -- «  , 2019».
      and btrim(c.brand) <> ''
      and btrim(c.model) <> ''
      and btrim(c.city)  <> ''
  ),

  -- 1) Марка + модель + год: «BMW X5, 2019».
  brand_model_year as (
    select
      'brand_model_year'::text as kind,
      b.brand                  as brand,
      b.model                  as model,
      b.year                   as year,
      null::text               as fuel,
      null::text               as city,
      null::integer            as price_bucket,
      count(*)                 as cars_count
    from base b
    group by b.brand, b.model, b.year
    having count(*) >= p_min_count
    order by count(*) desc, b.brand, b.model, b.year desc
    limit p_limit_per_kind
  ),

  -- 2) Марка + ценовой ориентир: «Audi do 15.000 €».
  brand_price as (
    select
      'brand_price'::text as kind,
      b.brand             as brand,
      null::text          as model,
      null::integer       as year,
      null::text          as fuel,
      null::text          as city,
      -- Округление 60-го процентиля вверх до 500 €.
      (ceil(
        percentile_cont(0.6) within group (order by b.sale_price) / 500.0
      ) * 500)::integer   as price_bucket,
      count(*)            as cars_count
    from base b
    group by b.brand
    having count(*) >= p_min_count
    order by count(*) desc, b.brand
    limit p_limit_per_kind
  ),

  -- 3) Топливо + город: «Dizel u Beogradu».
  fuel_city as (
    select
      'fuel_city'::text as kind,
      null::text        as brand,
      null::text        as model,
      null::integer     as year,
      -- enum → text: генератор сверяет значение с ключами FUELS
      -- (lib/types.ts) и по ним же берёт подпись на нужном языке.
      b.fuel::text      as fuel,
      b.city            as city,
      null::integer     as price_bucket,
      count(*)          as cars_count
    from base b
    where b.fuel is not null
    group by b.fuel, b.city
    having count(*) >= p_min_count
    order by count(*) desc, b.city, b.fuel::text
    limit p_limit_per_kind
  )

  select * from brand_model_year
  union all
  select * from brand_price
  union all
  select * from fuel_city;
$fn$;

comment on function public.get_suggestion_seeds(integer, integer)
  is 'Заготовки подсказок строки поиска по живым активным объявлениям на продажу. Вызывается только на сборке сайта (scripts/generate-suggestions.ts), не с клиента.';

-- ------------------------------------------------------------
-- Грант.
-- ------------------------------------------------------------
-- Явный grant ОБЯЗАТЕЛЕН: миграция 0065 сняла EXECUTE с PUBLIC и
-- закрыла default privileges, поэтому новая функция без этой строки
-- недоступна вообще никому, кроме владельца.
--
-- anon — потому что генератор ходит в базу с публичным анонимным
-- ключом на сборке (тем же, что используют страницы каталога), а не
-- с service_role: service_role-ключ в окружении сборки означал бы
-- полный доступ к базе ради выборки, которая и так публична по сути.
-- Данные здесь не приватные: это агрегаты по объявлениям, которые
-- каталог и так показывает поимённо.
grant execute on function public.get_suggestion_seeds(integer, integer)
  to anon, authenticated;

commit;

-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ
-- ============================================================
-- select kind, count(*) from public.get_suggestion_seeds() group by kind;
--   ожидаем три группы; пустая группа означает, что под её шаблон
--   не набралось комбинаций с 3+ объявлениями — на боевых данных
--   это нормально для fuel_city в начале жизни площадки.
--
-- select * from public.get_suggestion_seeds(1, 5) where kind = 'brand_price';
--   price_bucket должен быть кратен 500 и больше нуля.
-- ============================================================
