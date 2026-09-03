-- ============================================================
-- 0133. ОБЪЁМ ДВИГАТЕЛЯ: колонка, подача, правка, фильтр каталога.
-- ============================================================
-- Зачем: в карточке машины не хватало базовой характеристики, по
-- которой покупатель отсеивает варианты не хуже, чем по коробке.
-- В базе её не было вовсе, поэтому миграция ведёт всю вертикаль —
-- колонку, приём значения при подаче и правке, фильтрацию в поиске
-- и возврат объёма в выдаче.
--
-- ЕДИНИЦА — ЛИТРЫ, numeric(3,1): 1.6, 2.0, 5.5. Кубические
-- сантиметры (1598) точнее, но объявления и покупатели говорят
-- литрами, а округление до десятой — ровно то, что печатают в
-- документах. Три знака при одном дробном дают потолок 9.9 л:
-- больше не бывает у легкового транспорта, а constraint ниже
-- делает это правилом, а не надеждой.
--
-- ПОЛЕ НЕОБЯЗАТЕЛЬНОЕ. У электромобиля ДВС нет, и требовать литры
-- значило бы заставлять продавца выдумывать число. Фильтр по объёму
-- такие машины не показывает — это верно по смыслу: искать
-- «двухлитровый электромобиль» бессмысленно.
--
-- ВСЕ ИЗМЕНЕНИЯ АДДИТИВНЫ. Новые параметры функций стоят последними
-- и имеют default null, поэтому вызовы мобильного приложения
-- продолжают работать без единой правки на его стороне: PostgREST
-- сопоставляет аргументы по имени, отсутствующий получает default.
-- Набор возвращаемых колонок расширен новой в конце блока
-- характеристик — существующие сохранили и порядок, и типы.

-- ------------------------------------------------------------
-- 1) Колонка
-- ------------------------------------------------------------
alter table public.cars
  add column if not exists engine_volume numeric(3,1);

comment on column public.cars.engine_volume
  is 'Объём двигателя в литрах (1.6, 2.0). NULL у электромобилей (0133)';

-- Границы: 0.5 л — минимум для легкового транспорта (кей-кары
-- начинаются с 0.66), 9.9 — потолок формата numeric(3,1). Ноль и
-- отрицательные значения отсекаются здесь же, поэтому клиенту
-- достаточно не присылать поле, чтобы оно осталось пустым.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_engine_volume'
  ) then
    alter table public.cars
      add constraint chk_engine_volume
      check (engine_volume is null
             or (engine_volume >= 0.5 and engine_volume <= 9.9));
  end if;
end $$;

-- Индекс под фильтр по диапазону. Частичный: строки без объёма в
-- него не попадают, а фильтр их всё равно исключает — индекс тем
-- самым меньше и точнее.
create index if not exists idx_cars_engine_volume
  on public.cars (engine_volume)
  where engine_volume is not null;


-- ------------------------------------------------------------
-- 2) create_car_v3 — приём объёма при подаче
-- ------------------------------------------------------------
-- Тело перенесено из 0119 дословно; добавлены параметр и его запись.
--
-- DROP ПЕРЕД CREATE — ОБЯЗАТЕЛЕН, И ЭТО НЕ ПЕРЕСТРАХОВКА. Postgres
-- опознаёт функцию по имени И списку типов аргументов, поэтому
-- `create or replace` с новым параметром не заменяет прежнюю
-- функцию, а создаёт рядом вторую. PostgREST вызывает функции по
-- именам параметров, при двух кандидатах выбрать не может и отвечает
-- PGRST203 — подача объявления падает на последнем шаге. Ровно это
-- уже случилось после 0118/0119 и разбиралось в 0120; повторять
-- ошибку, зная её цену, нельзя.

drop function if exists public.create_car_v3(
  text, text, text, integer, integer, numeric, numeric, numeric, text,
  text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text, text
);

create or replace function public.create_car_v3(
  p_listing_type     text,
  p_brand            text,
  p_model            text,
  p_year             integer,
  p_mileage          integer,
  p_sale_price       numeric,
  p_rent_price_daily numeric,
  p_deposit_amount   numeric,
  p_currency         text,
  p_city             text,
  p_lat              double precision,
  p_lng              double precision,
  p_photo_urls       text[],
  p_body_type        body_type         default null,
  p_transmission     transmission_type default null,
  p_fuel             fuel_type         default null,
  p_description      text              default null,
  p_phone            text              default null,
  -- ДОСТУПНОСТЬ ВМЕСТО ФЛАГА «НА ЗАКАЗ» (0119). Параметр стоит
  -- последним и с default — прежние вызовы, включая мобильное
  -- приложение, продолжают работать: PostgREST сопоставляет аргументы
  -- по имени, а отсутствующий получает значение по умолчанию.
  --
  -- Тип text, а не car_availability: клиент присылает строку, и
  -- приводить её здесь дешевле, чем требовать от каждого клиента
  -- знания серверного типа. Неизвестное значение приводится к
  -- 'in_stock' — молча, потому что прийти оно может только в обход
  -- формы.
  p_availability     text              default null,
  -- ОБЪЁМ ДВИГАТЕЛЯ В ЛИТРАХ (0133). Необязателен: у электромобиля
  -- ДВС нет, и требовать литры значило бы заставлять продавца
  -- выдумывать число. Параметр последний и с default — прежние
  -- вызовы, включая мобильное приложение, работают без изменений.
  p_engine_volume    numeric           default null
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
  v_location geography(point, 4326);
  v_url      text;
  v_idx      integer := 0;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация для создания объявления'
      using errcode = 'insufficient_privilege';
  end if;

  -- Тип сделки. 'both' по-прежнему принимается на уровне БД: приложение
  -- умеет создавать такие объявления через create_car_v2, и запрещать их
  -- здесь значило бы разойтись с ним. Форма подачи на сайте предлагает
  -- только 'sale' и 'rent' — это ограничение интерфейса, не схемы.
  if p_listing_type = 'sale' then
    v_is_sale := true;
  elsif p_listing_type = 'rent' then
    v_is_rent := true;
  elsif p_listing_type = 'both' then
    v_is_sale := true;
    v_is_rent := true;
  else
    raise exception 'Некорректный listing_type = % (ожидалось sale/rent/both)', p_listing_type
      using errcode = 'check_violation';
  end if;

  if v_is_rent and p_rent_price_daily is null then
    raise exception 'Для аренды требуется цена за сутки'
      using errcode = 'check_violation';
  end if;

  if p_rent_price_daily is not null and p_rent_price_daily <= 0 then
    raise exception 'Цена аренды должна быть больше нуля'
      using errcode = 'check_violation';
  end if;

  if p_sale_price is not null and p_sale_price <= 0 then
    raise exception 'Цена продажи должна быть больше нуля'
      using errcode = 'check_violation';
  end if;

  if p_deposit_amount is not null and p_deposit_amount < 0 then
    raise exception 'Залог не может быть отрицательным'
      using errcode = 'check_violation';
  end if;

  -- Проверки на дубль здесь БОЛЬШЕ НЕТ: она переехала на таблицу
  -- (trg_cars_prevent_duplicate, эта же миграция).

  if p_lat is not null and p_lng is not null then
    v_location := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    body_type, transmission, fuel,
    currency, sale_price, rent_price_daily, deposit_amount,
    city, description, contact_phone, location,
    availability, engine_volume
  )
  values (
    v_user_id, v_is_sale, v_is_rent,
    p_brand, p_model, p_year, p_mileage,
    p_body_type, p_transmission, p_fuel,
    coalesce(p_currency, 'EUR')::currency_code,
    case when v_is_sale then p_sale_price end,
    case when v_is_rent then p_rent_price_daily end,
    case when v_is_rent then coalesce(p_deposit_amount, 0) else 0 end,
    p_city,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    v_location,
    -- Проверка «продавец — салон» не дублируется: её делает триггер
    -- trg_cars_availability_dealer_only выше.
    case
      when p_availability in ('on_order', 'in_transit')
      then p_availability::car_availability
      else 'in_stock'::car_availability
    end,
    -- Ноль и отрицательные значения отбрасываем: это не «маленький
    -- мотор», а мусор из обхода формы. Верхнюю границу держит
    -- constraint chk_engine_volume на таблице.
    case when p_engine_volume > 0 then p_engine_volume end
  )
  returning id into v_car_id;

  if p_photo_urls is not null then
    foreach v_url in array p_photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (v_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_car_id;
end;
$$;


-- ------------------------------------------------------------
-- 3) update_car_v3 — правка объёма
-- ------------------------------------------------------------
-- Прежняя сигнатура удаляется по той же причине, что и у подачи.
drop function if exists public.update_car_v3(
  uuid, text, text, text, integer, integer, numeric, numeric, numeric,
  text, text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text, text
);

-- Тело перенесено из 0119 дословно. Смена объёма участвует в
-- проверке v_changed и отправляет объявление на перемодерацию.
--
-- ОГРАНИЧЕНИЕ, О КОТОРОМ СТОИТ ЗНАТЬ: null означает «не трогать»,
-- поэтому ОЧИСТИТЬ уже заполненный объём через эту функцию нельзя.
-- Так же устроена доступность в 0119, и расходиться с ней ради
-- одного поля хуже, чем принять общее правило: смена бензиновой
-- машины на электрическую — это новое объявление, а не правка.

create or replace function public.update_car_v3(
  p_car_id           uuid,
  p_listing_type     text,
  p_brand            text,
  p_model            text,
  p_year             integer,
  p_mileage          integer,
  p_sale_price       numeric,
  p_rent_price_daily numeric,
  p_deposit_amount   numeric,
  p_currency         text,
  p_city             text,
  p_lat              double precision,
  p_lng              double precision,
  p_photo_urls       text[]            default null,
  p_body_type        body_type         default null,
  p_transmission     transmission_type default null,
  p_fuel             fuel_type         default null,
  p_description      text              default null,
  p_phone            text              default null,
  -- null означает «не трогать»: так ведёт себя клиент, не знающий о
  -- поле. Форма правки присылает значение всегда.
  p_availability     text              default null,
  -- null означает «не трогать» — та же логика, что у доступности.
  p_engine_volume    numeric           default null
)
returns table (
  id            uuid,
  status        text,
  boosted_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user_id   uuid := auth.uid();
  v_car       public.cars;
  v_is_sale   boolean := false;
  v_is_rent   boolean := false;
  v_sale      numeric;
  v_rent      numeric;
  v_deposit   numeric;
  v_location  geography(point, 4326);
  v_desc      text;
  v_phone     text;
  v_url       text;
  v_idx       integer := 0;
  v_changed   boolean := false;
  v_old_photos text[];
  -- Правка идёт из архива, снятого администратором: от этого зависит
  -- и допуск к правке, и то, куда уедет статус.
  v_from_admin_archive boolean := false;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку: параллельные сохранения из двух вкладок не
  -- должны перемешать поля одного объявления.
  select c.* into v_car
    from public.cars c
   where c.id = p_car_id
   for update;

  if v_car.id is null then
    raise exception 'Объявление не найдено'
      using errcode = 'no_data_found';
  end if;

  -- Владелец — и только он.
  if v_car.user_id <> v_user_id then
    raise exception 'Нельзя редактировать чужое объявление'
      using errcode = 'insufficient_privilege';
  end if;

  v_from_admin_archive :=
    v_car.status = 'archived'
    and v_car.archived_by = 'admin'::public.archived_by_kind;

  -- Редактировать можно рабочие статусы и админский архив (0090).
  -- Проданное и СВОЙ архив сначала возвращают в публикацию
  -- (set_my_car_status): для них путь короче и предсказуемее.
  if v_car.status not in ('moderation', 'rejected', 'active')
     and not v_from_admin_archive
  then
    raise exception 'Объявление нельзя редактировать: статус = %', v_car.status
      using errcode = 'check_violation';
  end if;

  -- ---------- ВАЛИДАЦИЯ: дословно как в create_car_v3 ----------
  if p_listing_type = 'sale' then
    v_is_sale := true;
  elsif p_listing_type = 'rent' then
    v_is_rent := true;
  elsif p_listing_type = 'both' then
    v_is_sale := true;
    v_is_rent := true;
  else
    raise exception 'Некорректный listing_type = % (ожидалось sale/rent/both)', p_listing_type
      using errcode = 'check_violation';
  end if;

  if v_is_rent and p_rent_price_daily is null then
    raise exception 'Для аренды требуется цена за сутки'
      using errcode = 'check_violation';
  end if;

  if p_rent_price_daily is not null and p_rent_price_daily <= 0 then
    raise exception 'Цена аренды должна быть больше нуля'
      using errcode = 'check_violation';
  end if;

  if p_sale_price is not null and p_sale_price <= 0 then
    raise exception 'Цена продажи должна быть больше нуля'
      using errcode = 'check_violation';
  end if;

  if p_deposit_amount is not null and p_deposit_amount < 0 then
    raise exception 'Залог не может быть отрицательным'
      using errcode = 'check_violation';
  end if;

  -- Значения, которые лягут в строку. Считаем ДО сравнения, чтобы
  -- сравнивать ровно то, что будет записано.
  v_sale    := case when v_is_sale then p_sale_price end;
  v_rent    := case when v_is_rent then p_rent_price_daily end;
  v_deposit := case when v_is_rent then coalesce(p_deposit_amount, 0) else 0 end;
  v_desc    := nullif(btrim(coalesce(p_description, '')), '');
  v_phone   := nullif(btrim(coalesce(p_phone, '')), '');

  if p_lat is not null and p_lng is not null then
    v_location := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  -- ---------- Изменился ли контент ----------
  -- is distinct from вместо <>: обычное сравнение с NULL даёт NULL, и
  -- правка «была цена — стало пусто» осталась бы незамеченной.
  v_changed :=
       v_car.is_for_sale      is distinct from v_is_sale
    or v_car.is_for_rent      is distinct from v_is_rent
    or v_car.brand            is distinct from p_brand
    or v_car.model            is distinct from p_model
    or v_car.year             is distinct from p_year
    or v_car.mileage          is distinct from p_mileage
    or v_car.body_type        is distinct from p_body_type
    or v_car.transmission     is distinct from p_transmission
    or v_car.fuel             is distinct from p_fuel
    or v_car.currency         is distinct from coalesce(p_currency, 'EUR')::currency_code
    or v_car.sale_price       is distinct from v_sale
    or v_car.rent_price_daily is distinct from v_rent
    or v_car.deposit_amount   is distinct from v_deposit
    or v_car.city             is distinct from p_city
    or v_car.description      is distinct from v_desc
    or v_car.contact_phone    is distinct from v_phone
    -- СМЕНА ДОСТУПНОСТИ — ТОЖЕ ИЗМЕНЕНИЕ СОДЕРЖАНИЯ, и объявление
    -- уходит на перемодерацию: наличная машина, обещание её привезти
    -- и машина в пути — разные предложения, и модератор обязан
    -- увидеть переход между ними.
    or (p_availability is not null
        and v_car.availability
            is distinct from p_availability::car_availability)
    -- Объём двигателя — характеристика машины, и его правка тоже
    -- отправляет объявление на перемодерацию: «1.6» вместо «2.0»
    -- меняет предмет сделки.
    or (p_engine_volume is not null
        and v_car.engine_volume is distinct from p_engine_volume);

  -- Фотографии сравниваем отдельно и только если их прислали.
  if not v_changed and p_photo_urls is not null then
    select coalesce(array_agg(ci.image_url order by ci.order_index), '{}')
      into v_old_photos
      from public.car_images ci
     where ci.car_id = p_car_id;

    if v_old_photos is distinct from p_photo_urls then
      v_changed := true;
    end if;
  end if;

  -- ---------- Запись ----------
  update public.cars c
     set is_for_sale      = v_is_sale,
         is_for_rent      = v_is_rent,
         brand            = p_brand,
         model            = p_model,
         year             = p_year,
         mileage          = p_mileage,
         body_type        = p_body_type,
         transmission     = p_transmission,
         fuel             = p_fuel,
         currency         = coalesce(p_currency, 'EUR')::currency_code,
         sale_price       = v_sale,
         rent_price_daily = v_rent,
         deposit_amount   = v_deposit,
         city             = p_city,
         description      = v_desc,
         contact_phone    = v_phone,
         location         = v_location,
         availability     = case
                              when p_availability in
                                   ('in_stock', 'on_order', 'in_transit')
                              then p_availability::car_availability
                              else c.availability
                            end,
         engine_volume    = case
                              when p_engine_volume is null
                              then c.engine_volume
                              when p_engine_volume > 0
                              then p_engine_volume
                            end,
         -- Контент изменился — объявление уходит на проверку, прежняя
         -- причина отклонения теряет смысл. Это одинаково верно и для
         -- обычной правки, и для правки админского архива: во втором
         -- случае повторная модерация и есть способ вернуться в пул.
         status = case when v_changed then 'moderation'::car_status
                       else c.status end,
         moderation_comment = case when v_changed then null
                                   else c.moderation_comment end,
         -- Метки архива снимаются вместе с уходом на модерацию.
         -- Формально это же сделал бы триггер (0089 гасит их при
         -- выходе из archived), но полагаться на него здесь нельзя:
         -- при несущественной правке статус не меняется, триггер не
         -- срабатывает вовсе, и метки обязаны остаться на месте.
         -- Явное выражение описывает оба случая сразу.
         archived_by = case when v_changed then null
                            else c.archived_by end,
         archived_reason = case when v_changed then null
                                else c.archived_reason end,
         -- Продвижение гасится вместе с уходом на модерацию: наверху
         -- выдачи не должно стоять непроверенное содержимое.
         is_vip = case when v_changed then false else c.is_vip end,
         boosted_until = case when v_changed then null
                              else c.boosted_until end
   where c.id = p_car_id;

  -- ---------- Полная замена набора фотографий ----------
  if p_photo_urls is not null then
    delete from public.car_images where car_id = p_car_id;

    foreach v_url in array p_photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (p_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  -- Возвращаем актуальное состояние: кабинету нужно понять, ушло ли
  -- объявление на модерацию, и перерисовать бейдж без второго запроса.
  return query
    select c.id, c.status::text, c.boosted_until
      from public.cars c
     where c.id = p_car_id;
end;
$fn$;


-- ------------------------------------------------------------
-- 4) search_cars_public — фильтр по объёму и объём в выдаче
-- ------------------------------------------------------------
-- Тело перенесено из 0119 дословно; добавлены два параметра
-- границы, условие фильтрации и колонка в возвращаемом наборе.
--
-- Здесь drop нужен ещё и потому, что меняется набор возвращаемых
-- колонок: create or replace на это отвечает SQLSTATE 42P13.
-- Миграция идёт одной транзакцией, промежутка без функции снаружи
-- не существует.

drop function if exists public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text, integer, boolean
);

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
  p_shuffle_all  boolean default false,
  -- ОБЪЁМ ДВИГАТЕЛЯ, ступень фильтра (0133). Границы приходят парой
  -- и трактуются как [from, to): «1.6–2.0» не должен пересекаться с
  -- «2.0–3.0», иначе машина 2.0 попала бы в обе ступени сразу.
  -- Параметры стоят ПОСЛЕДНИМИ и с default — прежние вызовы, включая
  -- мобильное приложение, продолжают работать без изменений.
  p_engine_from  numeric default null,
  p_engine_to    numeric default null
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
  engine_volume    numeric,
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
  -- Доступность: in_stock | on_order | in_transit (0119).
  availability     text,
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
      -- Объём: нижняя граница включается, верхняя — нет (см. выше).
      -- Машины без указанного объёма (электромобили) из выдачи
      -- выпадают: у них нет ДВС, и фильтр по литрам к ним не
      -- применим. Это осознанно, а не побочный эффект NULL.
      and (p_engine_from is null or c.engine_volume >= p_engine_from)
      and (p_engine_to   is null or c.engine_volume <  p_engine_to)
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
    r.engine_volume,
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
    r.availability::text,
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


-- ------------------------------------------------------------
-- 5) get_car_details — объём в карточке объявления
-- ------------------------------------------------------------
-- Тело перенесено из 0119 дословно; добавлена одна колонка.
-- Сигнатура (uuid) не меняется, но набор возвращаемых колонок —
-- меняется, а на это create or replace отвечает SQLSTATE 42P13.
-- Отсюда drop, а следом — повторный grant: пересозданная функция
-- прав не наследует (см. 0065).

drop function if exists public.get_car_details(uuid);

create or replace function public.get_car_details(p_car_id uuid)
returns table (
  id                uuid,
  user_id           uuid,
  is_for_sale       boolean,
  is_for_rent       boolean,
  brand             text,
  model             text,
  year              integer,
  mileage           integer,
  body_type         text,
  transmission      text,
  fuel              text,
  engine_volume     numeric,
  currency          text,
  sale_price        numeric,
  rent_price_daily  numeric,
  deposit_amount    numeric,
  city              text,
  description       text,
  contact_phone     text,
  rating_avg        numeric,
  reviews_count     integer,
  status            text,
  is_vip            boolean,
  boosted_until     timestamptz,
  is_promoted       boolean,
  site_url          text,
  seller_kind       text,
  seller_name       text,
  seller_logo_url   text,
  seller_avatar_url text,
  seller_since      timestamptz,
  created_at        timestamptz,
  updated_at        timestamptz,
  archived_by       text,
  archived_reason   text,
  -- Доступность: in_stock | on_order | in_transit (0119).
  availability      text
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    -- Право видеть объявление целиком. Вычисляется один раз: иначе
    -- auth.uid() и is_admin() пришлось бы звать в каждом из полутора
    -- десятков case-выражений ниже.
    select
      c.*,
      (c.user_id = auth.uid() or public.is_admin()) as full_access
    from public.cars c
    where c.id = p_car_id
  )
  select
    v.id, v.user_id, v.is_for_sale, v.is_for_rent,
    v.brand, v.model, v.year, v.mileage,
    v.body_type::text, v.transmission::text, v.fuel::text,
    v.engine_volume,
    v.currency::text,
    -- Цены снятого объявления не показываем посторонним.
    case when v.full_access or v.status in ('active', 'sold')
         then v.sale_price end,
    case when v.full_access or v.status in ('active', 'sold')
         then v.rent_price_daily end,
    case when v.full_access or v.status in ('active', 'sold')
         then v.deposit_amount end,
    v.city,
    -- Описание — содержимое, снятое с публикации.
    case when v.full_access or v.status in ('active', 'sold')
         then v.description end,
    -- ТЕЛЕФОН: ДВА УСЛОВИЯ СРАЗУ.
    -- 1) объявление опубликовано — снятое не должно приводить звонки;
    -- 2) вызывающий вошёл — анонимный обход каталога больше не
    --    собирает контакты продавцов (см. шапку миграции).
    -- Владелец и администратор идут по ветке full_access и обе
    -- проверки минуют.
    case when v.full_access
              or (auth.uid() is not null
                  and v.status in ('active', 'sold'))
         then v.contact_phone end,
    case when v.full_access or v.status in ('active', 'sold')
         then v.rating_avg end,
    case when v.full_access or v.status in ('active', 'sold')
         then v.reviews_count end,
    v.status::text,
    v.is_vip, v.boosted_until,
    (v.is_vip and v.boosted_until is not null and v.boosted_until > now()),
    public.f_car_site_url(v.id),
    -- Витрина продавца целиком — только для доступных объявлений.
    case when v.full_access or v.status in ('active', 'sold')
         then p.seller_kind end,
    case
      when v.full_access or v.status in ('active', 'sold')
      then case
             when p.seller_kind = 'dealer'
             then coalesce(nullif(trim(p.company_name), ''), 'Автосалон')
             else coalesce(nullif(trim(p.full_name), ''), 'Продавец')
           end
    end,
    case when v.full_access or v.status in ('active', 'sold')
         then p.logo_url end,
    case when v.full_access or v.status in ('active', 'sold')
         then p.avatar_url end,
    case when v.full_access or v.status in ('active', 'sold')
         then p.created_at end,
    v.created_at, v.updated_at,
    -- Авторство и причина снятия — только владельцу и админу.
    -- Отдаём текстом, а не enum: клиентские библиотеки получают
    -- пользовательский тип строкой, и тип не протекает наружу.
    case when v.full_access then v.archived_by::text end,
    case when v.full_access then v.archived_reason end,
    -- Пометка публична: покупателю она нужна до звонка.
    v.availability::text
  from viewer v
  join public.profiles p on p.id = v.user_id
  where
    -- Публично: активные и проданные — полностью.
    v.status in ('active', 'sold')
    -- Снятые, отклонённые и ушедшие на перепроверку — в урезанном
    -- виде (см. case-выражения выше). Нужны, чтобы ссылка из выдачи
    -- вела на страницу «объявление снято», а не на голую 404.
    -- expired добавлен к снятым (0113): для читателя это тот же
    -- случай «объявление сейчас не опубликовано», и заводить второй
    -- вариант поведения незачем.
    or v.status in ('archived', 'rejected', 'moderation', 'expired')
    -- Владельцу и администратору — всё и всегда.
    or v.full_access;
$$;

grant execute on function public.get_car_details(uuid)
  to anon, authenticated;

-- ------------------------------------------------------------
-- 6) Права
-- ------------------------------------------------------------
-- Миграция 0065 закрыла default privileges: КАЖДАЯ новая сигнатура
-- требует явного гранта, иначе клиент получит «function not found».
-- Сигнатуры перечисляются полностью — иначе Postgres не поймёт, о
-- какой функции речь.

grant execute on function public.create_car_v3(
  text, text, text, integer, integer, numeric, numeric, numeric, text,
  text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text, text, numeric
) to authenticated;

grant execute on function public.update_car_v3(
  uuid, text, text, text, integer, integer, numeric, numeric, numeric,
  text, text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text, text, numeric
) to authenticated;

-- Каталог обязан работать для анонима: на нём стоит SSR и индексация.
grant execute on function public.search_cars_public(
  text, text, text, text, integer, integer, integer, numeric, numeric,
  text, text, text, text, integer, integer, text, integer, boolean,
  numeric, numeric
) to anon, authenticated;
