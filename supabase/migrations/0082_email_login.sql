-- ============================================================
-- AUTO.RS — Миграция 0082: вход по электронной почте.
-- ------------------------------------------------------------
-- Второй способ входа на сайт — код на почту. Заведён потому, что
-- первый администратор площадки зарегистрирован без телефона, а вход
-- по SMS требует сербского мобильного: без этой миграции попасть в
-- /admin ему нечем.
--
-- ЧТО ЗДЕСЬ ЕСТЬ:
--   1) rpc_check_email_login  — гейт и квота ПЕРЕД запросом кода;
--   2) email_login_allowed    — та же проверка для Send Email Hook;
--   3) otp_email_log          — журнал отправок (квота);
--   4) rpc_cleanup_email_log  — обслуживание журнала.
--
-- ЧЕГО ЗДЕСЬ НЕТ И БЫТЬ НЕ ДОЛЖНО:
--
--   Кодов. Ни одной таблицы с кодами, ни одной функции, которая код
--   отдаёт или проверяет. Код генерирует, хранит и сверяет GoTrue —
--   тот же механизм, что у SMS. Своя таблица кодов означала бы ВТОРОЙ
--   путь аутентификации в обход Auth, а два пути к сессии — это
--   вдвое больше мест, где её можно получить незаконно.
--
--   Регистрации. Вход по почте открывает существующий аккаунт и
--   только его. Новых пользователей этим каналом не создаётся:
--   в Dashboard → Authentication → Providers → Email обязан быть
--   отключён «Allow new users to sign up» либо включён
--   «Confirm email». Гейт ниже — второй рубеж, а не единственный.
--
-- ============================================================
-- КАК ЭТО РАБОТАЕТ ЦЕЛИКОМ (важно для того, кто будет чинить)
-- ============================================================
--   1. Пользователь вводит почту на /login → вкладка «Почта».
--   2. Клиент зовёт rpc_check_email_login(email). Она отвечает
--      allowed=true ТОЛЬКО если такой профиль есть И у него
--      is_admin = true И суточная квота не исчерпана. Заодно
--      списывает квоту.
--   3. При allowed=false клиент показывает нейтральное «Для этого
--      адреса вход по почте не настроен» — одинаково и для чужого
--      адреса, и для существующего не-админа. Запрос к GoTrue при
--      этом НЕ уходит вовсе.
--   4. При allowed=true клиент зовёт signInWithOtp({ email }).
--      GoTrue генерирует код и просит Send Email Hook его отправить.
--   5. Хук (Edge Function auth-email-hook) ещё раз проверяет права
--      через email_login_allowed() — теперь уже на сервере, куда
--      клиент дотянуться не может, — и шлёт письмо через Resend
--      нашим шаблоном login_code на языке получателя.
--   6. Пользователь вводит код, клиент зовёт verifyOtp({ email,
--      token, type: 'email' }). Сессию выдаёт GoTrue.
--
-- ПОЧЕМУ ПРОВЕРКА ДВАЖДЫ. Шаг 2 — про удобство и про экономию: он
-- даёт понятный ответ и не гоняет GoTrue впустую. Шаг 5 — настоящая
-- защита: клиентскую RPC можно не вызывать вовсе и дёрнуть
-- signInWithOtp напрямую из консоли браузера. Тогда код сгенерируется,
-- но письмо не уйдёт — хук откажет. Код, который никому не отправлен,
-- бесполезен.
-- ============================================================


-- ============================================================
-- 1) ЖУРНАЛ ОТПРАВОК: public.otp_email_log
-- ------------------------------------------------------------
-- Зеркало otp_send_log (0040) для почтового канала. Отдельная
-- таблица, а не колонка «канал» в существующей: у них разные ключи
-- (номер против адреса), разные лимиты и разная цена ошибки —
-- SMS стоит денег, письмо почти нет.
--
-- ip хранится текстом и БЕЗ индекса по одному себе: он нужен только
-- вместе с окном времени, и составной индекс ниже это покрывает.
-- ============================================================
create table if not exists public.otp_email_log (
  id         bigint      generated always as identity primary key,
  email      text        not null,
  -- Адрес запросившего. Может быть null: клиент его не передаёт,
  -- заполняется только при вызове из Edge Function, которая видит
  -- заголовки запроса.
  ip         text,
  created_at timestamptz not null default now()
);

comment on table public.otp_email_log
  is 'Журнал запросов кода на почту: квота по адресу и по IP';

-- Под выборку «сколько отправок на адрес за сутки».
create index if not exists otp_email_log_email_time_idx
  on public.otp_email_log (email, created_at desc);

-- Под выборку «сколько отправок с одного IP за час». Частичный:
-- строки без ip в этот запрос не попадают никогда.
create index if not exists otp_email_log_ip_time_idx
  on public.otp_email_log (ip, created_at desc)
  where ip is not null;

-- RLS: таблица закрыта полностью, политик нет намеренно. Доступ
-- только через definer-функции ниже. Плюс явный revoke: RLS не
-- отменяет табличные гранты, которые Supabase выдаёт новым таблицам
-- схемы public по умолчанию.
alter table public.otp_email_log enable row level security;
revoke all on public.otp_email_log from anon, authenticated;


-- ============================================================
-- 2) email_login_allowed — ЯДРО ГЕЙТА
-- ------------------------------------------------------------
-- Отвечает на один вопрос: можно ли этому адресу входить по почте.
-- Вынесена отдельно от квоты, потому что вызывается дважды и с
-- разными намерениями: клиентской RPC (со списанием квоты) и хуком
-- отправки письма (без списания — квоту уже списали на шаге 2).
--
-- УСЛОВИЕ ГЕЙТА — is_admin. Канал заведён ради администраторов, и
-- открывать его всем сразу нельзя: у обычного продавца почта в
-- профиле часто чужая или устаревшая (её вводят руками), и вход по
-- ней стал бы дырой в чужой аккаунт.
--
-- КОГДА ОТКРЫВАТЬ ВСЕМ: заменить условие p.is_admin на
-- p.email is not null. Одна строка — это и был расчёт при
-- проектировании. Но перед этим обязательно: подтверждение почты
-- при её смене в профиле, иначе смена почты станет способом угона.
--
-- Нормализация адреса: lower + btrim. Почта регистронезависима в
-- домене и на практике в локальной части тоже; «Admin@RS.rs» и
-- «admin@rs.rs» обязаны быть одним адресом, иначе квота обходится
-- сменой регистра.
-- ============================================================
create or replace function public.email_login_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.profiles p
     where lower(btrim(p.email)) = lower(btrim(coalesce(p_email, '')))
       and p.is_admin
  );
$fn$;

comment on function public.email_login_allowed(text)
  is 'true, если адресу разрешён вход по почте (сейчас — только администраторам)';

-- Клиенту НЕ выдаётся: голая проверка «есть ли такой админ» — это
-- готовый перебор адресов. Наружу ходит только rpc_check_email_login,
-- которая отвечает нейтрально и тратит квоту на каждую попытку.
revoke all on function public.email_login_allowed(text) from public, anon, authenticated;


-- ============================================================
-- 3) rpc_check_email_login — гейт + квота для клиента
-- ------------------------------------------------------------
-- Вызывается АНОНИМНО, до входа. Возвращает json той же формы, что
-- rpc_check_otp_quota (0040), — фронтенд обрабатывает оба ответа
-- одинаково.
--
-- ОТВЕТ НЕЙТРАЛЕН И НЕ РАЗЛИЧАЕТ ПРИЧИНУ. allowed=false приходит и
-- когда адреса нет вовсе, и когда он есть, но не админский. Разные
-- ответы превратили бы форму входа в способ проверять, кто
-- зарегистрирован на площадке.
--
-- КВОТА СПИСЫВАЕТСЯ И ПРИ ОТКАЗЕ ПО ГЕЙТУ — это не мелочь. Списывай
-- мы только успешные попытки, перебор адресов был бы бесплатным:
-- отказ по гейту не тратил бы ничего, и перебрать тысячу адресов
-- можно было бы за минуту. Теперь на каждый адрес приходится
-- отдельный счётчик, а на IP — свой.
--
-- Два лимита с разным окном:
--   5 писем на адрес за 24 часа — защита почтового ящика владельца
--     от заваливания кодами;
--   20 запросов с IP за час — защита от перебора адресов. Час, а не
--     сутки: administrator, потерявший письмо, не должен ждать до
--     завтра из-за собственных повторов.
-- ============================================================
create or replace function public.rpc_check_email_login(
  p_email text,
  p_ip    text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_limit_email constant int := 5;    -- писем на адрес за 24 часа
  v_limit_ip    constant int := 20;   -- запросов с IP за час
  v_email       text;
  v_ip          text;
  v_used_email  int;
  v_used_ip     int;
begin
  v_email := lower(btrim(coalesce(p_email, '')));
  v_ip    := nullif(btrim(coalesce(p_ip, '')), '');

  -- Грубая проверка формы адреса. Не валидация по RFC — задача здесь
  -- другая: не пускать в журнал мусор, по которому квота считалась бы
  -- отдельными строками на каждый вариант.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return json_build_object(
      'allowed', false, 'used', 0, 'limit', v_limit_email, 'remaining', 0
    );
  end if;

  -- ---------- Лимит по IP ----------
  -- Проверяется ПЕРВЫМ и до гейта: перебор адресов идёт с одного
  -- адреса, и остановить его надо раньше, чем он потратит квоты
  -- десятков чужих ящиков.
  if v_ip is not null then
    select count(*) into v_used_ip
      from public.otp_email_log
     where ip = v_ip
       and created_at > now() - interval '1 hour';

    if v_used_ip >= v_limit_ip then
      return json_build_object(
        'allowed', false, 'used', v_used_ip, 'limit', v_limit_ip, 'remaining', 0
      );
    end if;
  end if;

  -- ---------- Лимит по адресу ----------
  select count(*) into v_used_email
    from public.otp_email_log
   where email = v_email
     and created_at > now() - interval '24 hours';

  if v_used_email >= v_limit_email then
    return json_build_object(
      'allowed', false, 'used', v_used_email, 'limit', v_limit_email, 'remaining', 0
    );
  end if;

  -- Попытку записываем ДО проверки гейта — см. комментарий к функции:
  -- иначе перебор адресов ничего не стоит.
  insert into public.otp_email_log (email, ip) values (v_email, v_ip);

  -- ---------- Гейт ----------
  if not public.email_login_allowed(v_email) then
    return json_build_object(
      'allowed',   false,
      'used',      v_used_email + 1,
      'limit',     v_limit_email,
      'remaining', v_limit_email - (v_used_email + 1)
    );
  end if;

  return json_build_object(
    'allowed',   true,
    'used',      v_used_email + 1,
    'limit',     v_limit_email,
    'remaining', v_limit_email - (v_used_email + 1)
  );
end;
$fn$;

comment on function public.rpc_check_email_login(text, text)
  is 'Гейт и квота перед запросом кода на почту. Ответ нейтрален: не различает «адреса нет» и «вход не разрешён»';

-- Аноним — потому что вызывается до входа.
grant execute on function public.rpc_check_email_login(text, text) to anon, authenticated;


-- ============================================================
-- 4) Обслуживание журнала
-- ------------------------------------------------------------
-- Зеркало rpc_cleanup_otp_log (0040). Двое суток хватает: окна
-- квот — 24 часа и 1 час.
-- ============================================================
create or replace function public.rpc_cleanup_email_log()
returns void
language sql
security definer
set search_path = public
as $fn$
  delete from public.otp_email_log
   where created_at < now() - interval '2 days';
$fn$;

comment on function public.rpc_cleanup_email_log()
  is 'Очистка журнала запросов кода на почту (старше 2 суток)';

revoke all on function public.rpc_cleanup_email_log() from public, anon, authenticated;
