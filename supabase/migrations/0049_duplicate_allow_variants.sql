-- ============================================================
-- AUTO.RS — Миграция 0049: дубли-варианты разрешены
-- ============================================================
-- Защита от даблклика из 0037 сравнивала объявления по продавцу + марке +
-- модели + году + типу сделки. Для своей задачи (случайный двойной тап
-- «Опубликовать») этого достаточно, но она же блокировала законный сценарий:
-- у автосалона стоят ДВЕ одинаковые машины разной комплектации — разный
-- пробег и разная цена. Такое объявление подать было нельзя.
--
-- ЧТО МЕНЯЕТСЯ: к условию совпадения добавлены пробег и цена. Объявление
-- считается дублем, только если совпадает ВСЁ: марка, модель, год, тип
-- сделки, пробег И цена. Отличается хоть одно из двух — это другая машина,
-- публикация проходит.
--
-- Почему именно пробег и цена: это два поля, которые у двух физически разных
-- машин одной модели практически всегда различаются. Добавлять в сравнение
-- цвет или описание бессмысленно — их легко забыть заполнить, и защита
-- перестала бы срабатывать вовсе.
--
-- ЗАЩИТА ОТ ДАБЛКЛИКА СОХРАНЯЕТСЯ: случайный повторный тап отправляет ту же
-- форму с тем же пробегом и той же ценой — все поля совпадают, и вставка
-- по-прежнему отклоняется.
--
-- СРАВНЕНИЕ NULL. Пробег и цена необязательны («Договорная», пробег не
-- указан). Обычное = с NULL даёт NULL, то есть условие не сработало бы и
-- два объявления без цены не считались бы дублями. Поэтому сравниваем через
-- IS NOT DISTINCT FROM — оператор, для которого NULL равен NULL.
--
-- Сигнатура функции не меняется → create or replace достаточно.
-- ============================================================

create or replace function public.create_car_v2(
  listing_type   text,
  brand          text,
  model          text,
  year           integer,
  mileage        integer,
  price          numeric,                        -- NULL → «Договорная»
  currency       text,
  city           text,
  lat            double precision,
  lng            double precision,
  photo_urls     text[],
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
declare
  v_user_id  uuid := auth.uid();
  v_car_id   uuid;
  v_is_sale  boolean := false;
  v_is_rent  boolean := false;
  v_sale     numeric(12,2);
  v_rent     numeric(12,2);
  v_location geography(point, 4326);
  v_url      text;
  v_idx      integer := 0;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация для создания объявления'
      using errcode = 'insufficient_privilege';
  end if;

  -- Маппинг назначения. Цена может быть NULL (тогда «Договорная»).
  if listing_type = 'sale' then
    v_is_sale := true;
    v_sale := price;
  elsif listing_type = 'rent' then
    v_is_rent := true;
    v_rent := price;
  elsif listing_type = 'both' then
    v_is_sale := true;
    v_is_rent := true;
    v_sale := price;
    v_rent := price;
  else
    raise exception 'Некорректный listing_type = % (ожидалось sale/rent/both)', listing_type
      using errcode = 'check_violation';
  end if;

  -- ---------- Анти-даблклик: полное совпадение всех признаков ----------
  -- Дубль = тот же продавец, марка, модель, год, тип сделки, пробег И цена.
  -- Разный пробег или разная цена → это другая машина, публикуем.
  -- Учитываем только живые статусы: архив/отказ/продажа не мешают подать заново.
  if exists (
    select 1
    from public.cars c
    where c.user_id = v_user_id
      and lower(btrim(c.brand)) = lower(btrim(brand))
      and lower(btrim(c.model)) = lower(btrim(model))
      and c.year = year
      and c.is_for_sale = v_is_sale
      and c.is_for_rent = v_is_rent
      -- Пробег: is not distinct from — NULL равен NULL (пробег не указан
      -- у обоих объявлений тоже считается совпадением).
      and c.mileage is not distinct from mileage
      -- Цена: сравниваем то поле, которое соответствует типу сделки.
      -- У аренды заполнено rent_price_daily, у продажи sale_price.
      and (
        case
          when v_is_rent and not v_is_sale
            then c.rent_price_daily is not distinct from v_rent
          else c.sale_price is not distinct from v_sale
        end
      )
      and c.status in ('moderation', 'active')
  ) then
    raise exception
      'У вас уже есть такое объявление (%, % %, % г.) с тем же пробегом и ценой. Измените пробег или цену, если это другая машина.',
      case when v_is_rent and not v_is_sale then 'аренда' else 'продажа' end,
      brand, model, year
      using errcode = 'unique_violation';
  end if;

  if lat is not null and lng is not null then
    v_location := st_setsrid(st_makepoint(lng, lat), 4326)::geography;
  end if;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, mileage,
    body_type, transmission, fuel,
    currency, sale_price, rent_price_daily,
    city, description, contact_phone, location
  )
  values (
    v_user_id, v_is_sale, v_is_rent,
    brand, model, year, mileage,
    p_body_type, p_transmission, p_fuel,
    coalesce(currency, 'EUR')::currency_code, v_sale, v_rent,
    city,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    v_location
  )
  returning id into v_car_id;

  if photo_urls is not null then
    foreach v_url in array photo_urls loop
      insert into public.car_images (car_id, image_url, order_index)
      values (v_car_id, v_url, v_idx);
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_car_id;
end;
$$;

comment on function public.create_car_v2 is
  'Создание объявления. Анти-даблклик: дублем считается полное совпадение марки/модели/года/типа/пробега/цены';
