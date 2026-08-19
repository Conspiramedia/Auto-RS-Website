-- ============================================================
-- AUTO.RS — Миграция 0067: редактирование объявления (update_car_v3)
-- ============================================================
-- ЗАЧЕМ НУЖНА ТРЕТЬЯ ВЕРСИЯ. Редактирование сейчас идёт через
-- update_car_v2 (миграция 0039), а она принимает ОДНУ цену:
--
--   update_car_v2(..., listing_type text, price numeric, ...)
--
-- и раскладывает её по типу сделки. При listing_type = 'both' одно и то
-- же число попадает и в sale_price, и в rent_price_daily — то есть цена
-- продажи автомобиля становится равной суточной ставке аренды. Ровно эту
-- ошибку уже исправили при СОЗДАНИИ объявления (create_car_v3, миграция
-- 0055), а редактирование осталось на старом контракте.
--
-- Вдобавок v2 не знает про залог (deposit_amount): продавец, указавший
-- залог при подаче, терял бы его при первой же правке.
--
-- ЭТА ФУНКЦИЯ — ЗЕРКАЛО create_car_v3 ДЛЯ UPDATE. Набор параметров и
-- правила валидации совпадают дословно, отличается только то, что
-- специфично для правки: проверка владельца, поведение статуса и замена
-- набора фотографий.
--
-- ------------------------------------------------------------
-- СТАТУС МЕНЯЕТСЯ ТОЛЬКО ПРИ ИЗМЕНЕНИИ КОНТЕНТА
-- ------------------------------------------------------------
-- update_car_v2 отправляла объявление на модерацию БЕЗУСЛОВНО, при
-- любом сохранении. Из-за этого продавец, открывший форму и нажавший
-- «Сохранить» ничего не поменяв, снимал своё активное объявление из
-- выдачи и вставал в очередь на проверку заново.
--
-- Здесь контент сравнивается со старым, и если он не изменился —
-- статус, продвижение и дата модерации остаются нетронутыми.
--
-- ЧТО СЧИТАЕТСЯ КОНТЕНТОМ: всё, что видит покупатель и проверяет
-- модератор — марка, модель, год, пробег, характеристики, цены, залог,
-- город, описание, телефон, тип сделки и НАБОР ФОТОГРАФИЙ. Порядок фото
-- тоже входит: первый снимок становится обложкой в каталоге.
--
-- ПОЧЕМУ ПРИ ПРАВКЕ ГАСИТСЯ ПРОДВИЖЕНИЕ. Продвигаемое объявление стоит
-- в начале выдачи. Если бы правка сохраняла промо, через него можно
-- было бы подменить содержимое уже проверенной карточки и оставить её
-- наверху до следующей проверки. Новая модерация — новое продвижение;
-- это то же правило, что при снятии с публикации (миграция 0070).
--
-- ------------------------------------------------------------
-- ЧТО НЕ ЛОМАЕТСЯ
-- ------------------------------------------------------------
-- update_car_v2 остаётся на месте и не изменяется. Приложение
-- (cars_repository.dart) продолжает вызывать её, как раньше: это другая
-- функция с другим именем, и переход приложения на v3 — отдельная
-- задача. RLS-политики не затрагиваются.
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
  -- NULL — фотографии не трогаем (правка только текстовых полей).
  -- Массив — полная замена набора, как в create_car_v3.
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
as $$
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
  -- Изменился ли контент: от этого зависит статус и продвижение.
  v_changed   boolean := false;
  -- Прежний набор фотографий в порядке order_index — для сравнения.
  v_old_photos text[];
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку: параллельные сохранения из двух вкладок не должны
  -- перемешать поля одного объявления.
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

  -- Редактировать можно рабочие статусы. Проданное и архивное сначала
  -- возвращают в публикацию (set_my_car_status, миграция 0070): правка
  -- завершённой сделки означала бы подмену её условий задним числом.
  if v_car.status not in ('moderation', 'rejected', 'active') then
    raise exception 'Объявление нельзя редактировать: статус = %', v_car.status
      using errcode = 'check_violation';
  end if;

  -- ---------- ВАЛИДАЦИЯ: дословно как в create_car_v3 ----------
  -- Правила продублированы, а не вынесены в общую подпрограмму,
  -- намеренно. Вынести их можно было бы только вместе с сообщениями об
  -- ошибках, а они ссылаются на разные действия («для создания» /
  -- «для правки»); к тому же create_car_v3 вызывается приложением, и
  -- менять её ради общей подпрограммы значило бы трогать рабочий путь
  -- подачи ради удобства нового кода.
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
  -- сравнивать ровно то, что будет записано, а не сырые параметры:
  -- иначе описание '  ' (пробелы) против NULL выглядело бы изменением.
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

  -- Фотографии сравниваем отдельно и только если их прислали: NULL
  -- означает «не трогать», и набор заведомо не менялся.
  if not v_changed and p_photo_urls is not null then
    select coalesce(array_agg(ci.image_url order by ci.order_index), '{}')
      into v_old_photos
      from public.car_images ci
     where ci.car_id = p_car_id;

    -- Сравнение массивов учитывает и состав, и ПОРЯДОК: первый снимок
    -- становится обложкой в каталоге, и его замена — изменение того,
    -- что видит покупатель.
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
         -- Контент изменился — объявление уходит на повторную проверку,
         -- прежняя причина отклонения теряет смысл и очищается.
         -- Не изменился — статус остаётся прежним (в том числе
         -- 'rejected' с причиной: продавец ещё не исправил замечание).
         status = case when v_changed then 'moderation'::car_status
                       else c.status end,
         moderation_comment = case when v_changed then null
                                   else c.moderation_comment end,
         -- Продвижение гасится вместе с уходом на модерацию: наверху
         -- выдачи не должно стоять непроверенное содержимое.
         is_vip = case when v_changed then false else c.is_vip end,
         boosted_until = case when v_changed then null
                              else c.boosted_until end
   where c.id = p_car_id;

  -- ---------- Полная замена набора фотографий ----------
  -- Так же, как в create_car_v3: порядок в массиве становится
  -- order_index, первый элемент — обложка объявления.
  --
  -- Старые записи удаляются только из car_images; сами файлы остаются
  -- в бакете. Это осознанно: удалять объекты хранилища изнутри SQL
  -- нельзя, а осиротевшие файлы подбирает регламентная чистка.
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
$$;

comment on function public.update_car_v3(
  uuid, text, text, text, integer, integer, numeric, numeric, numeric,
  text, text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text
) is 'Редактирование своего объявления с раздельными ценами продажи/аренды. При изменении контента — возврат на модерацию и гашение продвижения';

-- После миграции 0065 default privileges закрыты: без явного гранта
-- функция клиенту недоступна.
grant execute on function public.update_car_v3(
  uuid, text, text, text, integer, integer, numeric, numeric, numeric,
  text, text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text
) to authenticated;

-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ
-- ============================================================
-- 1) Правка без изменений — статус НЕ меняется:
--      select * from public.update_car_v3(
--        '<свой активный car_id>', 'sale', 'BMW', 'X5', 2019, 120000,
--        15000, null, null, 'EUR', 'Beograd', null, null, null);
--    (значения — ровно те, что уже в объявлении)
--    Ожидается status = 'active', boosted_until без изменений.
--
-- 2) Правка цены — уход на модерацию и гашение промо:
--      select * from public.update_car_v3(
--        '<тот же car_id>', 'sale', 'BMW', 'X5', 2019, 120000,
--        14500, null, null, 'EUR', 'Beograd', null, null, null);
--    Ожидается status = 'moderation', boosted_until = null.
--
-- 3) Чужое объявление — insufficient_privilege:
--      select * from public.update_car_v3('<чужой car_id>', 'sale', …);
--
-- 4) Проданное объявление — check_violation:
--      select * from public.update_car_v3('<sold car_id>', 'sale', …);
-- ============================================================
