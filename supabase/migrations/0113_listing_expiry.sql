-- ============================================================
-- AUTO.RS — Миграция 0113: срок жизни объявлений и продление
-- ============================================================
-- ЗАЧЕМ. У объявлений не было срока жизни: активное висело в выдаче
-- вечно, пока продавец сам его не снимал. Продавец, продавший машину
-- вживую и забывший нажать «Продано», — обычное дело, и через год
-- каталог наполнился бы мёртвыми объявлениями. Покупатели звонят,
-- никто не отвечает, доверие к площадке падает — а виноватой
-- выглядит площадка, а не забывчивый продавец.
--
-- РЕШЕНИЕ — НЕ УДАЛЕНИЕ, А МЯГКАЯ РЕАКТИВАЦИЯ:
--   1) у активного объявления есть expires_at (60 дней);
--   2) за 7 дней до срока продавцу уходит напоминание;
--   3) в срок объявление уходит в 'expired' — скрыто из выдачи,
--      но НЕ удалено;
--   4) продление в один клик возвращает его в 'active' на 60 дней.
--
-- ПОЧЕМУ 60 ДНЕЙ. Средний срок продажи подержанной машины на
-- балканском рынке — 4–8 недель. Меньший срок дёргал бы продавца
-- посреди активных переговоров, больший не решал бы исходную задачу.
-- Значение вынесено в app_settings: подобрать его точнее можно будет
-- по статистике, не выпуская миграцию.
--
-- СОВМЕСТИМОСТЬ С ПРИЛОЖЕНИЕМ (аддитивно, клиенты не трогаем):
--   * сигнатуры существующих RPC не меняются;
--   * expired нигде не нужно обрабатывать особо — вся выдача
--     фильтрует status = 'active', и новый статус в неё просто не
--     попадает;
--   * карточка по прямой ссылке уже умеет показывать «снято с
--     публикации» (0072) — добавляем expired в тот же список, и
--     приложение получает ровно то же поведение, что для архива.
-- ============================================================


-- ============================================================
-- 1) НАСТРОЙКИ СРОКА
-- ============================================================
-- В app_settings, а не константами в коде функций: срок — предмет
-- подбора по статистике, а не архитектурное решение. Правится
-- обычным UPDATE, без миграции и передеплоя.
insert into public.app_settings (key, value)
values
  ('listing_ttl_days', '60'),      -- сколько живёт активное объявление
  ('listing_warn_days', '7')       -- за сколько дней предупреждать
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- Чтение настроек с запасным значением
-- ------------------------------------------------------------
-- Отдельные функции, а не подзапрос в каждом месте: при смене способа
-- хранения править придётся одну строку. coalesce страхует от
-- удалённой или испорченной настройки — молча вернуть NULL и
-- проставить объявлению expires_at = NULL было бы хуже, чем
-- отработать по умолчанию.
create or replace function public.f_listing_ttl_days()
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select nullif(value, '')::integer from public.app_settings
      where key = 'listing_ttl_days'),
    60
  );
$$;

comment on function public.f_listing_ttl_days()
  is 'Срок жизни активного объявления в днях (app_settings.listing_ttl_days, по умолчанию 60)';

create or replace function public.f_listing_warn_days()
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select nullif(value, '')::integer from public.app_settings
      where key = 'listing_warn_days'),
    7
  );
$$;

comment on function public.f_listing_warn_days()
  is 'За сколько дней до истечения предупреждать продавца (app_settings.listing_warn_days, по умолчанию 7)';


-- ============================================================
-- 2) КОЛОНКИ
-- ============================================================
alter table public.cars
  add column if not exists expires_at   timestamptz,
  -- Отметка отправленного предупреждения. Без неё ежедневный job
  -- слал бы письмо каждые сутки все семь дней подряд: условие
  -- «до истечения меньше 7 дней» истинно всё это время.
  add column if not exists expiry_warned_at timestamptz;

comment on column public.cars.expires_at
  is 'Когда активное объявление уйдёт в expired. NULL у неактивных. Ставится триггером trg_cars_set_expiry';
comment on column public.cars.expiry_warned_at
  is 'Когда продавцу ушло предупреждение о скором истечении. Защита от повторной отправки';

-- Индекс под ежедневный job: он выбирает активные с истёкшим или
-- подходящим к концу сроком. Частичный — неактивные строки в этой
-- выборке не участвуют никогда, и держать их в индексе незачем.
create index if not exists idx_cars_expires_at
  on public.cars (expires_at)
  where status = 'active';


-- ============================================================
-- 3) ТРИГГЕР: публикация и реактивация ставят срок
-- ============================================================
-- ГДЕ ЭТО ЖИВЁТ И ПОЧЕМУ. В триггере, а не в create_car_v3 /
-- set_my_car_status / approve_car: статус объявления меняют семь
-- разных функций (владелец, админ, модерация, реактивация из архива,
-- продажа, возврат в продажу, будущий импорт), и в каждой легко
-- забыть проставить срок. Триггер ловит все пути разом, а сигнатуры
-- RPC остаются нетронутыми — приложение ничего не замечает.
--
-- ЛОГИКА:
--   * стало 'active' (из любого статуса) → срок = now() + TTL,
--     отметка предупреждения сбрасывается: это новая жизнь
--     объявления, и предупреждать по ней нужно заново;
--   * перестало быть 'active' → срок снимается. У архивного и
--     проданного объявления таймер не тикает: продавец вернёт его
--     когда захочет, и отсчёт пойдёт с этого момента;
--   * остаётся 'active' и срок уже стоит → НЕ трогаем. Иначе любая
--     правка объявления (или даже счётчик просмотров, если он
--     когда-нибудь станет UPDATE по cars) незаметно продлевала бы
--     жизнь вечно, и весь механизм оказался бы бесполезен.
create or replace function public.trg_set_listing_expiry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' then
    -- Срок ставим при переходе в active и при вставке сразу активным.
    -- Отдельная ветка на «уже был active, но срока нет» — страховка
    -- для строк, созданных до этой миграции в обход бэкфилла.
    if tg_op = 'INSERT'
       or old.status is distinct from 'active'
       or new.expires_at is null then
      new.expires_at       := now() + make_interval(days => public.f_listing_ttl_days());
      new.expiry_warned_at := null;
    end if;
  else
    -- Не active — таймер не идёт.
    new.expires_at       := null;
    new.expiry_warned_at := null;
  end if;

  return new;
end;
$$;

comment on function public.trg_set_listing_expiry()
  is 'BEFORE-триггер cars: ставит expires_at при публикации и реактивации, снимает у неактивных';

drop trigger if exists trg_cars_set_expiry on public.cars;

-- BEFORE INSERT OR UPDATE OF status: срок пересчитывается только при
-- смене статуса, а не на каждую правку объявления.
create trigger trg_cars_set_expiry
  before insert or update of status on public.cars
  for each row
  execute function public.trg_set_listing_expiry();


-- ============================================================
-- 4) БЭКФИЛЛ: срок для уже опубликованных
-- ============================================================
-- Триггер работает только на новые изменения, поэтому активным
-- объявлениям срок проставляем разом. Отсчёт от now(), а не от
-- created_at: объявление, висящее полгода, иначе истекло бы в ту же
-- секунду — продавец не получил бы ни предупреждения, ни шанса
-- продлить, и это выглядело бы как поломка сайта, а не как правило.
--
-- Идемпотентно: условие expires_at is null не даст переписать уже
-- проставленные сроки при повторном накате.
update public.cars
   set expires_at = now() + make_interval(days => public.f_listing_ttl_days())
 where status = 'active'
   and expires_at is null;


-- ============================================================
-- 5) RPC: ПРОДЛЕНИЕ ОДНОГО ОБЪЯВЛЕНИЯ
-- ============================================================
-- Работает и для 'active' (продлить заранее, не дожидаясь скрытия),
-- и для 'expired' (вернуть в выдачу). Второе — основной сценарий:
-- ссылка из письма ведёт именно сюда.
--
-- БЕЗ ПОВТОРНОЙ МОДЕРАЦИИ — сознательно, по тому же принципу, что
-- возврат из архива в 0070: содержимое объявления не менялось, оно
-- уже проверено. Гонять его по второму кругу значило бы наказывать
-- продавца за то, что он вовремя нажал кнопку.
--
-- Объявление, снятое АДМИНИСТРАТОРОМ, продлить нельзя: у него
-- archived_by = 'admin', и решение модератора не отменяется
-- продлением (правило Р2 из 0089). Такое объявление и не может быть
-- expired — в expired уходит только active.
create or replace function public.extend_listing(p_car_id uuid)
returns table (
  id         uuid,
  status     text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_car  public.cars;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку: два нажатия «Продлить» подряд (или продление
  -- параллельно с ночным job) не должны разойтись в гонке.
  select c.* into v_car
    from public.cars c
   where c.id = p_car_id
   for update;

  if v_car.id is null then
    raise exception 'Объявление не найдено'
      using errcode = 'no_data_found';
  end if;

  -- Проверка владельца идёт ДО проверки статуса, чтобы по тексту
  -- ошибки нельзя было выяснить состояние чужого объявления.
  if v_car.user_id <> v_user then
    raise exception 'Нельзя продлить чужое объявление'
      using errcode = 'insufficient_privilege';
  end if;

  if v_car.status not in ('active', 'expired') then
    raise exception 'Продлить можно только активное или истёкшее объявление (сейчас %)', v_car.status
      using errcode = 'check_violation';
  end if;

  -- Статус пишем всегда, даже когда он уже 'active': это заставляет
  -- сработать trg_cars_set_expiry, который и проставит новый срок.
  -- Дублировать вычисление даты здесь нельзя — разошлись бы два
  -- источника истины.
  update public.cars c
     set status     = 'active'::car_status,
         -- Снимаем срок явно, чтобы триггер увидел NULL и поставил
         -- новый: без этого ветка «уже active, срок стоит» оставила
         -- бы старую дату, и продление ничего бы не продлило.
         expires_at = null
   where c.id = p_car_id;

  return query
    select c.id, c.status::text, c.expires_at
      from public.cars c
     where c.id = p_car_id;
end;
$$;

comment on function public.extend_listing(uuid)
  is 'Продлевает своё объявление на срок TTL. Работает для active и expired, без повторной модерации';

grant execute on function public.extend_listing(uuid) to authenticated;


-- ============================================================
-- 6) RPC: МАССОВОЕ ПРОДЛЕНИЕ (кабинет салона)
-- ============================================================
-- У дилера объявлений десятки, и продлевать их по одному — работа,
-- которую никто делать не будет. Функция доступна ЛЮБОМУ владельцу,
-- а не только дилеру: частный продавец с тремя машинами выигрывает
-- от неё ровно так же, а проверка «дилер ли ты» добавила бы
-- зависимость от seller_kind без единой выгоды.
--
-- Возвращает число продлённых — кабинету нужно показать результат
-- («продлено 12 объявлений»), а не просто отсутствие ошибки.
create or replace function public.extend_my_listings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Тот же приём, что в extend_listing: обнуляем срок и переводим в
  -- active, остальное делает триггер. Объявления, снятые
  -- администратором, сюда не попадают — они в 'archived', а не в
  -- 'active'/'expired'.
  with updated as (
    update public.cars c
       set status     = 'active'::car_status,
           expires_at = null
     where c.user_id = v_user
       and c.status in ('active', 'expired')
    returning c.id
  )
  select count(*) into v_count from updated;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.extend_my_listings()
  is 'Массовое продление всех своих активных и истёкших объявлений. Возвращает количество продлённых';

grant execute on function public.extend_my_listings() to authenticated;


-- ============================================================
-- 7) ЕЖЕДНЕВНЫЙ JOB
-- ============================================================
-- Вызывается из Edge Function daily-cleanup (та же точка, что у
-- остальных ежедневных задач — cleanup_view_log, expire_promotions
-- и прочих). Планировщик Supabase умеет дёргать только HTTP, поэтому
-- pg_cron не используется: один способ запуска для всех задач лучше
-- двух параллельных, о чём написано в шапке daily-cleanup.
--
-- REVOKE для anon/authenticated: функция меняет чужие объявления и
-- рассылает письма, вызывать её вправе только service_role.
--
-- ПОРЯДОК ДЕЙСТВИЙ ВНУТРИ ВАЖЕН: сначала предупреждения, потом
-- скрытие. Наоборот объявление, истёкшее ровно сегодня, успело бы
-- уйти в expired до того, как получило предупреждение, — и продавец
-- узнал бы о сроке уже постфактум.
create or replace function public.expire_listings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_warned  integer := 0;
  v_expired integer := 0;
  v_rec     record;
  v_base    text := public.f_site_base_url();
begin
  -- ---------- 7a. ПРЕДУПРЕЖДЕНИЯ ЗА N ДНЕЙ ----------
  -- Берём активные, которым осталось меньше warn_days, и которых ещё
  -- не предупреждали. expiry_warned_at гарантирует ровно одно письмо
  -- на цикл жизни объявления.
  for v_rec in
    select c.id, c.user_id, c.brand, c.model, c.year, c.expires_at,
           p.email, coalesce(p.locale, 'sr') as locale
      from public.cars c
      join public.profiles p on p.id = c.user_id
     where c.status = 'active'
       and c.expires_at is not null
       and c.expires_at <= now() + make_interval(days => public.f_listing_warn_days())
       and c.expiry_warned_at is null
     for update of c skip locked
  loop
    -- Уведомление в кабинете — ВСЕГДА. Оно единственный канал для
    -- продавца без почты (вход на площадку по SMS, и у большинства
    -- profiles.email пуст), и оно же след для тех, кто письмо не
    -- открыл.
    insert into public.notifications (user_id, title, body, type, action_id)
    values (
      v_rec.user_id,
      case when v_rec.locale = 'ru'
        then 'Объявление скоро будет скрыто'
        else 'Oglas će uskoro biti sklonjen' end,
      case when v_rec.locale = 'ru'
        then v_rec.brand || ' ' || v_rec.model || ', ' || v_rec.year ||
             ' — срок публикации истекает. Продлите, чтобы объявление осталось в каталоге.'
        else v_rec.brand || ' ' || v_rec.model || ', ' || v_rec.year ||
             ' — rok objave ističe. Produžite da oglas ostane u katalogu.' end,
      'listing_expiring',
      v_rec.id
    );

    -- Письмо — только при наличии адреса. f_enqueue_email сам вернёт
    -- NULL на пустом или битом адресе, но проверка здесь избавляет от
    -- бессмысленного вызова на каждом объявлении.
    if v_rec.email is not null then
      perform public.f_enqueue_email(
        v_rec.email,
        'listing_expiring',
        jsonb_build_object(
          'locale',     v_rec.locale,
          'car_id',     v_rec.id,
          'brand',      v_rec.brand,
          'model',      v_rec.model,
          'year',       v_rec.year,
          'expires_at', v_rec.expires_at,
          'days_left',  public.f_listing_warn_days(),
          'url',        v_base || '/my'
        ),
        v_rec.user_id
      );
    end if;

    update public.cars set expiry_warned_at = now() where id = v_rec.id;
    v_warned := v_warned + 1;
  end loop;

  -- ---------- 7b. СКРЫТИЕ ИСТЁКШИХ ----------
  -- Строго status = 'active': проданные, архивные и снятые
  -- администратором объявления job не трогает — у них expires_at
  -- вообще NULL, но явное условие защищает от будущих изменений
  -- триггера.
  for v_rec in
    select c.id, c.user_id, c.brand, c.model, c.year,
           p.email, coalesce(p.locale, 'sr') as locale
      from public.cars c
      join public.profiles p on p.id = c.user_id
     where c.status = 'active'
       and c.expires_at is not null
       and c.expires_at <= now()
     for update of c skip locked
  loop
    update public.cars
       set status = 'expired'::car_status
     where id = v_rec.id;

    insert into public.notifications (user_id, title, body, type, action_id)
    values (
      v_rec.user_id,
      case when v_rec.locale = 'ru'
        then 'Объявление скрыто'
        else 'Oglas je sklonjen' end,
      case when v_rec.locale = 'ru'
        then v_rec.brand || ' ' || v_rec.model || ', ' || v_rec.year ||
             ' — срок публикации истёк. Объявление скрыто из каталога, его можно вернуть одним нажатием.'
        else v_rec.brand || ' ' || v_rec.model || ', ' || v_rec.year ||
             ' — rok objave je istekao. Oglas je sklonjen iz kataloga, možete ga vratiti jednim klikom.' end,
      'listing_expired',
      v_rec.id
    );

    if v_rec.email is not null then
      perform public.f_enqueue_email(
        v_rec.email,
        'listing_expired',
        jsonb_build_object(
          'locale', v_rec.locale,
          'car_id', v_rec.id,
          'brand',  v_rec.brand,
          'model',  v_rec.model,
          'year',   v_rec.year,
          'url',    v_base || '/my'
        ),
        v_rec.user_id
      );
    end if;

    v_expired := v_expired + 1;
  end loop;

  -- Итог возвращаем структурой, а не числом: в логах планировщика
  -- видно, что именно отработало, без похода в базу.
  return jsonb_build_object('warned', v_warned, 'expired', v_expired);
end;
$$;

comment on function public.expire_listings()
  is 'Ежедневный job: предупреждает о скором истечении и переводит просроченные объявления в expired. Вызывается из Edge Function daily-cleanup под service_role';

revoke execute on function public.expire_listings() from anon, authenticated;


-- ============================================================
-- 8) КАРТОЧКА ПО ПРЯМОЙ ССЫЛКЕ: expired = «снято с публикации»
-- ============================================================
-- Механизм из 0072 уже показывает факт существования объявления без
-- его содержимого — вместо голой 404. Добавляем expired в тот же
-- список: для читателя это ровно тот же случай («объявление сейчас
-- не опубликовано»), и заводить второй вариант поведения незачем.
--
-- Пересоздаём функцию целиком по версии 0090 (это её актуальная
-- редакция), меняя ровно одну строку — список статусов в конце.
-- Сигнатура и порядок колонок НЕ меняются: приложение читает те же
-- имена, контракт аддитивен.
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
  -- Новые поля (0090).
  archived_by       text,
  archived_reason   text
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
    -- Телефон: персональные данные продавца, снятое объявление не
    -- должно приводить ему звонки.
    case when v.full_access or v.status in ('active', 'sold')
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
    case when v.full_access then v.archived_reason end
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


comment on function public.get_car_details(uuid)
  is 'Детали объявления. Снятым (archived/rejected/moderation/expired) отдаёт только марку/модель/год/город без цен, контактов и данных продавца';


-- ============================================================
-- 9) RLS: чтение expired по прямой ссылке
-- ============================================================
-- get_car_details объявлена SECURITY DEFINER и RLS обходит, но
-- карточку читают и напрямую (get_car_images, JSON-LD, витрины).
-- Публичная политика 0007 отдаёт только 'active', поэтому expired
-- добавляем явно — иначе фотографии снятого объявления не покажутся
-- даже на заглушке.
--
-- Публиковать содержимое это не начинает: цены, контакты и описание
-- вырезает сама get_car_details, а каталог и поиск фильтруют
-- status = 'active' и expired не увидят.
drop policy if exists "cars_select_expired_public" on public.cars;

create policy "cars_select_expired_public" on public.cars
  for select using (status = 'expired');
