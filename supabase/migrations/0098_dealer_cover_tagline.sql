-- ============================================================
-- RS AUTO — Миграция 0098: обложка и слоган витрины салона.
-- ============================================================
-- ЗАЧЕМ. Плитка салона в каталоге показывала одно описание на всю
-- верхнюю половину. Поле длинное (до 1000 символов), а половина
-- фиксированная — описание обрывалось многоточием у любого салона,
-- который написал о себе больше пары фраз. Салон при этом сохранял
-- текст без единого предупреждения и видел в выдаче обрубок.
--
-- Вместо того чтобы резать описание, разделяем роли:
--
--   cover_url — обложка салона: шоурум, вывеска, команда. Занимает
--     верхнюю половину плитки. Это не фотография машины: снимки машин
--     из плитки убраны раньше намеренно — вокруг неё стоит ряд
--     карточек объявлений того же каталога, и ещё один автомобиль
--     ничего не добавлял;
--
--   tagline — слоган: одна фраза под названием салона. 90 символов,
--     столько влезает в две строки нижней половины даже на 360px.
--
-- Описание НЕ ТРОГАЕМ. Прежний лимит 1000 остаётся: поле продолжает
-- работать на публичной странице салона, где места сколько угодно, и
-- служит запасным вариантом в плитке — у салона без обложки верхнюю
-- половину занимает описание, а не серый прямоугольник.
--
-- ------------------------------------------------------------
-- ПОЧЕМУ ОТДЕЛЬНОЕ ПОЛЕ ПОД ОБЛОЖКУ, А НЕ logo_url
-- ------------------------------------------------------------
-- Логотип — квадрат 40px рядом с названием, обложка — кадр 8:3 во всю
-- ширину плитки. Это разные изображения по смыслу и по форме; салон
-- с одним лишь логотипом, растянутым на всю ширину, выглядел бы
-- сломанным. Поля независимы: можно иметь и то, и другое, и ни одного.
--
-- ------------------------------------------------------------
-- КАДРИРОВАНИЕ ДЕЛАЕТ КЛИЕНТ, А НЕ БАЗА
-- ------------------------------------------------------------
-- В cover_url лежит адрес уже готового кадра 8:3: обрезку выполняет
-- lib/imagePrepare.ts при загрузке (COVER_ASPECT). База хранит ссылку
-- и не знает о пропорциях — ровно как с logo_url и avatar_url.
--
-- ------------------------------------------------------------
-- АДДИТИВНОСТЬ
-- ------------------------------------------------------------
-- Два новых столбца, два новых параметра В КОНЕЦ update_seller_profile
-- и две новые колонки В КОНЕЦ возврата get_showcase_dealers. Вызовы,
-- которые уже есть — включая мобильное приложение, работающее на этом
-- же бэкенде, — продолжают работать без единой правки: параметры со
-- значением по умолчанию, колонки читаются по имени.
-- ============================================================

-- ------------------------------------------------------------
-- БЛОК 1. Столбцы.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists cover_url text,
  add column if not exists tagline   text;

comment on column public.profiles.cover_url
  is 'Обложка витрины салона: кадр 8:3 (шоурум, вывеска). Верхняя половина плитки каталога. Кадрируется при загрузке на клиенте (0098)';

comment on column public.profiles.tagline
  is 'Слоган салона: одна фраза под названием в плитке каталога, до 90 символов (0098)';

-- Длина адреса — как у прочих ссылок витрины (website, 200): путь в
-- бакете короткий, но к нему добавляется метка времени против кэша.
alter table public.profiles
  drop constraint if exists chk_profiles_cover_url_len;
alter table public.profiles
  add constraint chk_profiles_cover_url_len
  check (cover_url is null or length(cover_url) <= 500);

-- 90 символов — не круглое число «на глаз», а вместимость строки под
-- названием: на самом узком экране (360px) в нижнюю половину плитки
-- помещаются две строки по ~44 символа ступенью micro.
alter table public.profiles
  drop constraint if exists chk_profiles_tagline_len;
alter table public.profiles
  add constraint chk_profiles_tagline_len
  check (tagline is null or length(tagline) <= 90);

-- ------------------------------------------------------------
-- БЛОК 2. update_seller_profile — запись новых полей.
-- ------------------------------------------------------------
-- Функция переиздаётся целиком: изменить тело иначе нельзя. Прежняя
-- сигнатура сначала удаляется — иначе в базе осталось бы две функции
-- с разным числом параметров, и вызов стал бы неоднозначным
-- («function is not unique»). Это тот же приём, что в 0095 и 0097.
drop function if exists public.update_seller_profile(
  text, text, text, text, text, text, text, text
);

create or replace function public.update_seller_profile(
  p_seller_kind   text,
  p_company_name  text default null,
  p_logo_url      text default null,
  p_description   text default null,
  p_dealer_phone  text default null,
  p_website       text default null,
  p_opening_hours text default null,
  p_company_city  text default null,
  -- Новое (0098). Строго в конце и с default null: вызов приложения
  -- прежним числом аргументов остаётся рабочим.
  p_cover_url     text default null,
  p_tagline       text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  if p_seller_kind not in ('private', 'dealer') then
    raise exception 'Недопустимый тип продавца: %', p_seller_kind
      using errcode = 'check_violation';
  end if;

  -- Дилер без названия салона не сохраняется: проверяем ДО UPDATE, чтобы
  -- вернуть человекочитаемую ошибку, а не текст constraint'а из Postgres.
  if p_seller_kind = 'dealer'
     and nullif(trim(coalesce(p_company_name, '')), '') is null then
    raise exception 'Укажите название автосалона'
      using errcode = 'check_violation';
  end if;

  -- Длины проверяются и здесь, хотя их стережёт CHECK на таблице.
  -- Причина та же, что у названия салона выше: constraint отдаёт
  -- клиенту техническое «violates check constraint
  -- chk_profiles_description_len», а продавцу нужно понятное
  -- «описание слишком длинное».
  if length(coalesce(p_description, '')) > 1000 then
    raise exception 'Описание салона слишком длинное'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_dealer_phone, '')) > 40 then
    raise exception 'Телефон салона слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_website, '')) > 200 then
    raise exception 'Адрес сайта слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_opening_hours, '')) > 200 then
    raise exception 'Часы работы слишком длинные'
      using errcode = 'check_violation';
  end if;

  -- Город: та же граница, что у города объявления (cars.city). Своё
  -- значение разрешено, но не роман — 100 символов хватает любому
  -- населённому пункту Сербии с запасом.
  if length(coalesce(p_company_city, '')) > 100 then
    raise exception 'Название города слишком длинное'
      using errcode = 'check_violation';
  end if;

  -- Новое (0098).
  if length(coalesce(p_cover_url, '')) > 500 then
    raise exception 'Адрес обложки слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_tagline, '')) > 90 then
    raise exception 'Слоган слишком длинный'
      using errcode = 'check_violation';
  end if;

  update public.profiles p
     set seller_kind   = p_seller_kind,
         -- При возврате в 'private' затираем витрину дилера.
         company_name  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_company_name), '') end,
         logo_url      = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_logo_url), '') end,
         description   = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_description), '') end,
         dealer_phone  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_dealer_phone), '') end,
         website       = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_website), '') end,
         opening_hours = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_opening_hours), '') end,
         -- Город подчиняется тому же правилу, что остальные поля
         -- витрины: у частного лица города компании быть не должно.
         company_city  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_company_city), '') end,
         -- Обложка и слоган — поля витрины, и уходят вместе с ней.
         cover_url     = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_cover_url), '') end,
         tagline       = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_tagline), '') end,
         updated_at    = now()
   where p.id = v_user
  returning p.* into v_profile;

  return v_profile;
end;
$$;

comment on function public.update_seller_profile(
  text, text, text, text, text, text, text, text, text, text
) is 'Смена типа продавца (private/dealer) и полей витрины дилера: название, логотип, описание, телефон, сайт, часы работы, город, обложка и слоган (0098). Работает только со своим профилем';

grant execute on function public.update_seller_profile(
  text, text, text, text, text, text, text, text, text, text
) to authenticated;

-- ------------------------------------------------------------
-- БЛОК 3. get_showcase_dealers — отдаём обложку и слоган в плитку.
-- ------------------------------------------------------------
-- Возвращаемый тип меняется, поэтому функцию нужно удалить: create or
-- replace на изменённом наборе колонок падает с «cannot change return
-- type of existing function». Права после drop не сохраняются — grant
-- повторяется ниже.
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
  -- Новое (0098). Строго в конце — см. шапку.
  cover_url      text,
  tagline        text
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
    nullif(trim(p.tagline), '')        as tagline
  from public.profiles p
  join public.cars c
    on c.user_id = p.id
   and c.status = 'active'
  where p.seller_kind = 'dealer'
  -- Новые поля обязаны попасть в group by: они не агрегаты, а
  -- атрибуты салона, и без них Postgres откажется выполнять запрос
  -- («column must appear in the GROUP BY clause»).
  group by p.id, p.company_name, p.logo_url, p.company_city,
           p.description, p.opening_hours, p.dealer_phone,
           p.cover_url, p.tagline
  -- Крупные салоны первыми: плитка тем содержательнее, чем больше
  -- машин за ней стоит. Тот же порядок, что в get_site_dealers (0072).
  order by count(c.id) desc, max(c.updated_at) desc
  limit least(greatest(coalesce(p_limit, 4), 1), 24);
$$;

comment on function public.get_showcase_dealers(integer)
  is 'Салоны с активными объявлениями для широкой плитки-витрины: данные салона, часы работы и телефон (0096), обложка и слоган (0098)';

-- Публичная: плитка показывается гостю в каталоге.
grant execute on function public.get_showcase_dealers(integer) to anon, authenticated;

-- ------------------------------------------------------------
-- БЛОК 4. get_dealer_profile — обложка и слоган на странице салона.
-- ------------------------------------------------------------
-- Шапка публичной витрины показывает те же поля, что и плитка. Без
-- этого блока салон, загрузивший обложку, видел бы её в каталоге, но
-- не на собственной странице.
drop function if exists public.get_dealer_profile(uuid);

create function public.get_dealer_profile(p_user_id uuid)
returns table (
  id            uuid,
  seller_kind   text,
  display_name  text,
  logo_url      text,
  avatar_url    text,
  member_since  timestamptz,
  active_cars   bigint,
  sold_cars     bigint,
  company_city  text,
  description   text,
  dealer_phone  text,
  website       text,
  opening_hours text,
  -- Новое (0098). Строго в конце.
  cover_url     text,
  tagline       text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.seller_kind,
    -- Для дилера показываем название салона, для частника — имя человека.
    -- coalesce на случай, если имя не заполнено: карточка не должна быть пустой.
    case
      when p.seller_kind = 'dealer'
      then coalesce(nullif(trim(p.company_name), ''), 'Автосалон')
      else coalesce(nullif(trim(p.full_name), ''), 'Продавец')
    end                                        as display_name,
    p.logo_url,
    p.avatar_url,
    p.created_at                               as member_since,
    -- Счётчики объявлений продавца: активные и недавно проданные.
    -- Считаются подзапросами, чтобы не плодить join'ы с группировкой.
    (select count(*) from public.cars c
      where c.user_id = p.id and c.status = 'active')  as active_cars,
    (select count(*) from public.cars c
      where c.user_id = p.id and c.status = 'sold')    as sold_cars,
    -- Поля витрины отдаются ТОЛЬКО САЛОНУ. У частного продавца они
    -- физически могут оказаться заполненными (человек был салоном и
    -- переключился обратно), но публиковать «часы работы» частного
    -- лица неверно: это поля компании. update_seller_profile выше их
    -- при переходе в 'private' затирает, однако полагаться только на
    -- запись нельзя — читающая сторона обязана быть согласована с
    -- пишущей.
    case when p.seller_kind = 'dealer' then nullif(trim(p.company_city), '')  end as company_city,
    case when p.seller_kind = 'dealer' then nullif(trim(p.description), '')   end as description,
    case when p.seller_kind = 'dealer' then nullif(trim(p.dealer_phone), '')  end as dealer_phone,
    case when p.seller_kind = 'dealer' then nullif(trim(p.website), '')       end as website,
    case when p.seller_kind = 'dealer' then nullif(trim(p.opening_hours), '') end as opening_hours,
    case when p.seller_kind = 'dealer' then nullif(trim(p.cover_url), '')     end as cover_url,
    case when p.seller_kind = 'dealer' then nullif(trim(p.tagline), '')       end as tagline
  from public.profiles p
  where p.id = p_user_id;
$$;

comment on function public.get_dealer_profile(uuid)
  is 'Публичная карточка продавца/дилера: имя витрины, логотип, «на площадке с», счётчики объявлений, поля витрины салона (0095), обложка и слоган (0098)';

grant execute on function public.get_dealer_profile(uuid) to anon, authenticated;
