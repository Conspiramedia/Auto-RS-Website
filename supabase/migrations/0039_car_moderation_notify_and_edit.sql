-- ============================================================
-- AUTO.RS — Миграция 0039: Уведомления о модерации + редактирование
-- ============================================================
-- 1) При отклонении/одобрении объявления шлём владельцу уведомление
--    (колокольчик) — чтобы он узнал, не заходя в «Мои объявления».
-- 2) RPC update_car_v2: владелец редактирует своё объявление; после
--    правки статус → moderation (снова на проверку). Разрешено только
--    своему объявлению в статусах moderation/rejected/active.
-- ============================================================


-- ---------- 1) reject_car: статус + причина + уведомление владельцу ----------
create or replace function public.reject_car(car_id uuid, comment text)
returns public.cars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_car public.cars;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: модерация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  select c.* into v_car from public.cars c where c.id = car_id for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', car_id
      using errcode = 'no_data_found';
  end if;

  if v_car.status <> 'moderation' then
    raise exception 'Объявление нельзя отклонить: текущий статус = %, ожидался moderation', v_car.status
      using errcode = 'check_violation';
  end if;

  update public.cars
     set status = 'rejected',
         moderation_comment = comment
   where id = car_id
   returning * into v_car;

  -- Уведомление владельцу: причина + подсказка отредактировать.
  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_car.user_id,
    'Объявление отклонено',
    coalesce(comment, 'Причина не указана'),
    'car_rejected',
    v_car.id                 -- по тапу открыть это объявление
  );

  return v_car;
end;
$$;


-- ---------- 2) approve_car: статус active + уведомление владельцу ----------
create or replace function public.approve_car(car_id uuid)
returns public.cars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_car public.cars;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: модерация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  select c.* into v_car from public.cars c where c.id = car_id for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', car_id
      using errcode = 'no_data_found';
  end if;

  if v_car.status not in ('moderation', 'rejected') then
    raise exception 'Объявление нельзя одобрить: текущий статус = %', v_car.status
      using errcode = 'check_violation';
  end if;

  update public.cars
     set status = 'active',
         moderation_comment = null   -- очищаем прежнюю причину
   where id = car_id
   returning * into v_car;

  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_car.user_id,
    'Объявление опубликовано',
    format('%s %s одобрено и опубликовано', v_car.brand, v_car.model),
    'car_approved',
    v_car.id
  );

  return v_car;
end;
$$;


-- ---------- 3) update_car_v2: редактирование своего объявления ----------
-- Владелец меняет поля и снова уходит на модерацию. Фото передаём заново:
-- если p_photo_urls НЕ NULL — полностью заменяем набор фото объявления
-- (удаляем старые записи car_images и вставляем новые в переданном порядке);
-- NULL — фото не трогаем.
create or replace function public.update_car_v2(
  p_car_id       uuid,
  listing_type   text,
  brand          text,
  model          text,
  year           integer,
  mileage        integer,
  price          numeric,
  currency       text,
  city           text,
  lat            double precision,
  lng            double precision,
  p_photo_urls   text[]            default null,
  p_body_type    body_type         default null,
  p_transmission transmission_type default null,
  p_fuel         fuel_type         default null,
  p_description  text              default null,
  p_phone        text              default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
-- В UPDATE ... SET col = col правая часть неоднозначна (параметр vs колонка).
-- use_variable говорит plpgsql: при конфликте имя = ПАРАМЕТР функции.
#variable_conflict use_variable
declare
  v_user_id  uuid := auth.uid();
  v_car      public.cars;
  v_is_sale  boolean := false;
  v_is_rent  boolean := false;
  v_sale     numeric(12,2);
  v_rent     numeric(12,2);
  v_location geography(point, 4326);
  v_url      text;
  v_idx      integer := 0;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация' using errcode = 'insufficient_privilege';
  end if;

  select c.* into v_car from public.cars c where c.id = p_car_id for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', p_car_id using errcode = 'no_data_found';
  end if;

  -- Редактировать может только владелец.
  if v_car.user_id <> v_user_id then
    raise exception 'Нельзя редактировать чужое объявление'
      using errcode = 'insufficient_privilege';
  end if;

  -- Разрешаем правку в рабочих статусах (не архив/продано).
  if v_car.status not in ('moderation', 'rejected', 'active') then
    raise exception 'Объявление нельзя редактировать: статус = %', v_car.status
      using errcode = 'check_violation';
  end if;

  -- Маппинг назначения/цены (как в create_car_v2).
  if listing_type = 'sale' then
    v_is_sale := true; v_sale := price;
  elsif listing_type = 'rent' then
    v_is_rent := true; v_rent := price;
  elsif listing_type = 'both' then
    v_is_sale := true; v_is_rent := true; v_sale := price; v_rent := price;
  else
    raise exception 'Некорректный listing_type = %', listing_type
      using errcode = 'check_violation';
  end if;

  if lat is not null and lng is not null then
    v_location := st_setsrid(st_makepoint(lng, lat), 4326)::geography;
  end if;

  update public.cars
     set is_for_sale      = v_is_sale,
         is_for_rent      = v_is_rent,
         brand            = brand,
         model            = model,
         year             = year,
         mileage          = mileage,
         body_type        = p_body_type,
         transmission     = p_transmission,
         fuel             = p_fuel,
         currency         = coalesce(currency, 'EUR')::currency_code,
         sale_price       = v_sale,
         rent_price_daily = v_rent,
         city             = city,
         description      = nullif(btrim(coalesce(p_description, '')), ''),
         contact_phone    = nullif(btrim(coalesce(p_phone, '')), ''),
         location         = v_location,
         -- После правки — снова на модерацию, причина сбрасывается.
         status             = 'moderation',
         moderation_comment = null
   where id = p_car_id;

  -- Полная замена набора фото, если переданы.
  if p_photo_urls is not null then
    delete from public.car_images where car_id = p_car_id;
    foreach v_url in array p_photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (p_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  return p_car_id;
end;
$$;

grant execute on function public.update_car_v2(
  uuid, text, text, text, integer, integer, numeric, text, text,
  double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text
) to authenticated;
