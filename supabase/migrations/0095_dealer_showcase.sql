-- ============================================================
-- RS AUTO — Миграция 0095: витрина автосалона (описание, контакты, часы).
-- ============================================================
-- ЗАЧЕМ. У салона на площадке до сих пор было ровно два поля витрины —
-- название и логотип (0043) плюс город, заведённый для админки (0085).
-- Этого хватало странице /dealer/{id}, где вся содержательная часть —
-- список машин, но не хватает КАРТОЧКЕ САЛОНА в каталоге и на главной:
-- широкая плитка обязана за один взгляд объяснить, кто это и почему
-- к нему стоит зайти. Плитка с одним названием такой задачи не решает.
--
-- Четыре новых поля закрывают четыре разных вопроса покупателя:
--   description    — чем салон занимается (одна-две фразы, попадают
--                    в плитку и в шапку витрины);
--   dealer_phone   — по какому номеру звонить САЛОНУ. Не дублирует
--                    cars.contact_phone: тот принадлежит объявлению
--                    и у разных машин может отличаться (менеджер
--                    отдела), а этот — общий номер компании. И не
--                    дублирует profiles.phone: тот служит ЛОГИНОМ
--                    (вход по SMS, 0035), и публиковать его нельзя;
--   website        — сайт салона, если он есть;
--   opening_hours  — часы работы: без них покупатель не знает, ехать
--                    ли сегодня.
--
-- ВСЕ ЧЕТЫРЕ NULLABLE И БЕЗ DEFAULT. Существующие салоны заполнят их
-- сами; пустое поле означает «не указано» и в интерфейсе просто не
-- печатается — так же, как company_city из 0085.
--
-- АДДИТИВНОСТЬ. Приложение (Flutter) работает на этой же базе и зовёт
-- те же функции. Поэтому:
--   * колонки добавляются, ничего не переименовывается;
--   * у update_seller_profile новые параметры стоят В КОНЦЕ и имеют
--     default null — прежний вызов с тремя аргументами продолжает
--     работать байт-в-байт;
--   * у get_dealer_profile новые колонки добавлены В КОНЕЦ returns
--     table: клиенты читают результат по ИМЕНАМ полей, и лишние
--     колонки им не мешают.
-- ============================================================


-- ------------------------------------------------------------
-- БЛОК 1. Колонки витрины
-- ------------------------------------------------------------
alter table public.profiles
  -- Описание салона. text без ограничения длины на уровне типа:
  -- обрезка — задача интерфейса (в плитке line-clamp-2), а не базы.
  -- Верхняя граница всё же нужна, чтобы поле нельзя было превратить
  -- в хранилище мегабайта текста, — она ниже отдельным CHECK.
  add column if not exists description   text,
  -- Публичный телефон салона. Хранится строкой как есть: формат
  -- сербских номеров разный (+381 11 …, 060/…), и нормализация
  -- превратила бы часть номеров в неверные.
  add column if not exists dealer_phone  text,
  add column if not exists website       text,
  -- Часы работы одной строкой, а не структурой из семи дней: салоны
  -- пишут их произвольно (Pon-Pet 09-18, Sub 09-14), и разложенная
  -- по дням схема заставила бы либо угадывать разбор, либо строить в
  -- кабинете таблицу на 14 полей ради подписи, которую всё равно
  -- читают глазами.
  add column if not exists opening_hours text;

comment on column public.profiles.description
  is 'Описание автосалона для витрины и плитки в каталоге. NULL — не заполнено';
comment on column public.profiles.dealer_phone
  is 'Публичный телефон салона. НЕ логин (profiles.phone) и НЕ телефон объявления (cars.contact_phone)';
comment on column public.profiles.website
  is 'Сайт автосалона. NULL — не указан';
comment on column public.profiles.opening_hours
  is 'Часы работы салона одной строкой, в произвольном формате';


-- ------------------------------------------------------------
-- Границы длины.
-- ------------------------------------------------------------
-- Проверяются НА ДЛИНУ, а не на формат: тексты пишет человек, и
-- отклонять номер за непривычную запись значило бы чинить то, что не
-- сломано. Задача CHECK — не пустить в базу поле, которым можно
-- раздуть каждую строку выдачи.
--
-- drop + add вместо add if not exists: у constraint нет такой формы,
-- а повторный запуск миграции обязан быть безопасным.
alter table public.profiles
  drop constraint if exists chk_profiles_description_len;
alter table public.profiles
  add constraint chk_profiles_description_len
  check (description is null or length(description) <= 1000);

alter table public.profiles
  drop constraint if exists chk_profiles_dealer_phone_len;
alter table public.profiles
  add constraint chk_profiles_dealer_phone_len
  check (dealer_phone is null or length(dealer_phone) <= 40);

alter table public.profiles
  drop constraint if exists chk_profiles_website_len;
alter table public.profiles
  add constraint chk_profiles_website_len
  check (website is null or length(website) <= 200);

alter table public.profiles
  drop constraint if exists chk_profiles_opening_hours_len;
alter table public.profiles
  add constraint chk_profiles_opening_hours_len
  check (opening_hours is null or length(opening_hours) <= 200);


-- ------------------------------------------------------------
-- БЛОК 2. get_dealer_profile — новые колонки В КОНЦЕ
-- ------------------------------------------------------------
-- Функция публичная (grant для anon): её читает страница витрины и
-- плитка салона, обе доступны гостю. Поэтому набор полей остаётся
-- СТРОГО ОГРАНИЧЕННЫМ — сюда попадает только то, что салон сам
-- опубликовал о себе.
--
-- Что НЕ отдаётся и почему:
--   profiles.phone   — логин аккаунта (0035). Публикация номера входа
--                      открыла бы канал для перебора кодов по SMS;
--   profiles.email   — адрес уведомлений;
--   trusted_seller   — по нему видно, чьи объявления не проверяются
--                      (0085 прямо это запрещает);
--   contact_person, contract_date — внутренние поля админки.
--
-- company_city отдаётся: город салона — публичный факт, покупатель по
-- нему и решает, ехать ли. До сих пор он был доступен только админке.
--
-- returns table меняется, поэтому функцию нужно СНАЧАЛА УДАЛИТЬ:
-- create or replace не умеет менять состав возвращаемых колонок и
-- падает с «cannot change return type of existing function». Права
-- после drop не сохраняются — grant повторяется ниже.
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
  -- Новое (0095). Строго в конце: клиенты читают поля по имени, но
  -- вставка в СЕРЕДИНУ сломала бы тех, кто читает по позиции
  -- (прямой SQL в отчётах).
  company_city  text,
  description   text,
  dealer_phone  text,
  website       text,
  opening_hours text
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
    -- лица неверно: это поля компании. update_seller_profile ниже их
    -- при переходе в 'private' затирает, однако полагаться только на
    -- запись нельзя — читающая сторона обязана быть согласована с
    -- пишущей.
    case when p.seller_kind = 'dealer' then nullif(trim(p.company_city), '')  end as company_city,
    case when p.seller_kind = 'dealer' then nullif(trim(p.description), '')   end as description,
    case when p.seller_kind = 'dealer' then nullif(trim(p.dealer_phone), '')  end as dealer_phone,
    case when p.seller_kind = 'dealer' then nullif(trim(p.website), '')       end as website,
    case when p.seller_kind = 'dealer' then nullif(trim(p.opening_hours), '') end as opening_hours
  from public.profiles p
  where p.id = p_user_id;
$$;

comment on function public.get_dealer_profile(uuid)
  is 'Публичная карточка продавца/дилера: имя витрины, логотип, «на площадке с», счётчики объявлений и поля витрины салона (0095)';

-- Доступна и гостю: страница дилера открывается по прямой ссылке без входа.
grant execute on function public.get_dealer_profile(uuid) to anon, authenticated;


-- ------------------------------------------------------------
-- БЛОК 3. update_seller_profile — новые параметры В КОНЦЕ
-- ------------------------------------------------------------
-- Сигнатура расширяется четырьмя параметрами с default null. Старый
-- вызов update_seller_profile(p_seller_kind, p_company_name,
-- p_logo_url) остаётся допустимым — Postgres подставит null в
-- недостающие. Это и есть требуемая аддитивность: приложение зовёт
-- функцию тремя аргументами и продолжает работать.
--
-- ВАЖНАЯ ТОНКОСТЬ: одного create or replace здесь мало. Прежняя
-- трёхаргументная версия осталась бы в базе ОТДЕЛЬНОЙ функцией
-- (сигнатуры различаются), и вызов с тремя аргументами стал бы
-- неоднозначным — подошли бы обе, Postgres отвечает «function is not
-- unique». Поэтому старую версию сначала удаляем по её точной
-- сигнатуре.
drop function if exists public.update_seller_profile(text, text, text);

create or replace function public.update_seller_profile(
  p_seller_kind   text,
  p_company_name  text default null,
  p_logo_url      text default null,
  -- Новое (0095). null означает «поле пустое» и трактуется как
  -- очистка — ровно так же, как это давно работает у p_logo_url.
  -- Различать «не трогай» и «сотри» функция с полной перезаписью
  -- профиля не может, да и незачем: форма кабинета всегда присылает
  -- все поля целиком.
  p_description   text default null,
  p_dealer_phone  text default null,
  p_website       text default null,
  p_opening_hours text default null
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

  update public.profiles p
     set seller_kind   = p_seller_kind,
         -- При возврате в 'private' затираем витрину дилера.
         company_name  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_company_name), '') end,
         logo_url      = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_logo_url), '') end,
         -- Новые поля витрины подчиняются тому же правилу: у частного
         -- лица их быть не должно, иначе после переключения роли на
         -- витрине остались бы «часы работы» несуществующего салона.
         description   = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_description), '') end,
         dealer_phone  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_dealer_phone), '') end,
         website       = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_website), '') end,
         opening_hours = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_opening_hours), '') end,
         updated_at    = now()
   where p.id = v_user
  returning p.* into v_profile;

  return v_profile;
end;
$$;

comment on function public.update_seller_profile(text, text, text, text, text, text, text)
  is 'Смена типа продавца (private/dealer) и полей витрины дилера: название, логотип, описание, телефон, сайт, часы работы (0095). Работает только со своим профилем';

grant execute on function public.update_seller_profile(text, text, text, text, text, text, text)
  to authenticated;


-- ------------------------------------------------------------
-- БЛОК 4. get_showcase_dealers — салоны для широкой плитки
-- ------------------------------------------------------------
-- Плитка салона показывает не только его данные, но и до трёх
-- миниатюр машин. Существующая get_site_dealers (0072) для этого не
-- годится: она сделана для sitemap и отдаёт лишь имя, дату и
-- счётчик — фотографий там нет вовсе.
--
-- ПОЧЕМУ ОДНА ФУНКЦИЯ, А НЕ ЗАПРОС НА КАЖДЫЙ САЛОН. Блок на главной
-- показывает несколько салонов; вызов get_seller_listings в цикле дал
-- бы классический N+1 — по обращению к базе на каждую плитку. Здесь
-- миниатюры собираются одним проходом в массив.
--
-- preview_photos text[] — массив адресов, а не json: клиент выводит их
-- подряд, и никаких полей, кроме самой ссылки, у миниатюры нет.
-- Массив строк для этого проще и легче.
--
-- ГЛАВНЫЙ КАДР ВЫБИРАЕТСЯ ТАК ЖЕ, КАК В КАТАЛОГЕ — первая картинка по
-- order_index (см. get_seller_listings, 0050). Возьми мы произвольную,
-- одна и та же машина выглядела бы в плитке салона иначе, чем в
-- каталоге, и это читалось бы как разные объявления.
create or replace function public.get_showcase_dealers(
  p_limit integer default 4
)
returns table (
  id             uuid,
  display_name   text,
  logo_url       text,
  company_city   text,
  description    text,
  active_cars    bigint,
  preview_photos text[]
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
    -- плитка показывает три: у части машин фотографии может не быть
    -- вовсе, и запас позволяет заполнить ряд, не делая второй запрос.
    -- Строки без картинки отфильтрованы — иначе на клиенте появился
    -- бы пустой квадрат вместо машины.
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
    ) as preview_photos
  from public.profiles p
  join public.cars c
    on c.user_id = p.id
   and c.status = 'active'
  where p.seller_kind = 'dealer'
  group by p.id, p.company_name, p.logo_url, p.company_city, p.description
  -- Крупные салоны первыми: плитка тем содержательнее, чем больше
  -- машин за ней стоит. Тот же порядок, что в get_site_dealers (0072).
  order by count(c.id) desc, max(c.updated_at) desc
  limit least(greatest(coalesce(p_limit, 4), 1), 24);
$$;

comment on function public.get_showcase_dealers(integer)
  is 'Салоны с активными объявлениями для широкой плитки-витрины: данные салона и до 6 адресов фотографий машин (0095)';

-- Публичная: плитка показывается гостю на главной.
grant execute on function public.get_showcase_dealers(integer) to anon, authenticated;
