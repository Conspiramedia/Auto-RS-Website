-- ============================================================
-- RS AUTO — ТЕСТ защиты от дублей объявлений (0093).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл создаёт временных
-- пользователей и объявления. Всё идёт в ОДНОЙ транзакции, которая в
-- конце откатывается, — следов не остаётся. Но защита от запуска на
-- проде стоит первым блоком: rollback не спасёт от срабатывания
-- триггеров писем и уведомлений на боевых данных.
--
-- ЧТО ПРОВЕРЯЕТСЯ (пункт 4 задачи):
--   1) второе active того же частника с тем же ключом → unique_violation;
--   2) тот же ключ, другой ТИП СДЕЛКИ (sale/rent)     → разрешено;
--   3) салон (seller_kind='dealer') с тем же ключом   → разрешено;
--   4) возврат archived → active при живом дубле      → отклоняется;
--   5) другой владелец, та же машина                  → разрешено
--      (межпродавцовые дубли — уровень 4, не этот триггер);
--   6) get_my_similar_listings находит объявление по ключу.
-- Плюс то, что легко сломать незаметно:
--   7) правило по ТЕЛЕФОНУ: второй аккаунт того же человека → отказ;
--   8) правка своего объявления не считает его дублем самого себя;
--   9) архив/продажа дубля НЕ мешают подать заново.
--
-- ВСЕ ДЕЙСТВИЯ — ОТ РОЛИ authenticated С CLAIMS ВЛАДЕЛЬЦА. Вставлять
-- напрямую от суперпользователя здесь нельзя: половина проверяемого
-- поведения (create_car_v3, set_my_car_status, get_my_similar_listings)
-- опирается на auth.uid(), а сам гейт читает profiles под
-- SECURITY DEFINER — под postgres это не воспроизводится.
--
-- ЗАПУСК: npm run test:sql (берёт все supabase/checks/*_test.sql)
-- либо напрямую:
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
--        -f supabase/checks/0093_duplicate_guard_test.sql
-- ============================================================

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- 0) ЗАЩИТА: это точно не боевая база?
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from public.profiles where email = 'admin@rsauto.test'
  ) then
    raise exception
      'ОСТАНОВЛЕНО: не найден тестовый админ admin@rsauto.test. '
      'Похоже, это не локальная база с применённым seed. '
      'Запустите: supabase db reset';
  end if;
end $$;


-- ------------------------------------------------------------
-- 1) Подопытные продавцы.
-- ------------------------------------------------------------
-- Свои, а не из seed: тест обязан быть самодостаточным и не ломаться
-- от правки seed.sql.
do $$
declare
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values
    -- Частник — основной подопытный.
    ('00000000-0000-4000-d000-0000000000c1', v_instance, 'authenticated',
     'authenticated', 'dup-private@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    -- Второй частник — «другой владелец» и «второй аккаунт того же
    -- человека» (для правила по телефону).
    ('00000000-0000-4000-d000-0000000000c2', v_instance, 'authenticated',
     'authenticated', 'dup-private2@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    -- Салон: ему две одинаковые машины разрешены.
    ('00000000-0000-4000-d000-0000000000c3', v_instance, 'authenticated',
     'authenticated', 'dup-dealer@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.profiles
    (id, email, full_name, company_name, seller_kind, trusted_seller, role)
  values
    ('00000000-0000-4000-d000-0000000000c1', 'dup-private@rsauto.test',
     'Dup Private', null, 'private', false, 'client'),
    ('00000000-0000-4000-d000-0000000000c2', 'dup-private2@rsauto.test',
     'Dup Private 2', null, 'private', false, 'client'),
    -- trusted_seller = false СПЕЦИАЛЬНО: исключение из гейта дублей
    -- привязано к seller_kind, а не к доверию. Салон без автопубликации
    -- обязан проходить так же, как доверенный.
    ('00000000-0000-4000-d000-0000000000c3', 'dup-dealer@rsauto.test',
     'Dup Dealer', 'Dup Test Salon', 'dealer', false, 'seller')
  on conflict (id) do update
    set seller_kind    = excluded.seller_kind,
        trusted_seller = excluded.trusted_seller,
        company_name   = excluded.company_name;
end $$;


-- ------------------------------------------------------------
-- 2) Помощники.
-- ------------------------------------------------------------
-- Переключиться на пользователя: claims + роль authenticated.
-- SET не вычисляет выражения, поэтому claims ставим через set_config
-- внутри обычного select — тот же приём, что в 0089_status_matrix_test.
create or replace function pg_temp.act_as(p_user uuid)
returns void
language plpgsql
as $fn$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', p_user)::text,
    true
  );
end;
$fn$;

-- Создать объявление НАПРЯМУЮ, в заданном статусе.
-- Нужно там, где готовится ИСХОДНОЕ состояние (уже лежащий в базе
-- active или archived): гонять его через create_car_v3 значило бы
-- проверять гейт ещё на подготовке и путать причину падения.
--
-- SECURITY DEFINER: вставка идёт от роли authenticated, а RLS на cars
-- на прямой INSERT не рассчитан — политики писались под RPC.
create or replace function pg_temp.mk_car(
  p_user    uuid,
  p_status  text default 'active',
  p_sale    boolean default true,
  p_phone   text default '+381641110001',
  p_brand   text default 'Volkswagen',
  p_model   text default 'Golf',
  p_year    integer default 2019
)
returns uuid
language plpgsql
security definer
as $fn$
declare
  v_id uuid;
begin
  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    currency, sale_price, rent_price_daily,
    city, contact_phone, status
  )
  values (
    p_user, p_sale, not p_sale,
    p_brand, p_model, p_year, 87000,
    'EUR',
    case when p_sale then 12500 end,
    case when not p_sale then 45 end,
    'Beograd', p_phone, p_status::car_status
  )
  returning id into v_id;

  return v_id;
end;
$fn$;


-- ============================================================
-- ТЕСТ 1. Второе active того же частника, тот же ключ → отказ.
-- ============================================================
-- Главный сценарий: продавец подаёт ту же машину второй раз.
-- Пробег и цена у второго объявления ДРУГИЕ — именно этим обходилась
-- прежняя защита из 0049, и именно это теперь должно быть отклонено.
do $$
declare
  v_first    uuid;
  v_ok       boolean := false;
  v_sqlstate text;
begin
  perform pg_temp.act_as('00000000-0000-4000-d000-0000000000c1');

  v_first := pg_temp.mk_car('00000000-0000-4000-d000-0000000000c1', 'active');

  set local role authenticated;

  begin
    perform public.create_car_v3(
      p_listing_type     => 'sale',
      p_brand            => 'Volkswagen',
      p_model            => 'Golf',
      p_year             => 2019,
      -- Пробег и цена НАРОЧНО другие.
      p_mileage          => 87001,
      p_sale_price       => 12499,
      p_rent_price_daily => null,
      p_deposit_amount   => 0,
      p_currency         => 'EUR',
      p_city             => 'Beograd',
      p_lat              => null,
      p_lng              => null,
      p_photo_urls       => null,
      p_phone            => '+381641110001'
    );
  exception when others then
    v_sqlstate := sqlstate;
    if v_sqlstate = '23505' then
      v_ok := true;
    else
      raise exception
        'ТЕСТ 1 ПРОВАЛЕН: подача дубля отклонена кодом «%», ожидался '
        '23505 (unique_violation).', v_sqlstate;
    end if;
  end;

  reset role;

  if not v_ok then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: второе объявление той же машины (тот же '
      'владелец, brand+model+year+тип) СОЗДАЛОСЬ. Гейт дублей не '
      'сработал — либо триггер не установлен, либо пробег и цена '
      'снова попали в ключ.';
  end if;

  raise notice 'ТЕСТ 1 ok: второй дубль частника отклонён (23505)';
end $$;


-- ============================================================
-- ТЕСТ 2. Тот же ключ, ДРУГОЙ ТИП СДЕЛКИ → разрешено.
-- ============================================================
-- Машина, которую продают и сдают, подаётся двумя объявлениями —
-- так устроена форма сайта. Пары флагов (is_for_sale, is_for_rent)
-- у них разные, и гейт обязан их пропустить.
do $$
declare
  v_new uuid;
begin
  perform pg_temp.act_as('00000000-0000-4000-d000-0000000000c1');
  set local role authenticated;

  -- У частника уже есть active Golf 2019 В ПРОДАЖЕ (из теста 1).
  -- Подаём ту же машину В АРЕНДУ.
  v_new := public.create_car_v3(
    p_listing_type     => 'rent',
    p_brand            => 'Volkswagen',
    p_model            => 'Golf',
    p_year             => 2019,
    p_mileage          => 87000,
    p_sale_price       => null,
    p_rent_price_daily => 45,
    p_deposit_amount   => 200,
    p_currency         => 'EUR',
    p_city             => 'Beograd',
    p_lat              => null,
    p_lng              => null,
    p_photo_urls       => null,
    p_phone            => '+381641110001'
  );

  reset role;

  if v_new is null then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: аренда той же машины не создалась.';
  end if;

  raise notice 'ТЕСТ 2 ok: продажа и аренда одной машины разрешены';
end $$;


-- ============================================================
-- ТЕСТ 3. Салон с тем же ключом → разрешено.
-- ============================================================
-- У автосалона реально стоят две одинаковые машины разной
-- комплектации. Ради этого сценария 0049 когда-то ослабила ключ для
-- ВСЕХ; теперь вместо этого — явное исключение для салонов.
do $$
declare
  v_first uuid;
  v_second uuid;
begin
  perform pg_temp.act_as('00000000-0000-4000-d000-0000000000c3');

  v_first := pg_temp.mk_car(
    '00000000-0000-4000-d000-0000000000c3', 'active',
    p_phone => '+381641110003'
  );

  set local role authenticated;

  -- Полное совпадение ключа, включая пробег и цену.
  v_second := public.create_car_v3(
    p_listing_type     => 'sale',
    p_brand            => 'Volkswagen',
    p_model            => 'Golf',
    p_year             => 2019,
    p_mileage          => 87000,
    p_sale_price       => 12500,
    p_rent_price_daily => null,
    p_deposit_amount   => 0,
    p_currency         => 'EUR',
    p_city             => 'Beograd',
    p_lat              => null,
    p_lng              => null,
    p_photo_urls       => null,
    p_phone            => '+381641110003'
  );

  reset role;

  if v_second is null then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: салону не удалось подать вторую такую же '
      'машину. Исключение по seller_kind = dealer не работает.';
  end if;

  raise notice 'ТЕСТ 3 ok: салону две одинаковые машины разрешены';
end $$;


-- ============================================================
-- ТЕСТ 4. Возврат archived → active при живом дубле → отказ.
-- ============================================================
-- СЦЕНАРИЙ ② ИЗ АУДИТА, который прежняя защита не ловила ничем:
-- проверка стояла на пути INSERT, а возврат из архива — это UPDATE.
-- Продавец снимал объявление, подавал такое же заново и возвращал
-- старое кнопкой «Вернуть» — оба оказывались в выдаче.
do $$
declare
  v_archived uuid;
  v_ok       boolean := false;
  v_sqlstate text;
begin
  perform pg_temp.act_as('00000000-0000-4000-d000-0000000000c2');

  -- Готовим: у второго частника есть архивное объявление…
  v_archived := pg_temp.mk_car(
    '00000000-0000-4000-d000-0000000000c2', 'archived',
    p_phone => '+381641110002',
    p_model => 'Passat', p_year => 2021
  );

  -- …и живое активное с тем же ключом.
  perform pg_temp.mk_car(
    '00000000-0000-4000-d000-0000000000c2', 'active',
    p_phone => '+381641110002',
    p_model => 'Passat', p_year => 2021
  );

  set local role authenticated;

  begin
    perform public.set_my_car_status(v_archived, 'active');
  exception when others then
    v_sqlstate := sqlstate;
    if v_sqlstate = '23505' then
      v_ok := true;
    else
      raise exception
        'ТЕСТ 4 ПРОВАЛЕН: возврат из архива отклонён кодом «%», '
        'ожидался 23505.', v_sqlstate;
    end if;
  end;

  reset role;

  if not v_ok then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: объявление вернулось из архива в active при '
      'живом дубле. Триггер не покрывает UPDATE OF status — сценарий '
      '«снял, подал заново, вернул старое» снова открыт.';
  end if;

  raise notice 'ТЕСТ 4 ok: возврат из архива при живом дубле отклонён';
end $$;


-- ============================================================
-- ТЕСТ 5. Другой владелец, та же машина → разрешено.
-- ============================================================
-- Межпродавцовые дубли (перекуп + частник) этот триггер НЕ ловит и
-- ловить не должен: это уровень 4 из аудита (хеши фото и
-- пост-модерация). Тест фиксирует границу — чтобы правило случайно
-- не расширили до блокировки чужих объявлений.
do $$
declare
  v_new uuid;
begin
  -- У первого частника уже есть active Volkswagen Golf 2019 (тест 1).
  -- Второй подаёт такую же машину — со СВОИМ номером телефона.
  perform pg_temp.act_as('00000000-0000-4000-d000-0000000000c2');
  set local role authenticated;

  v_new := public.create_car_v3(
    p_listing_type     => 'sale',
    p_brand            => 'Volkswagen',
    p_model            => 'Golf',
    p_year             => 2019,
    p_mileage          => 87000,
    p_sale_price       => 12500,
    p_rent_price_daily => null,
    p_deposit_amount   => 0,
    p_currency         => 'EUR',
    p_city             => 'Beograd',
    p_lat              => null,
    p_lng              => null,
    p_photo_urls       => null,
    p_phone            => '+381641110002'
  );

  reset role;

  if v_new is null then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: другому владельцу не удалось подать ту же '
      'машину. Триггер не должен ловить межпродавцовые дубли.';
  end if;

  raise notice 'ТЕСТ 5 ok: другой владелец не заблокирован';
end $$;


-- ============================================================
-- ТЕСТ 6. get_my_similar_listings находит объявление по ключу.
-- ============================================================
do $$
declare
  v_count  integer;
  v_brand  text;
  v_url    text;
  v_alien  integer;
begin
  perform pg_temp.act_as('00000000-0000-4000-d000-0000000000c1');
  set local role authenticated;

  select count(*), max(s.brand), max(s.site_url)
    into v_count, v_brand, v_url
    from public.get_my_similar_listings('Volkswagen', 'Golf', 2019) s;

  -- У первого частника это продажа (тест 1) и аренда (тест 2):
  -- тип сделки в ключ функции НЕ входит, предупреждаем шире.
  if v_count < 1 then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: get_my_similar_listings не нашла собственное '
      'объявление Volkswagen Golf 2019.';
  end if;

  if v_brand is null or v_url is null then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: функция вернула строку с пустыми brand/site_url '
      '(brand=«%», site_url=«%»).', v_brand, v_url;
  end if;

  -- Регистр и пробелы не должны мешать: ключ нормализуется.
  select count(*) into v_count
    from public.get_my_similar_listings('  volkswagen ', 'GOLF', 2019) s;

  if v_count < 1 then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: нормализация ключа не работает — «  volkswagen »'
      '/«GOLF» не нашли то же объявление.';
  end if;

  -- ЧУЖИЕ ОБЪЯВЛЕНИЯ НЕ ВИДНЫ. У второго частника есть свой Golf 2019
  -- (тест 5), но первый не должен получить его в выдаче: функция
  -- читает по auth.uid(), и подставить чужой id нельзя.
  select count(*) into v_alien
    from public.get_my_similar_listings('Volkswagen', 'Golf', 2019) s
   where s.car_id in (
     select c.id from public.cars c
      where c.user_id = '00000000-0000-4000-d000-0000000000c2'
   );

  reset role;

  if v_alien <> 0 then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: в выдачу попали ЧУЖИЕ объявления (% шт.). '
      'Функция обязана читать только по auth.uid().', v_alien;
  end if;

  raise notice 'ТЕСТ 6 ok: get_my_similar_listings находит своё и только своё';
end $$;


-- ============================================================
-- ТЕСТ 7. Правило по ТЕЛЕФОНУ: второй аккаунт того же человека.
-- ============================================================
-- Ключ по user_id слеп к человеку, который завёл второй аккаунт.
-- Ловим его по номеру: user_id разный, телефон тот же.
--
-- Номер намеренно записан в ДРУГОМ ФОРМАТЕ: «+381641110001» против
-- «064 111 0001». Оба дают национальную часть 641110001, и
-- f_phone_digits обязана привести их к одному виду. Требовать
-- одинакового формата значило бы отключить правило для одного из двух
-- клиентов — сайт шлёт E.164, приложение может прислать с пробелами.
do $$
declare
  v_ok       boolean := false;
  v_sqlstate text;
  v_message  text;
begin
  -- Подготовка: у ПЕРВОГО частника появляется Skoda Octavia 2018
  -- с номером +381641110001.
  perform pg_temp.mk_car(
    '00000000-0000-4000-d000-0000000000c1', 'active',
    p_phone => '+381641110001',
    p_brand => 'Skoda', p_model => 'Octavia', p_year => 2018
  );

  -- Дальше действует ВТОРОЙ частник — другой аккаунт, тот же человек.
  perform pg_temp.act_as('00000000-0000-4000-d000-0000000000c2');
  set local role authenticated;

  begin
    perform public.create_car_v3(
      p_listing_type     => 'sale',
      p_brand            => 'Skoda',
      p_model            => 'Octavia',
      p_year             => 2018,
      p_mileage          => 60000,
      p_sale_price       => 9900,
      p_rent_price_daily => null,
      p_deposit_amount   => 0,
      p_currency         => 'EUR',
      p_city             => 'Beograd',
      p_lat              => null,
      p_lng              => null,
      p_photo_urls       => null,
      -- Номер ПЕРВОГО частника, записанный иначе.
      p_phone            => '064 111 0001'
    );
  exception when others then
    v_sqlstate := sqlstate;
    v_message  := sqlerrm;
    if v_sqlstate = '23505' then
      v_ok := true;
    else
      raise exception
        'ТЕСТ 7 ПРОВАЛЕН: отказ по телефону пришёл с кодом «%», '
        'ожидался 23505.', v_sqlstate;
    end if;
  end;

  reset role;

  -- ИМЕННО ПРАВИЛО ПО ТЕЛЕФОНУ, а не правило 1. Владельцы здесь
  -- разные, так что правило 1 сработать не может, — но проверить
  -- текст всё равно стоит: если ключ теста однажды пересечётся с
  -- чужим объявлением того же продавца, тест «пройдёт» по неверной
  -- причине и перестанет охранять то, ради чего написан.
  if v_ok and v_message not like '%номером телефона%' then
    raise exception
      'ТЕСТ 7 ПРОВАЛЕН: отказ пришёл, но от ДРУГОГО правила '
      '(«%»). Ожидалось правило по contact_phone.', v_message;
  end if;

  if not v_ok then
    raise exception
      'ТЕСТ 7 ПРОВАЛЕН: объявление со ЧУЖИМ user_id, но тем же '
      'телефоном и ключом создалось. Правило по contact_phone не '
      'работает — второй аккаунт того же человека проходит свободно.';
  end if;

  raise notice 'ТЕСТ 7 ok: второй аккаунт с тем же номером отклонён';
end $$;


-- ============================================================
-- ТЕСТ 8. Правка своего объявления не считает его дублем себя.
-- ============================================================
-- id <> new.id в обоих запросах гейта. Без него любое сохранение
-- через update_car_v3 падало бы с 23505: объявление находило бы
-- само себя.
do $$
declare
  v_car    uuid;
  v_status text;
begin
  perform pg_temp.act_as('00000000-0000-4000-d000-0000000000c3');

  v_car := pg_temp.mk_car(
    '00000000-0000-4000-d000-0000000000c3', 'active',
    p_phone => '+381641110003',
    p_model => 'Tiguan', p_year => 2020
  );

  set local role authenticated;

  -- Правим цену: контент изменился → объявление уходит в moderation,
  -- то есть триггер сработает на UPDATE OF status.
  perform public.update_car_v3(
    p_car_id           => v_car,
    p_listing_type     => 'sale',
    p_brand            => 'Volkswagen',
    p_model            => 'Tiguan',
    p_year             => 2020,
    p_mileage          => 50000,
    p_sale_price       => 15900,
    p_rent_price_daily => null,
    p_deposit_amount   => 0,
    p_currency         => 'EUR',
    p_city             => 'Beograd',
    p_lat              => null,
    p_lng              => null,
    p_phone            => '+381641110003'
  );

  reset role;

  select c.status::text into v_status from public.cars c where c.id = v_car;

  if v_status is null then
    raise exception 'ТЕСТ 8 ПРОВАЛЕН: объявление исчезло после правки.';
  end if;

  raise notice 'ТЕСТ 8 ok: правка своего объявления проходит (статус «%»)', v_status;
end $$;


-- ============================================================
-- ТЕСТ 9. Архив и продажа НЕ мешают подать заново.
-- ============================================================
-- Прежнее поведение из 0049, которое обязано сохраниться: снятое
-- объявление не блокирует новую подачу. Иначе продавец, продавший
-- машину и купивший такую же, не смог бы её выставить.
do $$
declare
  v_new uuid;
begin
  perform pg_temp.act_as('00000000-0000-4000-d000-0000000000c1');

  -- Только архивное и проданное объявление, живых с этим ключом нет.
  perform pg_temp.mk_car(
    '00000000-0000-4000-d000-0000000000c1', 'archived',
    p_phone => '+381641110001',
    p_model => 'Polo', p_year => 2015
  );
  perform pg_temp.mk_car(
    '00000000-0000-4000-d000-0000000000c1', 'sold',
    p_phone => '+381641110001',
    p_model => 'Polo', p_year => 2015
  );

  set local role authenticated;

  v_new := public.create_car_v3(
    p_listing_type     => 'sale',
    p_brand            => 'Volkswagen',
    p_model            => 'Polo',
    p_year             => 2015,
    p_mileage          => 120000,
    p_sale_price       => 5500,
    p_rent_price_daily => null,
    p_deposit_amount   => 0,
    p_currency         => 'EUR',
    p_city             => 'Beograd',
    p_lat              => null,
    p_lng              => null,
    p_photo_urls       => null,
    p_phone            => '+381641110001'
  );

  reset role;

  if v_new is null then
    raise exception
      'ТЕСТ 9 ПРОВАЛЕН: архивное/проданное объявление заблокировало '
      'новую подачу. В ключ гейта не должны попадать статусы вне '
      'moderation/active.';
  end if;

  raise notice 'ТЕСТ 9 ok: архив и продажа не мешают подать заново';
end $$;


rollback;

\echo 'ВСЕ ТЕСТЫ 0093 ПРОЙДЕНЫ (транзакция откачена, следов в базе нет)'
