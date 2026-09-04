-- ============================================================
-- 0139 — «ТОТАЛ» СЛИВАЕТСЯ С «НА ЗАПЧАСТИ»
-- ============================================================
-- ЧТО МЕНЯЕТСЯ. Значение 'salvage' (тотальная гибель) убирается из
-- набора состояний, а объявления с ним переводятся в 'parts'.
--
-- ПОЧЕМУ, ХОТЯ 0138 ЗАВЕЛА ЕГО ПЯТЬ МИНУТ НАЗАД. Формально это разные
-- вещи: 'parts' — намерение продавца («разбираю на детали»), 'salvage'
-- — юридический статус машины, списанной страховой. Но для ПОКУПАТЕЛЯ
-- оба означают ровно одно: машина не поедет, годится на запчасти. А
-- для ПРОДАВЦА разница неочевидна без подсказки, и часть объявлений
-- неизбежно легла бы не в тот пункт — то есть два значения давали бы
-- один смысл и разное заполнение.
--
-- Практический довод сильнее теоретической точности: выбор из пяти
-- пунктов, где два неразличимы на глаз, хуже выбора из четырёх.
--
-- ПОТЕРИ СМЫСЛА НЕТ: обоих скрывал один и тот же фильтр каталога
-- (damaged, parts, salvage — одна группа в search_cars_public), и в
-- выдаче они вели себя одинаково с самого начала. Сливаются значения,
-- которые уже были неразличимы для поиска.
--
-- ПОЧЕМУ НЕ ПРОСТО «НЕ ПОКАЗЫВАТЬ В ФОРМЕ». Значение, убранное только
-- из интерфейса, остаётся в enum и продолжает приходить из базы —
-- бейдж и плашка обязаны были бы уметь его рисовать вечно, а любой
-- забывший об этом код показал бы пустое место. Значение убирается
-- целиком, из типа тоже.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Перенос данных
-- ------------------------------------------------------------
-- Выполняется ДО подмены типа: строка со старым значением не может
-- пережить пересоздание enum, в котором этого значения уже нет.
--
-- На момент написания миграции таких строк на проде нет (0138
-- применена в тот же день, все объявления в 'normal'), но перенос
-- написан честно: между написанием и применением объявление может
-- появиться.
update public.cars
   set condition = 'parts'
 where condition = 'salvage';


-- ------------------------------------------------------------
-- 2) Пересоздание типа без 'salvage'
-- ------------------------------------------------------------
-- Postgres не умеет удалять значение из enum (ALTER TYPE ... DROP
-- VALUE не существует), поэтому тип пересоздаётся целиком:
--   * новый тип под временным именем;
--   * колонка переводится на него с приведением через text;
--   * старый тип удаляется, новый переименовывается.
--
-- Колонка теряет default на время подмены и получает его обратно:
-- ALTER TYPE не переносит default автоматически, а без него вставка
-- без явного значения упала бы на not null.
--
-- ЧАСТИЧНЫЙ ИНДЕКС СНОСИТСЯ ДО ПОДМЕНЫ И СОЗДАЁТСЯ ПОСЛЕ. Это не
-- перестраховка: idx_cars_condition из 0138 несёт предикат
-- (condition <> 'normal'), и при смене типа колонки Postgres пытается
-- перестроить индекс, сравнивая НОВЫЙ тип со СТАРЫМ литералом —
-- падает с «operator does not exist: car_condition_new <>
-- car_condition» (SQLSTATE 42883). Пересоздание индекса после
-- переименования типа снимает вопрос целиком.
do $$
begin
  -- Идемпотентность: если 'salvage' в типе уже нет, миграция
  -- повторно ничего не делает. Так db push на частично применённой
  -- базе не падает.
  if exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'car_condition'
       and e.enumlabel = 'salvage'
  ) then

    create type public.car_condition_new as enum (
      'normal',
      'damaged',
      -- Объединённое значение: и «разбираю на детали», и «списана
      -- страховой». Для покупателя это один случай.
      'parts',
      'no_docs',
      'for_export'
    );

    alter table public.cars
      alter column condition drop default;

    -- Предикат индекса ссылается на старый тип — см. шапку блока.
    drop index if exists public.idx_cars_condition;

    alter table public.cars
      alter column condition type public.car_condition_new
      using condition::text::public.car_condition_new;

    drop type public.car_condition;

    alter type public.car_condition_new
      rename to car_condition;

    alter table public.cars
      alter column condition set default 'normal';

    -- Индекс возвращается в прежнем виде: те же колонка и смысл
    -- предиката, только тип под ним теперь без 'salvage'.
    create index if not exists idx_cars_condition
      on public.cars (condition)
      where condition <> 'normal';

  end if;
end
$$;

comment on type public.car_condition
  is 'Состояние авто: обычное / битое / на запчасти / без документов / только на экспорт (0139: salvage слит с parts)';

comment on column public.cars.condition
  is 'Состояние: normal | damaged | parts | no_docs | for_export. Доступно ВСЕМ продавцам, в отличие от availability (0139)';


-- ------------------------------------------------------------
-- 3) Функции, где 'salvage' упомянут явно
-- ------------------------------------------------------------
-- ВАЖНО: create_car_v3 и update_car_v3 из 0138 сравнивают присланную
-- строку со списком допустимых значений, и в этом списке стоит
-- 'salvage'. Сам по себе такой список ошибку не даёт — приведение
-- к типу выполняется только для значения ИЗ списка, а 'salvage'
-- теперь в типе отсутствует, и клиент, приславший его, получил бы
-- ошибку приведения вместо тихого 'normal'.
--
-- Поэтому обе функции переписываются: 'salvage' убирается из
-- перечисления, и присланное старое значение уходит в 'normal'
-- (create) или «не трогать» (update) — так же, как любой другой
-- мусор из обхода формы.
--
-- Тела функций НЕ переписываются целиком: меняется одно выражение в
-- каждой, а полный перенос из 0138 означал бы копию на пятьсот строк
-- ради двух правок. Сигнатуры не меняются, поэтому drop не нужен и
-- контракт с мобильным приложением не затрагивается.
--
-- ТО ЖЕ КАСАЕТСЯ ФИЛЬТРА В search_cars_public: там стоит
-- not in ('damaged', 'parts', 'salvage'), и литерал снятого значения
-- Postgres привести к типу уже не сможет. Условие переписывается на
-- пару значений — смысл сохраняется полностью, потому что бывший
-- 'salvage' теперь и есть 'parts'.

create or replace function public.f_car_condition_in(p_condition text)
returns public.car_condition
language sql
immutable
as $$
  -- Приведение присланной клиентом строки к состоянию.
  -- Неизвестное значение (включая снятое 'salvage') даёт 'normal':
  -- прийти оно может только в обход формы, и падать из-за него
  -- подача объявления не должна.
  select case
           when p_condition in ('damaged', 'parts', 'no_docs', 'for_export')
           then p_condition::public.car_condition
           else 'normal'::public.car_condition
         end;
$$;

comment on function public.f_car_condition_in(text)
  is 'Строка клиента -> car_condition. Неизвестное значение даёт normal (0139)';

grant execute on function public.f_car_condition_in(text)
  to anon, authenticated;


-- ---------- create_car_v3 ----------
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
  p_availability     text              default null,
  p_engine_volume    numeric           default null,
  -- СОСТОЯНИЕ АВТОМОБИЛЯ (0138). Параметр стоит последним и с default
  -- — прежние вызовы, включая мобильное приложение, продолжают
  -- работать: PostgREST сопоставляет аргументы по имени, а
  -- отсутствующий получает значение по умолчанию.
  --
  -- Тип text по той же причине, что у p_availability: клиент присылает
  -- строку, и приводить её здесь дешевле, чем требовать от каждого
  -- клиента знания серверного типа. Неизвестное значение приводится к
  -- 'normal' — молча, потому что прийти оно может только в обход формы.
  p_condition        text              default null
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
  -- (trg_cars_prevent_duplicate, миграция 0133).

  if p_lat is not null and p_lng is not null then
    v_location := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    body_type, transmission, fuel,
    currency, sale_price, rent_price_daily, deposit_amount,
    city, description, contact_phone, location,
    availability, engine_volume, condition
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
    -- trg_cars_availability_dealer_only (0119).
    case
      when p_availability in ('on_order', 'in_transit')
      then p_availability::car_availability
      else 'in_stock'::car_availability
    end,
    -- Ноль и отрицательные значения отбрасываем: это не «маленький
    -- мотор», а мусор из обхода формы. Верхнюю границу держит
    -- constraint chk_engine_volume на таблице.
    case when p_engine_volume > 0 then p_engine_volume end,
    -- Состояние. Проверки «только салону» здесь НЕТ намеренно: битую
    -- машину продаёт и частник.
    -- 0139: список допустимых значений переехал в
    -- f_car_condition_in — одно место вместо трёх.
    public.f_car_condition_in(p_condition)
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


-- ---------- update_car_v3 ----------
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
  p_engine_volume    numeric           default null,
  -- null означает «не трогать» — та же логика (0138).
  p_condition        text              default null
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
        and v_car.engine_volume is distinct from p_engine_volume)
    -- СМЕНА СОСТОЯНИЯ — тем более изменение содержания: «обычная»
    -- вместо «битая» меняет предмет сделки сильнее, чем любая
    -- характеристика, и пропустить такую правку мимо модератора
    -- нельзя. Именно этот переход и стал бы способом обмануть
    -- покупателя: подать битую машину честно, дождаться публикации и
    -- тихо снять пометку.
    or (p_condition is not null
        and v_car.condition is distinct from p_condition::car_condition);

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
         -- 0139: 'salvage' снят. null по-прежнему означает «не
         -- трогать», поэтому проверяем его отдельно, а сам разбор
         -- значения делает f_car_condition_in.
         condition        = case
                              when p_condition is null then c.condition
                              else public.f_car_condition_in(p_condition)
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


-- ---------- search_cars_public ----------
-- Набор возвращаемых колонок НЕ меняется, поэтому drop не нужен:
-- create or replace достаточно, и сигнатура остаётся прежней.
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
  p_engine_from  numeric default null,
  p_engine_to    numeric default null,
  -- ПОКАЗЫВАТЬ ЛИ БИТЫЕ И РАЗБОРКУ (0138).
  --
  -- ПО УМОЛЧАНИЮ FALSE, и это главное решение всей миграции. Человек,
  -- пришедший за машиной, ищет машину на ходу; донор на разборку в
  -- той же выдаче — это не «дополнительный вариант», а мусор, из-за
  -- которого сравнение цен перестаёт работать: битый Golf за 1500 €
  -- рядом с целым за 8000 € выглядит выгодной находкой, пока не
  -- откроешь карточку.
  --
  -- Скрываются ДВА значения из пяти: damaged и parts — то есть те,
  -- где машина не на ходу или требует восстановления. С 0139 в
  -- 'parts' входит и бывший 'salvage'.
  -- no_docs и for_export остаются в выдаче ВСЕГДА: машина на ходу и
  -- в порядке, ограничение чисто юридическое, и прятать её от
  -- покупателя, которого это ограничение устраивает, незачем.
  --
  -- Параметр стоит ПОСЛЕДНИМ и с default — прежние вызовы, включая
  -- мобильное приложение, продолжают работать. ВАЖНОЕ СЛЕДСТВИЕ: у
  -- клиента, не знающего о параметре, выдача теперь не содержит
  -- битых машин. Это осознанно — именно такое поведение и требуется
  -- по умолчанию, а не только на сайте.
  p_show_damaged boolean default false
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
  -- Состояние: normal | damaged | parts | no_docs | for_export
  -- (0139). Ось, независимая от availability выше.
  condition        text,
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
      -- СОСТОЯНИЕ. Выключенный флаг убирает нерабочие машины; включённый
      -- не добавляет ничего сверх обычной выдачи, а просто снимает это
      -- ограничение. Фильтр по availability здесь НЕ участвует —
      -- это независимая ось, и «в пути» остаётся в выдаче при любом
      -- значении флага.
      and (
        coalesce(p_show_damaged, false)
        or c.condition not in ('damaged', 'parts')
      )
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
    r.condition::text,
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
    -- УРОВЕНЬ 2: ОКНО СВЕЖЕСТИ (0088).
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
