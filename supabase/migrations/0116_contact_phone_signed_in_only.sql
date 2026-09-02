-- ============================================================
-- 0116 — ТЕЛЕФОН ПРОДАВЦА ТОЛЬКО ВОШЕДШИМ
-- ============================================================
-- ЧТО БЫЛО. get_car_details отдавала contact_phone любому, кто знает
-- id объявления: условие в case-выражении проверяло только статус
-- («active» или «sold»), но не наличие сессии. Сайт номер не
-- показывал, и со стороны интерфейса это выглядело безопасно — на
-- деле же анонимный вызов RPC отдавал контакты продавца сплошным
-- списком. Обход каталога и сбор всех номеров стоил бы перекупу
-- нескольких минут.
--
-- ЧТО СТАЛО. К прежнему условию добавлена проверка auth.uid() is not
-- null. Телефон видит тот, кто вошёл, — а вход теперь по почте
-- (0106), то есть за номером стоит подтверждённый адрес, по которому
-- нарушителя видно.
--
-- ВЛАДЕЛЬЦА И АДМИНИСТРАТОРА НЕ ЗАТРАГИВАЕТ: у них full_access, и
-- ветка с ним стоит первой — свой номер владелец видит всегда, в том
-- числе у снятого объявления.
--
-- ПОЧЕМУ ТОЛЬКО ТЕЛЕФОН. Остальные поля (цена, описание, имя
-- продавца) остаются публичными намеренно: на них держится SEO, и
-- закрытая цена сделала бы карточку бесполезной для поиска. Телефон
-- в выдаче не участвует и в разметке Vehicle не публикуется — его
-- закрытие не стоит площадке ни одной позиции.
--
-- КОНТРАКТ НЕ МЕНЯЕТСЯ: набор колонок, их порядок и типы прежние,
-- меняется только значение одной из них для анонимного вызова.
-- Мобильное приложение зовёт ту же функцию и получает ту же
-- перемену — там пользователь тоже входит перед звонком.
-- ============================================================

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
  updated_at        timestamptz,
  archived_by       text,
  archived_reason   text
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
    -- ТЕЛЕФОН: ДВА УСЛОВИЯ СРАЗУ.
    -- 1) объявление опубликовано — снятое не должно приводить звонки;
    -- 2) вызывающий вошёл — анонимный обход каталога больше не
    --    собирает контакты продавцов (см. шапку миграции).
    -- Владелец и администратор идут по ветке full_access и обе
    -- проверки минуют.
    case when v.full_access
              or (auth.uid() is not null
                  and v.status in ('active', 'sold'))
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
    v.created_at, v.updated_at,
    -- Авторство и причина снятия — только владельцу и админу.
    -- Отдаём текстом, а не enum: клиентские библиотеки получают
    -- пользовательский тип строкой, и тип не протекает наружу.
    case when v.full_access then v.archived_by::text end,
    case when v.full_access then v.archived_reason end
  from viewer v
  join public.profiles p on p.id = v.user_id
  where
    -- Публично: активные и проданные — полностью.
    v.status in ('active', 'sold')
    -- Снятые, отклонённые и ушедшие на перепроверку — в урезанном
    -- виде (см. case-выражения выше). Нужны, чтобы ссылка из выдачи
    -- вела на страницу «объявление снято», а не на голую 404.
    -- expired добавлен к снятым (0113): для читателя это тот же
    -- случай «объявление сейчас не опубликовано», и заводить второй
    -- вариант поведения незачем.
    or v.status in ('archived', 'rejected', 'moderation', 'expired')
    -- Владельцу и администратору — всё и всегда.
    or v.full_access;
$$;

comment on function public.get_car_details(uuid)
  is 'Детали объявления. Снятым (archived/rejected/moderation/expired) отдаёт только марку/модель/год/город без цен, контактов и данных продавца. Телефон — только вошедшим (0116)';
