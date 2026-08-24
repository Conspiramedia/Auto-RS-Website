-- ============================================================
-- RS AUTO — ТЕСТ автопубликации доверенных салонов (0086).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл создаёт временных
-- пользователей и объявления. Всё выполняется в ОДНОЙ транзакции,
-- которая в конце откатывается, — следов в базе не остаётся. Но
-- защита от запуска на проде стоит первым блоком: rollback не спасёт
-- от нагрузки и от срабатывания триггеров писем на боевых данных.
--
-- ЧТО ПРОВЕРЯЕТСЯ. Первые три — прямо из пункта 4 задачи, остальные
-- закрывают то, что легко сломать незаметно:
--   1) доверенный салон с полным объявлением     → active;
--   2) доверенный салон БЕЗ фотографий           → moderation;
--   3) частник с флагом trusted_seller = true    → moderation;
--   4) невалидный телефон → moderation + причина в журнале,
--      и это НЕ rejected (проверяется отдельно);
--   5) отсутствие цены                           → moderation;
--   6) журнал: car_auto_approved несёт id салона;
--   7) письмо об одобрении при автопубликации НЕ ставится;
--   8) обычная модерация писем НЕ лишилась (подавление не задело
--      основной путь);
--   9) второе фото не публикует повторно, фото к отклонённому не
--      воскрешает его;
--  10) правка объявления публикует его снова — право выдано салону,
--      а не конкретному объявлению.
--
-- ЗАПУСК: npm run test:sql (берёт все supabase/checks/*_test.sql)
-- либо напрямую:
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
--        -f supabase/checks/0086_autopublish_test.sql
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
    -- Доверенный салон.
    ('00000000-0000-4000-e000-0000000000a1', v_instance, 'authenticated',
     'authenticated', 'ap-dealer@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    -- Частник, которому ошибочно выставили флаг доверия.
    ('00000000-0000-4000-e000-0000000000a2', v_instance, 'authenticated',
     'authenticated', 'ap-private@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.profiles
    (id, email, full_name, company_name, seller_kind, trusted_seller, role)
  values
    ('00000000-0000-4000-e000-0000000000a1', 'ap-dealer@rsauto.test',
     'AP Dealer', 'AP Test Salon', 'dealer', true, 'seller'),
    -- ЧАСТНИК С ФЛАГОМ. Ровно тот случай, который правило обязано
    -- отсечь: право привязано к виду продавца, а не к одному флагу.
    ('00000000-0000-4000-e000-0000000000a2', 'ap-private@rsauto.test',
     'AP Private', null, 'private', true, 'client')
  on conflict (id) do update
    set seller_kind    = excluded.seller_kind,
        trusted_seller = excluded.trusted_seller,
        company_name   = excluded.company_name;
end $$;


-- ------------------------------------------------------------
-- Помощник: создать объявление и (необязательно) фотографию.
-- ------------------------------------------------------------
-- Вставляем напрямую, а не через create_car_v3: та требует auth.uid(),
-- которого в psql нет. Для теста важен сам триггер на car_images, а
-- он срабатывает независимо от того, кто вставил строки.
create or replace function pg_temp.mk_car(
  p_user   uuid,
  p_phone  text default '+381641234567',
  p_price  numeric default 12500,
  p_photo  boolean default true
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
    currency, sale_price, city, contact_phone, status
  )
  values (
    p_user, true, false,
    'Volkswagen', 'Golf', 2019, 87000,
    'EUR', p_price, 'Beograd', p_phone, 'moderation'
  )
  returning id into v_id;

  if p_photo then
    insert into public.car_images (car_id, image_url, order_index)
    values (v_id, 'https://example.test/photo.jpg', 0);
  end if;

  return v_id;
end;
$fn$;


-- ============================================================
-- ТЕСТ 1. Доверенный салон + полное объявление → active.
-- ============================================================
do $$
declare
  v_id     uuid;
  v_status text;
begin
  v_id := pg_temp.mk_car('00000000-0000-4000-e000-0000000000a1');

  select status::text into v_status from public.cars where id = v_id;

  if v_status <> 'active' then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: объявление доверенного салона получило статус «%», '
      'ожидался active. Автопубликация не сработала.', v_status;
  end if;

  raise notice 'ТЕСТ 1 ok: доверенный салон публикуется сразу';
end $$;


-- ============================================================
-- ТЕСТ 2. Доверенный салон БЕЗ фотографий → moderation.
-- ============================================================
-- Фотография — обязательное условие. Триггер висит на car_images и
-- для объявления без снимков просто не сработает, поэтому оно
-- останется в очереди. Это и проверяем.
do $$
declare
  v_id     uuid;
  v_status text;
begin
  v_id := pg_temp.mk_car(
    '00000000-0000-4000-e000-0000000000a1',
    p_photo => false
  );

  select status::text into v_status from public.cars where id = v_id;

  if v_status <> 'moderation' then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: объявление БЕЗ ФОТОГРАФИЙ получило статус «%», '
      'ожидался moderation. Объявление без снимков не должно '
      'публиковаться автоматически.', v_status;
  end if;

  raise notice 'ТЕСТ 2 ok: без фотографий автопубликации нет';
end $$;


-- ============================================================
-- ТЕСТ 3. Частник → moderation НЕЗАВИСИМО от флага.
-- ============================================================
do $$
declare
  v_id      uuid;
  v_status  text;
  v_trusted boolean;
begin
  -- Убеждаемся, что флаг у частника действительно стоит: иначе тест
  -- проверял бы не то, что заявлено, и проходил бы всегда.
  select trusted_seller into v_trusted
    from public.profiles where id = '00000000-0000-4000-e000-0000000000a2';

  if v_trusted is not true then
    raise exception
      'ТЕСТ 3 НЕКОРРЕКТЕН: у частника не выставлен trusted_seller, '
      'проверять нечего';
  end if;

  v_id := pg_temp.mk_car('00000000-0000-4000-e000-0000000000a2');

  select status::text into v_status from public.cars where id = v_id;

  if v_status <> 'moderation' then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: объявление ЧАСТНИКА с флагом trusted_seller '
      'получило статус «%», ожидался moderation. Право на '
      'автопубликацию обязано зависеть от seller_kind, а не только '
      'от флага.', v_status;
  end if;

  raise notice 'ТЕСТ 3 ok: частник в очереди даже с флагом доверия';
end $$;


-- ============================================================
-- ТЕСТ 4. Невалидный телефон → moderation + причина в журнале.
-- ============================================================
-- Проверяется и то, что это НЕ авто-отклонение: статус moderation,
-- а не rejected.
do $$
declare
  v_id     uuid;
  v_status text;
  v_reason text;
begin
  -- Номер стационарный (начинается не с 6) — по правилам клиента
  -- невалиден как мобильный.
  v_id := pg_temp.mk_car(
    '00000000-0000-4000-e000-0000000000a1',
    p_phone => '+381112223344'
  );

  select status::text into v_status from public.cars where id = v_id;

  if v_status = 'rejected' then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: объявление АВТО-ОТКЛОНЕНО. Непрохождение '
      'валидации обязано отправлять в очередь, а не отклонять: '
      'правила проверяют форму, а не содержание.';
  end if;

  if v_status <> 'moderation' then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: статус «%», ожидался moderation', v_status;
  end if;

  -- Причина обязана попасть в журнал.
  select l.payload->>'reason' into v_reason
    from public.admin_action_log l
   where l.target_id = v_id
     and l.action = 'car_autopublish_skipped'
   limit 1;

  if v_reason is null then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: причина непрохождения не записана в журнал '
      '(действие car_autopublish_skipped не найдено)';
  end if;

  if v_reason not ilike '%телефон%' then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: в журнале причина «%», ожидалась про телефон',
      v_reason;
  end if;

  raise notice 'ТЕСТ 4 ok: невалидный телефон → очередь, причина «%»', v_reason;
end $$;


-- ============================================================
-- ТЕСТ 5. Отсутствие цены → moderation.
-- ============================================================
do $$
declare
  v_id     uuid;
  v_status text;
  v_reason text;
begin
  -- Договорная цена (NULL) схемой допускается, но автопубликацию не
  -- проходит: объявление без цены — частый повод для вопросов.
  v_id := pg_temp.mk_car(
    '00000000-0000-4000-e000-0000000000a1',
    p_price => null
  );

  select status::text into v_status from public.cars where id = v_id;

  -- Объявление на продажу без цены упирается в constraint
  -- chk_sale_price ещё на вставке, поэтому сюда мы попадаем только
  -- если схема это допустила. Если вставка прошла — статус обязан
  -- остаться moderation.
  if v_status <> 'moderation' then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: объявление БЕЗ ЦЕНЫ получило статус «%», '
      'ожидался moderation', v_status;
  end if;

  select l.payload->>'reason' into v_reason
    from public.admin_action_log l
   where l.target_id = v_id and l.action = 'car_autopublish_skipped'
   limit 1;

  raise notice 'ТЕСТ 5 ok: без цены → очередь (причина: %)',
    coalesce(v_reason, 'не дошло до валидации');
exception
  -- Constraint сработал раньше триггера — это тоже верное поведение
  -- и даже более раннее: объявление без цены вообще не создаётся.
  when check_violation then
    raise notice
      'ТЕСТ 5 ok: объявление без цены отклонено constraint''ом схемы '
      'ещё до автопубликации';
end $$;


-- ============================================================
-- ТЕСТ 6. Журнал: car_auto_approved несёт id салона.
-- ============================================================
-- Прямое требование пункта 3 задачи.
do $$
declare
  v_id        uuid;
  v_dealer_id text;
  v_actor     uuid;
  v_count     int;
begin
  v_id := pg_temp.mk_car('00000000-0000-4000-e000-0000000000a1');

  select count(*) into v_count
    from public.admin_action_log l
   where l.target_id = v_id and l.action = 'car_auto_approved';

  if v_count <> 1 then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: записей car_auto_approved %, ожидалась ровно 1',
      v_count;
  end if;

  select l.payload->>'dealer_id', l.actor_id
    into v_dealer_id, v_actor
    from public.admin_action_log l
   where l.target_id = v_id and l.action = 'car_auto_approved';

  if v_dealer_id is distinct from '00000000-0000-4000-e000-0000000000a1' then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: в payload dealer_id = «%», ожидался id салона',
      v_dealer_id;
  end if;

  if v_actor is distinct from '00000000-0000-4000-e000-0000000000a1'::uuid then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: actor_id = «%», ожидался id салона', v_actor;
  end if;

  raise notice 'ТЕСТ 6 ok: журнал несёт id салона и в payload, и в actor_id';
end $$;


-- ============================================================
-- ТЕСТ 7. Письмо об одобрении при автопубликации НЕ ставится.
-- ============================================================
-- Салон с автопубликацией знает, что его объявления уходят сразу;
-- письмо на каждую машину при десятках подач в день — спам.
do $$
declare
  v_id     uuid;
  v_emails int;
begin
  v_id := pg_temp.mk_car('00000000-0000-4000-e000-0000000000a1');

  select count(*) into v_emails
    from public.email_queue q
   where q.payload->>'brand' = 'Volkswagen'
     and q.template_key = 'car_approved'
     and q.created_at > now() - interval '1 minute'
     and q.user_id = '00000000-0000-4000-e000-0000000000a1';

  if v_emails > 0 then
    raise exception
      'ТЕСТ 7 ПРОВАЛЕН: при автопубликации поставлено писем: %. '
      'Ожидалось 0 — подавление через rs_auto.skip_moderation_email '
      'не сработало.', v_emails;
  end if;

  raise notice 'ТЕСТ 7 ok: письмо об одобрении при автопубликации не ставится';
end $$;


-- ============================================================
-- ТЕСТ 8. Обычная модерация писем НЕ лишилась.
-- ============================================================
-- Проверка того, что подавление не задело основной путь: флаг
-- ставится только внутри f_car_autopublish и живёт до конца
-- транзакции, поэтому ручное одобрение обязано слать письмо как
-- прежде.
do $$
declare
  v_id     uuid;
  v_emails int;
begin
  -- Объявление обычного частника без флага: автопубликации не будет.
  v_id := pg_temp.mk_car('00000000-0000-4000-e000-0000000000a2');

  -- Имитируем ручное одобрение сменой статуса — тем же переходом,
  -- что делает approve_car.
  update public.cars set status = 'active' where id = v_id;

  select count(*) into v_emails
    from public.email_queue q
   where q.user_id = '00000000-0000-4000-e000-0000000000a2'
     and q.template_key = 'car_approved'
     and q.created_at > now() - interval '1 minute';

  if v_emails = 0 then
    raise exception
      'ТЕСТ 8 ПРОВАЛЕН: при обычном одобрении письмо НЕ поставлено. '
      'Подавление автопубликации задело основной путь модерации.';
  end if;

  raise notice 'ТЕСТ 8 ok: обычная модерация по-прежнему шлёт письмо';
end $$;


-- ============================================================
-- ТЕСТ 9. Повторная вставка фото не публикует чужое/готовое.
-- ============================================================
-- Два случая в одном тесте, оба про условие «работаем только со
-- статусом moderation»:
--   а) второе фото у уже опубликованного объявления не создаёт
--      второй записи в журнале;
--   б) фотография, добавленная к ОТКЛОНЁННОМУ объявлению, не
--      воскрешает его в выдачу.
do $$
declare
  v_id     uuid;
  v_logs   int;
  v_status text;
begin
  -- ---------- (а) второе фото у опубликованного ----------
  v_id := pg_temp.mk_car('00000000-0000-4000-e000-0000000000a1');

  insert into public.car_images (car_id, image_url, order_index)
  values (v_id, 'https://example.test/photo2.jpg', 1);

  select count(*) into v_logs
    from public.admin_action_log l
   where l.target_id = v_id and l.action = 'car_auto_approved';

  if v_logs <> 1 then
    raise exception
      'ТЕСТ 9а ПРОВАЛЕН: записей car_auto_approved %, ожидалась 1. '
      'Триггер отработал повторно на втором фото.', v_logs;
  end if;

  -- ---------- (б) фото к отклонённому ----------
  v_id := pg_temp.mk_car(
    '00000000-0000-4000-e000-0000000000a1',
    p_photo => false
  );
  update public.cars set status = 'rejected' where id = v_id;

  insert into public.car_images (car_id, image_url, order_index)
  values (v_id, 'https://example.test/photo.jpg', 0);

  select status::text into v_status from public.cars where id = v_id;

  if v_status <> 'rejected' then
    raise exception
      'ТЕСТ 9б ПРОВАЛЕН: отклонённое объявление получило статус «%» '
      'после добавления фотографии. Отклонённое не должно '
      'публиковаться само.', v_status;
  end if;

  raise notice 'ТЕСТ 9 ok: повторное фото и фото к отклонённому безопасны';
end $$;


-- ============================================================
-- ТЕСТ 10. Правка объявления публикует его снова.
-- ============================================================
-- update_car_v3 при существенной правке возвращает объявление в
-- moderation и перезаписывает фотографии — триггер обязан сработать
-- снова. Право выдано САЛОНУ, а не объявлению: иначе салон не мог бы
-- исправить опечатку в цене, не потеряв машину из выдачи на сутки.
--
-- Саму RPC не зовём (ей нужен auth.uid()) — воспроизводим её
-- поведение: статус в moderation, фотографии заново.
do $$
declare
  v_id     uuid;
  v_status text;
  v_logs   int;
begin
  v_id := pg_temp.mk_car('00000000-0000-4000-e000-0000000000a1');

  -- Имитация существенной правки.
  update public.cars
     set status     = 'moderation',
         sale_price = 11900
   where id = v_id;

  delete from public.car_images where car_id = v_id;
  insert into public.car_images (car_id, image_url, order_index)
  values (v_id, 'https://example.test/photo-new.jpg', 0);

  select status::text into v_status from public.cars where id = v_id;

  if v_status <> 'active' then
    raise exception
      'ТЕСТ 10 ПРОВАЛЕН: после правки объявление доверенного салона '
      'получило статус «%», ожидался active', v_status;
  end if;

  select count(*) into v_logs
    from public.admin_action_log l
   where l.target_id = v_id and l.action = 'car_auto_approved';

  if v_logs <> 2 then
    raise exception
      'ТЕСТ 10 ПРОВАЛЕН: записей car_auto_approved %, ожидалось 2 '
      '(подача и правка)', v_logs;
  end if;

  raise notice 'ТЕСТ 10 ok: правка публикуется снова, обе записи в журнале';
end $$;


-- ------------------------------------------------------------
-- Откат: тест не оставляет следов в базе.
-- ------------------------------------------------------------
rollback;

\echo ''
\echo '================================================='
\echo 'ТЕСТЫ АВТОПУБЛИКАЦИИ ПРОЙДЕНЫ. Транзакция откачена.'
\echo '================================================='
