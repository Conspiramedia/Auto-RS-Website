-- ============================================================
-- RS AUTO — Миграция 0097: салон сам указывает свой город.
-- ============================================================
-- ЗАЧЕМ. company_city завели в 0085 для АДМИНКИ: администратор
-- проставлял город при заключении договора, а салон видел его в
-- профиле только для чтения. Пока поле было внутренним, это работало.
--
-- Теперь город показывается ПОКУПАТЕЛЮ — в плитке салона в каталоге
-- (левый блок, под описанием) и в шапке публичной страницы. И вот
-- здесь прежний порядок ломается: салон видит в своей карточке пустое
-- место, знает, что там должен быть город, но заполнить его не может
-- — нужно писать администратору. Ради одной строки текста это
-- несоразмерная процедура.
--
-- ЧТО МЕНЯЕТСЯ: у update_seller_profile появляется восьмой параметр
-- p_company_city, и функция пишет это поле так же, как остальные поля
-- витрины.
--
-- АДМИНКА НЕ ЛОМАЕТСЯ. Она правит profiles напрямую (admin_* функции
-- из 0085), а не через эту RPC, и продолжит это делать. Просто теперь
-- у поля два законных источника: администратор при заключении
-- договора и сам салон в кабинете. Конфликта нет — кто написал
-- последним, того значение и стоит, как у любого редактируемого поля.
--
-- АДДИТИВНОСТЬ. Параметр добавлен В КОНЕЦ и имеет default null,
-- поэтому вызов приложения (Flutter) тремя аргументами продолжает
-- работать. Как и в 0095, прежняя сигнатура сначала удаляется: иначе
-- в базе осталось бы две функции, и вызов стал бы неоднозначным
-- («function is not unique»).
--
-- ВНИМАНИЕ НА ПОБОЧНЫЙ ЭФФЕКТ. Функция перезаписывает профиль целиком,
-- то есть непереданный параметр затирает поле в NULL. Для города это
-- значит: любой клиент, который зовёт update_seller_profile и НЕ
-- передаёт p_company_city, обнулит город салона. Сейчас таких
-- клиентов два — сайт (передаёт) и приложение (зовёт тремя
-- аргументами, но у него и seller_kind тогда приходит без полей
-- витрины, то есть профиль и так перезаписывается целиком). Это то же
-- поведение, что уже действует для description и logo_url с 0095, —
-- новое поле лишь встаёт в общий ряд.
-- ============================================================

drop function if exists public.update_seller_profile(
  text, text, text, text, text, text, text
);

create or replace function public.update_seller_profile(
  p_seller_kind   text,
  p_company_name  text default null,
  p_logo_url      text default null,
  p_description   text default null,
  p_dealer_phone  text default null,
  p_website       text default null,
  p_opening_hours text default null,
  -- Новое (0097). Город салона — теперь редактируется владельцем.
  -- Значение НЕ проверяется по справочнику: список из 18 крупных
  -- городов в lib/referenceData.ts — подсказка, а не ограничение,
  -- и салон из посёлка обязан иметь возможность вписать своё. Ровно
  -- так же ведёт себя город объявления (allowCustom в форме подачи).
  p_company_city  text default null
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
         updated_at    = now()
   where p.id = v_user
  returning p.* into v_profile;

  return v_profile;
end;
$$;

comment on function public.update_seller_profile(
  text, text, text, text, text, text, text, text
) is 'Смена типа продавца (private/dealer) и полей витрины дилера: название, логотип, описание, телефон, сайт, часы работы, город (0097). Работает только со своим профилем';

grant execute on function public.update_seller_profile(
  text, text, text, text, text, text, text, text
) to authenticated;
