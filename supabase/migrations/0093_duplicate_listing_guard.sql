-- ============================================================
-- AUTO.RS — Миграция 0093: защита от дублей объявлений на таблице
-- ============================================================
-- ЧТО БЫЛО. Правило «не даём подать одну машину дважды» жило ДВУМЯ
-- копиями внутри функций подачи: create_car_v2 (0037 → 0049, её
-- вызывает приложение) и create_car_v3 (0057, подача с сайта). Копии
-- дословно совпадали, но у такой конструкции три дыры:
--
--   1) ЛЮБОЙ ПУТЬ ЗАПИСИ МИМО ЭТИХ ДВУХ ФУНКЦИЙ проверку не проходит
--      вовсе. Прямой INSERT под service_role, будущая RPC, импорт
--      фида дилера — все они вставляют дубль молча;
--
--   2) ВОЗВРАТ ИЗ АРХИВА ПРОВЕРКУ НЕ ВИДИТ ВООБЩЕ. Проверка стоит на
--      пути INSERT, а set_my_car_status (0089) переводит archived →
--      active обычным UPDATE. Отсюда сценарий, который защита не
--      ловила ничем: снять объявление в архив, подать такое же
--      заново, дождаться публикации и вернуть старое кнопкой
--      «Вернуть» — оба окажутся active;
--
--   3) ДВЕ КОПИИ ОДНОГО ПРАВИЛА РАСХОДЯТСЯ. Сейчас они совпадают, но
--      ничто не заставляет править обе разом.
--
-- ЧТО СТАНОВИТСЯ. Правило переезжает на таблицу — BEFORE INSERT OR
-- UPDATE OF status ON cars. Это единственный источник истины: он
-- перехватывает все пути записи сразу, включая возврат из архива, и
-- его нельзя обойти с клиента.
--
-- ------------------------------------------------------------
-- КЛЮЧ СОВПАДЕНИЯ — ВОЗВРАТ К 0037, А НЕ К 0049
-- ------------------------------------------------------------
-- Ключ: user_id + lower(btrim(brand)) + lower(btrim(model)) + year +
-- тип сделки (is_for_sale, is_for_rent). Пробега и цены в нём НЕТ.
--
-- Именно их добавление в 0049 и сделало защиту обходимой одной
-- цифрой: правка пробега 87 600 → 87 601 выводила подачу из-под
-- проверки, а для человека, переподающего объявление «посвежее», это
-- не обход, а обычное поведение.
--
-- НО ПРИЧИНА, ПО КОТОРОЙ 0049 ОСЛАБИЛА КЛЮЧ, НИКУДА НЕ ДЕЛАСЬ: у
-- автосалона реально стоят две одинаковые машины разной комплектации,
-- и запрещать их — ломать рабочий сценарий. Поэтому вместо ослабления
-- ключа для всех вводится ЯВНОЕ ИСКЛЮЧЕНИЕ ДЛЯ САЛОНОВ (ниже). У
-- частника две физически разные Golf 2020 — редкость, требующая
-- объяснения; у салона — норма.
--
-- ТИП СДЕЛКИ В КЛЮЧЕ. Пары флагов (is_for_sale, is_for_rent) у
-- продажи и аренды разные — (true,false) и (false,true). Одна машина,
-- выставленная и на продажу, и в аренду, подаётся двумя объявлениями
-- (так устроена форма сайта, см. SellForm) и проверку проходит.
--
-- ------------------------------------------------------------
-- ВТОРОЕ ПРАВИЛО: ТЕЛЕФОН
-- ------------------------------------------------------------
-- Ключ по user_id слеп к одному и тому же человеку с двумя
-- аккаунтами: завёл второй номер — и подал ту же машину заново.
-- Поэтому тем же триггером идёт вторая проверка, по
-- contact_phone + brand + model + year + тип сделки, БЕЗ учёта
-- user_id.
--
-- Телефон сравнивается ПО ЦИФРАМ и по национальной части: сайт
-- присылает E.164 (+3816XXXXXXXX), приложение может прислать с
-- пробелами, а требовать один формат значило бы отключить проверку
-- для одного из двух клиентов. Нормализация повторяет ту, что уже
-- работает в f_car_autopublish_check (0086), — вынесена в отдельную
-- функцию f_phone_digits, чтобы правило нормализации существовало в
-- одном месте.
--
-- ------------------------------------------------------------
-- ИСКЛЮЧЕНИЕ ДЛЯ САЛОНОВ
-- ------------------------------------------------------------
-- seller_kind = 'dealer' → обе проверки пропускаются. Салон вправе
-- держать в выдаче две одинаковые машины: у него их физически две.
--
-- Право привязано к ВИДУ ПРОДАВЦА, а не к флагу trusted_seller: это
-- разные вещи. trusted_seller даёт автопубликацию мимо модерации
-- (0086) и выдаётся адресно; здесь же речь о том, что у салона
-- в принципе бывает несколько одинаковых машин, и это верно для
-- любого салона, доверенного или нет.
--
-- ------------------------------------------------------------
-- ЧТО ПРОИСХОДИТ С ПРОВЕРКАМИ В create_car_v2/v3
-- ------------------------------------------------------------
-- ОНИ УБИРАЮТСЯ. Источник истины должен быть один, иначе смысла в
-- переносе нет: оставь их — и мы вернёмся к трём копиям правила
-- вместо двух.
--
-- Сигнатуры обеих функций НЕ меняются (create or replace, drop не
-- нужен) — прямое требование контракта с приложением. Меняется
-- только поведение внутри, и меняется одинаково для обоих клиентов.
--
-- ТЕКСТ ОШИБКИ СОХРАНЯЕТСЯ ПО СМЫСЛУ, но теперь он один и приходит
-- из триггера. errcode остаётся 'unique_violation' (23505): на него
-- уже смотрит сайт (humanOtpError в lib/otp.ts), и менять код
-- значило бы ломать разбор ошибки на клиенте.
--
-- ------------------------------------------------------------
-- ПОЧЕМУ BEFORE, А НЕ AFTER
-- ------------------------------------------------------------
-- BEFORE отклоняет операцию до записи. AFTER-триггер тоже отклонил бы
-- (исключение откатывает транзакцию), но уже после срабатывания
-- индексов и остальных BEFORE-триггеров — то есть дороже и без
-- всякой выгоды.
--
-- UPDATE OF status, а не UPDATE целиком: правка марки или модели у
-- уже активного объявления через update_car_v3 отправляет его в
-- moderation, то есть меняет статус, и триггер её увидит. Ловить же
-- каждый UPDATE (просмотры, метрики, промо) значило бы гонять
-- проверку на потоке записей, которые ключ дублирования не трогают.
-- ============================================================


-- ============================================================
-- БЛОК 1. f_phone_digits — национальная часть номера
-- ============================================================
-- Снимает всё, кроме цифр, затем код страны (00381 / 381) или ведущий
-- ноль. Тот же алгоритм, что в f_car_autopublish_check (0086) и в
-- serbianNationalDigits на клиенте (lib/inputFormat.ts).
--
-- ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ПОВТОР КОДА: правило нормализации телефона
-- нужно теперь в двух местах бэкенда, и разойдись они — проверка
-- дублей по телефону начала бы пропускать номера, которые
-- автопубликация считает валидными.
--
-- IMMUTABLE: результат зависит только от аргумента. Это позволяет
-- вызывать функцию в индексном выражении, если однажды понадобится
-- индекс по нормализованному телефону.
create or replace function public.f_phone_digits(p_phone text)
returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');

  if v_digits = '' then
    return null;
  end if;

  if v_digits like '00381%' then
    v_digits := substring(v_digits from 6);
  elsif v_digits like '381%' then
    v_digits := substring(v_digits from 4);
  elsif v_digits like '0%' then
    v_digits := substring(v_digits from 2);
  end if;

  return nullif(v_digits, '');
end;
$fn$;

comment on function public.f_phone_digits(text)
  is 'Национальная часть телефона одними цифрами: снимает код страны 381/00381 и ведущий ноль. Общая нормализация для сравнения номеров, присланных сайтом (E.164) и приложением (с пробелами)';


-- ============================================================
-- БЛОК 2. f_cars_prevent_duplicate — сам гейт
-- ============================================================
-- Возвращает NEW, если дубля нет; иначе бросает unique_violation.
--
-- SECURITY DEFINER: функция читает profiles.seller_kind другого
-- пользователя (при проверке по телефону — чужого), а RLS на profiles
-- этого не позволит из-под роли authenticated. Без definer проверка
-- по телефону молча не находила бы ничего.
create or replace function public.f_cars_prevent_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kind    text;
  v_phone   text;
  v_brand   text;
  v_model   text;
  v_dup_id  uuid;
begin
  -- ---------- Когда проверка вообще нужна ----------
  -- Только «живые» статусы: архив, отказ и продажа в выдаче не
  -- стоят и никому не мешают. Это же условие сохраняет прежнее
  -- поведение из 0049 — снятое объявление не мешает подать заново.
  if new.status not in ('moderation', 'active') then
    return new;
  end if;

  -- На UPDATE выходим, только если НИЧЕГО из ключа дублирования не
  -- изменилось — ни статус, ни сам ключ.
  --
  -- Сравнивать один статус было бы ошибкой. update_car_v3 (0067)
  -- пишет status в SET на КАЖДОМ вызове (там case ... else c.status),
  -- поэтому триггер вызывается и при обычной правке. И если продавец
  -- правит объявление, которое уже лежит в moderation, статус
  -- остаётся тем же — а вот марку и модель он этой правкой может
  -- сменить ровно на те, что заняты его вторым объявлением.
  -- Проверка «менялся ли статус» такую правку пропустила бы.
  if tg_op = 'UPDATE'
     and new.status      is not distinct from old.status
     and new.brand       is not distinct from old.brand
     and new.model       is not distinct from old.model
     and new.year        is not distinct from old.year
     and new.is_for_sale is not distinct from old.is_for_sale
     and new.is_for_rent is not distinct from old.is_for_rent
     and new.contact_phone is not distinct from old.contact_phone
  then
    return new;
  end if;

  -- ---------- Исключение для салонов ----------
  -- Читаем вид продавца ОДИН раз: он нужен обеим проверкам.
  select p.seller_kind into v_kind
    from public.profiles p
   where p.id = new.user_id;

  -- У салона две одинаковые машины — норма (см. шапку файла).
  if v_kind = 'dealer' then
    return new;
  end if;

  -- Нормализованные марка и модель. Считаем один раз: они входят
  -- в оба запроса ниже.
  v_brand := lower(btrim(coalesce(new.brand, '')));
  v_model := lower(btrim(coalesce(new.model, '')));

  -- ---------- Правило 1: тот же владелец ----------
  -- id <> new.id обязателен: на UPDATE строка уже лежит в таблице и
  -- без этого условия объявление нашло бы само себя.
  select c.id into v_dup_id
    from public.cars c
   where c.id <> new.id
     and c.user_id = new.user_id
     and lower(btrim(c.brand)) = v_brand
     and lower(btrim(c.model)) = v_model
     and c.year = new.year
     and c.is_for_sale = new.is_for_sale
     and c.is_for_rent = new.is_for_rent
     and c.status in ('moderation', 'active')
   limit 1;

  if v_dup_id is not null then
    raise exception
      'У вас уже есть объявление % % % г. в публикации. Отредактируйте его или снимите с публикации, прежде чем подавать новое.',
      new.brand, new.model, new.year
      using errcode = 'unique_violation';
  end if;

  -- ---------- Правило 2: тот же телефон, другой аккаунт ----------
  -- Ловит второй аккаунт того же человека: user_id разный, номер тот
  -- же. Объявления без телефона проверку пропускают — сравнивать
  -- нечего.
  v_phone := public.f_phone_digits(new.contact_phone);

  if v_phone is null then
    return new;
  end if;

  -- Салоны исключены и здесь: у объявлений одного салона общий
  -- контактный номер, и без этого условия вторая машина того же
  -- салона упиралась бы в правило по телефону, пройдя правило 1.
  --
  -- Соединение с profiles — ради того же исключения на ДРУГОЙ
  -- стороне: объявление салона не должно блокировать подачу
  -- частнику, случайно указавшему тот же номер (номер салона в
  -- объявлении частника — обычное дело при продаже через салон).
  select c.id into v_dup_id
    from public.cars c
    join public.profiles p on p.id = c.user_id
   where c.id <> new.id
     and c.user_id <> new.user_id
     and p.seller_kind <> 'dealer'
     and public.f_phone_digits(c.contact_phone) = v_phone
     and lower(btrim(c.brand)) = v_brand
     and lower(btrim(c.model)) = v_model
     and c.year = new.year
     and c.is_for_sale = new.is_for_sale
     and c.is_for_rent = new.is_for_rent
     and c.status in ('moderation', 'active')
   limit 1;

  if v_dup_id is not null then
    raise exception
      'Объявление % % % г. с этим номером телефона уже опубликовано.',
      new.brand, new.model, new.year
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$fn$;

comment on function public.f_cars_prevent_duplicate()
  is 'Гейт дублей: второе active/moderation объявление одного владельца (или одного телефона) с тем же brand+model+year+типом сделки. Салоны исключены — у них две одинаковые машины норма';

drop trigger if exists trg_cars_prevent_duplicate on public.cars;

create trigger trg_cars_prevent_duplicate
  before insert or update of status on public.cars
  for each row execute function public.f_cars_prevent_duplicate();


-- ============================================================
-- БЛОК 3. create_car_v2 — убираем копию правила
-- ============================================================
-- Тело повторяет 0049 ДОСЛОВНО, кроме вырезанного блока «Анти-даблклик»:
-- теперь его работу делает триггер. Сигнатура не меняется —
-- create or replace, вызовы приложения не затрагиваются.
create or replace function public.create_car_v2(
  listing_type   text,
  brand          text,
  model          text,
  year           integer,
  mileage        integer,
  price          numeric,                        -- NULL → «Договорная»
  currency       text,
  city           text,
  lat            double precision,
  lng            double precision,
  photo_urls     text[],
  p_body_type    body_type         default null,
  p_transmission transmission_type default null,
  p_fuel         fuel_type         default null,
  p_description  text              default null,
  p_phone        text              default null
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
  v_sale     numeric(12,2);
  v_rent     numeric(12,2);
  v_location geography(point, 4326);
  v_url      text;
  v_idx      integer := 0;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация для создания объявления'
      using errcode = 'insufficient_privilege';
  end if;

  -- Маппинг назначения. Цена может быть NULL (тогда «Договорная»).
  if listing_type = 'sale' then
    v_is_sale := true;
    v_sale := price;
  elsif listing_type = 'rent' then
    v_is_rent := true;
    v_rent := price;
  elsif listing_type = 'both' then
    v_is_sale := true;
    v_is_rent := true;
    v_sale := price;
    v_rent := price;
  else
    raise exception 'Некорректный listing_type = % (ожидалось sale/rent/both)', listing_type
      using errcode = 'check_violation';
  end if;

  -- Проверки на дубль здесь БОЛЬШЕ НЕТ: она переехала на таблицу
  -- (trg_cars_prevent_duplicate, эта же миграция) и сработает на
  -- INSERT ниже с тем же errcode 'unique_violation'.

  if lat is not null and lng is not null then
    v_location := st_setsrid(st_makepoint(lng, lat), 4326)::geography;
  end if;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    body_type, transmission, fuel,
    currency, sale_price, rent_price_daily,
    city, description, contact_phone, location
  )
  values (
    v_user_id, v_is_sale, v_is_rent,
    brand, model, year, mileage,
    p_body_type, p_transmission, p_fuel,
    coalesce(currency, 'EUR')::currency_code, v_sale, v_rent,
    city,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    v_location
  )
  returning id into v_car_id;

  if photo_urls is not null then
    foreach v_url in array photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (v_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_car_id;
end;
$$;

comment on function public.create_car_v2 is
  'Создание объявления (приложение). Защита от дублей — на таблице: trg_cars_prevent_duplicate (0093)';


-- ============================================================
-- БЛОК 4. create_car_v3 — убираем копию правила
-- ============================================================
-- Тело повторяет 0057 дословно, кроме вырезанного блока «Защита от
-- дублей». Сигнатура не меняется.
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
  p_phone            text              default null
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
    city, description, contact_phone, location
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
    v_location
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

comment on function public.create_car_v3(
  text, text, text, integer, integer, numeric, numeric, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text)
  is 'Подача с сайта: раздельные цены, залог. Защита от дублей — на таблице: trg_cars_prevent_duplicate (0093)';


-- ============================================================
-- БЛОК 5. get_my_similar_listings — предупреждение в форме подачи
-- ============================================================
-- УРОВЕНЬ 1 из аудита: форма подачи спрашивает эту функцию после
-- выбора марки/модели/года и, если что-то нашлось, показывает плашку
-- «У вас уже есть объявление …» со ссылкой на карточку.
--
-- ЭТО ПРЕДУПРЕЖДЕНИЕ, А НЕ ЗАПРЕТ. Функция ничего не блокирует и
-- вызывается ДО того, как продавец потратит время на фотографии и
-- SMS: узнать о своём же объявлении на первом шаге дешевле, чем
-- получить отказ на последнем.
--
-- КЛЮЧ ШИРЕ, ЧЕМ У ТРИГГЕРА: тип сделки в него НЕ входит. Триггер
-- отклоняет только точное совпадение, а показать стоит и соседний
-- случай — у продавца есть эта машина в продаже, а он подаёт её в
-- аренду. Это законно (триггер пропустит), но знать об этом полезно:
-- вероятно, он просто забыл про первое объявление.
--
-- ЧИТАЕТ ПО auth.uid(). Идентификатор владельца не параметр: иначе
-- любой авторизованный пользователь смог бы перечислять чужие
-- объявления по марке и модели.
--
-- STABLE, не VOLATILE: функция только читает. Это позволяет
-- планировщику вызывать её один раз на запрос.
create or replace function public.get_my_similar_listings(
  p_brand text,
  p_model text,
  p_year  integer
)
returns table (
  car_id       uuid,
  brand        text,
  model        text,
  year         integer,
  status       text,
  is_for_sale  boolean,
  is_for_rent  boolean,
  site_url     text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.brand,
    c.model,
    c.year,
    c.status::text,
    c.is_for_sale,
    c.is_for_rent,
    public.f_car_site_url(c.id),
    c.created_at
  from public.cars c
  where c.user_id = auth.uid()
    and c.status in ('moderation', 'active')
    and lower(btrim(c.brand)) = lower(btrim(coalesce(p_brand, '')))
    and lower(btrim(c.model)) = lower(btrim(coalesce(p_model, '')))
    and c.year = p_year
  -- Свежие сверху: если объявлений несколько, показать логично
  -- последнее поданное.
  order by c.created_at desc
  -- Ограничение на всякий случай: плашка показывает одно объявление,
  -- а тянуть на клиент неограниченный список незачем.
  limit 5;
$$;

comment on function public.get_my_similar_listings(text, text, integer)
  is 'Свои активные объявления по ключу brand+model+year для предупреждения в форме подачи. Тип сделки в ключ не входит — предупреждаем шире, чем запрещает триггер. Читает по auth.uid()';

-- anon сюда не нужен: функция читает объявления текущего
-- пользователя, а у гостя их нет по определению.
grant execute on function public.get_my_similar_listings(text, text, integer)
  to authenticated;
