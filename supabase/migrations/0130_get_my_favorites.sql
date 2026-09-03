-- ============================================================
-- 0130. Чтение избранного: список сохранённых объявлений.
-- ============================================================
-- ЗАЧЕМ. Таблица favorites и переключатель toggle_favorite живут с
-- миграции 0023, но ПРОЧИТАТЬ свой список было нечем: в схеме есть
-- только «поставить/снять закладку». Приложение обходится собственной
-- выборкой с join'ом (favorite_with_car_model.dart), сайту же нужен
-- тот же набор колонок, что рисует карточка каталога, — иначе список
-- избранного пришлось бы собирать вторым запросом за фотографиями и
-- ценами.
--
-- ФУНКЦИЯ ТОЛЬКО ДОБАВЛЯЕТСЯ. Существующие сигнатуры не трогаются,
-- поведение toggle_favorite не меняется — контракт с приложением
-- сохранён полностью.
--
-- ФОРМА ВОЗВРАТА ПОВТОРЯЕТ get_seller_listings (0050) — тот же набор
-- полей, что потребляет CarCard на сайте. Совпадение намеренное:
-- список избранного и витрина продавца рисуются одним компонентом, и
-- две разные формы заставили бы держать в нём две ветки разбора.
--
-- ЧТО ПОКАЗЫВАЕМ. Только активные объявления. Закладка на снятом,
-- проданном или отклонённом объявлении в списке не появится, но и НЕ
-- УДАЛЯЕТСЯ: объявление может вернуться в каталог (продление,
-- возврат из архива — 0070), и стирать закладку за человека значило бы
-- терять его выбор из-за временного состояния чужого объявления.
-- ============================================================

create or replace function public.get_my_favorites(
  p_limit  integer default 24,
  p_offset integer default 0
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
  availability     text,
  seller_kind      text,
  site_url         text,
  photo_url        text,
  -- Когда закладка поставлена. Порядок списка задаётся именно этим
  -- полем, а не датой объявления: человек ждёт увидеть сверху то, что
  -- сохранил последним.
  favorited_at     timestamptz
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
    -- Действует ли продвижение прямо сейчас (флаг + непросроченный
    -- срок) — то же выражение, что в get_seller_listings.
    (c.is_vip and c.boosted_until is not null and c.boosted_until > now()),
    c.availability::text,
    p.seller_kind::text,
    public.f_car_site_url(c.id),
    (select ci.image_url from public.car_images ci
      where ci.car_id = c.id
      order by ci.order_index asc
      limit 1),
    f.created_at
  from public.favorites f
  join public.cars c on c.id = f.car_id
  -- left join: профиль продавца может отсутствовать (удалённая учётная
  -- запись — 0126). Внутреннее соединение выбросило бы такое
  -- объявление из списка молча.
  left join public.profiles p on p.id = c.user_id
  -- auth.uid() и только он: функция security definer, и без этого
  -- условия она отдала бы чужие закладки. RLS здесь не защищает —
  -- definer выполняется с правами владельца.
  where f.user_id = auth.uid()
    -- Только то, что реально можно открыть (см. шапку).
    and c.status::text = 'active'
  order by f.created_at desc
  limit  least(greatest(coalesce(p_limit, 24), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.get_my_favorites(integer, integer)
  is 'Избранное текущего пользователя: активные объявления с полями карточки каталога, новые закладки сверху';

-- ------------------------------------------------------------
-- Счётчик избранного.
-- ------------------------------------------------------------
-- Нужен пагинации и пункту меню. Отдельной функцией, а не колонкой в
-- выборке выше: total в каждой строке страницы — это одно и то же
-- число, повторённое двадцать четыре раза, и при пустом списке оно не
-- приходит вовсе.
--
-- Считает по тому же условию, что и выборка: иначе пагинация обещала
-- бы страницы, на которых пусто.
create or replace function public.count_my_favorites()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.favorites f
  join public.cars c on c.id = f.car_id
  where f.user_id = auth.uid()
    and c.status::text = 'active';
$$;

comment on function public.count_my_favorites()
  is 'Число активных объявлений в избранном текущего пользователя';

-- Только вошедшему: у гостя избранного нет по определению, а
-- auth.uid() у него null — функция вернула бы пустой список, но
-- права на неё выдавать всё равно незачем.
grant execute on function public.get_my_favorites(integer, integer) to authenticated;
grant execute on function public.count_my_favorites() to authenticated;
