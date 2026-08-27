-- ============================================================
-- RS AUTO — Миграция 0096: часы работы и телефон в плитке салона.
-- ============================================================
-- ЗАЧЕМ. Плитка салона в каталоге переверстана: слева теперь блок со
-- сведениями о компании (описание, город, часы, телефон), справа —
-- крупная фотография машины. Описание и город get_showcase_dealers
-- (0095) уже отдавала, а часов работы и телефона в её returns table
-- не было вовсе — поля завели в profiles, но до плитки они не
-- доходили.
--
-- ЧТО МЕНЯЕТСЯ: две колонки в конце returns table. Тело функции
-- дополняется двумя выражениями и группировкой по этим полям.
--
-- БЕЗОПАСНОСТЬ ИЗМЕНЕНИЯ. get_showcase_dealers — функция САЙТА,
-- заведённая в 0095 вместе с плиткой. Приложение (Flutter) её не
-- вызывает: у него нет ни этой плитки, ни экрана, где она нужна.
-- Поэтому расширение никакой внешний контракт не задевает — в отличие
-- от get_dealer_profile и update_seller_profile, которые 0095
-- расширяла строго аддитивно именно потому, что их зовут оба клиента.
--
-- Тем не менее колонки добавлены В КОНЕЦ, а не в середину: правило
-- одно для всех функций проекта, и полагаться на то, что «эту всё
-- равно никто не читает по позиции», не стоит — завтра прочитают.
--
-- ПОЧЕМУ ПОЛЯ БЕРУТСЯ ПРЯМО ИЗ profiles, А НЕ ЧЕРЕЗ
-- get_dealer_profile. Плитка показывает несколько салонов сразу;
-- вызов функции-на-салон дал бы N+1 — ровно то, ради избежания чего
-- get_showcase_dealers и написана одним проходом.
-- ============================================================

-- returns table меняется, поэтому функцию нужно СНАЧАЛА УДАЛИТЬ:
-- create or replace не умеет менять состав возвращаемых колонок и
-- падает с «cannot change return type of existing function». Права
-- после drop не сохраняются — grant повторяется ниже.
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
  -- Новое (0096). Строго в конце — см. шапку.
  opening_hours  text,
  dealer_phone   text
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
    -- Адреса фотографий свежих объявлений салона. Берём шесть, хотя
    -- плитка показывает одну: у части машин фотографии может не быть
    -- вовсе, и запас позволяет заполнить снимок, не делая второй
    -- запрос. Строки без картинки отфильтрованы — иначе на клиенте
    -- появился бы пустой прямоугольник вместо машины.
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
    ) as preview_photos,
    -- Часы работы и публичный телефон САЛОНА. Оба — то, что салон сам
    -- о себе опубликовал (заполняются в кабинете), и оба безопасны
    -- для анонимного доступа.
    --
    -- dealer_phone НЕ ПУТАТЬ с profiles.phone: тот служит логином
    -- (вход по SMS, 0035), публикация номера входа открыла бы канал
    -- для перебора кодов. Здесь отдаётся отдельное поле, заведённое
    -- в 0095 именно как публичный контакт компании.
    nullif(trim(p.opening_hours), '') as opening_hours,
    nullif(trim(p.dealer_phone), '')  as dealer_phone
  from public.profiles p
  join public.cars c
    on c.user_id = p.id
   and c.status = 'active'
  where p.seller_kind = 'dealer'
  -- Новые поля обязаны попасть в group by: они не агрегаты, а
  -- атрибуты салона, и без них Postgres откажется выполнять запрос
  -- («column must appear in the GROUP BY clause»).
  group by p.id, p.company_name, p.logo_url, p.company_city,
           p.description, p.opening_hours, p.dealer_phone
  -- Крупные салоны первыми: плитка тем содержательнее, чем больше
  -- машин за ней стоит. Тот же порядок, что в get_site_dealers (0072).
  order by count(c.id) desc, max(c.updated_at) desc
  limit least(greatest(coalesce(p_limit, 4), 1), 24);
$$;

comment on function public.get_showcase_dealers(integer)
  is 'Салоны с активными объявлениями для широкой плитки-витрины: данные салона, часы работы и телефон (0096), до 6 адресов фотографий машин';

-- Публичная: плитка показывается гостю в каталоге.
grant execute on function public.get_showcase_dealers(integer) to anon, authenticated;
