-- ============================================================
-- AUTO.RS — Миграция 0043 (ЭТАП 0, ПАКЕТ A): роли продавца и кошелёк
-- ============================================================
-- Два независимых блока:
--
--   1) РОЛЬ ПРОДАВЦА. В profiles уже есть три оси: role (client/seller/admin),
--      user_type (customer/vendor) и is_admin. Ни одна из них не отвечает на
--      вопрос «частник или автосалон» — это ортогональная характеристика:
--      частник тоже vendor, дилер тоже vendor. Поэтому вводим ОТДЕЛЬНОЕ поле
--      seller_kind (private|dealer) и поля витрины дилера. user_type НЕ трогаем.
--      «На площадке с» отдельным полем не заводим — это profiles.created_at.
--
--   2) КОШЕЛЁК. Таблица public.transactions уже занята арендной механикой
--      (payment/refund/penalty/payout, привязка к booking_id, валюта RSD) и
--      участвует в pay_booking / cancel_booking / complete_booking /
--      get_vendor_balance. Ломать её нельзя, поэтому баланс пользователя живёт
--      в ОТДЕЛЬНОЙ таблице wallet_transactions.
--
--      Ключевое правило: БАЛАНС НЕ ХРАНИТСЯ ОТДЕЛЬНЫМ ПОЛЕМ. Баланс — это
--      всегда сумма строк wallet_transactions. Так исключены рассинхроны
--      «поле баланса разошлось с историей», а любая операция аудируема.
--      Знак суммы задаётся типом операции: пополнения (topup/bonus/gift/refund)
--      пишутся положительными, списания (spend) — отрицательными. Это
--      гарантируется CHECK-ограничением на уровне БД, а не кодом клиента.
--
-- ДЕНЬГИ НА ЭТАПЕ 0 ВЫКЛЮЧЕНЫ: реального пополнения нет, платёжный провайдер
-- не подключён. Единственный способ пополнения сейчас — credit_gift (админ).
-- ============================================================


-- ============================================================
-- БЛОК 1. РОЛЬ ПРОДАВЦА И ПОЛЯ ДИЛЕРА
-- ============================================================

alter table public.profiles
  -- Тип продавца. default 'private' — все существующие профили становятся
  -- частниками, что соответствует текущему положению дел.
  add column if not exists seller_kind  text not null default 'private',
  -- Название автосалона. Заполняется только дилерами, у частника NULL.
  add column if not exists company_name text,
  -- Логотип автосалона (ссылка на файл в Supabase Storage, бакет avatars).
  add column if not exists logo_url     text;

-- Ограничиваем допустимые значения на уровне БД (защита от опечаток клиента).
alter table public.profiles
  drop constraint if exists chk_seller_kind;
alter table public.profiles
  add constraint chk_seller_kind check (seller_kind in ('private', 'dealer'));

-- Дилер обязан иметь название компании: витрина дилера без имени бессмысленна.
-- Проверка срабатывает только для seller_kind = 'dealer'; частника не трогает.
-- nullif(trim(...), '') — пустая строка приравнивается к NULL, чтобы клиент не
-- обошёл проверку, прислав пробелы.
alter table public.profiles
  drop constraint if exists chk_dealer_has_company;
alter table public.profiles
  add constraint chk_dealer_has_company check (
    seller_kind <> 'dealer' or nullif(trim(coalesce(company_name, '')), '') is not null
  );

comment on column public.profiles.seller_kind
  is 'Тип продавца: private (частное лицо) / dealer (автосалон). Ортогонален user_type';
comment on column public.profiles.company_name
  is 'Название автосалона. Обязательно при seller_kind = dealer, у частника NULL';
comment on column public.profiles.logo_url
  is 'Логотип автосалона (Supabase Storage). Показывается на странице дилера';

-- Индекс под выборку «все дилеры» (каталог автосалонов в будущем).
-- Частичный: строки частников в индекс не попадают — он компактный.
create index if not exists idx_profiles_dealers
  on public.profiles (seller_kind)
  where seller_kind = 'dealer';


-- ------------------------------------------------------------
-- RPC: get_dealer_profile(p_user_id) — публичная карточка продавца
-- ------------------------------------------------------------
-- Нужна для страницы дилера (Шаг 3, п.6). Прямой SELECT из profiles закрыт RLS
-- (политика profiles_select_own отдаёт только собственный профиль), поэтому
-- отдаём СТРОГО ОГРАНИЧЕННЫЙ набор публичных полей через SECURITY DEFINER.
--
-- Приватные поля (email, phone, is_admin, user_type) НЕ отдаются намеренно —
-- телефон продавца показывается из cars.contact_phone конкретного объявления,
-- а не из профиля.
--
-- member_since = profiles.created_at — то самое «на площадке с…».
-- ------------------------------------------------------------
create or replace function public.get_dealer_profile(p_user_id uuid)
returns table (
  id            uuid,
  seller_kind   text,
  display_name  text,
  logo_url      text,
  avatar_url    text,
  member_since  timestamptz,
  active_cars   bigint,
  sold_cars     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.seller_kind,
    -- Для дилера показываем название салона, для частника — имя человека.
    -- coalesce на случай, если имя не заполнено: карточка не должна быть пустой.
    case
      when p.seller_kind = 'dealer'
      then coalesce(nullif(trim(p.company_name), ''), 'Автосалон')
      else coalesce(nullif(trim(p.full_name), ''), 'Продавец')
    end                                        as display_name,
    p.logo_url,
    p.avatar_url,
    p.created_at                               as member_since,
    -- Счётчики объявлений продавца: активные и недавно проданные.
    -- Считаются подзапросами, чтобы не плодить join'ы с группировкой.
    (select count(*) from public.cars c
      where c.user_id = p.id and c.status = 'active')  as active_cars,
    (select count(*) from public.cars c
      where c.user_id = p.id and c.status = 'sold')    as sold_cars
  from public.profiles p
  where p.id = p_user_id;
$$;

comment on function public.get_dealer_profile(uuid)
  is 'Публичная карточка продавца/дилера: имя витрины, логотип, «на площадке с», счётчики объявлений';

-- Доступна и гостю: страница дилера открывается по прямой ссылке без входа.
grant execute on function public.get_dealer_profile(uuid) to anon, authenticated;


-- ------------------------------------------------------------
-- RPC: update_seller_profile(...) — переключение частник/дилер
-- ------------------------------------------------------------
-- Пользователь редактирует ТОЛЬКО свой профиль (p_user := auth.uid(), из
-- параметров id не принимаем принципиально — иначе можно было бы подменить
-- чужой профиль). Политика profiles_update_own позволила бы сделать это и
-- прямым UPDATE, но через RPC мы централизуем валидацию: при переключении на
-- 'private' поля дилера очищаются, чтобы не оставался мусор от прошлой роли.
-- ------------------------------------------------------------
create or replace function public.update_seller_profile(
  p_seller_kind  text,
  p_company_name text default null,
  p_logo_url     text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  if p_seller_kind not in ('private', 'dealer') then
    raise exception 'Недопустимый тип продавца: %', p_seller_kind
      using errcode = 'check_violation';
  end if;

  -- Дилер без названия салона не сохраняется: проверяем ДО UPDATE, чтобы
  -- вернуть человекочитаемую ошибку, а не текст constraint'а из Postgres.
  if p_seller_kind = 'dealer'
     and nullif(trim(coalesce(p_company_name, '')), '') is null then
    raise exception 'Укажите название автосалона'
      using errcode = 'check_violation';
  end if;

  update public.profiles p
     set seller_kind  = p_seller_kind,
         -- При возврате в 'private' затираем витрину дилера.
         company_name = case when p_seller_kind = 'dealer'
                             then nullif(trim(p_company_name), '') end,
         logo_url     = case when p_seller_kind = 'dealer'
                             then nullif(trim(p_logo_url), '') end,
         updated_at   = now()
   where p.id = v_user
  returning p.* into v_profile;

  return v_profile;
end;
$$;

comment on function public.update_seller_profile(text, text, text)
  is 'Смена типа продавца (private/dealer) и полей витрины дилера. Работает только со своим профилем';

grant execute on function public.update_seller_profile(text, text, text) to authenticated;


-- ============================================================
-- БЛОК 2. КОШЕЛЁК: wallet_transactions
-- ============================================================
-- type:
--   topup  — пополнение через платёжного провайдера (ЭТАП 0: не используется,
--            провайдер не подключён; тип заведён заранее, чтобы потом не менять
--            constraint на живой таблице);
--   bonus  — начисление платформы (промо-акция, компенсация);
--   gift   — ручной подарок от администратора (единственный рабочий способ
--            «пополнения» на Этапе 0);
--   spend  — списание за услугу (продвижение объявления);
--   refund — возврат ранее списанного.
--
-- amount numeric(10,2) — по ТЗ Этапа 0. Знак строго связан с типом (CHECK ниже).
-- Валюта EUR — расчётная валюта платформы (как в bookings), в таблице не
-- хранится: весь кошелёк ведётся в одной валюте, колонка была бы константой.
-- ============================================================

create table if not exists public.wallet_transactions (
  id          uuid          primary key default gen_random_uuid(),
  user_id     uuid          not null references auth.users (id) on delete cascade,
  type        text          not null,
  -- Сумма операции. Положительная у начислений, отрицательная у списаний —
  -- поэтому баланс считается простым sum() без ветвлений по типу.
  amount      numeric(10,2) not null,
  -- Человекочитаемое описание для истории операций в профиле.
  description text,
  -- Ссылка на объявление, если операция с ним связана (продвижение).
  -- on delete set null: удалили объявление — финансовая история сохраняется.
  car_id      uuid          references public.cars (id) on delete set null,
  -- Кто провёл операцию (админ при gift/bonus). У системных начислений NULL.
  created_by  uuid          references auth.users (id) on delete set null,
  created_at  timestamptz   not null default now(),

  constraint chk_wallet_type check (
    type in ('topup', 'bonus', 'gift', 'spend', 'refund')
  ),

  -- Нулевые операции запрещены: строка без движения денег — мусор в истории.
  constraint chk_wallet_amount_nonzero check (amount <> 0),

  -- ГЛАВНАЯ ЗАЩИТА ЦЕЛОСТНОСТИ: знак суммы обязан соответствовать типу.
  -- Без неё ошибка в коде (spend с плюсом) молча НАКРУТИЛА БЫ баланс.
  constraint chk_wallet_amount_sign check (
    (type = 'spend' and amount < 0) or
    (type in ('topup', 'bonus', 'gift', 'refund') and amount > 0)
  )
);

comment on table public.wallet_transactions
  is 'Кошелёк пользователя (EUR). Баланс = sum(amount); отдельного поля баланса нет';
comment on column public.wallet_transactions.amount
  is 'Сумма в EUR. Начисления > 0, списания (spend) < 0 — гарантируется CHECK';

-- Индекс под два главных запроса: баланс (sum по user_id) и история
-- (свежие сверху). Один составной индекс покрывает оба.
create index if not exists idx_wallet_tx_user
  on public.wallet_transactions (user_id, created_at desc);


-- ------------------------------------------------------------
-- RLS: читать — только свои строки; писать напрямую НЕЛЬЗЯ ВООБЩЕ
-- ------------------------------------------------------------
-- Политик INSERT/UPDATE/DELETE нет намеренно. Любая запись идёт исключительно
-- через SECURITY DEFINER функции ниже, которые обходят RLS. Это делает
-- невозможным начисление себе баланса с клиента при утечке anon-ключа.
-- ------------------------------------------------------------
alter table public.wallet_transactions enable row level security;

drop policy if exists "wallet_tx_select_own" on public.wallet_transactions;
create policy "wallet_tx_select_own" on public.wallet_transactions
  for select to authenticated using (auth.uid() = user_id);

-- Админ видит кошелёк любого пользователя (разбор обращений, ручные подарки).
drop policy if exists "wallet_tx_select_admin" on public.wallet_transactions;
create policy "wallet_tx_select_admin" on public.wallet_transactions
  for select to authenticated using (public.is_admin());


-- ------------------------------------------------------------
-- RPC: get_balance(p_user_id) — баланс кошелька
-- ------------------------------------------------------------
-- p_user_id по умолчанию NULL = «мой баланс». Чужой баланс может запросить
-- только администратор — проверка внутри, потому что функция SECURITY DEFINER
-- и RLS её не ограничивает.
-- ------------------------------------------------------------
create or replace function public.get_balance(p_user_id uuid default null)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, auth.uid());
begin
  if v_caller is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Чужой кошелёк — только админу.
  if v_target <> v_caller and not public.is_admin() then
    raise exception 'Нет доступа к чужому балансу'
      using errcode = 'insufficient_privilege';
  end if;

  -- coalesce → 0.00 для пользователя без единой операции.
  return coalesce(
    (select sum(w.amount) from public.wallet_transactions w
      where w.user_id = v_target),
    0.00
  )::numeric(10,2);
end;
$$;

comment on function public.get_balance(uuid)
  is 'Баланс кошелька = сумма wallet_transactions. Без аргумента — свой; чужой только админу';

grant execute on function public.get_balance(uuid) to authenticated;


-- ------------------------------------------------------------
-- RPC: get_transactions(p_limit, p_offset) — история операций
-- ------------------------------------------------------------
-- Только свои операции, свежие сверху, с пагинацией под бесконечный список.
-- Прямой SELECT тоже возможен (RLS разрешает читать свои), но RPC даёт
-- стабильный контракт и ограничение p_limit сверху — клиент не выкачает
-- всю таблицу одним запросом.
-- ------------------------------------------------------------
create or replace function public.get_transactions(
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id          uuid,
  type        text,
  amount      numeric,
  description text,
  car_id      uuid,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.type, w.amount, w.description, w.car_id, w.created_at
  from public.wallet_transactions w
  where w.user_id = auth.uid()
  order by w.created_at desc
  -- least(...) — жёсткий потолок страницы; greatest(...) отсекает
  -- отрицательные значения, которые уронили бы запрос.
  limit  least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.get_transactions(integer, integer)
  is 'История операций кошелька текущего пользователя (свежие сверху, страница до 100 строк)';

grant execute on function public.get_transactions(integer, integer) to authenticated;


-- ------------------------------------------------------------
-- RPC: credit_gift(p_user_id, p_amount, p_description) — начисление админом
-- ------------------------------------------------------------
-- ЕДИНСТВЕННЫЙ рабочий способ пополнить баланс на Этапе 0 (платёжный провайдер
-- не подключён — см. TODO в отчёте). Вызывать может ТОЛЬКО администратор.
-- Тип по умолчанию 'gift'; 'bonus' — для массовых промо-начислений.
-- ------------------------------------------------------------
create or replace function public.credit_gift(
  p_user_id     uuid,
  p_amount      numeric,
  p_description text default null,
  p_type        text default 'gift'
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.wallet_transactions;
begin
  if not public.is_admin() then
    raise exception 'Начисление доступно только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  -- Начисление строго положительное: списания делает spend_balance.
  if p_amount is null or p_amount <= 0 then
    raise exception 'Сумма начисления должна быть больше нуля'
      using errcode = 'check_violation';
  end if;

  if p_type not in ('gift', 'bonus', 'topup') then
    raise exception 'Недопустимый тип начисления: %', p_type
      using errcode = 'check_violation';
  end if;

  -- Проверяем существование получателя: иначе внешний ключ вернёт
  -- невнятную ошибку про constraint вместо понятного текста.
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Пользователь не найден'
      using errcode = 'no_data_found';
  end if;

  insert into public.wallet_transactions (user_id, type, amount, description, created_by)
  values (
    p_user_id,
    p_type,
    round(p_amount, 2),
    coalesce(nullif(trim(p_description), ''), 'Подарок от платформы'),
    auth.uid()
  )
  returning * into v_tx;

  return v_tx;
end;
$$;

comment on function public.credit_gift(uuid, numeric, text, text)
  is 'Ручное начисление на баланс администратором (gift/bonus/topup). ЕДИНСТВЕННОЕ пополнение на Этапе 0';

grant execute on function public.credit_gift(uuid, numeric, text, text) to authenticated;


-- ------------------------------------------------------------
-- RPC: spend_balance(p_amount, p_description, p_car_id) — списание
-- ------------------------------------------------------------
-- Списание с баланса ТЕКУЩЕГО пользователя с проверкой достаточности средств.
-- Заготовка под будущие платные услуги (продвижение по прайсу): на Этапе 0
-- продвижение работает в режиме «подарок» и списаний не делает.
--
-- ЗАЩИТА ОТ ГОНКИ: два одновременных вызова могли бы каждый увидеть
-- достаточный баланс и увести его в минус. Поэтому берём advisory-блокировку
-- по user_id на время транзакции — второй вызов ждёт завершения первого и
-- считает баланс уже с учётом его списания.
-- ------------------------------------------------------------
create or replace function public.spend_balance(
  p_amount      numeric,
  p_description text default null,
  p_car_id      uuid default null
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_balance numeric(10,2);
  v_amount  numeric(10,2);
  v_tx      public.wallet_transactions;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- На вход принимаем ПОЛОЖИТЕЛЬНУЮ сумму («списать 5 EUR») — так вызов
  -- читается естественно; в таблицу пишем со знаком минус.
  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then
    raise exception 'Сумма списания должна быть больше нуля'
      using errcode = 'check_violation';
  end if;

  -- Сериализуем параллельные списания одного пользователя.
  -- hashtextextended даёт стабильный bigint-ключ из uuid; блокировка
  -- снимается автоматически в конце транзакции.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select coalesce(sum(w.amount), 0.00)
    into v_balance
    from public.wallet_transactions w
   where w.user_id = v_user;

  if v_balance < v_amount then
    raise exception 'Недостаточно средств: на балансе % EUR, требуется % EUR',
      v_balance, v_amount
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.wallet_transactions (user_id, type, amount, description, car_id)
  values (
    v_user,
    'spend',
    -v_amount,                                   -- в таблице списание отрицательное
    coalesce(nullif(trim(p_description), ''), 'Оплата услуги'),
    p_car_id
  )
  returning * into v_tx;

  return v_tx;
end;
$$;

comment on function public.spend_balance(numeric, text, uuid)
  is 'Списание с баланса с проверкой достаточности средств и защитой от гонки (advisory lock)';

grant execute on function public.spend_balance(numeric, text, uuid) to authenticated;
