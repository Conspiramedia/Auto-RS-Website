-- ============================================================
-- AUTO.RS — Миграция 0102: реквизиты компании в заявке с /dealers
-- ============================================================
-- ЗАЧЕМ:
--   Заявку на статус автосалона можно оставить двумя путями:
--     1. из профиля  → submit_dealer_application (0100), нужен вход;
--     2. со страницы /dealers → submit_dealer_lead (0053), аноним.
--
--   Второй путь спрашивал только название, контакт, телефон, email,
--   город и комментарий. Первый — ещё и PIB с матичним бројем, по
--   которым администратор и проверяет компанию в APR. Из-за этого
--   анонимные заявки приходили без единственных данных, которые
--   реально нужны для проверки, и разбор начинался с переписки.
--
--   Здесь поля выравниваются: в dealer_leads добавляются те же
--   реквизиты. ОБЯЗАТЕЛЬНЫМИ ОНИ НЕ СТАНОВЯТСЯ — в этом разница
--   двух путей. Лид остаётся лидом: администратор связывается сам,
--   статус автосалона по нему не выдаётся, и требовать выписку APR
--   до первого разговора значит терять салон на пороге.
--
-- АДДИТИВНОСТЬ:
--   Колонки nullable и без DEFAULT — старые строки не переписываются.
--   Параметры RPC добавлены В КОНЕЦ сигнатуры со значением по
--   умолчанию null, поэтому прежние вызовы с шестью аргументами
--   продолжают работать без изменений (мобильное приложение эту RPC
--   не вызывает, но правило то же).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Колонки реквизитов
-- ------------------------------------------------------------
alter table public.dealer_leads
  add column if not exists tax_id              text,
  add column if not exists registration_number text,
  add column if not exists website             text;

comment on column public.dealer_leads.tax_id
  is 'PIB, 9 цифр. Необязателен: заявка с /dealers — лид, а не заявка на статус';
comment on column public.dealer_leads.registration_number
  is 'Матични број, 8 цифр. Необязателен, см. tax_id';
comment on column public.dealer_leads.website
  is 'Сайт автосалона, необязателен';

-- CHECK, а не проверка только в RPC: колонки могут быть заполнены и
-- будущим импортом, а формат «девять цифр» от источника не зависит.
-- Условие пропускает null — поле необязательное.
alter table public.dealer_leads
  drop constraint if exists chk_dealer_lead_tax_id;
alter table public.dealer_leads
  add constraint chk_dealer_lead_tax_id
  check (tax_id is null or tax_id ~ '^[0-9]{9}$');

alter table public.dealer_leads
  drop constraint if exists chk_dealer_lead_reg_num;
alter table public.dealer_leads
  add constraint chk_dealer_lead_reg_num
  check (registration_number is null or registration_number ~ '^[0-9]{8}$');


-- ------------------------------------------------------------
-- 2. RPC: те же три поля, опционально
-- ------------------------------------------------------------
-- CREATE OR REPLACE здесь НЕ ГОДИТСЯ: у функции меняется число
-- аргументов, а значит это другая сигнатура — Postgres создал бы
-- вторую функцию рядом, и вызов с шестью аргументами стал бы
-- неоднозначным. Поэтому старую удаляем явно.
drop function if exists public.submit_dealer_lead(
  text, text, text, text, text, text);

create or replace function public.submit_dealer_lead(
  p_company_name text,
  p_contact_name text,
  p_phone        text,
  p_email        text default null,
  p_city         text default null,
  p_comment      text default null,
  -- Новые параметры — строго в конце сигнатуры.
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
  -- Реквизиты чистим от всего, кроме цифр, — той же логикой, что в
  -- submit_dealer_application (0100): человек набирает PIB как
  -- «123 456 789» или «PIB 123-456-789», и придираться к пробелу,
  -- который сервер и так выбросит, незачем.
  v_tax     text := nullif(regexp_replace(coalesce(p_tax_id, ''), '[^0-9]', '', 'g'), '');
  v_reg     text := nullif(regexp_replace(coalesce(p_reg_num, ''), '[^0-9]', '', 'g'), '');
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

  -- ---------- Реквизиты: пусто можно, кривое — нельзя ----------
  -- Заполнил человек PIB — проверяем формат. Не заполнил — пропускаем
  -- заявку дальше: поле необязательное по замыслу.
  if v_tax is not null and v_tax !~ '^[0-9]{9}$' then
    return json_build_object('ok', false, 'error', 'invalid_tax_id');
  end if;

  if v_reg is not null and v_reg !~ '^[0-9]{8}$' then
    return json_build_object('ok', false, 'error', 'invalid_reg_num');
  end if;

  -- Необязательные поля тоже ограничиваем по длине: иначе бот зальёт
  -- в comment сколько угодно текста.
  if length(coalesce(p_email, '')) > 200
     or length(coalesce(p_city, '')) > 100
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
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
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
  is 'Приём заявки автосалона с сайта. Аноним, с ограничением 3 заявки на номер в сутки. Реквизиты (PIB, матични број, сайт) необязательны';

grant execute on function public.submit_dealer_lead(
  text, text, text, text, text, text, text, text, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 3. Реквизиты — в письмо администратору
-- ------------------------------------------------------------
-- Письмо о заявке (0071) собирало payload из шести полей. Реквизиты
-- в него не попадали бы, и админ, получив письмо, всё равно шёл бы в
-- админку за PIB — то есть письмо переставало быть самодостаточным.
--
-- Триггер и его имя не меняются, меняется только состав payload:
-- шаблон письма читает поля по ключам и пропускает пустые.
create or replace function public.email_on_dealer_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.f_enqueue_email(
    public.f_admin_email(),
    'dealer_lead_admin',
    jsonb_build_object(
      -- Письма администратору всегда на русском: служебный ящик читает
      -- команда площадки, а не клиент. Сербский здесь только мешал бы.
      'locale',       'ru',
      'lead_id',      new.id,
      'company_name', new.company_name,
      'contact_name', new.contact_name,
      'phone',        new.phone,
      'email',        new.email,
      'city',         new.city,
      'comment',      new.comment,
      -- Новое (0102). Поля необязательные: пустые шаблон отбросит сам.
      'tax_id',       new.tax_id,
      'reg_num',      new.registration_number,
      'website',      new.website
    ),
    null                       -- получатель не пользователь площадки
  );

  return new;
end;
$$;
