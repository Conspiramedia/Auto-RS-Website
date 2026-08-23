-- ============================================================
-- AUTO.RS — Миграция 0072: снятые объявления и список дилеров
-- ============================================================
-- Две несвязанные задачи Пакета B, обе про выдачу поисковика:
--   1) объявление, ушедшее в архив или на перепроверку, перестаёт
--      открываться по ссылке из Google и отдаёт голую 404;
--   2) витрины дилеров не попадают в sitemap, хотя проиндексированы
--      быть должны.
-- ============================================================


-- ============================================================
-- 1) СНЯТОЕ ОБЪЯВЛЕНИЕ ВМЕСТО 404
-- ============================================================
-- ПРОБЛЕМА. get_car_details (0048) отдаёт гостю только 'active' и
-- 'sold'. Всё остальное — 'archived', 'rejected', 'moderation' —
-- видно лишь владельцу и админу, а постороннему возвращается пустой
-- результат, и страница уходит в notFound().
--
-- Для объявления, которое уже побывало в индексе, это худший исход:
-- человек кликает по ссылке в выдаче и получает 404 без единого
-- следа того, что он искал. Уходит он при этом не на другую страницу
-- сайта, а обратно в поиск — то есть к конкуренту.
--
-- РЕШЕНИЕ. Показывать факт существования объявления, не показывая
-- само объявление: «снято с публикации», марка, модель, год — и
-- ссылки на похожие. Этого достаточно, чтобы человек понял, что
-- попал по адресу, и остался на сайте.
--
-- ЧТО ИМЕННО СКРЫВАЕТСЯ. Всё, ради чего объявление читают, и все
-- персональные данные продавца:
--   * contact_phone — обнуляется. Снятое объявление не должно
--     приводить звонки продавцу, который уже продал машину или
--     сам убрал её из публикации;
--   * description — обнуляется: это содержимое, снятое с публикации;
--   * цены (sale_price, rent_price_daily, deposit_amount) —
--     обнуляются. Цена снятого объявления вводит в заблуждение и не
--     должна попадать ни в разметку, ни в кэш поисковика;
--   * витрина продавца (seller_name, seller_logo_url,
--     seller_avatar_url, seller_kind, seller_since) — обнуляется.
--     Имя человека, снявшего объявление, публиковать незачем;
--   * рейтинг и число отзывов — обнуляются по той же причине.
--
-- ОСТАЁТСЯ: id, марка, модель, год, город, тип кузова и статус.
-- Этого хватает на заголовок «Škoda Octavia, 2022 — снято» и на
-- подбор похожих, и ничего из этого не является персональными
-- данными.
--
-- ПОЧЕМУ 'moderation' ТОЖЕ В СПИСКЕ. Объявление уходит на
-- перепроверку при каждом редактировании (update_car_v2), причём уже
-- будучи в индексе. Отдавать 404 на время проверки — значит терять
-- позиции страницы, которая через час снова станет активной.
-- Формулировка на сайте это учитывает: «снято или на проверке».
--
-- СОВМЕСТИМОСТЬ С ПРИЛОЖЕНИЕМ. Сигнатура и порядок колонок НЕ
-- меняются — добавленных полей нет, удалённых нет. Приложение
-- (cars_repository.dart: fetchDetails → CarDetailsModel.fromMap)
-- читает те же имена; модель терпима к NULL (`as String?`, `?? ''`),
-- поэтому обнулённые поля её не ломают. Меняется только то, что
-- РАНЬШЕ приложение получало для этих статусов пустой список, а
-- теперь получит строку со статусом 'archived' | 'rejected' |
-- 'moderation'. Экран карточки в приложении уже разбирает статус
-- (isSold и плашка «Продано»), незнакомый статус он покажет как
-- обычную карточку с пустыми полями — не идеально, но не поломка;
-- приведение экрана приложения к новому поведению — отдельная
-- задача из web-first порядка.
--
-- ВЛАДЕЛЕЦ И АДМИН видят объявление ПОЛНОСТЬЮ в любом статусе, как и
-- раньше: маскировка применяется только к посторонним.
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
  updated_at        timestamptz
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
    v.created_at, v.updated_at
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
  is 'Карточка объявления. Активные и проданные — полностью; снятые/отклонённые/на проверке — без цен, описания, контактов и витрины продавца (страница «объявление снято»); владельцу и админу — всё';

grant execute on function public.get_car_details(uuid) to anon, authenticated;


-- ============================================================
-- 2) СПИСОК ДИЛЕРОВ ДЛЯ SITEMAP
-- ============================================================
-- Витрины /dealer/{id} построены (0043 + 0050) и проиндексированы
-- быть должны: салон приводит десятки объявлений, и его страница —
-- целевая посадочная по запросу «<название салона> Beograd». Но в
-- sitemap их нет, и краулер добирается до них только переходом с
-- карточки объявления.
--
-- ТОЛЬКО ТЕ, У КОГО ЕСТЬ АКТИВНЫЕ ОБЪЯВЛЕНИЯ. Витрина без объявлений
-- уходит в noindex как thin content (DealerPageView) — класть её в
-- sitemap означало бы отправлять краулера на страницу, которая сама
-- же просит себя не индексировать.
--
-- ЧАСТНЫЕ ПРОДАВЦЫ НЕ ВКЛЮЧАЮТСЯ. Их витрины технически работают, но
-- в sitemap им не место: страница «Иван, 3 объявления» поисковой
-- ценности не несёт, а имя частного лица в карте сайта — лишняя
-- публикация персональных данных. Салон — организация, у него
-- название компании, а не имя человека.
create or replace function public.get_site_dealers(
  p_limit integer default 1000
)
returns table (
  user_id      uuid,
  display_name text,
  -- Время последнего изменения объявлений салона: идёт в lastmod
  -- записи sitemap. Дата регистрации профиля тут не годится — она не
  -- меняется никогда, и краулер решил бы, что витрина не обновляется.
  updated_at   timestamptz,
  listings     integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(nullif(trim(p.company_name), ''), 'Autosalon'),
    max(c.updated_at),
    count(*)::integer
  from public.profiles p
  join public.cars c on c.user_id = p.id
  where p.seller_kind = 'dealer'
    and c.status = 'active'
  group by p.id, p.company_name
  -- Крупные салоны первыми: при упоре в лимит в карту попадут те,
  -- чьи витрины содержательнее.
  order by count(*) desc, max(c.updated_at) desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

comment on function public.get_site_dealers(integer)
  is 'Салоны с активными объявлениями для sitemap. Частные продавцы не включаются';

grant execute on function public.get_site_dealers(integer) to anon, authenticated;
