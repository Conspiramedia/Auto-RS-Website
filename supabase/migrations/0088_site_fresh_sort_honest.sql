-- ============================================================
-- AUTO.RS — Миграция 0088: честная сортировка «Сначала новые».
-- ============================================================
-- ПРОБЛЕМА. Каталог сайта подписывает дефолтный порядок как
-- «Сначала новые» / «Najnovije» (lib/types.ts → SORT_OPTIONS), но
-- search_cars_public (0059) при sort_key = 'fresh' сортировала
-- ИСКЛЮЧИТЕЛЬНО по md5(id || соль_суток) — то есть псевдослучайно.
-- Дата подачи в порядок не входила вовсе: created_at возвращался в
-- колонках, но в order by не участвовал.
--
-- Последствие, из-за которого задача и заведена: продавец подал
-- машину, она прошла модерацию, он открыл каталог, выбрал «Сначала
-- новые» — и не нашёл своё объявление. Оно стояло на случайной
-- позиции среди всех активных: при 500 объявлениях шанс попасть в
-- первую двадцатку — около 4%. С точки зрения продавца площадка
-- просто не работает, и объяснить ему это нечем.
--
-- Приложение всё это время вело себя честно: search_cars_advanced
-- (0062) поднимает объявления моложе трёх дней и сортирует их по
-- created_at desc. То есть два клиента одной базы отвечали на
-- «покажи новые» по-разному, и неверным был именно сайт — при том
-- что по правилу проекта сайт является эталоном.
--
-- ------------------------------------------------------------
-- ЧТО СТАНОВИТСЯ ПОРЯДКОМ 'fresh'
-- ------------------------------------------------------------
--   а) ПРОМО — is_vip и boosted_until > now(), внутри блока по
--      boosted_until desc (купивший продвижение позже стоит выше);
--   б) СВЕЖИЕ — created_at > now() - 3 дня, по created_at desc;
--   в) ОСТАЛЬНОЕ — md5(id || shuffle_salt), как было.
--
-- Три дня и порядок уровней взяты у приложения намеренно, а не
-- придуманы заново: расхождение между клиентами и есть та поломка,
-- которую чинит эта миграция.
--
-- ПОЧЕМУ ХВОСТ ОСТАЁТСЯ ПЕРЕМЕШКОЙ, А НЕ created_at desc. Полная
-- сортировка по дате означала бы, что через месяц объявление уходит
-- на тридцатую страницу и больше не показывается никогда. Перемешка
-- даёт всем непроданным машинам равные шансы и каждые сутки (соль =
-- current_date) раздаёт новые позиции. Окно свежести решает задачу
-- старта нового объявления, перемешка — задачу выживания старого.
--
-- ------------------------------------------------------------
-- ЛИМИТ ПРОМО-БЛОКА: НЕ БОЛЬШЕ ТРЁХ
-- ------------------------------------------------------------
-- Без ограничения продвижение ломает выдачу арифметически: купи его
-- сорок продавцов — и первые две страницы каталога состоят только из
-- них. Обычное объявление в таком каталоге не видно никогда, окно
-- свежести из пункта (б) не спасает, и продвижение из услуги
-- превращается в единственный способ вообще появиться в выдаче.
--
-- Поэтому наверх поднимаются ТОЛЬКО первые три промо-объявления по
-- boosted_until desc. Остальные не исчезают и не штрафуются — они
-- идут дальше по обычным правилам: попадают в окно свежести, если
-- молоды, иначе в перемешку.
--
-- ЧИСЛО ВЫНЕСЕНО В КОНСТАНТУ f_promo_top_limit(), а не вписано в
-- order by: его придётся менять по мере роста площадки (три промо на
-- 24 карточки — это первый экран, при сетке в четыре колонки цифра
-- станет другой), и искать литерал внутри трёх case-выражений —
-- прямой путь поменять его в двух местах из трёх.
--
-- ЛИМИТ СЧИТАЕТСЯ ПО ВСЕЙ ОТФИЛЬТРОВАННОЙ ВЫДАЧЕ, А НЕ ПО СТРАНИЦЕ.
-- Это принципиально: row_number() нумерует промо в границах текущего
-- набора фильтров, поэтому на второй странице промо-блока уже нет —
-- первые три ушли на первую страницу и там же остались. Считай мы
-- лимит внутри страницы, каждая страница открывалась бы тремя
-- промо-карточками, и ограничение не ограничивало бы ничего.
--
-- ------------------------------------------------------------
-- ЧТО НЕ МЕНЯЕТСЯ
-- ------------------------------------------------------------
--   * ЯВНАЯ СОРТИРОВКА (price_asc/desc, year_asc/desc, mileage_asc) —
--     промо не поднимается вовсе. Человек попросил «сначала дешёвые»,
--     и реклама поверх этого выглядит как обман. Правило было в 0059,
--     остаётся дословно;
--   * БЕСКОНЕЧНАЯ ЛЕНТА. При p_shuffle_all (круги 2+) промо-блок и
--     окно свежести отключаются одинаково: иначе каждый круг
--     открывался бы одними и теми же карточками, а ради этого
--     shuffle_all и вводился (0059);
--   * СИГНАТУРА. Список параметров, их порядок, умолчания и набор
--     возвращаемых колонок — те же. Вызовы сайта (lib/queries.ts →
--     fetchCatalog), SSG страниц марок, sitemap и InfiniteCarFeed
--     работают без единой правки;
--   * WHERE не тронут ни на символ. Меняется только порядок строк,
--     поэтому счётчик total_count (оконный count(*) over ()) остаётся
--     верным сам собой;
--   * search_cars_advanced (приложение) НЕ ТРОГАЕМ — она уже ведёт
--     себя так, как теперь будет вести сайт.
--
-- ПОВТОРНЫЙ ЗАПУСК БЕЗОПАСЕН: create or replace, drop с if exists.
-- ============================================================


-- ============================================================
-- БЛОК 1. Константа: сколько промо-объявлений пускать наверх.
-- ============================================================
-- Отдельная immutable-функция вместо литерала в теле запроса. Две
-- причины, и обе про то, чтобы значение осталось одним:
--   * оно используется в ТРЁХ case-выражениях order by, и правка
--     литерала на месте почти наверняка забудет одно из них;
--   * его должны видеть тесты. supabase/checks/0088_fresh_sort_test.sql
--     проверяет лимит, вызывая эту же функцию, а не повторяя число
--     у себя: разойдись они — тест начнёт врать, причём молча.
--
-- immutable, а не stable: результат не зависит ни от данных, ни от
-- настроек сессии, и планировщик вправе подставить его в план как
-- константу.
create or replace function public.f_promo_top_limit()
returns integer
language sql
immutable
set search_path = public
as $$
  select 3;
$$;

comment on function public.f_promo_top_limit()
  is 'Сколько промо-объявлений поднимается наверх дефолтной выдачи (0088). Остальные идут по обычным правилам. Первый экран каталога — 24 карточки, поэтому три';

grant execute on function public.f_promo_top_limit() to anon, authenticated;


-- ============================================================
-- БЛОК 2. Окно свежести — сколько дней объявление считается новым.
-- ============================================================
-- Значение то же, что в search_cars_advanced (0062), и вынесено сюда
-- по той же причине: два клиента обязаны понимать «новое» одинаково.
-- Разойдись эти числа — объявление считалось бы новым в приложении и
-- обычным на сайте, и объяснить такое поведение продавцу нельзя.
create or replace function public.f_fresh_window()
returns interval
language sql
immutable
set search_path = public
as $$
  select interval '3 days';
$$;

comment on function public.f_fresh_window()
  is 'Сколько времени объявление считается новым и поднимается в выдаче (0088). Совпадает с окном в search_cars_advanced для приложения';

grant execute on function public.f_fresh_window() to anon, authenticated;


-- ============================================================
-- БЛОК 3. search_cars_public — каталог сайта.
-- ============================================================
-- Сигнатура повторяет 0059 ОДИН В ОДИН. Меняются: подзапрос ranked
-- (нумерация промо) и order by.
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
  p_limit        integer default 24,
  p_listing_type text    default 'sale',
  -- Соль перемешки для бесконечной ленты. NULL = current_date.
  p_seed         integer default null,
  -- Круги 2+: полная перетасовка без блока промо сверху.
  p_shuffle_all  boolean default false
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
  rent_price_daily numeric,
  deposit_amount   numeric,
  is_for_sale      boolean,
  is_for_rent      boolean,
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
      nullif(trim(coalesce(p_search_query, '')), '')  as raw_query,
      public.f_normalize(p_search_query)              as norm,
      greatest(coalesce(p_offset, 0), 0)              as safe_offset,
      least(greatest(coalesce(p_limit, 24), 1), 100)  as safe_limit,
      case
        when p_sort in ('fresh', 'price_asc', 'price_desc',
                        'year_desc', 'year_asc', 'mileage_asc')
        then p_sort
        else 'fresh'
      end as sort_key,
      case
        when p_listing_type in ('sale', 'rent', 'both')
        then p_listing_type
        else 'sale'
      end as mode,
      -- Соль перемешки. Клиентский seed имеет приоритет; без него —
      -- прежнее поведение: одна соль на сутки, стабильная для краулера
      -- и для offset-пагинации.
      coalesce(p_seed::text, current_date::text) as shuffle_salt,
      -- Поднимать ли промо наверх. На кругах 2+ (p_shuffle_all) — нет.
      coalesce(p_shuffle_all, false) as shuffle_all,
      -- Граница окна свежести. Вычисляется ОДИН раз на запрос: now()
      -- внутри order by пересчитывался бы для каждой строки, а на
      -- длинной выдаче граница успела бы сдвинуться, и объявление на
      -- краю окна попало бы в обе группы сразу — то есть порядок
      -- перестал бы быть строгим, и пагинация дала бы дубли.
      now() - public.f_fresh_window() as fresh_since,
      public.f_promo_top_limit()      as promo_limit
  ),
  filtered as (
    select
      c.*,
      (c.is_vip and c.boosted_until is not null and c.boosted_until > now())
        as promoted_now,
      case when p.mode = 'rent' then c.rent_price_daily else c.sale_price end
        as active_price,
      count(*) over () as total_rows
    from public.cars c, params p
    where
      c.status = 'active'
      and (
        (p.mode = 'sale' and c.is_for_sale)
        or (p.mode = 'rent' and c.is_for_rent)
        or (p.mode = 'both' and (c.is_for_sale or c.is_for_rent))
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
      and (p_brand is null or public.f_normalize(c.brand) = public.f_normalize(p_brand))
      and (p_model is null or public.f_normalize(c.model) = public.f_normalize(p_model))
      and (p_city  is null or public.f_normalize(c.city)  = public.f_normalize(p_city))
      and (p_year_from is null or c.year >= p_year_from)
      and (p_year_to   is null or c.year <= p_year_to)
      and (p_mileage_max is null or c.mileage is null or c.mileage <= p_mileage_max)
      and (p_price_from is null
           or (case when p.mode = 'rent' then c.rent_price_daily else c.sale_price end)
              >= p_price_from)
      and (p_price_to is null
           or (case when p.mode = 'rent' then c.rent_price_daily else c.sale_price end)
              <= p_price_to)
      and (p_body_type    is null or c.body_type::text    = p_body_type)
      and (p_transmission is null or c.transmission::text = p_transmission)
      and (p_fuel         is null or c.fuel::text         = p_fuel)
  ),
  -- ------------------------------------------------------------
  -- НУМЕРАЦИЯ ПРОМО. Отдельный уровень, потому что оконная функция
  -- не может стоять в order by внешнего запроса.
  -- ------------------------------------------------------------
  -- row_number() присваивает промо-объявлениям места 1, 2, 3, … в
  -- порядке boosted_until desc. Дальше в order by наверх поднимаются
  -- только места до f_promo_top_limit().
  --
  -- boosted_until desc здесь — это и есть требование «купивший позже
  -- стоит выше»: оно задаёт и порядок внутри блока, и то, КАКИЕ три
  -- промо в блок попадут. Одно правило, а не два.
  --
  -- Тайбрейк по id обязателен и внутри окна: у двух объявлений
  -- boosted_until может совпасть до микросекунды (пакетная выдача
  -- продвижения салону — ровно такой случай), и без тайбрейка их
  -- номера разошлись бы между запросами. Тогда на первой странице
  -- промо-блока оказалось бы то одно, то другое, и при пагинации
  -- одна карточка задвоилась бы, а другая пропала.
  --
  -- partition by не нужен: нумеруем один общий блок промо на всю
  -- выдачу. filter (where promoted_now) оставляет номера только у
  -- промо, у остальных row_number даёт null — и case ниже их не
  -- поднимает.
  ranked as (
    select
      f.*,
      case
        when f.promoted_now
        then row_number() over (
          order by f.boosted_until desc nulls last, f.id
        )
      end as promo_rank
    from filtered f
  )
  select
    r.id, r.brand, r.model, r.year, r.mileage,
    r.body_type::text, r.transmission::text, r.fuel::text,
    r.currency::text,
    r.sale_price, r.rent_price_daily, r.deposit_amount,
    r.is_for_sale, r.is_for_rent,
    r.city, r.status::text,
    -- is_promoted остаётся ПРИЗНАКОМ ПРОДВИЖЕНИЯ, а не признаком
    -- попадания в верхний блок: карточка рисует значок «VIP» по
    -- этому полю, и четвёртое промо-объявление обязано носить его
    -- так же, как первое. Лимит управляет позицией, а не статусом.
    r.promoted_now,
    public.f_car_site_url(r.id),
    (select ci.image_url from public.car_images ci
      where ci.car_id = r.id
      order by ci.order_index asc
      limit 1),
    pr.seller_kind,
    r.created_at,
    r.total_rows
  from ranked r
  join public.profiles pr on pr.id = r.user_id,
       params p
  order by
    -- ============================================================
    -- УРОВЕНЬ 0: ПРОМО-БЛОК (не более f_promo_top_limit() штук).
    -- ============================================================
    -- Условия те же, что были, плюс ограничение по месту в блоке.
    -- Промо с местом 4 и дальше здесь даёт false и опускается к
    -- обычным правилам — оно не наказано, просто не в шапке.
    --
    -- Не действует при явной сортировке и на кругах 2+ ленты.
    case
      when p.sort_key = 'fresh' and not p.shuffle_all
      then (r.promo_rank is not null and r.promo_rank <= p.promo_limit)
    end desc nulls last,

    -- Внутри промо-блока — купивший продвижение позже стоит выше.
    -- Сортируем по promo_rank (он уже посчитан по boosted_until desc),
    -- а не по самому boosted_until: так порядок в блоке и отбор в
    -- блок гарантированно следуют одному правилу. Сортируй мы здесь
    -- по boosted_until напрямую, два выражения пришлось бы держать
    -- синхронными вручную.
    case
      when p.sort_key = 'fresh' and not p.shuffle_all
       and r.promo_rank is not null and r.promo_rank <= p.promo_limit
      then r.promo_rank
    end asc nulls last,

    -- ============================================================
    -- УРОВЕНЬ 1: ЯВНАЯ СОРТИРОВКА, выбранная пользователем.
    -- ============================================================
    -- Не изменилась с 0059. NULLS LAST везде: объявление без цены
    -- или пробега уходит в конец, а не всплывает наверх при
    -- сортировке по возрастанию.
    case when p.sort_key = 'price_asc'   then r.active_price end asc  nulls last,
    case when p.sort_key = 'price_desc'  then r.active_price end desc nulls last,
    case when p.sort_key = 'year_desc'   then r.year         end desc nulls last,
    case when p.sort_key = 'year_asc'    then r.year         end asc  nulls last,
    case when p.sort_key = 'mileage_asc' then r.mileage      end asc  nulls last,

    -- ============================================================
    -- УРОВЕНЬ 2: ОКНО СВЕЖЕСТИ (0088) — то, ради чего миграция.
    -- ============================================================
    -- Объявления моложе f_fresh_window() поднимаются над остальными.
    -- Это делает подпись «Сначала новые» правдой: у нового объявления
    -- появляется гарантированное окно видимости вместо случайной
    -- позиции среди сотен.
    --
    -- Сравнение с заранее вычисленным fresh_since, а не с now() —
    -- см. пояснение в блоке params.
    --
    -- На кругах 2+ ленты (shuffle_all) окно не действует: там задача
    -- обратная — показать то, что человек ещё не видел.
    case
      when p.sort_key = 'fresh' and not p.shuffle_all
      then (r.created_at > p.fresh_since)
    end desc nulls last,

    -- Внутри окна — по дате подачи, новейшее первым.
    case
      when p.sort_key = 'fresh' and not p.shuffle_all
       and r.created_at > p.fresh_since
      then r.created_at
    end desc,

    -- ============================================================
    -- УРОВЕНЬ 3: ПЕРЕМЕШКА — весь хвост выдачи.
    -- ============================================================
    -- Порядок псевдослучайный, но одинаковый для всех страниц одного
    -- круга (одна соль) — это и делает offset-пагинацию корректной:
    -- без стабильного порядка одно объявление попало бы на две
    -- страницы, а другое — ни на одну.
    --
    -- Здесь же решается задача смешанного фида: md5 не зависит ни от
    -- created_at, ни от типа сделки, поэтому продажа и аренда идут
    -- вперемешку, а не двумя блоками.
    case
      when p.sort_key = 'fresh'
      then md5(r.id::text || p.shuffle_salt)
    end,

    -- ФИНАЛЬНЫЙ ТАЙБРЕЙК. Обязателен: без него строки с равными
    -- значениями могут менять порядок между запросами, и одно
    -- объявление попадёт на две страницы пагинации, а другое — ни на одну.
    r.id
  limit  (select safe_limit  from params)
  offset (select safe_offset from params);
$$;

comment on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text, integer, boolean)
  is 'Каталог сайта (0088): промо (не более f_promo_top_limit(), внутри по boosted_until desc) → окно свежести f_fresh_window() по created_at desc → перемешка md5(id||seed). При явной сортировке промо не поднимается. total_count для пагинации';

-- Права те же, что у прежней версии функции.
revoke all on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text, integer, boolean) from public;
grant execute on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text, integer, boolean)
  to anon, authenticated;


-- ============================================================
-- ИНДЕКС под окно свежести.
-- ============================================================
-- Окно свежести добавляет в order by условие по created_at, которого
-- там раньше не было. На каталоге в сотни тысяч строк это означает
-- сортировку всей отфильтрованной выборки; частичный индекс по
-- активным объявлениям снимает большую её часть.
--
-- Частичный (where status = 'active') намеренно: выдача НИКОГДА не
-- показывает другие статусы, а архив и отклонённые со временем
-- станут заметной долей таблицы — держать их в этом индексе значит
-- платить за строки, которые не будут прочитаны ни разу.
create index if not exists idx_cars_active_created_at
  on public.cars (created_at desc)
  where status = 'active';

comment on index public.idx_cars_active_created_at
  is 'Окно свежести в каталоге (0088). Частичный: выдача читает только active';


-- ============================================================
-- ПРОВЕРКА после применения (SQL Editor или psql).
-- ============================================================
-- Полный набор — supabase/checks/0088_fresh_sort_test.sql
-- (npm run test:sql). Быстрая проверка руками:
--
--   -- 1. Промо стоит первым и его не больше трёх:
--   select is_promoted, created_at
--     from public.search_cars_public(p_limit => 24);
--   -- ожидается: до трёх строк is_promoted = true подряд сверху
--
--   -- 2. Внутри окна свежести порядок по дате:
--   select created_at from public.search_cars_public(p_limit => 24)
--    where created_at > now() - interval '3 days';
--   -- ожидается: строго по убыванию
--
--   -- 3. Явная сортировка промо не поднимает:
--   select is_promoted, sale_price
--     from public.search_cars_public(p_sort => 'price_asc', p_limit => 24);
--   -- ожидается: цена по возрастанию, промо на своих местах по цене
