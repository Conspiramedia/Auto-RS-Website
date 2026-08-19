-- ============================================================
-- AUTO.RS — Миграция 0048 (ЭТАП 0, ПАКЕТ E): deep links + подарок без денег
-- ============================================================
-- Два блока:
--   1) правка кошелька: бесплатное продвижение больше не растит баланс;
--   2) site_url в выдаче каталога и карточки — канонический адрес объявления
--      на сайте, он же цель deep link.
-- ============================================================


-- ============================================================
-- БЛОК 1. ПОДАРОК-УСЛУГА: amount = 0 для type = 'gift'
-- ============================================================
-- Прежняя пара ограничений требовала строго ненулевой суммы и строго
-- положительной для gift. Из-за этого activate_promotion вынужденно писала
-- номинал (1 EUR/сутки), и баланс рос при бесплатном продвижении — деньги
-- появлялись из воздуха, хотя услуга подарена.
--
-- Правильная трактовка: подарочное продвижение — это ВЫДАННАЯ УСЛУГА, а не
-- движение денег. Сумма 0 честно отражает «пользователь не заплатил и не
-- получил средств», а строка в кошельке остаётся журналом выданных подарков.
--
-- Оба ограничения переписываем согласованно — иначе они противоречили бы
-- друг другу (nonzero требует ≠ 0, sign требует > 0 для gift).
--
-- Что сохраняется без ослабления:
--   * spend по-прежнему строго отрицательный — списание не может накрутить баланс;
--   * topup / bonus / refund по-прежнему строго положительные — реальные
--     деньги нулевыми не бывают;
--   * нулевая сумма разрешена ТОЛЬКО для gift.
-- ============================================================

alter table public.wallet_transactions
  drop constraint if exists chk_wallet_amount_nonzero;

alter table public.wallet_transactions
  drop constraint if exists chk_wallet_amount_sign;

-- Единое ограничение вместо пары: знак строго связан с типом, и только
-- gift допускает ноль. Держать это одним CHECK надёжнее — два независимых
-- условия легко рассогласовать при следующей правке.
alter table public.wallet_transactions
  add constraint chk_wallet_amount_sign check (
    -- Списание: всегда строго отрицательное.
    (type = 'spend' and amount < 0)
    -- Реальные поступления: всегда строго положительные.
    or (type in ('topup', 'bonus', 'refund') and amount > 0)
    -- Подарок: положительный (начисление средств в подарок) либо НУЛЕВОЙ
    -- (подаренная услуга — продвижение). Отрицательный по-прежнему запрещён.
    or (type = 'gift' and amount >= 0)
  );

comment on column public.wallet_transactions.amount
  is 'Сумма в EUR. Начисления > 0, списания < 0. Ноль допустим только для gift — подаренная услуга без движения денег';


-- ------------------------------------------------------------
-- activate_promotion: подарок теперь на 0 EUR
-- ------------------------------------------------------------
-- Тело идентично версии из 0047, кроме суммы gift-транзакции: вместо
-- номинала (1 EUR/сутки) пишем 0. Баланс при бесплатном продвижении
-- не меняется.
--
-- Когда подключим прайс, здесь появится вызов spend_balance(v_price, ...),
-- а gift-строка останется только для реально подарочных активаций.
-- ------------------------------------------------------------
create or replace function public.activate_promotion(
  p_car_id uuid,
  p_days   integer default 7
)
returns public.cars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_car  public.cars;
  v_days integer;
  v_from timestamptz;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку: параллельные вызовы не должны дважды продлить срок.
  select c.* into v_car
    from public.cars c
   where c.id = p_car_id
   for update;

  if v_car.id is null then
    raise exception 'Объявление не найдено'
      using errcode = 'no_data_found';
  end if;

  if v_car.user_id <> v_user then
    raise exception 'Продвигать можно только своё объявление'
      using errcode = 'insufficient_privilege';
  end if;

  if v_car.status <> 'active' then
    raise exception 'Продвигать можно только активное объявление (текущий статус: %)',
      v_car.status
      using errcode = 'check_violation';
  end if;

  v_days := coalesce(p_days, 7);
  if v_days < 1 or v_days > 30 then
    raise exception 'Срок продвижения должен быть от 1 до 30 дней'
      using errcode = 'check_violation';
  end if;

  -- Продление: если продвижение ещё действует, отсчитываем от его окончания,
  -- чтобы не терять оставшееся время.
  v_from := greatest(coalesce(v_car.boosted_until, now()), now());

  -- Журнал выданной услуги. Сумма 0: деньги на Этапе 0 выключены, подарок
  -- не является движением средств и баланс не меняет.
  insert into public.wallet_transactions (user_id, type, amount, description, car_id)
  values (
    v_user,
    'gift',
    0,
    format('Продвижение «%s %s» на %s дн. (подарок)', v_car.brand, v_car.model, v_days),
    p_car_id
  );

  update public.cars
     set is_vip        = true,
         boosted_until = v_from + make_interval(days => v_days),
         updated_at    = now()
   where id = p_car_id
  returning * into v_car;

  return v_car;
end;
$$;

comment on function public.activate_promotion(uuid, integer)
  is 'Включает продвижение своего активного объявления. Этап 0: подарок на 0 EUR, баланс не растёт';

grant execute on function public.activate_promotion(uuid, integer) to authenticated;


-- ============================================================
-- БЛОК 2. КАНОНИЧЕСКИЙ АДРЕС ОБЪЯВЛЕНИЯ (site_url)
-- ============================================================
-- Путь /car/{id} — тот же, что у роута приложения (см. app_router.dart),
-- поэтому deep link открывается одинаково и в приложении, и на сайте.
--
-- ГДЕ ХРАНИТСЯ ДОМЕН. Базовый адрес — не свойство объявления, а настройка
-- окружения: на проде он один, на стенде другой. Класть его в каждую строку
-- cars нельзя (при смене домена пришлось бы переписывать всю таблицу).
-- Поэтому домен живёт в ОДНОЙ строке служебной таблицы app_settings, а
-- функции собирают адрес на лету.
--
-- Почему не Postgres-параметр (current_setting): его пришлось бы задавать
-- в каждой сессии, а PostgREST их не переиспользует — значение терялось бы.
-- ============================================================

create table if not exists public.app_settings (
  key         text        primary key,
  value       text        not null,
  updated_at  timestamptz not null default now()
);

comment on table public.app_settings
  is 'Настройки окружения (базовый адрес сайта и т.п.). Читается сервером, правится админом';

-- Значение по умолчанию — плейсхолдер. Заменить на реальный домен командой
-- из отчёта, ДО первого использования кнопки «Поделиться».
insert into public.app_settings (key, value)
values ('site_base_url', 'https://example.rs')
on conflict (key) do nothing;

-- RLS: читать может кто угодно (адрес публичен и всё равно уходит клиенту
-- в составе ссылки), править — только администратор.
alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select_all" on public.app_settings;
create policy "app_settings_select_all" on public.app_settings
  for select to anon, authenticated using (true);

drop policy if exists "app_settings_write_admin" on public.app_settings;
create policy "app_settings_write_admin" on public.app_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ------------------------------------------------------------
-- f_site_base_url() — базовый адрес без завершающего слэша
-- ------------------------------------------------------------
-- rtrim снимает случайный слэш в конце: без него ссылка получила бы двойной
-- разделитель (https://domain.rs//car/…), а такие адреса ломают шаринг и
-- проверку app-links.
-- ------------------------------------------------------------
create or replace function public.f_site_base_url()
returns text
language sql
stable
set search_path = public
as $$
  select rtrim(
    coalesce(
      (select s.value from public.app_settings s where s.key = 'site_base_url'),
      'https://example.rs'          -- страховка, если строку удалили
    ),
    '/'
  );
$$;

comment on function public.f_site_base_url()
  is 'Базовый адрес сайта из app_settings, без завершающего слэша';

grant execute on function public.f_site_base_url() to anon, authenticated;


-- ------------------------------------------------------------
-- f_car_site_url(uuid) — канонический адрес объявления
-- ------------------------------------------------------------
-- Единая точка сборки ссылки. Если завтра путь изменится (/car → /listing),
-- правка будет ровно в одном месте, а не в каждой RPC.
-- ------------------------------------------------------------
create or replace function public.f_car_site_url(p_car_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select public.f_site_base_url() || '/car/' || p_car_id::text;
$$;

comment on function public.f_car_site_url(uuid)
  is 'Канонический адрес объявления: {SITE_BASE_URL}/car/{id}. Путь совпадает с роутом приложения';

grant execute on function public.f_car_site_url(uuid) to anon, authenticated;


-- ------------------------------------------------------------
-- RPC: get_car_details(p_car_id) — карточка объявления с site_url
-- ------------------------------------------------------------
-- Экран карточки сейчас читает cars напрямую (RLS отдаёт активные всем).
-- Прямой SELECT не может вернуть site_url — вычисляемого поля в таблице нет.
-- Поэтому заводим RPC, которая отдаёт объявление целиком плюс:
--   site_url    — ссылка для кнопки «Поделиться» и deep link;
--   is_promoted — действует ли продвижение прямо сейчас;
--   seller_*    — витрина продавца для перехода на страницу дилера.
--
-- ВАЖНО про статус: карточка отдаётся и для status = 'sold' — по вашему
-- требованию проданное объявление исчезает из каталога, но открывается по
-- прямой ссылке с плашкой «Продано». Скрываем только то, что не должно быть
-- публичным: модерацию, отклонённые и архив — их видит лишь владелец.
-- ------------------------------------------------------------
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
  updated_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.user_id, c.is_for_sale, c.is_for_rent,
    c.brand, c.model, c.year, c.mileage,
    c.body_type::text, c.transmission::text, c.fuel::text,
    c.currency::text, c.sale_price, c.rent_price_daily, c.deposit_amount,
    c.city, c.description, c.contact_phone,
    c.rating_avg, c.reviews_count,
    c.status::text,
    c.is_vip, c.boosted_until,
    (c.is_vip and c.boosted_until is not null and c.boosted_until > now()),
    public.f_car_site_url(c.id),
    -- Витрина продавца: у дилера название салона, у частника имя.
    p.seller_kind,
    case
      when p.seller_kind = 'dealer'
      then coalesce(nullif(trim(p.company_name), ''), 'Автосалон')
      else coalesce(nullif(trim(p.full_name), ''), 'Продавец')
    end,
    p.logo_url,
    p.avatar_url,
    p.created_at,
    c.created_at, c.updated_at
  from public.cars c
  join public.profiles p on p.id = c.user_id
  where c.id = p_car_id
    and (
      -- Публично: активные и проданные (последние — только по прямой ссылке,
      -- в каталог они не попадают, там фильтр status = 'active').
      c.status in ('active', 'sold')
      -- Владельцу видно собственное объявление в любом статусе.
      or c.user_id = auth.uid()
      -- Админу — тоже (разбор жалоб, модерация).
      or public.is_admin()
    );
$$;

comment on function public.get_car_details(uuid)
  is 'Карточка объявления с site_url, статусом промо и витриной продавца. Проданные доступны по прямой ссылке';

grant execute on function public.get_car_details(uuid) to anon, authenticated;


-- ------------------------------------------------------------
-- RPC: search_cars_with_links(...) — каталог со ссылками
-- ------------------------------------------------------------
-- search_cars_advanced объявлена как returns setof public.cars, поэтому
-- добавить в неё site_url нельзя, не сломав сигнатуру (а её менять запрещено
-- требованием Пакета D). Заводим отдельную обёртку с расширенной выдачей:
-- те же 20 параметров, тот же порядок, плюс site_url и is_promoted.
--
-- Клиент выбирает сам: списку каталога ссылки не нужны (он и так знает id),
-- а вот шаринг из ленты и превью для соцсетей их требуют.
-- ------------------------------------------------------------
create or replace function public.search_cars_with_links(
  p_listing_type text default null,
  p_search_query text default null,
  p_user_lat     double precision default null,
  p_user_lng     double precision default null,
  p_radius_km    double precision default null,
  p_brand        text default null,
  p_model        text default null,
  p_city         text default null,
  p_year_from    integer default null,
  p_year_to      integer default null,
  p_mileage_max  integer default null,
  p_price_from   numeric default null,
  p_price_to     numeric default null,
  p_body_type    text default null,
  p_transmission text default null,
  p_fuel         text default null,
  p_seed         integer default 0,
  p_offset       integer default 0,
  p_limit        integer default 20,
  p_shuffle_all  boolean default false
)
returns table (
  id               uuid,
  user_id          uuid,
  is_for_sale      boolean,
  is_for_rent      boolean,
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
  city             text,
  status           text,
  is_vip           boolean,
  boosted_until    timestamptz,
  is_promoted      boolean,
  site_url         text,
  photo_url        text,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  -- Переиспользуем каталог как есть: вся логика фильтрации, промо-блока,
  -- гео и шафла остаётся в одной функции. Дублировать её ради двух
  -- дополнительных колонок было бы прямым путём к расхождению.
  select
    c.id, c.user_id, c.is_for_sale, c.is_for_rent,
    c.brand, c.model, c.year, c.mileage,
    c.body_type::text, c.transmission::text, c.fuel::text,
    c.currency::text, c.sale_price, c.rent_price_daily,
    c.city, c.status::text,
    c.is_vip, c.boosted_until,
    (c.is_vip and c.boosted_until is not null and c.boosted_until > now()),
    public.f_car_site_url(c.id),
    (select ci.image_url from public.car_images ci
      where ci.car_id = c.id
      order by ci.order_index asc
      limit 1),
    c.created_at
  from public.search_cars_advanced(
    p_listing_type, p_search_query, p_user_lat, p_user_lng, p_radius_km,
    p_brand, p_model, p_city, p_year_from, p_year_to, p_mileage_max,
    p_price_from, p_price_to, p_body_type, p_transmission, p_fuel,
    p_seed, p_offset, p_limit, p_shuffle_all
  ) c;
$$;

comment on function public.search_cars_with_links is
  'Каталог с site_url и статусом промо. Обёртка над search_cars_advanced — логика выдачи не дублируется';

grant execute on function public.search_cars_with_links(
  text, text, double precision, double precision, double precision,
  text, text, text, integer, integer, integer, numeric, numeric, text, text, text,
  integer, integer, integer, boolean
) to anon, authenticated;


-- ------------------------------------------------------------
-- RPC: set_site_base_url(p_url) — смена домена администратором
-- ------------------------------------------------------------
-- Чтобы не лезть в таблицу руками при переезде на боевой домен.
-- Валидация минимальная, но осмысленная: адрес должен начинаться с http(s),
-- иначе ссылки в шаринге окажутся нерабочими у всех пользователей сразу.
-- ------------------------------------------------------------
create or replace function public.set_site_base_url(p_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := rtrim(trim(coalesce(p_url, '')), '/');
begin
  if not public.is_admin() then
    raise exception 'Смена адреса сайта доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  if v_url !~ '^https?://[^/ ]+$' then
    raise exception 'Ожидается адрес вида https://domain.rs без пути'
      using errcode = 'check_violation';
  end if;

  insert into public.app_settings (key, value, updated_at)
  values ('site_base_url', v_url, now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  return v_url;
end;
$$;

comment on function public.set_site_base_url(text)
  is 'Устанавливает базовый адрес сайта (только админ). Влияет на все site_url сразу';

grant execute on function public.set_site_base_url(text) to authenticated;
