-- ============================================================
-- AUTO.RS — Миграция 0103: email в заявке на статус автосалона
--                          и обязательные контактные поля
-- ============================================================
-- ЗАЧЕМ:
--   Две формы заявки — из профиля (submit_dealer_application, 0100) и
--   со страницы /dealers (submit_dealer_lead, 0053 + 0102) — должны
--   спрашивать одно и то же и в одном порядке. После 0102 состав почти
--   сошёлся, но заявка из профиля не спрашивала email вовсе, а город,
--   контактное лицо и телефон принимала пустыми.
--
--   Здесь: добавляется email, и контактные поля становятся
--   обязательными в ОБЕИХ RPC. Необязательным остаётся только сайт —
--   он есть не у каждого салона.
--
-- ПОЧЕМУ ПРОВЕРКА В RPC, А НЕ NOT NULL НА КОЛОНКАХ:
--   В dealer_applications уже лежат заявки, поданные до этой правки, с
--   пустыми городом и телефоном. NOT NULL не применился бы к таблице
--   с такими строками, а переписывать историю ради нового правила
--   нельзя: администратор одобрял то, что читал. Требование касается
--   НОВЫХ заявок, и его место — в функции приёма.
--
-- АДДИТИВНОСТЬ:
--   Колонка nullable. Параметр p_email добавлен В КОНЕЦ сигнатуры со
--   значением по умолчанию, поэтому прежние вызовы не ломаются
--   синтаксически. Требование заполненности — новое поведение внутри
--   функции, и оно одинаково для всех клиентов (см. CLAUDE.md, п. 3
--   о контракте бэкенда).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Колонка email
-- ------------------------------------------------------------
alter table public.dealer_applications
  add column if not exists email text;

comment on column public.dealer_applications.email
  is 'Контактная почта салона из заявки. Отдельно от profiles.email: заявитель входил по SMS, и почта аккаунта может отличаться от рабочей почты салона';


-- ------------------------------------------------------------
-- 2. submit_dealer_application: email + обязательные контакты
-- ------------------------------------------------------------
-- Меняется число аргументов, поэтому старую сигнатуру удаляем явно:
-- create or replace создал бы вторую функцию рядом, и вызов с восемью
-- аргументами стал бы неоднозначным.
drop function if exists public.submit_dealer_application(
  text, text, text, text, text, text, text, text);

create or replace function public.submit_dealer_application(
  p_company_name        text,
  p_tax_id              text,
  p_registration_number text,
  p_company_city        text default null,
  p_contact_person      text default null,
  p_phone               text default null,
  p_website             text default null,
  p_comment             text default null,
  -- Новый параметр — строго в конце сигнатуры.
  p_email               text default null
)
returns public.dealer_applications
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_app  public.dealer_applications;
  -- Реквизиты чистим от всего, что не цифра: человек наберёт PIB как
  -- «PIB 123 456 789» или «123-456-789», и требовать от него ровно
  -- девять символов подряд — придирка, которую легко снять здесь.
  v_tax  text := regexp_replace(coalesce(p_tax_id, ''), '[^0-9]', '', 'g');
  v_reg  text := regexp_replace(coalesce(p_registration_number, ''), '[^0-9]', '', 'g');
  -- Контактные поля приводим к «пусто = null» один раз здесь, чтобы
  -- ниже и проверять, и вставлять одно и то же значение.
  v_city   text := nullif(btrim(coalesce(p_company_city, '')), '');
  v_person text := nullif(btrim(coalesce(p_contact_person, '')), '');
  v_phone  text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email  text := nullif(btrim(coalesce(p_email, '')), '');
  v_site   text := nullif(btrim(coalesce(p_website, '')), '');
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Уже салон — заявка не нужна.
  if exists (
    select 1 from public.profiles p
     where p.id = v_user and p.seller_kind = 'dealer'
  ) then
    raise exception 'У вас уже есть статус автосалона'
      using errcode = 'check_violation';
  end if;

  if length(btrim(coalesce(p_company_name, ''))) < 2 then
    raise exception 'Укажите название автосалона'
      using errcode = 'check_violation';
  end if;

  if length(btrim(p_company_name)) > 120 then
    raise exception 'Название автосалона слишком длинное'
      using errcode = 'check_violation';
  end if;

  -- Проверяем ДЛИНУ ПОСЛЕ очистки: сообщение должно называть то, что
  -- от человека действительно требуется, — девять цифр, а не девять
  -- символов.
  if v_tax !~ '^[0-9]{9}$' then
    raise exception 'PIB состоит из 9 цифр'
      using errcode = 'check_violation';
  end if;

  if v_reg !~ '^[0-9]{8}$' then
    raise exception 'Матични број состоит из 8 цифр'
      using errcode = 'check_violation';
  end if;

  -- ---------- Контакты: теперь обязательны ----------
  -- До 0103 эти три поля принимались пустыми, и в очереди
  -- администратора оказывались заявки, по которым не с кем связаться.
  if v_city is null then
    raise exception 'Укажите город'
      using errcode = 'check_violation';
  end if;
  if length(v_city) > 100 then
    raise exception 'Название города слишком длинное'
      using errcode = 'check_violation';
  end if;

  if v_person is null then
    raise exception 'Укажите контактное лицо'
      using errcode = 'check_violation';
  end if;
  if length(v_person) > 120 then
    raise exception 'Имя контактного лица слишком длинное'
      using errcode = 'check_violation';
  end if;

  if v_phone is null then
    raise exception 'Укажите телефон'
      using errcode = 'check_violation';
  end if;
  if length(v_phone) > 40 then
    raise exception 'Телефон слишком длинный'
      using errcode = 'check_violation';
  end if;

  -- Почта: проверяем наличие и грубый формат. Строгую проверку по RFC
  -- здесь не строим — она отвергает валидные адреса чаще, чем ловит
  -- невалидные, а опечатку в домене всё равно поймает только письмо.
  if v_email is null then
    raise exception 'Укажите email'
      using errcode = 'check_violation';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Проверьте email'
      using errcode = 'check_violation';
  end if;
  if length(v_email) > 200 then
    raise exception 'Email слишком длинный'
      using errcode = 'check_violation';
  end if;

  -- Сайт остаётся необязательным: он есть не у каждого салона.
  if length(coalesce(v_site, '')) > 200 then
    raise exception 'Адрес сайта слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_comment, '')) > 1000 then
    raise exception 'Комментарий слишком длинный'
      using errcode = 'check_violation';
  end if;

  begin
    insert into public.dealer_applications (
      user_id, company_name, tax_id, registration_number,
      company_city, contact_person, phone, website, comment, email
    )
    values (
      v_user,
      btrim(p_company_name),
      v_tax,
      v_reg,
      v_city,
      v_person,
      v_phone,
      v_site,
      nullif(btrim(coalesce(p_comment, '')), ''),
      v_email
    )
    returning * into v_app;
  exception
    -- Вторая ОДНОВРЕМЕННО ждущая заявка: её отсекает уникальный
    -- индекс. Перехватываем, чтобы вернуть понятный текст вместо
    -- «duplicate key value violates unique constraint».
    -- Текст ДОСЛОВНО как в 0100: server action распознаёт причину по
    -- подстроке «уже отправлена» (app/my/actions.ts), и перефразировка
    -- превратила бы понятную причину в «неизвестную ошибку».
    when unique_violation then
      raise exception 'Ваша заявка уже отправлена и ждёт рассмотрения'
        using errcode = 'check_violation';
  end;

  return v_app;
end;
$fn$;

comment on function public.submit_dealer_application(
  text, text, text, text, text, text, text, text, text)
  is 'Подача заявки на статус автосалона. Обязательны реквизиты и контакты, необязателен только сайт';

grant execute on function public.submit_dealer_application(
  text, text, text, text, text, text, text, text, text) to authenticated;


-- ------------------------------------------------------------
-- 3. submit_dealer_lead: тот же состав обязательных полей
-- ------------------------------------------------------------
-- Форма на /dealers должна спрашивать ровно то же. Реквизиты и почта
-- становятся обязательными и здесь; сигнатура не меняется — меняются
-- только проверки внутри.
create or replace function public.submit_dealer_lead(
  p_company_name text,
  p_contact_name text,
  p_phone        text,
  p_email        text default null,
  p_city         text default null,
  p_comment      text default null,
  p_tax_id       text default null,
  p_reg_num      text default null,
  p_website      text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Номер приводим к цифрам и плюсу: '+381 60 123-45' и '+38160 12345'
  -- должны считаться одним номером, иначе ограничение частоты обходится
  -- простым добавлением пробела.
  v_phone   text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_company text := btrim(coalesce(p_company_name, ''));
  v_contact text := btrim(coalesce(p_contact_name, ''));
  v_tax     text := nullif(regexp_replace(coalesce(p_tax_id, ''), '[^0-9]', '', 'g'), '');
  v_reg     text := nullif(regexp_replace(coalesce(p_reg_num, ''), '[^0-9]', '', 'g'), '');
  v_email   text := nullif(btrim(coalesce(p_email, '')), '');
  v_city    text := nullif(btrim(coalesce(p_city, '')), '');
  v_site    text := nullif(btrim(coalesce(p_website, '')), '');
  v_recent  integer;
begin
  -- ---------- Валидация обязательных полей ----------
  if v_company = '' or length(v_company) > 200 then
    return json_build_object('ok', false, 'error', 'invalid_company');
  end if;

  if v_contact = '' or length(v_contact) > 200 then
    return json_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  -- Минимум 9 цифр — короче не бывает ни один валидный номер.
  if length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 9
     or length(v_phone) > 20 then
    return json_build_object('ok', false, 'error', 'invalid_phone');
  end if;

  -- Реквизиты обязательны: по ним администратор проверяет компанию
  -- в APR, и заявка без них означала бы разбор через переписку.
  if v_tax is null or v_tax !~ '^[0-9]{9}$' then
    return json_build_object('ok', false, 'error', 'invalid_tax_id');
  end if;

  if v_reg is null or v_reg !~ '^[0-9]{8}$' then
    return json_build_object('ok', false, 'error', 'invalid_reg_num');
  end if;

  -- Почта и город тоже обязательны — см. комментарий у
  -- submit_dealer_application выше.
  if v_email is null
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return json_build_object('ok', false, 'error', 'invalid_email');
  end if;

  if v_city is null then
    return json_build_object('ok', false, 'error', 'invalid_city');
  end if;

  -- Длины остальных полей.
  if length(v_email) > 200
     or length(v_city) > 100
     or length(coalesce(p_comment, '')) > 2000
     or length(coalesce(v_site, '')) > 200 then
    return json_build_object('ok', false, 'error', 'too_long');
  end if;

  -- ---------- Ограничение частоты ----------
  select count(*) into v_recent
  from public.dealer_leads d
  where d.phone = v_phone
    and d.created_at > now() - interval '24 hours';

  if v_recent >= 3 then
    return json_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.dealer_leads
    (company_name, contact_name, phone, email, city, comment,
     tax_id, registration_number, website)
  values (
    v_company,
    v_contact,
    v_phone,
    v_email,
    v_city,
    nullif(btrim(coalesce(p_comment, '')), ''),
    v_tax,
    v_reg,
    v_site
  );

  return json_build_object('ok', true);
end;
$$;

comment on function public.submit_dealer_lead(
  text, text, text, text, text, text, text, text, text)
  is 'Приём заявки автосалона с сайта. Аноним, 3 заявки на номер в сутки. Состав полей тот же, что в заявке из профиля; необязателен только сайт';

grant execute on function public.submit_dealer_lead(
  text, text, text, text, text, text, text, text, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 4. Очередь администратора: показать email заявки
-- ------------------------------------------------------------
-- Колонка в returns table меняет тип возврата, поэтому функцию
-- пересоздаём через drop.
drop function if exists public.admin_dealer_applications(text, integer, integer);

create or replace function public.admin_dealer_applications(
  p_status text    default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id                  uuid,
  user_id             uuid,
  status              text,
  company_name        text,
  tax_id              text,
  registration_number text,
  company_city        text,
  contact_person      text,
  phone               text,
  website             text,
  comment             text,
  -- Почта ИЗ ЗАЯВКИ (0103). Не путать с account_email ниже: рабочая
  -- почта салона может отличаться от почты аккаунта — ровно та же
  -- причина, по которой phone стоит отдельно от account_phone.
  email               text,
  reject_reason       text,
  created_at          timestamptz,
  reviewed_at         timestamptz,
  -- Контакты аккаунта заявителя.
  account_phone       text,
  account_email       text,
  account_name        text,
  -- Общее число строк под выбранный фильтр — для пагинации. Считается
  -- окном в том же запросе: отдельный count() означал бы второй проход
  -- по таблице ради числа под кнопкой «дальше».
  total_count         bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: заявки салонов доступны только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Недопустимая стадия: %', p_status
      using errcode = 'check_violation';
  end if;

  return query
  select
    a.id, a.user_id, a.status, a.company_name, a.tax_id, a.registration_number,
    a.company_city, a.contact_person, a.phone, a.website, a.comment, a.email,
    a.reject_reason, a.created_at, a.reviewed_at,
    p.phone, p.email, p.full_name,
    count(*) over ()
  from public.dealer_applications a
  left join public.profiles p on p.id = a.user_id
  where p_status is null or a.status = p_status
  -- Ждущие рассмотрения — всегда сверху, независимо от даты: это
  -- работа, а одобренные и отклонённые — архив. Внутри стадии свежие
  -- первыми.
  order by (a.status = 'pending') desc, a.created_at desc
  limit  least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

comment on function public.admin_dealer_applications(text, integer, integer)
  is 'Очередь заявок на статус автосалона с контактами заявителя. Ждущие сверху. Только для админа';

grant execute on function public.admin_dealer_applications(text, integer, integer) to authenticated;
