-- ============================================================
-- RS AUTO — ТЕСТ правки объявления из админского архива (0090).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл создаёт временных
-- пользователей и объявления; всё идёт в одной транзакции, которая в
-- конце откатывается.
--
-- Проверки прав выполняются от роли authenticated с подставленным
-- auth.uid(), а НЕ от postgres: под суперпользователем SECURITY
-- DEFINER-функции видят другой auth.uid(), is_admin() смотрит на
-- несуществующий профиль, а RLS не применяется — такой тест проходил
-- бы всегда.
--
-- ЧТО ПРОВЕРЯЕТСЯ (дельта 0090 поверх 0089):
--   1) админ архивировал → set_my_car_status(…,'active') отклонён
--      с insufficient_privilege, и текст НЕ отсылает в поддержку;
--   2) владелец архивировал сам → тот же вызов проходит;
--   3) существенная правка админского архива → moderation,
--      archived_by/archived_reason сброшены;
--   4) НЕсущественная правка админского архива → остаётся archived,
--      метки на месте (иначе «Сохранить» без изменений работало бы
--      как «оспорить решение»);
--   5) автопубликация ПОСЛЕ такой правки не срабатывает — даже у
--      доверенного салона, даже когда объявление формально идеально;
--  5а) замена фотографий при правке из архива: старый снимок уходит,
--      новый становится обложкой, объявление уезжает на модерацию;
--   6) свой архив в update_car_v3 по-прежнему не редактируется;
--   7) get_car_details отдаёт archived_by владельцу и скрывает от
--      постороннего.
--
-- Сценарии К4, К5, К6, К9 покрыты в 0089_status_matrix_test.sql и
-- здесь не дублируются — 0090 их не трогает.
--
-- ЗАПУСК: npm run test:sql
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
    ('00000000-0000-4000-f100-0000000000c1', v_instance, 'authenticated',
     'authenticated', 'ed-admin@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    ('00000000-0000-4000-f100-0000000000c2', v_instance, 'authenticated',
     'authenticated', 'ed-owner@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    ('00000000-0000-4000-f100-0000000000c3', v_instance, 'authenticated',
     'authenticated', 'ed-dealer@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb),
    -- Посторонний: нужен для проверки видимости причины снятия.
    ('00000000-0000-4000-f100-0000000000c4', v_instance, 'authenticated',
     'authenticated', 'ed-stranger@rsauto.test', '', now(), now(), now(),
     '{}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.profiles
    (id, email, full_name, company_name, seller_kind, trusted_seller,
     role, is_admin, locale)
  values
    ('00000000-0000-4000-f100-0000000000c1', 'ed-admin@rsauto.test',
     'ED Admin', null, 'private', false, 'admin', true, 'ru'),
    ('00000000-0000-4000-f100-0000000000c2', 'ed-owner@rsauto.test',
     'ED Owner', null, 'private', false, 'seller', false, 'ru'),
    ('00000000-0000-4000-f100-0000000000c3', 'ed-dealer@rsauto.test',
     'ED Dealer', 'ED Test Salon', 'dealer', true, 'seller', false, 'ru'),
    ('00000000-0000-4000-f100-0000000000c4', 'ed-stranger@rsauto.test',
     'ED Stranger', null, 'private', false, 'client', false, 'ru')
  on conflict (id) do update
    set is_admin       = excluded.is_admin,
        seller_kind    = excluded.seller_kind,
        trusted_seller = excluded.trusted_seller,
        email          = excluded.email;
end $$;


-- ------------------------------------------------------------
-- Помощники.
-- ------------------------------------------------------------
create or replace function pg_temp.mk_car(
  p_user   uuid,
  p_status text default 'active'
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
    currency, sale_price, city, contact_phone, status, description
  )
  values (
    p_user, true, false,
    'Skoda', 'Octavia', 2021, 42000,
    'EUR', 17400, 'Beograd', '+381641234567', p_status::car_status,
    'Прежнее описание объявления.'
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

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

-- Вызов update_car_v3 с текущими значениями объявления и заданным
-- описанием. Описание — единственное, что меняется между вызовами,
-- поэтому «существенная правка» и «правка без изменений» отличаются
-- ровно одним аргументом.
-- p_photos: NULL — набор фотографий не трогаем (правка только текста);
-- массив — полная замена, как это делает форма сайта.
create or replace function pg_temp.edit_car(
  p_car_id uuid,
  p_desc   text,
  p_photos text[] default null
)
returns text
language plpgsql
as $fn$
declare
  v_car    public.cars;
  v_status text;
begin
  select c.* into v_car from public.cars c where c.id = p_car_id;

  select u.status
    into v_status
    from public.update_car_v3(
      p_car_id,
      'sale',
      v_car.brand,
      v_car.model,
      v_car.year,
      v_car.mileage,
      v_car.sale_price,
      null,
      null,
      v_car.currency::text,
      v_car.city,
      null, null,
      p_photos,
      v_car.body_type,
      v_car.transmission,
      v_car.fuel,
      p_desc,
      v_car.contact_phone
    ) u;

  return v_status;
end;
$fn$;


-- ============================================================
-- ТЕСТ 1. ПРЯМОЙ ВОЗВРАТ АДМИНСКОГО АРХИВА ОТКЛОНЁН
-- ============================================================
do $$
declare
  v_car    uuid;
  v_ok     boolean := false;
  v_msg    text;
  v_state  text;
  v_status text;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f100-0000000000c2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c1');
  set local role authenticated;

  perform public.admin_set_car_status(
    v_car, 'archived', 'уберите номер телефона из текста описания'
  );

  reset role;

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c2');
  set local role authenticated;

  begin
    perform public.set_my_car_status(v_car, 'active');
  exception when others then
    v_state := sqlstate;
    v_msg   := sqlerrm;
    if v_state = '42501' then
      v_ok := true;
    end if;
  end;

  reset role;

  if not v_ok then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: возврат админского архива не отклонён кодом '
      '42501 (получено «%», «%»)', v_state, v_msg;
  end if;

  -- Текст ведёт к правке, а не в поддержку: это прямое требование
  -- продуктовой логики, и проверяется оно здесь, потому что в UI
  -- сообщение подменяется своим и расхождение осталось бы незамеченным.
  if v_msg ilike '%поддержк%' then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: сообщение отсылает в поддержку — «%»', v_msg;
  end if;

  if v_msg not ilike '%повторную модерацию%' then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: сообщение не называет путь через повторную '
      'модерацию — «%»', v_msg;
  end if;

  select c.status::text into v_status from public.cars c where c.id = v_car;

  if v_status <> 'archived' then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: после отклонённого вызова статус «%»', v_status;
  end if;

  raise notice 'ТЕСТ 1 ok: прямой возврат закрыт, текст ведёт к правке';
end $$;


-- ============================================================
-- ТЕСТ 2. КОНТРОЛЬ: СВОЙ АРХИВ ВОЗВРАЩАЕТСЯ
-- ============================================================
do $$
declare
  v_car    uuid;
  v_status text;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f100-0000000000c2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c2');
  set local role authenticated;

  perform public.set_my_car_status(v_car, 'archived');
  perform public.set_my_car_status(v_car, 'active');

  reset role;

  select c.status::text into v_status from public.cars c where c.id = v_car;

  if v_status <> 'active' then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: владелец не смог вернуть СВОЁ снятое '
      'объявление, статус «%»', v_status;
  end if;

  raise notice 'ТЕСТ 2 ok: свой архив по-прежнему возвращается';
end $$;


-- ============================================================
-- ТЕСТ 3. СУЩЕСТВЕННАЯ ПРАВКА → ПОВТОРНАЯ МОДЕРАЦИЯ
-- ============================================================
-- Главный сценарий этой миграции: владелец исправляет замечание и
-- объявление уходит в очередь, а не остаётся навсегда в архиве.
do $$
declare
  v_car     uuid;
  v_status  text;
  v_by      text;
  v_reason  text;
  v_ret     text;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f100-0000000000c2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c1');
  set local role authenticated;

  perform public.admin_set_car_status(
    v_car, 'archived', 'уберите номер телефона из текста описания'
  );

  reset role;

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c2');
  set local role authenticated;

  -- Владелец исправляет замечание.
  v_ret := pg_temp.edit_car(v_car, 'Описание без телефона. Автомобиль в отличном состоянии.');

  reset role;

  select c.status::text, c.archived_by::text, c.archived_reason
    into v_status, v_by, v_reason
    from public.cars c where c.id = v_car;

  if v_status <> 'moderation' then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: после правки статус «%», ожидался moderation. '
      'Владельцу некуда девать снятое объявление.', v_status;
  end if;

  -- Функция обязана вернуть тот же статус: кабинет по нему решает,
  -- показывать ли баннер «ушло на повторную проверку».
  if v_ret is distinct from 'moderation' then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: update_car_v3 вернула статус «%», а в строке '
      '«%» — клиент покажет неверный баннер', v_ret, v_status;
  end if;

  -- Метки прежнего решения сняты: начался новый цикл проверки.
  if v_by is not null or v_reason is not null then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: archived_by = «%», archived_reason = «%», '
      'ожидались null', v_by, v_reason;
  end if;

  raise notice 'ТЕСТ 3 ok: правка отправляет на повторную модерацию';
end $$;


-- ============================================================
-- ТЕСТ 4. ПРАВКА БЕЗ ИЗМЕНЕНИЙ НЕ ВЫВОДИТ ИЗ АРХИВА
-- ============================================================
-- Без этой проверки «Сохранить» без единого исправления работало бы
-- как кнопка «оспорить решение»: снятое объявление можно было бы
-- гонять по очереди модерации, ничего не меняя.
do $$
declare
  v_car    uuid;
  v_status text;
  v_by     text;
  v_reason text;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f100-0000000000c2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c1');
  set local role authenticated;

  perform public.admin_set_car_status(
    v_car, 'archived', 'фотографии не соответствуют автомобилю'
  );

  reset role;

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c2');
  set local role authenticated;

  -- Сохраняем ТО ЖЕ описание, что уже в объявлении.
  perform pg_temp.edit_car(v_car, 'Прежнее описание объявления.');

  reset role;

  select c.status::text, c.archived_by::text, c.archived_reason
    into v_status, v_by, v_reason
    from public.cars c where c.id = v_car;

  if v_status <> 'archived' then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: правка без изменений вывела объявление из '
      'архива в «%»', v_status;
  end if;

  if v_by is distinct from 'admin' or v_reason is null then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: метки решения потеряны (archived_by = «%», '
      'причина «%») — карточка перестанет показывать, за что сняли',
      v_by, v_reason;
  end if;

  raise notice 'ТЕСТ 4 ok: пустое сохранение не выводит из архива';
end $$;


-- ============================================================
-- ТЕСТ 5. АВТОПУБЛИКАЦИЯ ПОСЛЕ ПРАВКИ АДМИНСКОГО АРХИВА
-- ============================================================
-- Второй путь обхода, открывшийся вместе с правкой из архива: салон
-- с автопубликацией мог бы вернуть снятое объявление в выдачу, просто
-- добавив фотографию.
do $$
declare
  v_car    uuid;
  v_ctrl   uuid;
  v_status text;
  v_reason text;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f100-0000000000c3', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c1');
  set local role authenticated;

  perform public.admin_set_car_status(
    v_car, 'archived', 'в описании реклама стороннего сайта'
  );

  reset role;

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c3');
  set local role authenticated;

  -- Салон правит объявление — оно уходит на модерацию.
  perform pg_temp.edit_car(v_car, 'Описание без рекламы. Сервисная книжка, один владелец.');

  reset role;

  select c.status::text into v_status from public.cars c where c.id = v_car;

  if v_status <> 'moderation' then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН (подготовка): статус «%», ожидался moderation',
      v_status;
  end if;

  -- И добавляет фотографию — срабатывает триггер автопубликации.
  insert into public.car_images (car_id, image_url, order_index)
  values (v_car, 'https://example.test/ed-photo.jpg', 0);

  select c.status::text into v_status from public.cars c where c.id = v_car;

  if v_status <> 'moderation' then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: объявление, снятое администратором, вернулось '
      'в выдачу автопубликацией (статус «%»). Решение модератора '
      'обойдено с другой стороны.', v_status;
  end if;

  select l.payload->>'reason'
    into v_reason
    from public.admin_action_log l
   where l.target_id = v_car
     and l.action    = 'car_autopublish_skipped'
   order by l.created_at desc
   limit 1;

  if v_reason is null or v_reason not ilike '%решение модератора%' then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: в журнале причина «%», ожидалась про решение '
      'модератора', v_reason;
  end if;

  -- КОНТРОЛЬ: объявление без истории решений публикуется как прежде.
  v_ctrl := pg_temp.mk_car('00000000-0000-4000-f100-0000000000c3', 'moderation');

  insert into public.car_images (car_id, image_url, order_index)
  values (v_ctrl, 'https://example.test/ed-clean.jpg', 0);

  select c.status::text into v_status from public.cars c where c.id = v_ctrl;

  if v_status <> 'active' then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН (контроль): чистое объявление доверенного '
      'салона получило «%», ожидался active — автопубликация сломана '
      'целиком', v_status;
  end if;

  raise notice 'ТЕСТ 5 ok: барьер держит, обычная автопубликация жива';
end $$;


-- ============================================================
-- ТЕСТ 5а. ЗАМЕНА ФОТОГРАФИЙ ПРИ ПРАВКЕ ИЗ АДМИНСКОГО АРХИВА
-- ============================================================
-- Самый частый повод для снятия — именно фотографии («на снимках
-- другой автомобиль», «чужое фото»), и исправить замечание значит
-- удалить один снимок и добавить другой. Если набор фото в статусе
-- archived не заменяется, весь цикл правки бесполезен: продавец не
-- может устранить то, за что его сняли.
--
-- Проверяется полная замена: старого снимка в car_images не остаётся,
-- новые лежат в переданном порядке (первый — обложка), объявление
-- уходит на модерацию, метки архива сброшены.
do $$
declare
  v_car     uuid;
  v_status  text;
  v_by      text;
  v_reason  text;
  v_photos  text[];
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f100-0000000000c2', 'active');

  -- Исходный набор: два снимка, один из которых и вызвал замечание.
  insert into public.car_images (car_id, image_url, order_index)
  values
    (v_car, 'https://example.test/old-wrong-car.jpg', 0),
    (v_car, 'https://example.test/old-keep.jpg',      1);

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c1');
  set local role authenticated;

  perform public.admin_set_car_status(
    v_car, 'archived', 'на первом снимке другой автомобиль, замените фото'
  );

  reset role;

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c2');
  set local role authenticated;

  -- Владелец удаляет бракованный снимок и добавляет новый.
  -- Порядок в массиве = order_index: новый снимок становится обложкой.
  perform pg_temp.edit_car(
    v_car,
    'Прежнее описание объявления.',        -- текст НЕ меняем
    array[
      'https://example.test/new-correct-car.jpg',
      'https://example.test/old-keep.jpg'
    ]
  );

  reset role;

  select c.status::text, c.archived_by::text, c.archived_reason
    into v_status, v_by, v_reason
    from public.cars c where c.id = v_car;

  -- Замена фотографий — существенная правка сама по себе, даже когда
  -- ни одно текстовое поле не тронуто: покупатель видит прежде всего
  -- снимки, и модератор обязан их проверить.
  if v_status <> 'moderation' then
    raise exception
      'ТЕСТ 5а ПРОВАЛЕН: после замены фотографий статус «%», ожидался '
      'moderation. Замена фото не считается изменением контента.',
      v_status;
  end if;

  if v_by is not null or v_reason is not null then
    raise exception
      'ТЕСТ 5а ПРОВАЛЕН: метки архива не сброшены (archived_by = «%», '
      'причина «%»)', v_by, v_reason;
  end if;

  select array_agg(ci.image_url order by ci.order_index)
    into v_photos
    from public.car_images ci
   where ci.car_id = v_car;

  if array_length(v_photos, 1) is distinct from 2 then
    raise exception
      'ТЕСТ 5а ПРОВАЛЕН: в объявлении % фотографий, ожидалось 2',
      coalesce(array_length(v_photos, 1), 0);
  end if;

  -- Удалённый снимок не должен остаться ни на какой позиции.
  if 'https://example.test/old-wrong-car.jpg' = any(v_photos) then
    raise exception
      'ТЕСТ 5а ПРОВАЛЕН: удалённая фотография осталась в объявлении — '
      'замечание модератора не устранено, набор = %', v_photos;
  end if;

  -- Порядок: новый снимок первый, значит он и обложка в каталоге.
  if v_photos[1] <> 'https://example.test/new-correct-car.jpg' then
    raise exception
      'ТЕСТ 5а ПРОВАЛЕН: обложкой стал «%», ожидался новый снимок',
      v_photos[1];
  end if;

  if v_photos[2] <> 'https://example.test/old-keep.jpg' then
    raise exception
      'ТЕСТ 5а ПРОВАЛЕН: второй снимок «%», ожидался сохранённый',
      v_photos[2];
  end if;

  raise notice 'ТЕСТ 5а ok: фотографии заменились, объявление на проверке';
end $$;


-- ============================================================
-- ТЕСТ 6. СВОЙ АРХИВ НЕ РЕДАКТИРУЕТСЯ НАПРЯМУЮ
-- ============================================================
-- Для него путь другой и короче: «Вернуть» → правка опубликованного.
-- Два пути к одному результату с разным поведением статуса сбивали бы
-- продавца с толку.
do $$
declare
  v_car uuid;
  v_ok  boolean := false;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f100-0000000000c2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c2');
  set local role authenticated;

  perform public.set_my_car_status(v_car, 'archived');

  begin
    perform pg_temp.edit_car(v_car, 'Попытка правки своего архива.');
  exception when others then
    if sqlstate = '23514' then   -- check_violation
      v_ok := true;
    else
      raise exception
        'ТЕСТ 6 ПРОВАЛЕН: правка своего архива отклонена кодом «%», '
        'ожидался 23514', sqlstate;
    end if;
  end;

  reset role;

  if not v_ok then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: свой архив отредактировался напрямую, минуя '
      'возврат в публикацию';
  end if;

  raise notice 'ТЕСТ 6 ok: свой архив правится только после возврата';
end $$;


-- ============================================================
-- ТЕСТ 7. ПРИЧИНА СНЯТИЯ — ТОЛЬКО ВЛАДЕЛЬЦУ И АДМИНУ
-- ============================================================
-- Страница снятого объявления публична (0072), и внутреннее решение
-- площадки о конкретном человеке не должно попадать постороннему.
do $$
declare
  v_car     uuid;
  v_by      text;
  v_reason  text;
begin
  v_car := pg_temp.mk_car('00000000-0000-4000-f100-0000000000c2', 'active');

  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c1');
  set local role authenticated;

  perform public.admin_set_car_status(
    v_car, 'archived', 'подозрение на скрученный пробег автомобиля'
  );

  reset role;

  -- --- Владелец видит ---
  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c2');
  set local role authenticated;

  select d.archived_by, d.archived_reason
    into v_by, v_reason
    from public.get_car_details(v_car) d;

  reset role;

  if v_by is distinct from 'admin' or v_reason is null then
    raise exception
      'ТЕСТ 7 ПРОВАЛЕН: владелец не видит авторства снятия '
      '(archived_by = «%», причина «%») — страница правки не отличит '
      'админский архив от своего', v_by, v_reason;
  end if;

  -- --- Посторонний не видит ---
  perform pg_temp.act_as('00000000-0000-4000-f100-0000000000c4');
  set local role authenticated;

  select d.archived_by, d.archived_reason
    into v_by, v_reason
    from public.get_car_details(v_car) d;

  reset role;

  if v_by is not null or v_reason is not null then
    raise exception
      'ТЕСТ 7 ПРОВАЛЕН: посторонний видит причину снятия '
      '(archived_by = «%», причина «%»)', v_by, v_reason;
  end if;

  raise notice 'ТЕСТ 7 ok: причина снятия видна только своим';
end $$;


-- ------------------------------------------------------------
-- Откат: тест не оставляет следов в базе.
-- ------------------------------------------------------------
rollback;

\echo ''
\echo '================================================='
\echo 'ТЕСТЫ ПРАВКИ ИЗ АДМИНСКОГО АРХИВА ПРОЙДЕНЫ. Откачено.'
\echo '================================================='
