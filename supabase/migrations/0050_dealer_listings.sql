-- ============================================================
-- AUTO.RS — Миграция 0050: объявления продавца для страницы дилера
-- ============================================================
-- ЗАЧЕМ НУЖНА ОТДЕЛЬНАЯ RPC.
-- Страница дилера показывает два блока: активные объявления и «недавно
-- проданные» (социальное доказательство — видно, что салон реально продаёт).
-- Ни один существующий путь этого не даёт:
--
--   * search_cars_advanced не умеет фильтровать по продавцу и отдаёт
--     только status = 'active' — проданных в нём нет по определению;
--   * прямой SELECT из cars ограничен политикой cars_select_active_public,
--     которая пускает только активные: проданные объявления чужого
--     продавца гость через неё не увидит.
--
-- Отдаём обе категории ОДНОЙ функцией с параметром p_status, чтобы страница
-- дилера не собирала выдачу из разных источников с разными правилами
-- видимости.
--
-- ЧТО ВИДНО ПУБЛИЧНО: только active и sold. Модерация, отклонённые и архив —
-- внутренняя кухня продавца, посторонним они не показываются никогда
-- (в отличие от get_car_details, где владелец видит и своё непубличное:
-- там речь о собственной карточке, здесь — о чужой витрине).
-- ============================================================

create or replace function public.get_seller_listings(
  p_user_id uuid,
  -- 'active' — витрина, 'sold' — блок «недавно проданные».
  p_status  text default 'active',
  p_limit   integer default 20,
  p_offset  integer default 0
)
returns table (
  id               uuid,
  brand            text,
  model            text,
  year             integer,
  mileage          integer,
  city             text,
  currency         text,
  sale_price       numeric,
  rent_price_daily numeric,
  is_for_sale      boolean,
  is_for_rent      boolean,
  status           text,
  is_promoted      boolean,
  site_url         text,
  photo_url        text,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.brand, c.model, c.year, c.mileage, c.city,
    c.currency::text, c.sale_price, c.rent_price_daily,
    c.is_for_sale, c.is_for_rent,
    c.status::text,
    -- Действует ли продвижение прямо сейчас (флаг + непросроченный срок).
    (c.is_vip and c.boosted_until is not null and c.boosted_until > now()),
    public.f_car_site_url(c.id),
    (select ci.image_url from public.car_images ci
      where ci.car_id = c.id
      order by ci.order_index asc
      limit 1),
    c.created_at
  from public.cars c
  where c.user_id = p_user_id
    -- Жёсткий белый список статусов: даже если клиент передаст 'moderation',
    -- ничего не вернётся. Проверка именно здесь, а не в CASE по параметру, —
    -- так непубличный статус не утечёт ни при каком значении p_status.
    and c.status::text = case
          when p_status = 'sold' then 'sold'
          else 'active'
        end
  order by
    -- Активные: сначала продвигаемые, затем свежие — как в каталоге,
    -- чтобы витрина дилера не противоречила общей выдаче.
    -- Проданные: просто свежие сверху («недавно продано»).
    case
      when p_status <> 'sold'
       and c.is_vip and c.boosted_until is not null and c.boosted_until > now()
      then 0 else 1
    end,
    c.created_at desc
  limit  least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.get_seller_listings(uuid, text, integer, integer)
  is 'Объявления продавца для страницы дилера: active (витрина) или sold (недавно проданные). Публично видны только эти два статуса';

-- Доступна гостю: страница дилера открывается по прямой ссылке без входа.
grant execute on function public.get_seller_listings(uuid, text, integer, integer)
  to anon, authenticated;
