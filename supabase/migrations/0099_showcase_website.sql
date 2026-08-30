-- ============================================================
-- RS AUTO — Миграция 0099: сайт салона в плитке каталога.
-- ============================================================
-- ЗАЧЕМ. Поле website завели в 0095 вместе с остальной витриной, и
-- салон его заполняет в кабинете. Но get_showcase_dealers — функция,
-- которая кормит плитку каталога, — этой колонки не отдавала, поэтому
-- адрес сайта нигде покупателю не показывался: салон вводил его в
-- пустоту.
--
-- Функция get_dealer_profile сайт возвращает с самого начала, так что
-- правка нужна только здесь.
--
-- ------------------------------------------------------------
-- АДДИТИВНОСТЬ
-- ------------------------------------------------------------
-- Колонка добавлена В КОНЕЦ возвращаемого набора. Клиенты читают поля
-- по имени, но вставка в СЕРЕДИНУ сломала бы тех, кто читает по
-- позиции (прямой SQL в отчётах), — то же правило действовало в 0095,
-- 0096 и 0098. Мобильное приложение, работающее на этом же бэкенде,
-- продолжает работать без правок.
--
-- Возвращаемый тип меняется, поэтому функцию нужно удалить: create or
-- replace на изменённом наборе колонок падает с «cannot change return
-- type of existing function». Права после drop не сохраняются — grant
-- повторяется ниже.
-- ============================================================

drop function if exists public.get_showcase_dealers(integer);

create function public.get_showcase_dealers(
  p_limit integer default 4
)
returns table (
  id             uuid,
  display_name   text,
  logo_url       text,
  company_city   text,
  description    text,
  active_cars    bigint,
  preview_photos text[],
  opening_hours  text,
  dealer_phone   text,
  cover_url      text,
  tagline        text,
  -- Новое (0099). Строго в конце — см. шапку.
  website        text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(nullif(trim(p.company_name), ''), 'Autosalon') as display_name,
    nullif(trim(p.logo_url), '')      as logo_url,
    nullif(trim(p.company_city), '')  as company_city,
    nullif(trim(p.description), '')   as description,
    count(c.id)                       as active_cars,
    -- Адреса фотографий свежих объявлений салона. Плитка их больше не
    -- показывает — снимок машины из неё убран, — но колонка сохранена:
    -- её читает мобильное приложение, работающее на этом же бэкенде,
    -- и убрать её значило бы сломать чужой вызов ради экономии одного
    -- подзапроса.
    (
      select coalesce(
               array_agg(t.photo_url order by t.created_at desc),
               '{}'::text[]
             )
      from (
        select
          (
            select ci.image_url
            from public.car_images ci
            where ci.car_id = c2.id
            order by ci.order_index asc
            limit 1
          ) as photo_url,
          c2.created_at
        from public.cars c2
        where c2.user_id = p.id
          and c2.status = 'active'
        order by c2.created_at desc
        limit 6
      ) t
      where t.photo_url is not null
    )                                  as preview_photos,
    nullif(trim(p.opening_hours), '')  as opening_hours,
    nullif(trim(p.dealer_phone), '')   as dealer_phone,
    nullif(trim(p.cover_url), '')      as cover_url,
    nullif(trim(p.tagline), '')        as tagline,
    nullif(trim(p.website), '')        as website
  from public.profiles p
  join public.cars c
    on c.user_id = p.id
   and c.status = 'active'
  where p.seller_kind = 'dealer'
  -- Новое поле обязано попасть в group by: оно не агрегат, а атрибут
  -- салона, и без него Postgres откажется выполнять запрос («column
  -- must appear in the GROUP BY clause»).
  group by p.id, p.company_name, p.logo_url, p.company_city,
           p.description, p.opening_hours, p.dealer_phone,
           p.cover_url, p.tagline, p.website
  -- Крупные салоны первыми: плитка тем содержательнее, чем больше
  -- машин за ней стоит. Тот же порядок, что в get_site_dealers (0072).
  order by count(c.id) desc, max(c.updated_at) desc
  limit least(greatest(coalesce(p_limit, 4), 1), 24);
$$;

comment on function public.get_showcase_dealers(integer)
  is 'Салоны с активными объявлениями для широкой плитки-витрины: данные салона, часы работы и телефон (0096), обложка и слоган (0098), сайт (0099)';

-- Публичная: плитка показывается гостю в каталоге.
grant execute on function public.get_showcase_dealers(integer) to anon, authenticated;
