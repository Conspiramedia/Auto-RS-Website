-- ============================================================
-- AUTO.RS — Миграция 0090: правка объявления из админского архива
-- ============================================================
-- ЧТО УЖЕ СДЕЛАНО В 0089 И ЗДЕСЬ НЕ ПОВТОРЯЕТСЯ. Авторство снятия
-- (cars.archived_by / archived_reason), запрет владельцу возвращать
-- админский архив, письмо о снятии, журнал по каждому объявлению при
-- блокировке салона, единый триггер гашения продвижения и запись
-- car_restored_by_owner — всё это применено и работает. Эта миграция
-- меняет только продуктовый ИСХОД для владельца.
--
-- ПРОБЛЕМА 0089. Владелец, у которого администратор снял объявление,
-- упирался в тупик: причина видна, но сделать с ней нечего. Текст
-- ошибки отсылал в поддержку, то есть переводил в ручной канал
-- ситуацию, которую продавец способен решить сам — замечание обычно
-- в том, что надо заменить фотографию или убрать телефон из описания.
-- Поддержка при этом всё равно не может «вернуть» объявление, не
-- перепроверив его, — то есть цепочка всё равно упиралась в модератора,
-- только через лишнего человека.
--
-- РЕШЕНИЕ. Объявление, снятое администратором, редактируется. Правка
-- по существу отправляет его на повторную модерацию — обычным путём,
-- тем же, каким идёт исправление отклонённого. Прямого возврата в пул
-- по-прежнему нет: решение администратора отменяет либо администратор,
-- либо новая проверка.
--
-- ИТОГОВЫЙ ЦИКЛ ДЛЯ ВЛАДЕЛЬЦА:
--   admin_set_car_status → archived + причина
--     → владелец видит причину и кнопку «Редактировать»
--     → update_car_v3 с изменённым контентом
--     → moderation, метки архива сброшены
--     → approve_car / reject_car — обычная очередь модерации.
--
-- ЧТО ВНУТРИ:
--   1) set_my_car_status — новый текст ошибки 42501, без поддержки;
--   2) update_car_v3 — принимает archived при archived_by = 'admin';
--   3) f_car_autopublish — барьер расширен: не публикуются
--      автоматически и те объявления, которые администратор СНИМАЛ,
--      а не только отклонял;
--   4) get_car_details — отдаёт archived_by/archived_reason владельцу
--      и админу: без них страница правки не отличает админский архив
--      от владельческого и не пускает в форму.
--
-- ЧЕГО ЗДЕСЬ НЕТ (осознанная отсрочка, как и в 0089):
--   * revoke update on public.cars — приложение меняет статус прямым
--     UPDATE (cars_repository.dart:301);
--   * revoke execute on update_car_v2 — приложение её вызывает
--     (cars_repository.dart:272). Проверено поиском по репозиторию
--     приложения при подготовке этой миграции.
-- ============================================================

begin;


-- ############################################################
-- 1) set_my_car_status — текст отказа ведёт к правке, а не в тупик
-- ############################################################
-- Меняется РОВНО ОДНА строка тела — сообщение об ошибке. Функция
-- пересоздаётся целиком, потому что иначе нельзя: create or replace
-- не умеет патчить часть тела. Остальное — матрица переходов, метка
-- owner, запись car_restored_by_owner — переносится из 0089 дословно.
--
-- ПОЧЕМУ ТЕКСТ ВАЖЕН НАСТОЛЬКО, ЧТО РАДИ НЕГО ИДЁТ МИГРАЦИЯ. Это
-- единственное, что видит продавец, если он всё-таки дошёл до
-- запрещённого перехода (например, из приложения, где кнопка ещё не
-- скрыта). «Обратитесь в поддержку» отправляет его писать письмо;
-- «исправьте замечания и отправьте на повторную модерацию» —
-- открывать форму правки. Второе решает задачу продавца за минуту и
-- не создаёт обращения, на которое всё равно ответят «отредактируйте».
-- ============================================================
create or replace function public.set_my_car_status(
  p_car_id uuid,
  p_status text
)
returns table (
  id            uuid,
  status        text,
  boosted_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_car  public.cars;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку: два параллельных нажатия («Продано» и «Снять»)
  -- не должны разойтись в гонке. Эта же блокировка сериализует
  -- владельца с администратором.
  select c.* into v_car
    from public.cars c
   where c.id = p_car_id
   for update;

  if v_car.id is null then
    raise exception 'Объявление не найдено'
      using errcode = 'no_data_found';
  end if;

  -- Владелец — и только он. Проверка идёт ДО матрицы переходов, чтобы
  -- по тексту ошибки нельзя было выяснить статус чужого объявления.
  if v_car.user_id <> v_user then
    raise exception 'Нельзя менять статус чужого объявления'
      using errcode = 'insufficient_privilege';
  end if;

  -- Матрица допустимых переходов. Белый список.
  if not (
       (v_car.status = 'active'     and p_status in ('archived', 'sold'))
    or (v_car.status = 'archived'   and p_status = 'active')
    or (v_car.status = 'sold'       and p_status = 'active')
    or (v_car.status = 'moderation' and p_status = 'archived')
    or (v_car.status = 'rejected'   and p_status = 'archived')
  ) then
    raise exception 'Недопустимый переход статуса: % → %', v_car.status, p_status
      using errcode = 'check_violation';
  end if;

  -- РЕШЕНИЕ АДМИНИСТРАТОРА ВЛАДЕЛЬЦУ НЕ ОТМЕНИТЬ ПРЯМЫМ ВОЗВРАТОМ.
  -- Но и тупика нет: путь назад в выдачу открыт через правку и
  -- повторную модерацию (update_car_v3, см. ниже). Текст ошибки
  -- называет этот путь прямо.
  if v_car.status = 'archived'
     and p_status = 'active'
     and v_car.archived_by is not null
     and v_car.archived_by <> 'owner'
  then
    raise exception 'Объявление снято администратором — исправьте замечания и отправьте на повторную модерацию'
      using errcode = 'insufficient_privilege';
  end if;

  -- Гашение продвижения выполняет триггер trg_cars_status_side_effects
  -- (0089) для всех путей сразу.
  update public.cars c
     set status = p_status::car_status,
         archived_by = case
                         when p_status = 'archived' then 'owner'::public.archived_by_kind
                         else c.archived_by   -- сброс делает триггер
                       end,
         archived_reason = case
                             when p_status = 'archived' then null
                             else c.archived_reason
                           end
   where c.id = p_car_id;

  -- Возврат из архива — в журнал: модератор должен видеть, что снятое
  -- объявление снова в выдаче.
  if v_car.status = 'archived' and p_status = 'active' then
    perform public.f_admin_log(
      'car_restored_by_owner',
      'cars',
      p_car_id,
      jsonb_build_object(
        'prev_archived_by', v_car.archived_by,
        'user_id',          v_car.user_id,
        'brand',            v_car.brand,
        'model',            v_car.model
      )
    );
  end if;

  return query
    select c.id, c.status::text, c.boosted_until
      from public.cars c
     where c.id = p_car_id;
end;
$fn$;

comment on function public.set_my_car_status(uuid, text)
  is 'Смена статуса своего объявления по матрице переходов. Возврат из архива — только своего снятия; админский архив исправляется правкой и повторной модерацией (0090)';

grant execute on function public.set_my_car_status(uuid, text) to authenticated;


-- ############################################################
-- 2) update_car_v3 — правка объявления, снятого администратором
-- ############################################################
-- ЧТО МЕНЯЕТСЯ ОТНОСИТЕЛЬНО 0067:
--   + в список редактируемых статусов добавлен 'archived', но НЕ
--     любой: только тот, что снял администратор (archived_by =
--     'admin'). Владельческий архив по-прежнему правится не сразу —
--     его сначала возвращают в публикацию кнопкой «Вернуть», которая
--     для него доступна и работает.
--   + существенная правка админского архива переводит объявление в
--     'moderation' и СБРАСЫВАЕТ archived_by/archived_reason: начался
--     новый цикл проверки, и прежнее решение администратора больше не
--     висит на объявлении.
--   + несущественная правка (контент не изменился) оставляет
--     объявление в архиве. Иначе сохранение формы без единого
--     изменения выводило бы снятое объявление в очередь модерации —
--     то есть кнопка «Сохранить» работала бы как «оспорить решение»,
--     и снятое объявление можно было бы гонять по кругу, ничего не
--     исправляя.
--
-- ПОЧЕМУ ВЛАДЕЛЬЧЕСКИЙ АРХИВ СЮДА НЕ ПОПАЛ. Для него правка не нужна:
-- владелец возвращает объявление в active одним нажатием и правит уже
-- опубликованное. Разрешить правку прямо из архива значило бы завести
-- второй путь к тому же результату — с другим поведением статуса
-- (уход на модерацию вместо мгновенного возврата), и продавец не смог
-- бы предсказать, что произойдёт после «Сохранить».
--
-- ПРОДАННОЕ (sold) НЕ РЕДАКТИРУЕТСЯ, как и раньше: правка условий
-- завершённой сделки задним числом.
--
-- Сигнатура и состав возвращаемых колонок НЕ меняются.
-- ============================================================
create or replace function public.update_car_v3(
  p_car_id           uuid,
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
  p_photo_urls       text[]            default null,
  p_body_type        body_type         default null,
  p_transmission     transmission_type default null,
  p_fuel             fuel_type         default null,
  p_description      text              default null,
  p_phone            text              default null
)
returns table (
  id            uuid,
  status        text,
  boosted_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user_id   uuid := auth.uid();
  v_car       public.cars;
  v_is_sale   boolean := false;
  v_is_rent   boolean := false;
  v_sale      numeric;
  v_rent      numeric;
  v_deposit   numeric;
  v_location  geography(point, 4326);
  v_desc      text;
  v_phone     text;
  v_url       text;
  v_idx       integer := 0;
  v_changed   boolean := false;
  v_old_photos text[];
  -- Правка идёт из архива, снятого администратором: от этого зависит
  -- и допуск к правке, и то, куда уедет статус.
  v_from_admin_archive boolean := false;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку: параллельные сохранения из двух вкладок не
  -- должны перемешать поля одного объявления.
  select c.* into v_car
    from public.cars c
   where c.id = p_car_id
   for update;

  if v_car.id is null then
    raise exception 'Объявление не найдено'
      using errcode = 'no_data_found';
  end if;

  -- Владелец — и только он.
  if v_car.user_id <> v_user_id then
    raise exception 'Нельзя редактировать чужое объявление'
      using errcode = 'insufficient_privilege';
  end if;

  v_from_admin_archive :=
    v_car.status = 'archived'
    and v_car.archived_by = 'admin'::public.archived_by_kind;

  -- Редактировать можно рабочие статусы и админский архив (0090).
  -- Проданное и СВОЙ архив сначала возвращают в публикацию
  -- (set_my_car_status): для них путь короче и предсказуемее.
  if v_car.status not in ('moderation', 'rejected', 'active')
     and not v_from_admin_archive
  then
    raise exception 'Объявление нельзя редактировать: статус = %', v_car.status
      using errcode = 'check_violation';
  end if;

  -- ---------- ВАЛИДАЦИЯ: дословно как в create_car_v3 ----------
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

  -- Значения, которые лягут в строку. Считаем ДО сравнения, чтобы
  -- сравнивать ровно то, что будет записано.
  v_sale    := case when v_is_sale then p_sale_price end;
  v_rent    := case when v_is_rent then p_rent_price_daily end;
  v_deposit := case when v_is_rent then coalesce(p_deposit_amount, 0) else 0 end;
  v_desc    := nullif(btrim(coalesce(p_description, '')), '');
  v_phone   := nullif(btrim(coalesce(p_phone, '')), '');

  if p_lat is not null and p_lng is not null then
    v_location := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  -- ---------- Изменился ли контент ----------
  -- is distinct from вместо <>: обычное сравнение с NULL даёт NULL, и
  -- правка «была цена — стало пусто» осталась бы незамеченной.
  v_changed :=
       v_car.is_for_sale      is distinct from v_is_sale
    or v_car.is_for_rent      is distinct from v_is_rent
    or v_car.brand            is distinct from p_brand
    or v_car.model            is distinct from p_model
    or v_car.year             is distinct from p_year
    or v_car.mileage          is distinct from p_mileage
    or v_car.body_type        is distinct from p_body_type
    or v_car.transmission     is distinct from p_transmission
    or v_car.fuel             is distinct from p_fuel
    or v_car.currency         is distinct from coalesce(p_currency, 'EUR')::currency_code
    or v_car.sale_price       is distinct from v_sale
    or v_car.rent_price_daily is distinct from v_rent
    or v_car.deposit_amount   is distinct from v_deposit
    or v_car.city             is distinct from p_city
    or v_car.description      is distinct from v_desc
    or v_car.contact_phone    is distinct from v_phone;

  -- Фотографии сравниваем отдельно и только если их прислали.
  if not v_changed and p_photo_urls is not null then
    select coalesce(array_agg(ci.image_url order by ci.order_index), '{}')
      into v_old_photos
      from public.car_images ci
     where ci.car_id = p_car_id;

    if v_old_photos is distinct from p_photo_urls then
      v_changed := true;
    end if;
  end if;

  -- ---------- Запись ----------
  update public.cars c
     set is_for_sale      = v_is_sale,
         is_for_rent      = v_is_rent,
         brand            = p_brand,
         model            = p_model,
         year             = p_year,
         mileage          = p_mileage,
         body_type        = p_body_type,
         transmission     = p_transmission,
         fuel             = p_fuel,
         currency         = coalesce(p_currency, 'EUR')::currency_code,
         sale_price       = v_sale,
         rent_price_daily = v_rent,
         deposit_amount   = v_deposit,
         city             = p_city,
         description      = v_desc,
         contact_phone    = v_phone,
         location         = v_location,
         -- Контент изменился — объявление уходит на проверку, прежняя
         -- причина отклонения теряет смысл. Это одинаково верно и для
         -- обычной правки, и для правки админского архива: во втором
         -- случае повторная модерация и есть способ вернуться в пул.
         status = case when v_changed then 'moderation'::car_status
                       else c.status end,
         moderation_comment = case when v_changed then null
                                   else c.moderation_comment end,
         -- Метки архива снимаются вместе с уходом на модерацию.
         -- Формально это же сделал бы триггер (0089 гасит их при
         -- выходе из archived), но полагаться на него здесь нельзя:
         -- при несущественной правке статус не меняется, триггер не
         -- срабатывает вовсе, и метки обязаны остаться на месте.
         -- Явное выражение описывает оба случая сразу.
         archived_by = case when v_changed then null
                            else c.archived_by end,
         archived_reason = case when v_changed then null
                                else c.archived_reason end,
         -- Продвижение гасится вместе с уходом на модерацию: наверху
         -- выдачи не должно стоять непроверенное содержимое.
         is_vip = case when v_changed then false else c.is_vip end,
         boosted_until = case when v_changed then null
                              else c.boosted_until end
   where c.id = p_car_id;

  -- ---------- Полная замена набора фотографий ----------
  if p_photo_urls is not null then
    delete from public.car_images where car_id = p_car_id;

    foreach v_url in array p_photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (p_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  -- Возвращаем актуальное состояние: кабинету нужно понять, ушло ли
  -- объявление на модерацию, и перерисовать бейдж без второго запроса.
  return query
    select c.id, c.status::text, c.boosted_until
      from public.cars c
     where c.id = p_car_id;
end;
$fn$;

comment on function public.update_car_v3(
  uuid, text, text, text, integer, integer, numeric, numeric, numeric,
  text, text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text
) is 'Редактирование своего объявления. Принимает и админский архив: существенная правка отправляет его на повторную модерацию (0090)';

grant execute on function public.update_car_v3(
  uuid, text, text, text, integer, integer, numeric, numeric, numeric,
  text, text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text
) to authenticated;


-- ############################################################
-- 3) К7. Барьер автопубликации — и для снятых, не только отклонённых
-- ############################################################
-- ЧТО БЫЛО В 0089. Автопубликация не срабатывала для объявлений, по
-- которым в журнале есть запись car_rejected: модератор, однажды
-- отклонивший объявление, обязан увидеть исправленный вариант.
--
-- ЧЕГО НЕ ХВАТАЛО. С появлением правки из админского архива (блок 2
-- выше) открылся второй путь к тому же обходу, и до этой миграции его
-- не было:
--   1) администратор СНИМАЕТ объявление доверенного салона
--      (admin_set_car_status → archived, причина);
--   2) салон правит его — статус уходит в moderation;
--   3) салон меняет набор фотографий — срабатывает триггер
--      автопубликации, и объявление возвращается в выдачу, минуя
--      модератора, который его только что снял.
-- То есть ровно тот конфликт «младшая роль отменяет старшую», ради
-- которого затевалась вся работа, вернулся бы с другой стороны — и
-- именно у доверенных салонов, где цена ошибки выше.
--
-- РЕШЕНИЕ. Признак расширяется с одного действия до двух:
-- car_rejected ИЛИ car_archived в журнале по этому объявлению. Оба
-- пишутся только администраторскими путями (reject_car,
-- admin_set_car_status, admin_block_dealer — все из 0078/0080/0089),
-- поэтому запись означает ровно «по этому объявлению было решение
-- администратора». Владельческое снятие в журнал не пишется вовсе,
-- и обычный цикл «снял на неделю — вернул — добавил фото» под барьер
-- не попадает.
--
-- Журнал остаётся источником признака по той же причине, что в 0089:
-- поле в строке пришлось бы либо чистить при правке (и тогда оно
-- ничего не помнит), либо не чистить никогда. Нового значения в
-- car_status не появляется.
-- ============================================================
create or replace function public.f_car_autopublish()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_car     public.cars;
  v_trusted boolean;
  v_kind    text;
  v_reason  text;
begin
  -- Блокируем строку объявления: две фотографии могут вставляться
  -- параллельно, и без блокировки обе ветки прочитали бы статус
  -- 'moderation' и обе попытались бы опубликовать.
  select c.* into v_car
    from public.cars c
   where c.id = new.car_id
   for update;

  if v_car.id is null then
    return new;
  end if;

  -- Работаем ТОЛЬКО с объявлением, ждущим проверки. Это же условие
  -- отсекает второе и последующие фото.
  if v_car.status <> 'moderation' then
    return new;
  end if;

  -- ---------- Право на автопубликацию ----------
  select p.seller_kind, p.trusted_seller
    into v_kind, v_trusted
    from public.profiles p
   where p.id = v_car.user_id;

  -- Частник не получает автопубликацию НИКОГДА, даже если флаг
  -- trusted_seller каким-то образом выставлен.
  if v_kind is distinct from 'dealer' or v_trusted is not true then
    return new;
  end if;

  -- ---------- К7: объявление с историей решений администратора ----------
  -- Проверяем ДО авто-валидации: результат один и тот же (объявление
  -- остаётся в очереди), но причина в журнале должна быть именно эта.
  -- Модератор, однажды отклонивший ИЛИ снявший объявление, обязан
  -- увидеть исправленный вариант своими глазами — независимо от того,
  -- проходит ли тот формальную проверку.
  if exists (
    select 1
      from public.admin_action_log l
     where l.target_table = 'cars'
       and l.target_id    = v_car.id
       and l.action in ('car_rejected', 'car_archived')
  ) then
    v_reason := 'по объявлению есть решение модератора';
  else
    -- ---------- Авто-валидация ----------
    v_reason := public.f_car_autopublish_check(v_car);
  end if;

  if v_reason is not null then
    -- НЕ отклоняем — оставляем в очереди.
    --
    -- Пишем НАПРЯМУЮ, а не через f_admin_log: тот берёт актора из
    -- auth.uid() и предназначен для действий администратора. Здесь
    -- действует система, и актором записан сам салон.
    insert into public.admin_action_log
      (actor_id, action, target_table, target_id, payload)
    values (
      v_car.user_id,
      'car_autopublish_skipped',
      'cars',
      v_car.id,
      jsonb_build_object(
        'dealer_id', v_car.user_id,
        'reason',    v_reason,
        'brand',     v_car.brand,
        'model',     v_car.model
      )
    );

    -- Уведомление салону в кабинет. Без него объявление молча уходит
    -- в очередь, а салон ждёт публикации, которая не наступает.
    insert into public.notifications (user_id, title, body, type, action_id)
    values (
      v_car.user_id,
      'Объявление отправлено на проверку',
      format(
        '%s %s не прошло автоматическую проверку (%s) и ждёт модератора.',
        v_car.brand, v_car.model, v_reason
      ),
      'car_autopublish_skipped',
      v_car.id
    );

    return new;
  end if;

  -- ---------- Публикация ----------
  perform set_config('rs_auto.skip_moderation_email', 'on', true);

  update public.cars
     set status             = 'active',
         moderation_comment = null,
         updated_at         = now()
   where id = v_car.id;

  perform set_config('rs_auto.skip_moderation_email', 'off', true);

  insert into public.admin_action_log
    (actor_id, action, target_table, target_id, payload)
  values (
    v_car.user_id,
    'car_auto_approved',
    'cars',
    v_car.id,
    jsonb_build_object(
      'dealer_id', v_car.user_id,
      'brand',     v_car.brand,
      'model',     v_car.model,
      'year',      v_car.year
    )
  );

  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_car.user_id,
    'Объявление опубликовано',
    format('%s %s опубликовано без модерации', v_car.brand, v_car.model),
    'car_approved',
    v_car.id
  );

  return new;
end;
$fn$;

comment on function public.f_car_autopublish()
  is 'Автопубликация объявления доверенного салона. Не срабатывает, если по объявлению есть решение модератора — отклонение или снятие (0090)';

-- Триггер tg_car_autopublish (0086) висит на этой же функции и
-- подхватывает новое тело — пересоздавать не нужно.


-- ############################################################
-- 4) get_car_details — авторство снятия для страницы правки
-- ############################################################
-- ЗАЧЕМ. Страница /my/listing/[id]/edit решает по этой функции,
-- показывать форму или отдать 404. С появлением правки из админского
-- архива ей нужно отличать его от владельческого, а поля в ответе
-- не было — гейт молча не пускал бы владельца в форму, и вся цепочка
-- «причина → Редактировать → повторная модерация» обрывалась бы на
-- втором шаге.
--
-- ВИДИМОСТЬ ПОЛЕЙ — КАК У ОПИСАНИЯ И ЦЕН. Причина снятия видна
-- только владельцу и администратору (full_access). Постороннему,
-- пришедшему по ссылке из поисковой выдачи, показывать «снято за
-- накрутку пробега» нельзя: это внутреннее решение площадки о
-- конкретном человеке, а страница снятого объявления публична.
--
-- Порядок существующих колонок сохранён, новые добавлены в конец —
-- приложение (CarDetailsModel.fromMap) читает ответ по именам и
-- лишние поля игнорирует.
--
-- Сигнатура returns table меняется, поэтому функцию нужно удалить
-- перед пересозданием: CREATE OR REPLACE не умеет менять состав
-- возвращаемых колонок.
-- ============================================================
drop function if exists public.get_car_details(uuid);

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
    or v.status in ('archived', 'rejected', 'moderation')
    -- Владельцу и администратору — всё и всегда.
    or v.full_access;
$$;

comment on function public.get_car_details(uuid)
  is 'Карточка объявления. Активные и проданные — полностью; снятые/отклонённые/на проверке — без цен, описания, контактов и витрины продавца; владельцу и админу — всё, включая авторство и причину снятия';

grant execute on function public.get_car_details(uuid) to anon, authenticated;

commit;


-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ
-- ============================================================
-- Автоматическая: supabase/checks/0090_edit_from_admin_archive_test.sql
--   npm run test:sql
--
-- Вручную, полный цикл:
--   1) админ:    select * from public.admin_set_car_status(
--                  '<car_id>', 'archived', 'уберите телефон из описания');
--      → status = 'archived', archived_by = 'admin'.
--   2) владелец: select * from public.set_my_car_status('<car_id>', 'active');
--      → 42501 «…исправьте замечания и отправьте на повторную модерацию».
--   3) владелец: select * from public.update_car_v3('<car_id>', 'sale', …
--                  с изменённым описанием …);
--      → status = 'moderation', archived_by = null, archived_reason = null.
--   4) админ:    select * from public.approve_car('<car_id>');
--      → status = 'active'.
-- ============================================================
