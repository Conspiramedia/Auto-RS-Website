-- ============================================================
-- RS AUTO — ТЕСТ честной сортировки «Сначала новые» (0088).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл создаёт временного
-- продавца и объявления. Всё в ОДНОЙ транзакции, которая в конце
-- откатывается, — следов в базе не остаётся. Защита от запуска на
-- проде стоит первым блоком: rollback не спасёт от нагрузки и от
-- срабатывания триггеров на боевых данных.
--
-- ЧТО ПРОВЕРЯЕТСЯ (пункты 1–3 задачи плюс то, что легко сломать):
--   1) новое объявление в окне 3 дней стоит выше старого;
--   2) промо стоит выше свежих;
--   3) лимит промо-блока работает: наверх идут ровно три;
--   4) внутри промо-блока порядок по boosted_until desc —
--      купивший позже стоит выше;
--   5) четвёртое промо не исчезает и не наказывается: оно идёт
--      по обычным правилам (в окно свежести, если молодое);
--   6) is_promoted остаётся у ВСЕХ промо, включая не попавшие
--      в верхний блок, — карточка обязана нарисовать значок;
--   7) при явной сортировке (price_asc) промо НЕ поднимается;
--   8) истёкшее продвижение (boosted_until в прошлом) наверх
--      не идёт;
--   9) лимит промо считается по всей выдаче, а не по странице:
--      на второй странице промо-блока быть не должно;
--  10) окно свежести не действует на кругах 2+ ленты
--      (p_shuffle_all = true);
--  11) выдача остаётся стабильной между вызовами — иначе
--      пагинация даст дубли и пропуски;
--  12) total_count не изменился от новой сортировки.
--
-- ИЗОЛЯЦИЯ ОТ SEED. Все подопытные объявления носят марку
-- 'ZZTestBrand' и запрашиваются через p_brand — иначе в выдачу
-- попали бы seed-объявления и демо-данные, и порядок пришлось бы
-- проверять среди чужих строк. Марка заведомо не встречается ни в
-- seed.sql, ни в демо-миграциях.
--
-- ЗАПУСК: npm run test:sql (берёт все supabase/checks/*_test.sql)
-- либо напрямую:
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
--        -f supabase/checks/0088_fresh_sort_test.sql
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
-- 1) Подопытный продавец.
-- ------------------------------------------------------------
-- Заводим своего, а не берём из seed: тест должен быть
-- самодостаточным и не ломаться от правки seed.sql.
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
    ('00000000-0000-4000-f000-0000000000b1', v_instance, 'authenticated',
     'authenticated', 'fresh-sort@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  -- seller_kind = 'private': search_cars_public соединяется с profiles
  -- через INNER JOIN, поэтому строка профиля обязана существовать —
  -- без неё объявления не попали бы в выдачу вовсе, и тест «упал бы
  -- зелёным», проверяя пустой набор.
  insert into public.profiles (id, email, full_name, seller_kind, role)
  values ('00000000-0000-4000-f000-0000000000b1', 'fresh-sort@rsauto.test',
          'Fresh Sort Tester', 'private', 'seller')
  on conflict (id) do update
    set seller_kind = excluded.seller_kind;
end $$;


-- ------------------------------------------------------------
-- Помощник: создать объявление с заданными возрастом и продвижением.
-- ------------------------------------------------------------
-- Вставляем напрямую, а не через create_car_v3: та требует auth.uid(),
-- которого в psql нет. Для теста важен ПОРЯДОК ВЫДАЧИ, а он зависит
-- только от содержимого строк.
--
-- created_at задаётся явно: у столбца default now(), а нам нужны
-- объявления возрастом в дни. Триггер set_updated_at трогает только
-- updated_at при UPDATE и вставке не мешает.
--
-- Статус сразу 'active': путь модерации проверяется в 0086, здесь он
-- только помешал бы — объявление в moderation в выдачу не попадает.
create or replace function pg_temp.mk_car(
  p_label     text,
  p_age       interval,
  p_boosted   interval default null,   -- null = без продвижения
  p_price     numeric  default 10000
)
returns uuid
language plpgsql
as $fn$
declare
  v_id uuid;
begin
  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    currency, sale_price, city, contact_phone, status,
    is_vip, boosted_until, created_at
  )
  values (
    '00000000-0000-4000-f000-0000000000b1', true, false,
    -- Марка-маркер: по ней тест отбирает СВОИ объявления и не видит
    -- ни seed, ни демо-данные.
    'ZZTestBrand', p_label, 2019, 87000,
    'EUR', p_price, 'Beograd', '+381641234567', 'active',
    p_boosted is not null,
    case when p_boosted is not null then now() + p_boosted end,
    now() - p_age
  )
  returning id into v_id;

  -- Фотография: в выдаче photo_url берётся подзапросом и её
  -- отсутствие ничему не мешает, но объявление без фото —
  -- нереалистичная строка, а тест должен идти по обычному пути.
  insert into public.car_images (car_id, image_url, order_index)
  values (v_id, 'https://example.test/' || p_label || '.jpg', 0);

  return v_id;
end;
$fn$;


-- Помощник: позиция объявления в выдаче (1 = первое). NULL — нет в выдаче.
create or replace function pg_temp.pos_of(
  p_car_id uuid,
  p_sort   text    default 'fresh',
  p_offset integer default 0,
  p_limit  integer default 100
)
returns integer
language sql
as $fn$
  select pos::integer from (
    select s.id, row_number() over () as pos
      from public.search_cars_public(
             p_brand  => 'ZZTestBrand',
             p_sort   => p_sort,
             p_offset => p_offset,
             p_limit  => p_limit
           ) s
  ) t
  where t.id = p_car_id;
$fn$;


-- ============================================================
-- ТЕСТ 1. Новое объявление в окне 3 дней стоит выше старого.
-- ============================================================
-- Главный сценарий задачи: продавец подал машину и обязан увидеть её
-- наверху, а не на случайной позиции среди сотен.
--
-- Старых объявлений берём десять: с одним старым тест прошёл бы и на
-- случайной сортировке — там шанс угадать 50%. При десяти вероятность
-- ложного успеха 1/11, и повторный прогон её добьёт.
do $$
declare
  v_new uuid;
  v_old uuid;
  v_pos integer;
  i     integer;
begin
  -- Десять старых: возраст от 10 до 100 дней.
  for i in 1..10 loop
    v_old := pg_temp.mk_car('old-' || i, (i * 10) || ' days');
  end loop;

  -- Новое: подано час назад.
  v_new := pg_temp.mk_car('new-1', interval '1 hour');

  v_pos := pg_temp.pos_of(v_new);

  if v_pos is null then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: новое объявление вообще не попало в выдачу';
  end if;

  if v_pos <> 1 then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: новое объявление на позиции %, ожидалась 1. '
      'Окно свежести не работает — сортировка осталась случайной.', v_pos;
  end if;

  raise notice 'ТЕСТ 1 ok: новое объявление первое среди 10 старых';
end $$;


-- ============================================================
-- ТЕСТ 2. Промо стоит выше свежих.
-- ============================================================
-- Порядок уровней: промо → окно свежести → перемешка. Промо-объявление
-- СТАРОЕ (30 дней) и всё равно обязано стоять выше вчерашнего:
-- продвижение — платная услуга, и окно свежести её не отменяет.
do $$
declare
  v_promo uuid;
  v_fresh uuid;
  v_p_pos integer;
  v_f_pos integer;
begin
  v_promo := pg_temp.mk_car('promo-old', interval '30 days', interval '7 days');
  v_fresh := pg_temp.mk_car('fresh-2',   interval '2 hours');

  v_p_pos := pg_temp.pos_of(v_promo);
  v_f_pos := pg_temp.pos_of(v_fresh);

  if v_p_pos is null or v_f_pos is null then
    raise exception 'ТЕСТ 2 ПРОВАЛЕН: объявления не попали в выдачу';
  end if;

  if v_p_pos >= v_f_pos then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: промо на позиции %, свежее на % — '
      'промо обязано быть выше', v_p_pos, v_f_pos;
  end if;

  if v_p_pos <> 1 then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: единственное промо на позиции %, ожидалась 1',
      v_p_pos;
  end if;

  raise notice 'ТЕСТ 2 ok: промо (%) выше свежего (%)', v_p_pos, v_f_pos;
end $$;


-- ============================================================
-- ТЕСТ 3. Лимит промо-блока: наверх идут ровно три.
-- ============================================================
-- Ради этого пункта миграция и вводит f_promo_top_limit(): без лимита
-- сорок купивших продвижение занимают первые две страницы, и обычное
-- объявление не видно никогда.
--
-- Заводим ШЕСТЬ промо и проверяем, что подряд сверху их ровно три.
-- Лимит читаем из самой функции, а не пишем «3» здесь: разойдись
-- константа и тест — тест начал бы врать молча.
do $$
declare
  v_limit  integer := public.f_promo_top_limit();
  v_streak integer := 0;
  v_row    record;
  i        integer;
begin
  -- Шесть промо, продвижение куплено в разное время.
  for i in 1..6 loop
    perform pg_temp.mk_car(
      'promo-lim-' || i,
      interval '40 days',
      (i || ' days')::interval
    );
  end loop;

  -- Считаем, сколько промо идёт ПОДРЯД от первой строки.
  for v_row in
    select s.is_promoted
      from public.search_cars_public(
             p_brand => 'ZZTestBrand', p_limit => 100
           ) s
  loop
    exit when not v_row.is_promoted;
    v_streak := v_streak + 1;
  end loop;

  if v_streak <> v_limit then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: подряд сверху % промо-объявлений, ожидалось % '
      '(f_promo_top_limit). Лимит промо-блока не работает.',
      v_streak, v_limit;
  end if;

  raise notice 'ТЕСТ 3 ok: в промо-блоке ровно % объявления', v_streak;
end $$;


-- ============================================================
-- ТЕСТ 4. Внутри промо-блока — boosted_until desc.
-- ============================================================
-- Купивший продвижение позже стоит выше. Это и порядок в блоке, и
-- правило отбора В блок: из шести промо теста 3 наверх обязаны
-- попасть те три, у кого boosted_until самый дальний.
do $$
declare
  v_prev timestamptz := null;
  v_row  record;
  v_seen integer := 0;
begin
  for v_row in
    select s.id, s.is_promoted, c.boosted_until
      from public.search_cars_public(
             p_brand => 'ZZTestBrand', p_limit => 100
           ) s
      join public.cars c on c.id = s.id
  loop
    exit when not v_row.is_promoted;

    v_seen := v_seen + 1;

    if v_prev is not null and v_row.boosted_until > v_prev then
      raise exception
        'ТЕСТ 4 ПРОВАЛЕН: в промо-блоке boosted_until % идёт после % — '
        'порядок не по убыванию', v_row.boosted_until, v_prev;
    end if;

    v_prev := v_row.boosted_until;
  end loop;

  if v_seen = 0 then
    raise exception 'ТЕСТ 4 ПРОВАЛЕН: промо-блок пуст, проверять нечего';
  end if;

  raise notice 'ТЕСТ 4 ok: % промо идут по boosted_until desc', v_seen;
end $$;


-- ============================================================
-- ТЕСТ 5. Промо сверх лимита не наказано.
-- ============================================================
-- Четвёртое и дальше промо не исчезает из выдачи и не уходит в хвост:
-- оно идёт по ОБЫЧНЫМ правилам. Проверяем на молодом промо —
-- не попав в блок, оно обязано подхватиться окном свежести.
do $$
declare
  v_young_promo uuid;
  v_old_plain   uuid;
  v_yp_pos      integer;
  v_op_pos      integer;
begin
  -- Молодое промо с САМЫМ БЛИЗКИМ boosted_until: в тесте 3 уже есть
  -- шесть промо со сроком 1–6 дней, здесь 12 часов — гарантированно
  -- последнее в нумерации, то есть в верхний блок не попадает.
  v_young_promo := pg_temp.mk_car(
    'promo-young', interval '1 hour', interval '12 hours'
  );
  v_old_plain := pg_temp.mk_car('plain-old', interval '200 days');

  v_yp_pos := pg_temp.pos_of(v_young_promo);
  v_op_pos := pg_temp.pos_of(v_old_plain);

  if v_yp_pos is null then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: промо сверх лимита пропало из выдачи';
  end if;

  if v_yp_pos <= public.f_promo_top_limit() then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: промо с наименьшим boosted_until попало в '
      'верхний блок (позиция %) — отбор в блок идёт не по '
      'boosted_until desc', v_yp_pos;
  end if;

  if v_yp_pos >= v_op_pos then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: молодое промо сверх лимита на позиции %, '
      'старое обычное на % — окно свежести его не подхватило',
      v_yp_pos, v_op_pos;
  end if;

  raise notice
    'ТЕСТ 5 ok: промо сверх лимита идёт по обычным правилам (% < %)',
    v_yp_pos, v_op_pos;
end $$;


-- ============================================================
-- ТЕСТ 6. is_promoted остаётся у всех промо.
-- ============================================================
-- Лимит управляет ПОЗИЦИЕЙ, а не статусом. Карточка рисует значок
-- «VIP» по полю is_promoted, и четвёртое промо обязано носить его
-- так же, как первое: продавец за него заплатил.
do $$
declare
  v_flagged integer;
  v_actual  integer;
begin
  select count(*) into v_flagged
    from public.search_cars_public(p_brand => 'ZZTestBrand', p_limit => 100) s
   where s.is_promoted;

  select count(*) into v_actual
    from public.cars c
   where c.brand = 'ZZTestBrand'
     and c.status = 'active'
     and c.is_vip
     and c.boosted_until > now();

  if v_flagged <> v_actual then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: is_promoted = true у % строк, а действующих '
      'продвижений % — лимит блока не должен снимать признак',
      v_flagged, v_actual;
  end if;

  raise notice 'ТЕСТ 6 ok: признак продвижения у всех % промо', v_flagged;
end $$;


-- ============================================================
-- ТЕСТ 7. При явной сортировке промо НЕ поднимается.
-- ============================================================
-- Человек попросил «сначала дешёвые» — реклама поверх этого выглядит
-- как обман. Правило было в 0059 и обязано пережить правку.
do $$
declare
  v_cheap uuid;
  v_pos   integer;
  v_prev  numeric := null;
  v_row   record;
begin
  -- Самое дешёвое объявление БЕЗ продвижения. Все промо выше по цене
  -- (10000 по умолчанию), поэтому при price_asc оно обязано быть первым.
  v_cheap := pg_temp.mk_car('cheap-plain', interval '300 days', null, 1);

  v_pos := pg_temp.pos_of(v_cheap, 'price_asc');

  if v_pos <> 1 then
    raise exception
      'ТЕСТ 7 ПРОВАЛЕН: при price_asc самое дешёвое объявление на '
      'позиции %, ожидалась 1 — промо поднялось поверх явной '
      'сортировки', v_pos;
  end if;

  -- Заодно: цена действительно по возрастанию по всей выдаче.
  for v_row in
    select s.sale_price
      from public.search_cars_public(
             p_brand => 'ZZTestBrand', p_sort => 'price_asc', p_limit => 100
           ) s
  loop
    if v_prev is not null and v_row.sale_price < v_prev then
      raise exception
        'ТЕСТ 7 ПРОВАЛЕН: цена % идёт после % — порядок нарушен',
        v_row.sale_price, v_prev;
    end if;
    v_prev := v_row.sale_price;
  end loop;

  raise notice 'ТЕСТ 7 ok: явная сортировка по цене не нарушена промо';
end $$;


-- ============================================================
-- ТЕСТ 8. Истёкшее продвижение наверх не идёт.
-- ============================================================
-- is_vip сам по себе не истекает — источник истины при сортировке
-- это ОБА поля вместе (0047). Объявление с is_vip = true и
-- boosted_until в прошлом обязано считаться обычным.
do $$
declare
  v_expired uuid;
  v_pos     integer;
begin
  -- Продвижение закончилось сутки назад, флаг остался.
  insert into public.cars (
    user_id, is_for_sale, is_for_rent, brand, model, year, mileage,
    currency, sale_price, city, contact_phone, status,
    is_vip, boosted_until, created_at
  )
  values (
    '00000000-0000-4000-f000-0000000000b1', true, false,
    'ZZTestBrand', 'promo-expired', 2019, 87000,
    'EUR', 10000, 'Beograd', '+381641234567', 'active',
    true, now() - interval '1 day', now() - interval '50 days'
  )
  returning id into v_expired;

  v_pos := pg_temp.pos_of(v_expired);

  if v_pos <= public.f_promo_top_limit() then
    raise exception
      'ТЕСТ 8 ПРОВАЛЕН: объявление с истёкшим продвижением на позиции % — '
      'попало в промо-блок', v_pos;
  end if;

  raise notice 'ТЕСТ 8 ok: истёкшее продвижение не поднимается (позиция %)',
    v_pos;
end $$;


-- ============================================================
-- ТЕСТ 9. Лимит считается по выдаче, а не по странице.
-- ============================================================
-- Если бы лимит применялся внутри страницы, КАЖДАЯ страница
-- открывалась бы тремя промо-карточками, и ограничение не
-- ограничивало бы ничего. На второй странице промо-блока быть
-- не должно.
do $$
declare
  v_limit    integer := public.f_promo_top_limit();
  v_page2_hd integer := 0;
  v_row      record;
begin
  -- Вторая страница при размере страницы, равном лимиту: первая
  -- страница целиком занята промо-блоком, вторая обязана начаться
  -- с обычных объявлений.
  for v_row in
    select s.is_promoted
      from public.search_cars_public(
             p_brand  => 'ZZTestBrand',
             p_offset => v_limit,
             p_limit  => v_limit
           ) s
  loop
    exit when not v_row.is_promoted;
    v_page2_hd := v_page2_hd + 1;
  end loop;

  if v_page2_hd > 0 then
    raise exception
      'ТЕСТ 9 ПРОВАЛЕН: вторая страница начинается с % промо — '
      'лимит применяется к странице, а не ко всей выдаче', v_page2_hd;
  end if;

  raise notice 'ТЕСТ 9 ok: промо-блок только на первой странице';
end $$;


-- ============================================================
-- ТЕСТ 10. На кругах 2+ ленты окно свежести не действует.
-- ============================================================
-- p_shuffle_all вводился (0059) ради того, чтобы новый круг
-- бесконечной ленты не открывался теми же карточками. Подними мы там
-- свежие — круг снова начинался бы с одного и того же.
do $$
declare
  v_new     uuid;
  v_top_id  uuid;
  v_matches integer := 0;
  i         integer;
begin
  -- Самое новое объявление во всей выборке.
  v_new := pg_temp.mk_car('newest-of-all', interval '1 minute');

  -- На пяти разных солях проверяем, что оно НЕ прибито к первой
  -- позиции. Одна соль ничего не доказала бы: случайная перемешка
  -- вправе поставить его первым — но не на всех пяти сразу.
  for i in 1..5 loop
    select s.id into v_top_id
      from public.search_cars_public(
             p_brand       => 'ZZTestBrand',
             p_seed        => i * 1000,
             p_shuffle_all => true,
             p_limit       => 1
           ) s;

    if v_top_id = v_new then
      v_matches := v_matches + 1;
    end if;
  end loop;

  if v_matches = 5 then
    raise exception
      'ТЕСТ 10 ПРОВАЛЕН: при shuffle_all самое новое объявление '
      'первое на всех 5 солях — окно свежести не отключилось';
  end if;

  raise notice
    'ТЕСТ 10 ok: при shuffle_all свежесть не поднимает (совпадений %/5)',
    v_matches;
end $$;


-- ============================================================
-- ТЕСТ 11. Выдача стабильна между вызовами.
-- ============================================================
-- Требование пагинации: без стабильного порядка одно объявление
-- попадёт на две страницы, а другое — ни на одну. Три вызова подряд
-- обязаны дать одинаковую последовательность id.
do $$
declare
  v_first  uuid[];
  v_next   uuid[];
  i        integer;
begin
  select array_agg(x.id order by x.pos) into v_first
    from (
      select s.id, row_number() over () as pos
        from public.search_cars_public(
               p_brand => 'ZZTestBrand', p_limit => 100
             ) s
    ) x;

  for i in 1..3 loop
    select array_agg(x.id order by x.pos) into v_next
      from (
        select s.id, row_number() over () as pos
          from public.search_cars_public(
                 p_brand => 'ZZTestBrand', p_limit => 100
               ) s
      ) x;

    if v_next is distinct from v_first then
      raise exception
        'ТЕСТ 11 ПРОВАЛЕН: вызов % дал другой порядок — '
        'пагинация даст дубли и пропуски', i;
    end if;
  end loop;

  raise notice 'ТЕСТ 11 ok: порядок стабилен между вызовами';
end $$;


-- ============================================================
-- ТЕСТ 12. total_count не пострадал от новой сортировки.
-- ============================================================
-- Порядок строк на их количество влиять не может, но total_count
-- считается оконной функцией ВНУТРИ запроса, который миграция
-- переписала, — проверяем, что он по-прежнему равен числу строк.
do $$
declare
  v_total  bigint;
  v_actual bigint;
begin
  select s.total_count into v_total
    from public.search_cars_public(p_brand => 'ZZTestBrand', p_limit => 1) s;

  select count(*) into v_actual
    from public.cars c
    join public.profiles pr on pr.id = c.user_id
   where c.brand = 'ZZTestBrand'
     and c.status = 'active'
     and c.is_for_sale;

  if v_total is distinct from v_actual then
    raise exception
      'ТЕСТ 12 ПРОВАЛЕН: total_count = %, реально строк % ',
      v_total, v_actual;
  end if;

  raise notice 'ТЕСТ 12 ok: total_count верен (%)', v_total;
end $$;


-- ------------------------------------------------------------
-- Откат: тест не оставляет следов в базе.
-- ------------------------------------------------------------
rollback;

\echo ''
\echo '================================================='
\echo 'ТЕСТЫ СОРТИРОВКИ FRESH ПРОЙДЕНЫ. Транзакция откачена.'
\echo '================================================='
