-- ============================================================
-- AUTO.RS — Миграция 0144: уровень продавца в RPC и админке
-- ============================================================
-- Продолжение 0143. Здесь уровень попадает туда, где он виден и где
-- он применяется:
--
--   1) create_car_v3       — проверка лимита активных объявлений;
--   2) get_car_details     — уровень продавца на странице объявления;
--   3) get_dealer_profile  — уровень на витрине салона;
--   4) chats_with_details  — уровень собеседника в шапке чата;
--   5) get_my_tier_progress— прогресс до следующей ступени в кабинете;
--   6) admin_set_seller_tier / admin_clear_seller_tier — ручное
--      назначение и его снятие.
--
-- Показ уровня в карточке пользователя админки и тип собеседника в
-- чате доехали следующей миграцией (0145): эта была уже применена.
--
-- search_cars_public НЕ РАСШИРЯЕТСЯ. Плашка уровня в каталоге не
-- показывается (решение пакета): рядом с золотой короной платного
-- продвижения вторая золотая метка читалась бы как удвоение, а на
-- плитке 360px подпись у имени продавца всё равно теряется. Раз
-- потребителя нет — нет и колонки: лишнее поле в самой горячей
-- выдаче площадки стоит денег на каждом запросе.
--
-- СОВМЕСТИМОСТЬ С ПРИЛОЖЕНИЕМ. Все изменения аддитивные: сигнатуры
-- существующих функций не меняются ни на один параметр, новые
-- колонки в returns table добавлены СТРОГО В КОНЕЦ — клиент, читающий
-- поля по имени, их не заметит, читающий по позиции не сломается.
-- Поведение create_car_v3 меняется (появляется отказ по лимиту) — и
-- меняется сразу для обоих клиентов, что и требуется: лимит,
-- действующий на сайте и не действующий в приложении, не лимит.
-- ============================================================


-- ============================================================
-- 1) create_car_v3 — ЛИМИТ АКТИВНЫХ ОБЪЯВЛЕНИЙ
-- ============================================================
-- Тело повторяет 0139 дословно; добавлена ровно одна проверка сразу
-- после авторизации — до всех остальных валидаций и до вставки.
--
-- ПОЧЕМУ В САМОМ НАЧАЛЕ. Отказ по лимиту не зависит от содержимого
-- формы, и заставлять человека сначала пройти проверки цены и года,
-- чтобы упереться в лимит, — впустую потраченное время.
--
-- ПОЧЕМУ ЗДЕСЬ, А НЕ ТРИГГЕРОМ НА ТАБЛИЦЕ. Лимит считает АКТИВНЫЕ
-- объявления, а create_car_v3 вставляет строку со статусом
-- 'moderation'. Триггер на вставке считал бы то же самое, но сообщение
-- об ошибке из триггера нельзя связать с формой подачи так же
-- аккуратно, а главное — лимит не должен мешать модерации возвращать
-- в active уже поданное. Проверка стоит ровно там, где принимается
-- решение «принять новое объявление или нет».
--
-- ГОНКА ДВУХ ВКЛАДОК. Две одновременные подачи могли бы обе увидеть
-- «активных меньше лимита». Практического вреда нет: проверка
-- считает active, а вставка создаёт moderation — чтобы превысить
-- лимит, оба объявления должны сначала пройти модерацию, и к этому
-- моменту счётчик уже верен. Блокировку ради этого не берём: она
-- сериализовала бы подачу объявлений на всей площадке.
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
  v_limit_error text;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация для создания объявления'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---------- ЛИМИТ АКТИВНЫХ ОБЪЯВЛЕНИЙ (0143) ----------
  -- HINT = 'listing_limit' — по нему сайт узнаёт причину отказа и
  -- показывает собственный текст в локали продавца. Именно hint, а не
  -- код: check_violation у объявления означает ещё и цену, и год, и
  -- залог, и подставлять им текст про лимит было бы враньём. Тот же
  -- приём уже применён для контактов в описании (0135).
  --
  -- Сам текст сербский: он достаётся мобильному приложению, которое
  -- зовёт эту же RPC и о ключах словаря сайта не знает.
  v_limit_error := public.f_check_listing_limit(v_user_id);

  if v_limit_error is not null then
    raise exception '%', v_limit_error
      using errcode = 'check_violation', hint = 'listing_limit';
  end if;

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
    case
      when p_availability in ('on_order', 'in_transit')
      then p_availability::car_availability
      else 'in_stock'::car_availability
    end,
    case when p_engine_volume > 0 then p_engine_volume end,
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

comment on function public.create_car_v3(
  text, text, text, integer, integer, numeric, numeric, numeric, text, text,
  double precision, double precision, text[], body_type, transmission_type,
  fuel_type, text, text, text, numeric, text
) is 'Создание объявления. С 0144 проверяет лимит активных объявлений по уровню продавца (f_check_listing_limit)';


-- ============================================================
-- 2) get_car_details — уровень продавца на странице объявления
-- ============================================================
-- Тело повторяет 0138; добавлена одна колонка В КОНЕЦ.
--
-- Уровень отдаётся по тем же правилам видимости, что имя и логотип
-- продавца: только для доступного объявления. У снятого с публикации
-- витрина продавца не показывается целиком, и уровень — её часть.
--
-- Отдаём ХРАНИМОЕ поле, а не вычисляемое: это отображение, суточное
-- отставание здесь безвредно, а вызов расчёта на каждый просмотр
-- карточки — лишняя работа на самой посещаемой странице сайта.
drop function if exists public.get_car_details(uuid);

create function public.get_car_details(p_car_id uuid)
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
  availability      text,
  condition         text,
  -- Новое (0144). Строго в конце.
  seller_tier       smallint
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
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
    case when v.full_access or v.status in ('active', 'sold')
         then v.sale_price end,
    case when v.full_access or v.status in ('active', 'sold')
         then v.rent_price_daily end,
    case when v.full_access or v.status in ('active', 'sold')
         then v.deposit_amount end,
    v.city,
    case when v.full_access or v.status in ('active', 'sold')
         then v.description end,
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
    case when v.full_access then v.archived_by::text end,
    case when v.full_access then v.archived_reason end,
    v.availability::text,
    v.condition::text,
    -- Уровень продавца (0143). Видимость — как у витрины продавца.
    case when v.full_access or v.status in ('active', 'sold')
         then p.seller_tier end
  from viewer v
  join public.profiles p on p.id = v.user_id;
$$;

comment on function public.get_car_details(uuid)
  is 'Карточка объявления: поля машины, витрина продавца, уровень продавца (0144). Скрытое содержимое — только владельцу и админу';

grant execute on function public.get_car_details(uuid) to anon, authenticated;


-- ============================================================
-- 3) get_dealer_profile — уровень на витрине
-- ============================================================
-- Тело повторяет 0098; добавлена одна колонка В КОНЕЦ.
--
-- Уровень отдаётся и частнику, и салону: страница /dealer/{id}
-- открывается для любого продавца, и плашка на ней уместна у обоих.
drop function if exists public.get_dealer_profile(uuid);

create function public.get_dealer_profile(p_user_id uuid)
returns table (
  id            uuid,
  seller_kind   text,
  display_name  text,
  logo_url      text,
  avatar_url    text,
  member_since  timestamptz,
  active_cars   bigint,
  sold_cars     bigint,
  company_city  text,
  description   text,
  dealer_phone  text,
  website       text,
  opening_hours text,
  cover_url     text,
  tagline       text,
  -- Новое (0144). Строго в конце.
  seller_tier   smallint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.seller_kind,
    case
      when p.seller_kind = 'dealer'
      then coalesce(nullif(trim(p.company_name), ''), 'Автосалон')
      else coalesce(nullif(trim(p.full_name), ''), 'Продавец')
    end                                        as display_name,
    p.logo_url,
    p.avatar_url,
    p.created_at                               as member_since,
    (select count(*) from public.cars c
      where c.user_id = p.id and c.status = 'active')  as active_cars,
    (select count(*) from public.cars c
      where c.user_id = p.id and c.status = 'sold')    as sold_cars,
    case when p.seller_kind = 'dealer' then nullif(trim(p.company_city), '')  end as company_city,
    case when p.seller_kind = 'dealer' then nullif(trim(p.description), '')   end as description,
    case when p.seller_kind = 'dealer' then nullif(trim(p.dealer_phone), '')  end as dealer_phone,
    case when p.seller_kind = 'dealer' then nullif(trim(p.website), '')       end as website,
    case when p.seller_kind = 'dealer' then nullif(trim(p.opening_hours), '') end as opening_hours,
    case when p.seller_kind = 'dealer' then nullif(trim(p.cover_url), '')     end as cover_url,
    case when p.seller_kind = 'dealer' then nullif(trim(p.tagline), '')       end as tagline,
    p.seller_tier
  from public.profiles p
  where p.id = p_user_id;
$$;

comment on function public.get_dealer_profile(uuid)
  is 'Публичная карточка продавца/дилера: витрина, счётчики, уровень продавца (0144)';

grant execute on function public.get_dealer_profile(uuid) to anon, authenticated;


-- ============================================================
-- 4) chats_with_details — уровень собеседника
-- ============================================================
-- VIEW пересоздаётся целиком: create or replace умеет дописывать
-- колонки в конец, но здесь их ДВЕ и обе новые, а надёжнее один
-- предсказуемый путь. Зависимых объектов у представления нет
-- (проверено pg_depend перед миграцией), поэтому drop безопасен.
--
-- Определение 0041 повторено дословно, новые поля дописаны последними.
-- security_invoker сохраняется: VIEW применяет RLS вызывающего — без
-- него представление отдавало бы чужие диалоги.
drop view if exists public.chats_with_details;

create view public.chats_with_details
with (security_invoker = true)
as
select
  ch.id,
  ch.car_id,
  ch.buyer_id,
  ch.seller_id,
  ch.created_at,

  case when ch.buyer_id = auth.uid() then ch.seller_id else ch.buyer_id end
    as opponent_id,

  opp.full_name  as opponent_name,
  opp.avatar_url as opponent_avatar,

  c.brand,
  c.model,
  c.year,

  img.image_url as car_photo,

  (
    select count(*)
    from public.messages m
    where m.chat_id = ch.id
      and m.is_read = false
      and m.sender_id <> auth.uid()
  )::int as unread_count,

  (
    select max(m.created_at)
    from public.messages m
    where m.chat_id = ch.id
  ) as last_message_at,

  (
    select m.text
    from public.messages m
    where m.chat_id = ch.id
    order by m.created_at desc
    limit 1
  ) as last_message,

  (pref.pinned_at is not null) as pinned,
  pref.pinned_at,

  exists (
    select 1 from public.user_blocks ub
    where ub.blocker_id = auth.uid()
      and ub.blocked_id = case
        when ch.buyer_id = auth.uid() then ch.seller_id
        else ch.buyer_id
      end
  ) as peer_blocked,

  -- Новое (0144). Уровень СОБЕСЕДНИКА: в шапке диалога плашка стоит
  -- рядом с его именем. Свой уровень человек видит в кабинете, и в
  -- переписке он не нужен.
  -- Тип собеседника рядом с уровнем добавляет миграция 0145: у золота
  -- две разные подписи, и без seller_kind шапка чата назвала бы салон
  -- экспертом-частником.
  opp.seller_tier as opponent_tier

from public.chats ch
left join public.profiles opp
  on opp.id = case when ch.buyer_id = auth.uid() then ch.seller_id else ch.buyer_id end
join public.cars c
  on c.id = ch.car_id
left join public.chat_prefs pref
  on pref.chat_id = ch.id and pref.user_id = auth.uid()
left join lateral (
  select ci.image_url
  from public.car_images ci
  where ci.car_id = ch.car_id
  order by ci.order_index asc
  limit 1
) img on true;

comment on view public.chats_with_details
  is 'Чаты + собеседник + машина + непрочитанные + превью + закрепление/блокировка + уровень собеседника (0144). RLS вызывающего';


-- ============================================================
-- 5) get_my_tier_progress — прогресс до следующей ступени
-- ============================================================
-- Отдаёт ЧИСЛА, а не готовую фразу: текст живёт в словаре сайта
-- (lib/i18n.ts) в двух локалях, и собирать его в базе значило бы
-- держать переводы в двух местах.
--
-- Уровень здесь ВЫЧИСЛЯЕМЫЙ: кабинет — то место, где человек смотрит
-- на свой прогресс сразу после действия («подал третье объявление —
-- что изменилось?»), и суточное отставание выглядело бы поломкой.
--
-- ЧТО ЗНАЧИТ next_* ДЛЯ САЛОНА. Салон растёт по своей шкале
-- (бронза при одобрении, серебро на 10 активных, золото — решение
-- площадки), поэтому:
--   * на бронзе   next_tier = 2, cars_left = сколько до 10 активных;
--   * на серебре  next_tier = 3, но cars_left = null и sales_left =
--     null: золото салона не считается, его НАЗНАЧАЮТ. Клиент по
--     двум null отличает «нужно столько-то» от «зависит не от вас».
--   * на золоте   next_tier = null — расти некуда.
create or replace function public.get_my_tier_progress()
returns table (
  tier         smallint,
  next_tier    smallint,
  active_cars  integer,
  sales        integer,
  cars_left    integer,
  sales_left   integer,
  is_dealer    boolean,
  penalty_until timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user       uuid := auth.uid();
  v_kind       text;
  v_tier       smallint;
  v_active     integer;
  v_sales      integer;
  v_penalty    timestamptz;
  v_next       smallint;
  v_cars_left  integer;
  v_sales_left integer;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  select p.seller_kind, p.tier_penalty_until
    into v_kind, v_penalty
    from public.profiles p
   where p.id = v_user;

  v_tier := public.f_seller_tier_now(v_user);

  select count(*)::integer into v_active
    from public.cars c
   where c.user_id = v_user and c.status = 'active';

  select count(*)::integer into v_sales
    from public.cars c
   where c.user_id = v_user
     and c.status = 'sold'
     and c.sold_at is not null
     and c.sold_at - c.created_at >= make_interval(days => public.f_tier_sale_min_days());

  if v_kind = 'dealer' then
    if v_tier >= 3 then
      v_next := null;
    elsif v_tier = 2 then
      -- Золото салона назначает площадка: считать нечего, оба
      -- остатка остаются null.
      v_next := 3;
    else
      v_next      := 2;
      v_cars_left := greatest(10 - v_active, 0);
    end if;
  else
    if v_tier >= 3 then
      v_next := null;
    elsif v_tier = 2 then
      v_next       := 3;
      v_cars_left  := greatest(25 - v_active, 0);
      v_sales_left := greatest(10 - v_sales, 0);
    elsif v_tier = 1 then
      v_next       := 2;
      v_cars_left  := greatest(10 - v_active, 0);
      v_sales_left := greatest(3 - v_sales, 0);
    else
      v_next       := 1;
      v_cars_left  := greatest(3 - v_active, 0);
      v_sales_left := greatest(1 - v_sales, 0);
    end if;
  end if;

  return query select
    v_tier, v_next, v_active, v_sales,
    v_cars_left, v_sales_left,
    (v_kind = 'dealer'), v_penalty;
end;
$$;

comment on function public.get_my_tier_progress()
  is 'Прогресс текущего пользователя до следующей ступени: числа для фразы «до серебра ещё X объявлений или Y продаж». Текст собирает клиент';

grant execute on function public.get_my_tier_progress() to authenticated;


-- ============================================================
-- 6) АДМИНКА: ручное назначение уровня
-- ============================================================
-- Назначенный уровень перекрывает расчёт целиком — см. комментарий
-- к profiles.tier_override в 0143. Поэтому каждое назначение и каждое
-- снятие попадает в admin_action_log: это решение человека, и оно
-- обязано иметь автора.
--
-- ПРИЧИНА ОБЯЗАТЕЛЬНА (constraint в 0143 + проверка здесь ради
-- человекочитаемой ошибки). Через полгода вопрос «почему у этого
-- салона золото» задаётся обязательно.
create or replace function public.admin_set_seller_tier(
  p_user_id uuid,
  p_tier    smallint,
  p_reason  text
)
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Назначение уровня доступно только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  if p_tier is null or p_tier not between 0 and 3 then
    raise exception 'Недопустимый уровень: % (ожидалось 0..3)', p_tier
      using errcode = 'check_violation';
  end if;

  if v_reason is null then
    raise exception 'Укажите причину назначения уровня'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Пользователь не найден'
      using errcode = 'no_data_found';
  end if;

  perform public.f_admin_log(
    'seller_tier_set',
    'profiles',
    p_user_id,
    jsonb_build_object('tier', p_tier, 'reason', v_reason)
  );

  update public.profiles p
     set tier_override        = p_tier,
         tier_override_reason = v_reason,
         tier_override_at     = now(),
         tier_override_by     = auth.uid(),
         -- Пересчёт подхватит override и запишет его в seller_tier.
         -- Ставим значение сразу же: администратор ждёт результата
         -- своего действия, а не следующей ночи.
         seller_tier          = p_tier,
         tier_dirty           = false
   where p.id = p_user_id;

  return p_tier;
end;
$$;

comment on function public.admin_set_seller_tier(uuid, smallint, text)
  is 'Ручное назначение уровня продавца администратором. Перекрывает расчёт до снятия; причина обязательна, действие в admin_action_log';

grant execute on function public.admin_set_seller_tier(uuid, smallint, text) to authenticated;


-- ------------------------------------------------------------
-- Снятие ручного назначения: возврат к расчёту по данным.
-- ------------------------------------------------------------
create or replace function public.admin_clear_seller_tier(p_user_id uuid)
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier smallint;
begin
  if not public.is_admin() then
    raise exception 'Снятие уровня доступно только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Пользователь не найден'
      using errcode = 'no_data_found';
  end if;

  perform public.f_admin_log(
    'seller_tier_cleared',
    'profiles',
    p_user_id,
    '{}'::jsonb
  );

  update public.profiles p
     set tier_override        = null,
         tier_override_reason = null,
         tier_override_at     = null,
         tier_override_by     = null
   where p.id = p_user_id;

  -- Считаем сразу, а не оставляем на ночь: администратор должен
  -- увидеть, куда вернулся уровень после снятия.
  v_tier := public.f_calc_seller_tier(p_user_id);

  update public.profiles p
     set seller_tier = v_tier,
         tier_dirty  = false
   where p.id = p_user_id;

  return v_tier;
end;
$$;

comment on function public.admin_clear_seller_tier(uuid)
  is 'Снятие ручного назначения уровня: возврат к расчёту по данным с немедленным пересчётом';

grant execute on function public.admin_clear_seller_tier(uuid) to authenticated;
