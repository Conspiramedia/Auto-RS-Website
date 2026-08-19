-- ============================================================
-- AUTO.RS — Миграция 0046: полный предикат совпадения фильтров
-- ============================================================
-- Дополнение к Пакету C. В версии из 0045 предикат проверял 8 ключей
-- (brand, model, city, fuel, price_from/to, year_from/to), а каталог умеет
-- фильтровать ещё по четырём: типу объявления, пробегу, кузову и коробке.
--
-- Расхождение опасно ровно тем, ради чего предикат и выносился в общую
-- функцию: подписка, сохранённая с фильтром «только продажа, до 100 000 км,
-- автомат», присылала бы пуши про арендные машины с любым пробегом и любой
-- коробкой. Пользователь получает уведомление, открывает — а объявление ему
-- не подходит.
--
-- Добавляем недостающие ключи:
--   listing_type  — 'sale' | 'rent' (в каталоге это p_listing_type);
--   mileage_max   — верхняя граница пробега;
--   body_type     — тип кузова (enum body_type);
--   transmission  — коробка передач (enum transmission_type).
--
-- Ключи fuel и year_from/year_to уже были в 0045 — здесь они сохранены
-- без изменений, функция переопределяется целиком.
--
-- НА search_cars_advanced ЭТО НЕ ВЛИЯЕТ: каталог принимает фильтры
-- отдельными параметрами и предикат не вызывает. Сигнатура RPC не меняется.
--
-- ------------------------------------------------------------
-- ОБРАБОТКА ОТСУТСТВУЮЩИХ КЛЮЧЕЙ (требование проверки).
-- Оператор ->> возвращает SQL NULL в трёх разных случаях:
--   1) ключа в объекте нет вовсе          '{}'::jsonb ->> 'brand'         → NULL
--   2) значение равно JSON null            '{"brand":null}' ->> 'brand'    → NULL
--   3) сам jsonb равен NULL                NULL::jsonb ->> 'brand'         → NULL
-- Во всех трёх «... is null» истинно, ветвь ИЛИ замыкается, и ограничение
-- не применяется — то есть отсутствующий фильтр не сужает выборку.
--
-- Отдельно закрыт четвёртый случай: значение есть, но это ПУСТАЯ СТРОКА
-- ('{"brand":""}'). Она не NULL, поэтому старая проверка ушла бы в
-- сравнение с пустой строкой и не совпала бы ни с одним объявлением —
-- подписка молча перестала бы работать. Теперь текстовые ключи проходят
-- через nullif(trim(...), ''), и пустая строка трактуется как «фильтр не задан».
--
-- Числовые ключи с мусором ('{"year_from":"abc"}') уронили бы приведение
-- типа. Такие значения в подписку не попадают: save_search_from_filters
-- пропускает фильтры только через известные ключи, а канонизация в
-- f_filters_hash уже приводит числа к numeric — нечисловое значение упало бы
-- при сохранении, а не при рассылке. Дополнительная защита здесь избыточна.
-- ============================================================

create or replace function public.car_matches_filters(
  p_car     public.cars,
  p_filters jsonb
)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    -- ---------- Тип объявления: продажа или аренда ----------
    -- Логика в точности как у p_listing_type в search_cars_advanced:
    -- объявление гибридное (может быть и на продажу, и в аренду), поэтому
    -- проверяем соответствующий флаг, а не равенство одному значению.
    (nullif(trim(coalesce(p_filters ->> 'listing_type', '')), '') is null
      or (p_filters ->> 'listing_type' = 'sale' and p_car.is_for_sale)
      or (p_filters ->> 'listing_type' = 'rent' and p_car.is_for_rent))

    -- ---------- Марка, модель, город ----------
    -- Нормализация f_normalize (unaccent + lower) обеспечивает
    -- двуалфавитность: «BMW», «bmw», «БМВ» и «Beograd»/«Београд»/«Beograd»
    -- с диакритикой совпадают между собой.
    and (nullif(trim(coalesce(p_filters ->> 'brand', '')), '') is null
      or public.f_normalize(p_car.brand) = public.f_normalize(p_filters ->> 'brand'))
    and (nullif(trim(coalesce(p_filters ->> 'model', '')), '') is null
      or public.f_normalize(p_car.model) = public.f_normalize(p_filters ->> 'model'))
    and (nullif(trim(coalesce(p_filters ->> 'city', '')), '') is null
      or public.f_normalize(p_car.city) = public.f_normalize(p_filters ->> 'city'))

    -- ---------- Характеристики (enum-поля) ----------
    -- Значения enum записаны латиницей ('petrol', 'sedan', 'automatic'),
    -- нормализация им не нужна — сравниваем как текст, ровно как каталог.
    -- Если у объявления характеристика не указана (NULL), а в подписке она
    -- задана — совпадения нет: сравнение с NULL даёт NULL, что в контексте
    -- AND равносильно false. Это правильное поведение: нельзя обещать
    -- «только автомат», присылая объявления с неизвестной коробкой.
    and (nullif(trim(coalesce(p_filters ->> 'fuel', '')), '') is null
      or p_car.fuel::text = p_filters ->> 'fuel')
    and (nullif(trim(coalesce(p_filters ->> 'body_type', '')), '') is null
      or p_car.body_type::text = p_filters ->> 'body_type')
    and (nullif(trim(coalesce(p_filters ->> 'transmission', '')), '') is null
      or p_car.transmission::text = p_filters ->> 'transmission')

    -- ---------- Год выпуска ----------
    and (nullif(trim(coalesce(p_filters ->> 'year_from', '')), '') is null
      or p_car.year >= (p_filters ->> 'year_from')::int)
    and (nullif(trim(coalesce(p_filters ->> 'year_to', '')), '') is null
      or p_car.year <= (p_filters ->> 'year_to')::int)

    -- ---------- Пробег ----------
    -- Копируем поведение каталога дословно, включая «c.mileage is null or»:
    -- объявление с неуказанным пробегом фильтр НЕ отсекает. Иначе подписка
    -- и каталог разошлись бы — а именно этого мы и избегаем общим предикатом.
    and (nullif(trim(coalesce(p_filters ->> 'mileage_max', '')), '') is null
      or p_car.mileage is null
      or p_car.mileage <= (p_filters ->> 'mileage_max')::int)

    -- ---------- Цена ----------
    -- Поле выбирается по назначению объявления: аренда → суточная ставка,
    -- иначе цена продажи. Ровно как в search_cars_advanced.
    and (nullif(trim(coalesce(p_filters ->> 'price_from', '')), '') is null
      or coalesce(
           case when p_car.is_for_rent then p_car.rent_price_daily else p_car.sale_price end,
           0
         ) >= (p_filters ->> 'price_from')::numeric)
    and (nullif(trim(coalesce(p_filters ->> 'price_to', '')), '') is null
      or coalesce(
           case when p_car.is_for_rent then p_car.rent_price_daily else p_car.sale_price end,
           0
         ) <= (p_filters ->> 'price_to')::numeric);
$$;

comment on function public.car_matches_filters(public.cars, jsonb)
  is 'ЕДИНЫЙ предикат совпадения по ВСЕМ 12 ключам фильтров каталога. Используется триггером рассылки; каталог принимает те же фильтры параметрами';


-- ============================================================
-- РАСШИРЕНИЕ ХЭША И ОЧИСТКИ ФИЛЬТРОВ ПОД НОВЫЕ КЛЮЧИ
-- ============================================================
-- f_filters_hash и save_search_from_filters из 0045 знали только 8 ключей.
-- Если их не расширить, новые ключи будут отброшены при сохранении подписки —
-- предикат их просто никогда не увидит, и расширение выше окажется мёртвым.
--
-- Дополнительный эффект на дедупликацию: две подписки, отличающиеся только
-- коробкой передач, теперь дают РАЗНЫЕ хэши и существуют независимо. Раньше
-- они схлопнулись бы в одну.
--
-- ВАЖНО про уже сохранённые подписки: их хэши считались по старому набору
-- ключей. Пересчёт не требуется — старые подписки не содержат новых ключей,
-- поэтому их канонизированная строка (а значит, и хэш) не меняется.
-- ============================================================
create or replace function public.f_filters_hash(p_filters jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select md5(
    coalesce(
      (
        select string_agg(key || '=' || value, '&' order by key)
        from (
          -- Текстовые ключи: значение нормализуется, поэтому «BMW» и «БМВ»
          -- дают один хэш и считаются одной подпиской.
          select k as key, public.f_normalize(p_filters ->> k) as value
          from unnest(array['brand', 'model', 'city']) as k
          where nullif(trim(coalesce(p_filters ->> k, '')), '') is not null

          union all

          -- Enum-ключи и тип объявления: значения латиницей и фиксированы
          -- (petrol, sedan, automatic, sale/rent), нормализация не нужна —
          -- берём как есть в нижнем регистре.
          select k, lower(p_filters ->> k)
          from unnest(array['fuel', 'body_type', 'transmission', 'listing_type']) as k
          where nullif(trim(coalesce(p_filters ->> k, '')), '') is not null

          union all

          -- Числовые ключи: приведение к numeric и обратно убирает разницу
          -- между '10000', 10000 и 10000.0.
          select k, (p_filters ->> k)::numeric::text
          from unnest(array['price_from', 'price_to', 'year_from', 'year_to', 'mileage_max']) as k
          where nullif(trim(coalesce(p_filters ->> k, '')), '') is not null
        ) parts
      ),
      ''
    )
  );
$$;

comment on function public.f_filters_hash(jsonb)
  is 'Канонизирует все 12 ключей фильтров и возвращает md5 — ключ дедупликации подписок';


-- ------------------------------------------------------------
-- save_search_from_filters: тот же список ключей, что у предиката
-- ------------------------------------------------------------
-- Тело идентично версии из 0045, изменён только массив разрешённых ключей —
-- он приведён в соответствие с полным предикатом. Всё, что не входит в этот
-- список, отбрасывается: клиент не может записать в подписку произвольный
-- jsonb, который предикат не проверяет.
-- ------------------------------------------------------------
create or replace function public.save_search_from_filters(
  p_filters jsonb,
  p_title   text default null
)
returns public.saved_searches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_clean  jsonb := '{}'::jsonb;
  v_key    text;
  v_value  text;
  v_hash   text;
  v_search public.saved_searches;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Полный список поддерживаемых ключей — совпадает с car_matches_filters.
  foreach v_key in array array[
    'listing_type', 'brand', 'model', 'city',
    'fuel', 'body_type', 'transmission',
    'price_from', 'price_to', 'year_from', 'year_to', 'mileage_max'
  ] loop
    v_value := nullif(trim(coalesce(p_filters ->> v_key, '')), '');
    if v_value is not null then
      v_clean := v_clean || jsonb_build_object(v_key, v_value);
    end if;
  end loop;

  -- Подписка без фильтров = «уведомлять о каждом объявлении площадки».
  -- Это гарантированный спам, поэтому запрещаем.
  if v_clean = '{}'::jsonb then
    raise exception 'Задайте хотя бы один фильтр для подписки'
      using errcode = 'check_violation';
  end if;

  v_hash := public.f_filters_hash(v_clean);

  insert into public.saved_searches (user_id, filters, filters_hash, title, active)
  values (v_user, v_clean, v_hash, nullif(trim(p_title), ''), true)
  on conflict (user_id, filters_hash) do update
    set active = true,
        title  = coalesce(nullif(trim(excluded.title), ''), public.saved_searches.title)
  returning * into v_search;

  return v_search;
end;
$$;

comment on function public.save_search_from_filters(jsonb, text)
  is 'Создаёт или реактивирует подписку (upsert по хэшу). Принимает все 12 ключей фильтров каталога';

grant execute on function public.save_search_from_filters(jsonb, text) to authenticated;
