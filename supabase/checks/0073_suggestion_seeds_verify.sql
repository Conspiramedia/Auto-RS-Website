-- ============================================================
-- AUTO.RS — Проверка миграции 0073 (get_suggestion_seeds).
-- ============================================================
-- Выполняется в SQL Editor ПОСЛЕ применения 0073. Ничего не меняет:
-- только читает и сравнивает. Каждый блок печатает признак «ok» или
-- то, что пошло не так.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Функция существует в ЕДИНСТВЕННОМ экземпляре.
-- ------------------------------------------------------------
-- Первая версия функции имела два параметра, текущая — четыре.
-- create or replace список параметров не меняет, поэтому в миграции
-- стоит drop старой сигнатуры. Если он не отработал, в базе окажутся
-- ДВЕ перегрузки, и вызов уйдёт не в ту функцию — самая коварная
-- ошибка этой миграции, потому что ошибки не будет вовсе.
select
  count(*) as overloads,
  case when count(*) = 1
       then 'ok'
       else 'ВНИМАНИЕ: в базе несколько перегрузок, старая не удалена'
  end      as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_suggestion_seeds';

-- ------------------------------------------------------------
-- 2) Объявление функции: security definer, stable, search_path.
-- ------------------------------------------------------------
select
  p.proname                                   as function_name,
  p.prosecdef                                 as security_definer,
  case p.provolatile when 's' then 'stable'
                     when 'i' then 'immutable'
                     else 'volatile' end      as volatility,
  p.proconfig                                 as settings,
  case
    when p.prosecdef
     and p.provolatile = 's'
     and 'search_path=public' = any(coalesce(p.proconfig, array[]::text[]))
    then 'ok'
    else 'ВНИМАНИЕ: объявление функции отличается от ожидаемого'
  end                                         as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_suggestion_seeds';

-- ------------------------------------------------------------
-- 3) Гранты. После 0065 EXECUTE снят с PUBLIC и default privileges
--    закрыты, поэтому проверяем наличие нужных прав явно.
-- ------------------------------------------------------------
select
  coalesce(
    (select string_agg(distinct grantee, ', ')
       from information_schema.role_routine_grants
      where specific_schema = 'public'
        and routine_name = 'get_suggestion_seeds'
        and privilege_type = 'EXECUTE'),
    '(нет грантов)'
  ) as grantees,
  case
    when has_function_privilege('anon',
           'public.get_suggestion_seeds(integer, integer, integer, integer)',
           'EXECUTE')
     and has_function_privilege('authenticated',
           'public.get_suggestion_seeds(integer, integer, integer, integer)',
           'EXECUTE')
    then 'ok'
    else 'ВНИМАНИЕ: anon или authenticated не могут вызвать функцию'
  end as verdict;

-- ------------------------------------------------------------
-- 4) Три вида заготовок. Пустая группа — не ошибка сама по себе:
--    на молодой базе под шаблон могло не набраться комбинаций.
--    Но kind вне списка означает ошибку в SQL.
-- ------------------------------------------------------------
select
  kind,
  count(*)        as rows_count,
  min(cars_count) as min_cars,
  max(cars_count) as max_cars,
  case
    when kind in ('brand_model', 'brand_price', 'fuel')
    then 'ok'
    else 'ВНИМАНИЕ: неизвестный kind'
  end             as verdict
from public.get_suggestion_seeds()
group by kind
order by kind;

-- ------------------------------------------------------------
-- 5) Пороги соблюдены. У каждого вида порог свой, поэтому и
--    проверяем каждый против своего значения.
-- ------------------------------------------------------------
select
  count(*) as rows_below_threshold,
  case when count(*) = 0
       then 'ok'
       else 'ВНИМАНИЕ: порог вида не соблюдается'
  end      as verdict
from public.get_suggestion_seeds(1, 2, 3, 40)
where (kind = 'brand_model' and cars_count < 1)
   or (kind = 'brand_price' and cars_count < 2)
   or (kind = 'fuel'        and cars_count < 3);

-- ------------------------------------------------------------
-- 6) Ценовой ориентир кратен 500 и положителен.
-- ------------------------------------------------------------
select
  count(*) as bad_buckets,
  case when count(*) = 0
       then 'ok'
       else 'ВНИМАНИЕ: price_bucket не кратен 500 или неположителен'
  end      as verdict
from public.get_suggestion_seeds(1, 1, 1, 100)
where kind = 'brand_price'
  and (price_bucket is null or price_bucket <= 0 or price_bucket % 500 <> 0);

-- ------------------------------------------------------------
-- 7) Заполненность колонок по видам: у каждого вида свой набор,
--    остальные колонки обязаны быть NULL. Расхождение означает,
--    что ветки union all разъехались по порядку колонок, — а это
--    самая опасная ошибка здесь: типы совпадают, данные подменены.
-- ------------------------------------------------------------
select
  count(*) as broken_rows,
  case when count(*) = 0
       then 'ok'
       else 'ВНИМАНИЕ: набор заполненных колонок не соответствует kind'
  end      as verdict
from public.get_suggestion_seeds(1, 1, 1, 100)
where
  (kind = 'brand_model' and (brand is null or model is null
        or fuel is not null or price_bucket is not null))
  or (kind = 'brand_price' and (brand is null or price_bucket is null
        or model is not null or fuel is not null))
  or (kind = 'fuel' and (fuel is null
        or brand is not null or model is not null
        or price_bucket is not null));

-- ------------------------------------------------------------
-- 8) Источник данных: только активные объявления на продажу.
--    Непустой результат означает, что в подсказки попала марка,
--    которой нет среди активных объявлений на продажу.
-- ------------------------------------------------------------
select
  count(*) as brands_not_in_active_catalog,
  case when count(*) = 0
       then 'ok'
       else 'ВНИМАНИЕ: в заготовках есть марки вне активной выдачи'
  end      as verdict
from (
  select distinct s.brand
  from public.get_suggestion_seeds(1, 1, 1, 100) s
  where s.brand is not null
) x
where not exists (
  select 1
  from public.cars c
  where btrim(c.brand) = x.brand
    and c.status = 'active'
    and c.is_for_sale
);

-- ------------------------------------------------------------
-- 9) Значения топлива — из enum fuel_type, то есть совпадают с
--    ключами FUELS в lib/types.ts. Генератор берёт по ним подпись
--    на нужном языке, и незнакомое значение осталось бы без перевода.
-- ------------------------------------------------------------
select
  count(*) as unknown_fuels,
  case when count(*) = 0
       then 'ok'
       else 'ВНИМАНИЕ: значение топлива вне известного набора'
  end      as verdict
from public.get_suggestion_seeds(1, 1, 1, 100)
where kind = 'fuel'
  and fuel not in ('petrol', 'diesel', 'hybrid', 'electric', 'gas');
