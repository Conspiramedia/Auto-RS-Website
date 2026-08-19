-- ============================================================
-- AUTO.RS — Миграция 0058: обращения с формы обратной связи (/contact).
-- ============================================================
-- Назначение: принять сообщение посетителя сайта, не заводя ему аккаунт.
-- Форма доступна анонимно — этого требует сам сценарий: человек пишет
-- в поддержку ИМЕННО потому, что у него что-то не получилось, и
-- требовать перед этим вход по SMS означало бы не получать обращения.
--
-- Построена по образцу submit_dealer_lead (миграция 0053): та же схема
-- «таблица закрыта RLS + SECURITY DEFINER RPC + серверный rate-лимит».
-- Второй сущности для лидов дилеров здесь НЕ создаётся: у них своя
-- таблица и свой процесс разбора.
--
-- ПОТРЕБИТЕЛЬ — САЙТ (components/ContactForm.tsx). В приложении эта
-- таблица не используется: поддержка там открывается своим экраном.
-- Миграция всё равно живёт в supabase/migrations, потому что это
-- единый источник истины по схеме для обоих клиентов одного Supabase.
--
-- ПОВТОРНЫЙ ЗАПУСК БЕЗОПАСЕН и ничего не разрушает:
-- create table if not exists, create index if not exists,
-- drop policy if exists перед create policy, create or replace function.
-- Данные существующей таблицы при повторном прогоне не затрагиваются.
--
-- Выполняется в Supabase SQL Editor под ролью владельца проекта.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Таблица обращений.
-- ------------------------------------------------------------
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),

  -- Тема обращения. Ограничена перечнем: свободная тема превращает
  -- разбор в чтение всех писем подряд. Значения совпадают с вариантами
  -- селектора на сайте (dict: contact_topic_*).
  topic text not null default 'general'
    check (topic in ('general', 'ad', 'abuse', 'privacy')),

  name text not null,
  email text not null,
  message text not null,

  -- Ссылка на объявление, если человек пишет по конкретной машине.
  -- Без внешнего ключа намеренно: объявление могут удалить, а обращение
  -- по нему обязано сохраниться вместе с адресом, который был в форме.
  car_id uuid,

  -- Служебное: с какой локали сайта пришло обращение. Нужно, чтобы
  -- ответить человеку на его языке.
  locale text not null default 'sr' check (locale in ('sr', 'ru')),

  -- Состояние разбора. Интерфейса пока нет, читается SQL-запросом.
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'done', 'spam')),

  created_at timestamptz not null default now()
);

comment on table public.contact_messages is
  'Обращения с формы обратной связи сайта (/contact). Пишутся только через RPC submit_contact_message.';

-- Индекс под разбор: свежие необработанные сверху.
create index if not exists idx_contact_messages_status_created
  on public.contact_messages (status, created_at desc);

-- Индекс под rate-лимит: проверка «сколько обращений с этой почты за сутки».
create index if not exists idx_contact_messages_email_created
  on public.contact_messages (lower(email), created_at desc);

-- ------------------------------------------------------------
-- 2. RLS: таблица закрыта полностью.
-- ------------------------------------------------------------
-- Политик на insert для anon НЕТ намеренно. Запись идёт исключительно
-- через SECURITY DEFINER функцию ниже: будь у анонима прямой INSERT,
-- он обошёл бы и валидацию, и rate-лимит, и мог бы проставить себе
-- любой status.
alter table public.contact_messages enable row level security;

-- Чтение — только администратору. Функция public.is_admin() заведена
-- ранее (используется политиками модерации объявлений).
drop policy if exists contact_messages_select_admin on public.contact_messages;
create policy contact_messages_select_admin
  on public.contact_messages
  for select
  to authenticated
  using (public.is_admin());

-- Обновление статуса при разборе — тоже только администратору.
drop policy if exists contact_messages_update_admin on public.contact_messages;
create policy contact_messages_update_admin
  on public.contact_messages
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- 3. RPC приёма обращения.
-- ------------------------------------------------------------
-- Возвращает jsonb: {ok: true} либо {ok: false, error: '<код>'}.
-- Коды ошибок совпадают с ключами словаря сайта (contact_err_*),
-- поэтому фронтенд показывает текст на языке пользователя и не
-- занимается разбором сообщений СУБД.
create or replace function public.submit_contact_message(
  p_name text,
  p_email text,
  p_message text,
  p_topic text default 'general',
  p_car_id uuid default null,
  p_locale text default 'sr'
)
returns jsonb
language plpgsql
security definer
-- Пустой search_path — обязательное требование безопасности для
-- SECURITY DEFINER: иначе вызывающий может подменить схему и заставить
-- функцию работать со своими объектами.
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_message text := btrim(coalesce(p_message, ''));
  v_topic text := coalesce(nullif(btrim(p_topic), ''), 'general');
  v_locale text := coalesce(nullif(btrim(p_locale), ''), 'sr');
  v_recent int;
begin
  -- ---------- Валидация ----------
  -- Сервер здесь источник истины: клиентские проверки в ContactForm
  -- нужны только для быстрой подсказки и обходятся тривиально.
  if length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  -- Проверка почты нарочно нестрогая: задача — отсечь мусор, а не
  -- реализовать RFC 5322. Слишком строгий шаблон отклоняет валидные
  -- адреса и лишает человека возможности написать в поддержку.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  if length(v_message) < 10 then
    return jsonb_build_object('ok', false, 'error', 'invalid_message');
  end if;

  if length(v_name) > 200
     or length(v_email) > 200
     or length(v_message) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;

  if v_topic not in ('general', 'ad', 'abuse', 'privacy') then
    v_topic := 'general';
  end if;

  if v_locale not in ('sr', 'ru') then
    v_locale := 'sr';
  end if;

  -- ---------- Rate-лимит ----------
  -- 3 обращения с одного адреса за сутки. Считается на сервере: любой
  -- клиентский счётчик обходится очисткой localStorage.
  -- Лимит именно 3, а не 1: человеку свойственно дописывать забытое,
  -- и блокировать вторую же попытку означало бы терять обращения.
  select count(*)
    into v_recent
    from public.contact_messages
   where lower(email) = v_email
     and created_at > now() - interval '24 hours';

  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  -- ---------- Запись ----------
  insert into public.contact_messages (topic, name, email, message, car_id, locale)
  values (v_topic, v_name, v_email, v_message, p_car_id, v_locale);

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.submit_contact_message is
  'Приём обращения с формы /contact: валидация, лимит 3 обращения на адрес за 24 часа.';

-- Право вызова: аноним и вошедший пользователь. Публичность формы —
-- её смысл, а защита обеспечена валидацией и лимитом внутри функции.
revoke all on function public.submit_contact_message(text, text, text, text, uuid, text) from public;
grant execute on function public.submit_contact_message(text, text, text, text, uuid, text) to anon, authenticated;

-- ============================================================
-- Проверка после применения:
--
--   select public.submit_contact_message(
--     'Test', 'test@example.com', 'Poruka duza od deset znakova', 'general');
--   -- ожидается {"ok": true}
--
--   select count(*) from public.contact_messages;  -- 1
--
-- Удалить тестовую запись:
--   delete from public.contact_messages where email = 'test@example.com';
-- ============================================================
