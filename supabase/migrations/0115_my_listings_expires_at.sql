-- ============================================================
-- AUTO.RS — Миграция 0115: expires_at в списке кабинета
-- ============================================================
-- ЗАЧЕМ. get_my_listings_stats отдаёт кабинету статус объявления, и
-- истёкшие после 0113 появляются там сами — с бейджем «Истекло» и
-- кнопкой «Продлить». Но даты окончания срока в выдаче нет, поэтому
-- продавец видит проблему только постфактум: объявление уже скрыто.
--
-- Активному объявлению дата нужна ЗАРАНЕЕ — «Истекает 31.10», а за
-- неделю до срока ещё и пометка «Скоро истечёт». Тогда продление
-- становится действием по своей воле, а не реакцией на потерю показов.
--
-- АДДИТИВНО. Колонка добавлена ПОСЛЕДНЕЙ в returns table, порядок и
-- типы существующих не изменились. Мобильное приложение читает ответ
-- по именам колонок и о новой просто не знает — контракт цел.
--
-- Функция пересоздаётся целиком (create or replace), тело взято из
-- 0092 без изменений: правится ровно одна строка выборки и одна
-- строка сигнатуры.
-- ============================================================

-- DROP перед CREATE обязателен: create or replace не умеет менять
-- набор колонок returns table (SQLSTATE 42P13). Внутри одной
-- транзакции миграции разрыва доступности нет — функция исчезает и
-- появляется атомарно, параллельные запросы дождутся коммита.
--
-- Права после DROP не сохраняются, поэтому GRANT ниже повторён явно.
drop function if exists public.get_my_listings_stats();

create function public.get_my_listings_stats()
returns table (
  car_id           uuid,
  brand            text,
  model            text,
  year             integer,
  city             text,
  status           text,
  sale_price       numeric,
  rent_price_daily numeric,
  currency         text,
  photo_url        text,
  views            integer,
  favorites        integer,
  contacts         integer,
  is_promoted      boolean,
  boosted_until    timestamptz,
  created_at       timestamptz,
  moderation_comment text,
  is_for_sale        boolean,
  is_for_rent        boolean,
  archived_by        text,
  archived_reason    text,
  -- Новое (0092): состояние кнопки «Поднять» и дата, с которой
  -- продвижение станет доступно (либо до которой уже действует).
  promo_state        text,
  promo_available_at timestamptz,
  -- Новое (0115): когда объявление уйдёт в expired. NULL у неактивных.
  -- Кабинету нужна дата, чтобы показать «Истекает 31.10» и подсветить
  -- те объявления, до срока которых осталось меньше недели.
  expires_at         timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.brand,
    c.model,
    c.year,
    c.city,
    c.status::text,
    c.sale_price,
    c.rent_price_daily,
    c.currency::text,
    (select ci.image_url from public.car_images ci
      where ci.car_id = c.id
      order by ci.order_index asc
      limit 1) as photo_url,
    coalesce(s.views, 0),
    coalesce(s.favorites, 0),
    coalesce(s.contacts, 0),
    (c.is_vip and c.boosted_until is not null and c.boosted_until > now()),
    c.boosted_until,
    c.created_at,
    -- Причина отклонения — только в статусе 'rejected' (см. 0089).
    case when c.status = 'rejected' then c.moderation_comment end,
    c.is_for_sale,
    c.is_for_rent,
    -- Авторство архива отдаём текстом, а не enum (см. 0089).
    c.archived_by::text,
    c.archived_reason,
    -- Порядок ветвей повторяет порядок проверок в activate_promotion:
    -- подсказка обязана называть ту же причину, что назовёт сервер.
    case
      when c.status <> 'active' then 'blocked'
      when c.is_vip and c.boosted_until is not null and c.boosted_until > now()
        then 'active'
      when now() < c.created_at + public.f_promo_min_age() then 'too_young'
      when c.promoted_at is not null
       and now() < c.promoted_at + public.f_promo_cooldown() then 'cooldown'
      else 'available'
    end,
    case
      when c.status <> 'active' then null
      when c.is_vip and c.boosted_until is not null and c.boosted_until > now()
        then c.boosted_until
      when now() < c.created_at + public.f_promo_min_age()
        then c.created_at + public.f_promo_min_age()
      when c.promoted_at is not null
       and now() < c.promoted_at + public.f_promo_cooldown()
        then c.promoted_at + public.f_promo_cooldown()
      else null
    end,
    c.expires_at
  from public.cars c
  left join public.listing_stats s on s.car_id = c.id
  where c.user_id = auth.uid()
  order by c.created_at desc;
$$;


comment on function public.get_my_listings_stats()
  is 'Объявления пользователя со статистикой, состоянием продвижения и датой окончания срока публикации';

grant execute on function public.get_my_listings_stats() to authenticated;
