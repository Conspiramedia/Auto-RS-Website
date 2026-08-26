-- ============================================================
-- RS AUTO — ТЕСТ матрицы статусов и авторства снятия (0089).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл создаёт временных
-- пользователей и объявления. Всё выполняется в ОДНОЙ транзакции,
-- которая в конце откатывается, — следов в базе не остаётся. Защита
-- от запуска на проде стоит первым блоком: rollback не спасёт от
-- срабатывания триггеров писем на боевых данных.
--
-- ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: проверки, где важны ПРАВА, идут от
-- роли authenticated с подставленным auth.uid(), а НЕ от postgres.
-- Под postgres SECURITY DEFINER-функции выполняются от суперпользо-
-- вателя, is_admin() смотрит на несуществующий профиль, а RLS не
-- применяется вовсе — тест, написанный так, проходил бы всегда и не
-- проверял бы ничего.
--
-- ЧТО ПРОВЕРЯЕТСЯ (нумерация конфликтов — из отчёта по матрице):
--   К1  владелец НЕ возвращает объявление, снятое администратором;
--   К1' контроль: своё собственное снятие владелец возвращает;
--   К1'' архив «до 0089» (archived_by is null) владельцу доступен;
--   Р1  admin_set_car_status проставляет archived_by/archived_reason,
--       возврат администратором их сбрасывает;
--   К4  письмо car_archived_by_admin ставится при снятии админом и
--       НЕ ставится при снятии владельцем;
--   К5  блокировка салона пишет car_archived на каждое объявление и
--       помечает их admin — то есть владелец их не вернёт;
--   К6  продвижение гаснет при уходе в archived/sold ЛЮБЫМ путём,
--       включая админский и прямой UPDATE;
--   К7  объявление, однажды отклонённое модератором, не публикуется
--       автоматически даже у доверенного салона;
--   К9  владельческий возврат из архива попадает в журнал.
--
-- ЗАПУСК: npm run test:sql (берёт все supabase/checks/*_test.sql)
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
-- 1) Подопытные: администратор, частник, доверенный салон.
-- ------------------------------------------------------------
-- Заводим своих, а не берём из seed: тест должен быть самодостаточным
-- и не ломаться от правки seed.sql.
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
     'authenticated', 'sm-admin@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    ('00000000-0000-4000-f000-0000000000b2', v_instance, 'authenticated',
     'authenticated', 'sm-owner@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    ('00000000-0000-4000-f000-0000000000b3', v_instance, 'authenticated',
     'authenticated', 'sm-dealer@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.profiles
    (id, email, full_name, company_name, seller_kind, trusted_seller,
     role, is_admin, locale)
  values
    ('00000000-0000-4000-f000-0000000000b1', 'sm-admin@rsauto.test',
     'SM Admin', null, 'private', false, 'admin', true, 'ru'),
    -- У владельца ОБЯЗАТЕЛЬНО есть email: без него триггер писем
    -- выходит раньше, чем доходит до постановки письма, и тест К4
    -- проверял бы не то, что задумано.
    ('00000000-0000-4000-f000-0000000000b2', 'sm-owner@rsauto.test',
     'SM Owner', null, 'private', false, 'seller', false, 'ru'),
    ('00000000-0000-4000-f000-0000000000b3', 'sm-dealer@rsauto.test',
     'SM Dealer', 'SM Test Salon', 'dealer', true, 'seller', false, 'ru')
  on conflict (id) do update
    set is_admin       = excluded.is_admin,
        seller_kind    = excluded.seller_kind,
        trusted_seller = excluded.trusted_seller,
        email          = excluded.email;
end $$;


-- ------------------------------------------------------------
-- Помощники.
-- ------------------------------------------------------------
-- Создать объявление в заданном статусе. Вставляем напрямую, а не
-- через create_car_v3: та требует auth.uid(), а нам нужно готовое
-- состояние, а не проверка подачи.
create or replace function pg_temp.mk_car(
  p_user   uuid,
  p_status text default 'active',
  p_vip    boolean default false
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
    is_vip, boosted_until
  )
  values (
    p_user, true, false,
    'Audi', 'A4', 2020, 65000,
    'EUR', 15900, 'Novi Sad', '+381641234567', p_status::car_status,
    p_vip,
    case when p_vip then now() + interval '7 days' end
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

-- Переключиться на пользователя: claims + роль authenticated.
-- SET не вычисляет выражения, поэтому claims ставим через set_config
-- внутри обычного select — тот же приём, что в 0063_rls_verify.sql.
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


-- ============================================================
-- ТЕСТ К1. ВЛАДЕЛЕЦ НЕ ОТМЕНЯЕТ РЕШЕНИЕ АДМИНИСТРАТОРА
-- ============================================================
-- Главный сценарий тикета: админ снял объявление, владелец нажал
-- «Вернуть» — и до 0089 объявление возвращалось в пул.
do $$
declare
  v_car     uuid;
  v_status  text;
  v_by      text;
  v_reason  text;
  v_ok      boolean := false;
  v_sqlstate text;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b2', 'active');

  -- --- Админ снимает объявление ---
  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b1');
  set local role authenticated;

  perform public.admin_set_car_status(
    v_car, 'archived', 'нарушение правил размещения объявлений'
  );

  reset role;

  select c.status::text, c.archived_by::text, c.archived_reason
    into v_status, v_by, v_reason
    from public.cars c where c.id = v_car;

  -- Р1: авторство и причина записаны в САМУ СТРОКУ.
  if v_status <> 'archived' or v_by <> 'admin' then
    raise exception
      'ТЕСТ К1 ПРОВАЛЕН (подготовка): статус «%», archived_by «%», '
      'ожидались archived/admin', v_status, v_by;
  end if;

  if v_reason is null or v_reason not like 'нарушение%' then
    raise exception
      'ТЕСТ К1 ПРОВАЛЕН (подготовка): причина снятия не записана в '
      'cars.archived_reason (получено «%»)', v_reason;
  end if;

  -- --- Владелец пытается вернуть ---
  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b2');
  set local role authenticated;

  begin
    perform public.set_my_car_status(v_car, 'active');
    -- Сюда попадать нельзя: вызов обязан упасть.
  exception when others then
    v_sqlstate := sqlstate;
    -- Ровно insufficient_privilege, а не любая ошибка: check_violation
    -- здесь означал бы, что переход запрещён как таковой, а это не
    -- так — он запрещён ЭТОЙ РОЛИ.
    if v_sqlstate = '42501' then
      v_ok := true;
    else
      raise exception
        'ТЕСТ К1 ПРОВАЛЕН: возврат отклонён с кодом «%», ожидался '
        '42501 insufficient_privilege', v_sqlstate;
    end if;
  end;

  reset role;

  if not v_ok then
    raise exception
      'ТЕСТ К1 ПРОВАЛЕН: владелец ВЕРНУЛ в публикацию объявление, '
      'снятое администратором. Это и есть конфликт из тикета.';
  end if;

  -- Статус не изменился ни на йоту.
  select c.status::text into v_status from public.cars c where c.id = v_car;

  if v_status <> 'archived' then
    raise exception
      'ТЕСТ К1 ПРОВАЛЕН: после отклонённого вызова статус «%», '
      'ожидался archived', v_status;
  end if;

  raise notice 'ТЕСТ К1 ok: админский архив владельцу не вернуть';
end $$;


-- ============================================================
-- ТЕСТ К1'. КОНТРОЛЬ: СВОЙ АРХИВ ВЛАДЕЛЕЦ ВОЗВРАЩАЕТ
-- ============================================================
-- Без этой проверки предыдущий тест проходил бы и у функции, которая
-- запрещает возврат ВСЕГДА, — а это сломало бы обычный сценарий
-- «снял на неделю, вернул».
do $$
declare
  v_car    uuid;
  v_status text;
  v_by     text;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b2');
  set local role authenticated;

  -- Снимает сам.
  perform public.set_my_car_status(v_car, 'archived');

  select c.archived_by::text into v_by from public.cars c where c.id = v_car;

  if v_by is distinct from 'owner' then
    raise exception
      'ТЕСТ К1'' ПРОВАЛЕН: владельческое снятие записало archived_by '
      '«%», ожидалось owner', v_by;
  end if;

  -- И возвращает.
  perform public.set_my_car_status(v_car, 'active');

  reset role;

  select c.status::text, c.archived_by::text
    into v_status, v_by
    from public.cars c where c.id = v_car;

  if v_status <> 'active' then
    raise exception
      'ТЕСТ К1'' ПРОВАЛЕН: владелец не смог вернуть СВОЁ снятое '
      'объявление, статус «%»', v_status;
  end if;

  -- Выход из архива стирает авторство (иначе следующее собственное
  -- снятие сравнивалось бы со старой меткой).
  if v_by is not null then
    raise exception
      'ТЕСТ К1'' ПРОВАЛЕН: после возврата archived_by = «%», '
      'ожидался null', v_by;
  end if;

  raise notice 'ТЕСТ К1'' ok: свой архив возвращается, метка снимается';
end $$;


-- ============================================================
-- ТЕСТ К1''. АРХИВ «ДО 0089» ОСТАЁТСЯ ДОСТУПНЫМ ВЛАДЕЛЬЦУ
-- ============================================================
-- У объявлений, попавших в архив до этой миграции, archived_by пуст.
-- Трактовать пустоту как админский архив значило бы задним числом
-- запереть в архиве объявления добросовестных продавцов.
do $$
declare
  v_car    uuid;
  v_status text;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b2', 'archived');

  -- Явно приводим строку к состоянию «до 0089»: статус archived,
  -- авторство неизвестно.
  update public.cars set archived_by = null, archived_reason = null
   where id = v_car;

  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b2');
  set local role authenticated;

  perform public.set_my_car_status(v_car, 'active');

  reset role;

  select c.status::text into v_status from public.cars c where c.id = v_car;

  if v_status <> 'active' then
    raise exception
      'ТЕСТ К1'''' ПРОВАЛЕН: архив без метки авторства не вернулся, '
      'статус «%». Старые объявления оказались заперты.', v_status;
  end if;

  raise notice 'ТЕСТ К1'''' ok: архив до 0089 владельцу доступен';
end $$;


-- ============================================================
-- ТЕСТ Р1. ВОЗВРАТ АДМИНИСТРАТОРОМ СБРАСЫВАЕТ АВТОРСТВО
-- ============================================================
do $$
declare
  v_car uuid;
  v_by  text;
  v_rsn text;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b1');
  set local role authenticated;

  perform public.admin_set_car_status(v_car, 'archived', 'проверка документов на автомобиль');
  perform public.admin_set_car_status(v_car, 'active', 'документы предоставлены продавцом');

  reset role;

  select c.archived_by::text, c.archived_reason
    into v_by, v_rsn
    from public.cars c where c.id = v_car;

  if v_by is not null or v_rsn is not null then
    raise exception
      'ТЕСТ Р1 ПРОВАЛЕН: после возврата администратором archived_by = '
      '«%», archived_reason = «%», ожидались null. Метка осталась бы '
      'навсегда и запретила бы владельцу его собственное снятие.',
      v_by, v_rsn;
  end if;

  raise notice 'ТЕСТ Р1 ok: возврат админом снимает метку архива';
end $$;


-- ============================================================
-- ТЕСТ К4. ПИСЬМО О СНЯТИИ АДМИНИСТРАТОРОМ
-- ============================================================
-- Регрессия: ветку active → archived потеряли при пересоздании
-- триггерной функции в 0086, и продавец перестал получать письмо.
do $$
declare
  v_car_admin uuid;
  v_car_owner uuid;
  v_mails     integer;
  v_before    integer;
  v_reason    text;
begin
  -- --- Снятие администратором: письмо ОБЯЗАНО быть ---
  v_car_admin := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b1');
  set local role authenticated;

  perform public.admin_set_car_status(
    v_car_admin, 'archived', 'фотографии не соответствуют автомобилю'
  );

  reset role;

  select count(*), max(q.payload->>'reason')
    into v_mails, v_reason
    from public.email_queue q
   where q.template_key = 'car_archived_by_admin'
     and q.to_email     = 'sm-owner@rsauto.test'
     and q.payload->>'brand' = 'Audi';

  if v_mails < 1 then
    raise exception
      'ТЕСТ К4 ПРОВАЛЕН: письмо car_archived_by_admin НЕ поставлено '
      'в очередь. Продавец не узнает о снятии иначе как из '
      'колокольчика.';
  end if;

  -- Причина обязана доехать до письма: письмо «объявление снято» без
  -- объяснения бесполезно и обидно.
  if v_reason is null or v_reason not like 'фотографии%' then
    raise exception
      'ТЕСТ К4 ПРОВАЛЕН: в письме причина «%», ожидалась про '
      'фотографии', v_reason;
  end if;

  -- --- Снятие владельцем: письма быть НЕ должно ---
  -- Payload письма не содержит id объявления, поэтому отличить новое
  -- письмо от письма предыдущего блока по содержимому нельзя.
  -- Считаем письма ДО и ПОСЛЕ: прирост обязан быть нулевым.
  select count(*)
    into v_before
    from public.email_queue q
   where q.template_key = 'car_archived_by_admin'
     and q.to_email     = 'sm-owner@rsauto.test';

  v_car_owner := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b2');
  set local role authenticated;

  perform public.set_my_car_status(v_car_owner, 'archived');

  reset role;

  select count(*)
    into v_mails
    from public.email_queue q
   where q.template_key = 'car_archived_by_admin'
     and q.to_email     = 'sm-owner@rsauto.test';

  if v_mails <> v_before then
    raise exception
      'ТЕСТ К4 ПРОВАЛЕН: владельцу отправлено письмо о его '
      'СОБСТВЕННОМ снятии — это спам (писем было %, стало %)',
      v_before, v_mails;
  end if;

  raise notice 'ТЕСТ К4 ok: письмо только при снятии администратором';
end $$;


-- ============================================================
-- ТЕСТ К5. БЛОКИРОВКА САЛОНА: ЖУРНАЛ ПО КАЖДОМУ ОБЪЯВЛЕНИЮ
-- ============================================================
-- До 0089 массовое архивирование писало ОДНУ запись на профиль, и
-- владелец возвращал каждую машину кнопкой «Вернуть», обходя
-- блокировку целиком.
do $$
declare
  v_c1     uuid;
  v_c2     uuid;
  v_mod    uuid;
  v_hidden integer;
  v_logs   integer;
  v_by     text;
  v_status text;
  v_ok     boolean := false;
begin
  v_c1  := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b3', 'active');
  v_c2  := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b3', 'active');
  -- Объявление на модерации трогать не должны: оно и так не в выдаче.
  v_mod := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b3', 'moderation');

  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b1');
  set local role authenticated;

  v_hidden := public.admin_block_dealer(
    '00000000-0000-4000-f000-0000000000b3',
    'салон размещает несуществующие автомобили'
  );

  reset role;

  if v_hidden <> 2 then
    raise exception
      'ТЕСТ К5 ПРОВАЛЕН: скрыто % объявлений, ожидалось 2', v_hidden;
  end if;

  -- Объявление на модерации не тронуто.
  select c.status::text into v_status from public.cars c where c.id = v_mod;
  if v_status <> 'moderation' then
    raise exception
      'ТЕСТ К5 ПРОВАЛЕН: объявление на модерации получило статус «%»',
      v_status;
  end if;

  -- Запись журнала на КАЖДОЕ объявление, а не одна на салон.
  select count(*)
    into v_logs
    from public.admin_action_log l
   where l.target_table = 'cars'
     and l.action       = 'car_archived'
     and l.target_id in (v_c1, v_c2);

  if v_logs <> 2 then
    raise exception
      'ТЕСТ К5 ПРОВАЛЕН: записей car_archived по объявлениям %, '
      'ожидалось 2. Без них по машине не видно, почему она в архиве.',
      v_logs;
  end if;

  -- Авторство проставлено — значит владелец не вернёт (проверяем).
  select c.archived_by::text into v_by from public.cars c where c.id = v_c1;

  if v_by is distinct from 'admin' then
    raise exception
      'ТЕСТ К5 ПРОВАЛЕН: archived_by = «%», ожидался admin', v_by;
  end if;

  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b3');
  set local role authenticated;

  begin
    perform public.set_my_car_status(v_c1, 'active');
  exception when insufficient_privilege then
    v_ok := true;
  end;

  reset role;

  if not v_ok then
    raise exception
      'ТЕСТ К5 ПРОВАЛЕН: салон вернул в выдачу объявление, скрытое '
      'блокировкой, — блокировка обходится в один клик.';
  end if;

  raise notice 'ТЕСТ К5 ok: журнал по каждому, возврат салоном закрыт';
end $$;


-- ============================================================
-- ТЕСТ К6. ПРОДВИЖЕНИЕ ГАСНЕТ НА ЛЮБОМ ПУТИ
-- ============================================================
-- Раньше гашение жило внутри set_my_car_status, и admin_set_car_status
-- отправляла объявление в архив с действующим промо.
do $$
declare
  v_car  uuid;
  v_vip  boolean;
  v_till timestamptz;
begin
  -- --- Путь 1: администратор ---
  v_car := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b2', 'active', true);

  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b1');
  set local role authenticated;

  perform public.admin_set_car_status(v_car, 'archived', 'снято до выяснения обстоятельств');

  reset role;

  select c.is_vip, c.boosted_until into v_vip, v_till
    from public.cars c where c.id = v_car;

  if v_vip or v_till is not null then
    raise exception
      'ТЕСТ К6 ПРОВАЛЕН (админ): is_vip = %, boosted_until = %, '
      'ожидались false/null. Оплаченные дни горят в архиве впустую.',
      v_vip, v_till;
  end if;

  -- --- Путь 2: владелец, «продано» ---
  v_car := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b2', 'active', true);

  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b2');
  set local role authenticated;

  perform public.set_my_car_status(v_car, 'sold');

  reset role;

  select c.is_vip, c.boosted_until into v_vip, v_till
    from public.cars c where c.id = v_car;

  if v_vip or v_till is not null then
    raise exception
      'ТЕСТ К6 ПРОВАЛЕН (владелец/продано): is_vip = %, '
      'boosted_until = %', v_vip, v_till;
  end if;

  -- --- Путь 3: ПРЯМОЙ UPDATE ---
  -- Тот самый путь, который аппа использует до сих пор и который
  -- отзыв прав пока не закрыл. Триггер обязан гасить промо и здесь —
  -- в этом и смысл переноса логики из RPC на таблицу.
  v_car := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b2', 'active', true);

  update public.cars set status = 'archived' where id = v_car;

  select c.is_vip, c.boosted_until into v_vip, v_till
    from public.cars c where c.id = v_car;

  if v_vip or v_till is not null then
    raise exception
      'ТЕСТ К6 ПРОВАЛЕН (прямой UPDATE): is_vip = %, boosted_until = %. '
      'Логика гашения снова зависит от способа смены статуса.',
      v_vip, v_till;
  end if;

  raise notice 'ТЕСТ К6 ok: промо гаснет всеми тремя путями';
end $$;


-- ============================================================
-- ТЕСТ К7. ОТКЛОНЁННОЕ НЕ ПУБЛИКУЕТСЯ АВТОМАТИЧЕСКИ
-- ============================================================
-- Сценарий: модератор отклонил объявление салона; салон поправил
-- пробел в описании (статус ушёл в moderation) и добавил фото —
-- автопубликация вернула бы его в выдачу мимо модератора.
do $$
declare
  v_car    uuid;
  v_status text;
  v_reason text;
  v_ctrl   uuid;
begin
  -- Объявление доверенного салона на модерации.
  v_car := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b3', 'moderation');

  -- Модератор отклоняет — в журнале появляется car_rejected.
  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b1');
  set local role authenticated;

  perform public.reject_car(v_car, 'на снимках другой автомобиль, замените фотографии');

  reset role;

  -- Салон правит объявление: статус снова moderation.
  update public.cars set status = 'moderation', moderation_comment = null
   where id = v_car;

  -- И добавляет фотографию — срабатывает триггер автопубликации.
  insert into public.car_images (car_id, image_url, order_index)
  values (v_car, 'https://example.test/photo-fixed.jpg', 0);

  select c.status::text into v_status from public.cars c where c.id = v_car;

  if v_status <> 'moderation' then
    raise exception
      'ТЕСТ К7 ПРОВАЛЕН: ранее отклонённое объявление получило статус '
      '«%». Оно опубликовано мимо модератора, который его отклонил.',
      v_status;
  end if;

  -- Причина непрохождения записана — салон должен понимать, почему
  -- его объявление на этот раз ждёт очереди.
  select l.payload->>'reason'
    into v_reason
    from public.admin_action_log l
   where l.target_id = v_car
     and l.action    = 'car_autopublish_skipped'
   order by l.created_at desc
   limit 1;

  if v_reason is null or v_reason not like '%отклонял%' then
    raise exception
      'ТЕСТ К7 ПРОВАЛЕН: в журнале причина «%», ожидалась про прежнее '
      'отклонение', v_reason;
  end if;

  -- КОНТРОЛЬ: объявление БЕЗ истории отклонений публикуется как
  -- прежде. Без этой проверки тест проходил бы и у функции, которая
  -- сломала автопубликацию целиком.
  v_ctrl := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b3', 'moderation');

  insert into public.car_images (car_id, image_url, order_index)
  values (v_ctrl, 'https://example.test/photo-clean.jpg', 0);

  select c.status::text into v_status from public.cars c where c.id = v_ctrl;

  if v_status <> 'active' then
    raise exception
      'ТЕСТ К7 ПРОВАЛЕН (контроль): чистое объявление доверенного '
      'салона получило статус «%», ожидался active. Автопубликация '
      'сломана целиком.', v_status;
  end if;

  raise notice 'ТЕСТ К7 ok: отклонённое — в очередь, чистое — в выдачу';
end $$;


-- ============================================================
-- ТЕСТ К9. ВОЗВРАТ ВЛАДЕЛЬЦЕМ ПОПАДАЕТ В ЖУРНАЛ
-- ============================================================
-- Без записи модератор не может обнаружить, что объявление, которое
-- он видел снятым, снова в выдаче.
do $$
declare
  v_car   uuid;
  v_logs  integer;
  v_actor uuid;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f000-0000000000b2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f000-0000000000b2');
  set local role authenticated;

  perform public.set_my_car_status(v_car, 'archived');
  perform public.set_my_car_status(v_car, 'active');

  reset role;

  select count(*), max(l.actor_id)
    into v_logs, v_actor
    from public.admin_action_log l
   where l.target_table = 'cars'
     and l.target_id    = v_car
     and l.action       = 'car_restored_by_owner';

  if v_logs <> 1 then
    raise exception
      'ТЕСТ К9 ПРОВАЛЕН: записей car_restored_by_owner %, ожидалась 1',
      v_logs;
  end if;

  -- Актор — сам владелец, а не администратор: действие его.
  if v_actor <> '00000000-0000-4000-f000-0000000000b2'::uuid then
    raise exception
      'ТЕСТ К9 ПРОВАЛЕН: актором записан «%», ожидался владелец',
      v_actor;
  end if;

  -- Снятие владельцем в журнал НЕ пишется: это обычная жизнь
  -- объявления, и заваливать ею журнал модератора незачем.
  select count(*)
    into v_logs
    from public.admin_action_log l
   where l.target_id = v_car
     and l.action    = 'car_archived';

  if v_logs <> 0 then
    raise exception
      'ТЕСТ К9 ПРОВАЛЕН: владельческое снятие записано как car_archived '
      '(%), журнал модератора засоряется', v_logs;
  end if;

  raise notice 'ТЕСТ К9 ok: возврат владельцем в журнале, снятие — нет';
end $$;


-- ------------------------------------------------------------
-- Откат: тест не оставляет следов в базе.
-- ------------------------------------------------------------
rollback;

\echo ''
\echo '================================================='
\echo 'ТЕСТЫ МАТРИЦЫ СТАТУСОВ ПРОЙДЕНЫ. Транзакция откачена.'
\echo '================================================='
