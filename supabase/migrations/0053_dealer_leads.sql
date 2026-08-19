-- ============================================================
-- AUTO.RS — Миграция 0053: заявки автосалонов с сайта
-- ============================================================
-- ЗАЧЕМ:
--   На странице /dealers сайт предлагает автосалонам оффер «первые 3 месяца
--   бесплатно». Заявку оставляет НЕАВТОРИЗОВАННЫЙ посетитель — заставлять
--   дилера регистрироваться до первого контакта значит терять его.
--
--   Поэтому нужна отдельная таблица заявок. Она НЕ дублирует profiles:
--   там живут учётные записи существующих пользователей, а здесь — входящие
--   обращения, которые ещё не стали аккаунтами.
--
-- БЕЗОПАСНОСТЬ (главное в этой миграции):
--   Форма открыта анониму, а значит открыта и спамерам. Защита слоями:
--     1. Вставка ТОЛЬКО через SECURITY DEFINER RPC. Прямого INSERT для
--        anon нет — политика на запись не создаётся вовсе.
--     2. Ограничение частоты на стороне БД: не более 3 заявок с одного
--        номера телефона в сутки. Клиентскую проверку обойти тривиально,
--        серверную — нет.
--     3. Валидация длины полей в самой функции: без неё бот залил бы в
--        таблицу мегабайты текста.
--   Читать заявки может только администратор — в них персональные данные.
-- ============================================================

create table if not exists public.dealer_leads (
  id            uuid        primary key default uuid_generate_v4(),
  company_name  text        not null,
  contact_name  text        not null,
  phone         text        not null,
  email         text,
  city          text,
  comment       text,
  -- Стадия обработки заявки менеджером.
  status        text        not null default 'new',
  created_at    timestamptz not null default now(),

  constraint chk_dealer_lead_status
    check (status in ('new', 'in_progress', 'done', 'rejected'))
);

comment on table public.dealer_leads
  is 'Заявки автосалонов с сайта (/dealers). Заполняются анонимно через RPC, читает только админ';

-- Индекс под разбор заявок менеджером: сначала новые.
create index if not exists idx_dealer_leads_created
  on public.dealer_leads (created_at desc);

-- Индекс под проверку частоты подачи с одного номера.
create index if not exists idx_dealer_leads_phone_time
  on public.dealer_leads (phone, created_at desc);


-- ------------------------------------------------------------
-- RLS: чтение — только администратор, записи напрямую нет ни у кого
-- ------------------------------------------------------------
alter table public.dealer_leads enable row level security;

drop policy if exists "dealer_leads_select_admin" on public.dealer_leads;
create policy "dealer_leads_select_admin" on public.dealer_leads
  for select to authenticated
  using (public.is_admin());

drop policy if exists "dealer_leads_update_admin" on public.dealer_leads;
create policy "dealer_leads_update_admin" on public.dealer_leads
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Политики INSERT намеренно НЕТ: единственный путь записи — RPC ниже.


-- ------------------------------------------------------------
-- RPC: submit_dealer_lead(...) — приём заявки от анонима
-- ------------------------------------------------------------
-- Возврат json { ok, error } вместо исключения: форма на сайте должна
-- показать человеку понятный текст, а не «500 Internal Server Error».
-- ------------------------------------------------------------
create or replace function public.submit_dealer_lead(
  p_company_name text,
  p_contact_name text,
  p_phone        text,
  p_email        text default null,
  p_city         text default null,
  p_comment      text default null
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

  -- Необязательные поля тоже ограничиваем по длине: иначе бот зальёт
  -- в comment сколько угодно текста.
  if length(coalesce(p_email, '')) > 200
     or length(coalesce(p_city, '')) > 100
     or length(coalesce(p_comment, '')) > 2000 then
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
    (company_name, contact_name, phone, email, city, comment)
  values (
    v_company,
    v_contact,
    v_phone,
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_comment, '')), '')
  );

  return json_build_object('ok', true);
end;
$$;

comment on function public.submit_dealer_lead(text, text, text, text, text, text)
  is 'Приём заявки автосалона с сайта. Аноним, с ограничением 3 заявки на номер в сутки';

grant execute on function public.submit_dealer_lead(
  text, text, text, text, text, text) to anon, authenticated;
