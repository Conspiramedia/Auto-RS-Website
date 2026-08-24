-- ============================================================
-- AUTO.RS — Проверка миграции 0082 (вход по почте).
-- ============================================================
-- Блоки 1–5 только читают каталоги. Блок 6 — ручной.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Функции существуют в единственном экземпляре, definer,
--    search_path закреплён.
-- ------------------------------------------------------------
select
  p.proname                                    as function_name,
  count(*)                                     as overloads,
  bool_and(p.prosecdef)                        as security_definer,
  bool_and('search_path=public' = any(coalesce(p.proconfig, array[]::text[])))
                                               as search_path_pinned,
  case
    when count(*) = 1
     and bool_and(p.prosecdef)
     and bool_and('search_path=public' = any(coalesce(p.proconfig, array[]::text[])))
    then 'ok'
    else 'ВНИМАНИЕ: перегрузки, нет definer или незакреплённый search_path'
  end                                          as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'email_login_allowed', 'rpc_check_email_login', 'rpc_cleanup_email_log'
  )
group by p.proname
order by p.proname;


-- ------------------------------------------------------------
-- 2) ГЛАВНОЕ ПО БЕЗОПАСНОСТИ: гранты.
-- ------------------------------------------------------------
-- rpc_check_email_login — anon (вызывается до входа).
-- email_login_allowed   — НИКОМУ из клиентских ролей: голая проверка
--   «есть ли такой админ» это готовый перебор адресов. Наружу ходит
--   только rpc_check_email_login, которая отвечает нейтрально и
--   тратит квоту на каждую попытку.
-- rpc_cleanup_email_log — никому: обслуживание.
select
  p.proname                                                 as function_name,
  has_function_privilege('anon',          p.oid, 'execute') as anon_can,
  has_function_privilege('authenticated', p.oid, 'execute') as auth_can,
  case
    when p.proname = 'rpc_check_email_login'
     and has_function_privilege('anon', p.oid, 'execute')
    then 'ok'
    when p.proname in ('email_login_allowed', 'rpc_cleanup_email_log')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute')
    then 'ok'
    else 'ВНИМАНИЕ: гранты отличаются от ожидаемых'
  end                                                       as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'email_login_allowed', 'rpc_check_email_login', 'rpc_cleanup_email_log'
  )
order by p.proname;


-- ------------------------------------------------------------
-- 3) Журнал квот закрыт с двух сторон.
-- ------------------------------------------------------------
-- RLS включён, политик нет, табличных грантов клиентским ролям нет.
-- Одного RLS мало: гранты выдаются независимо от него.
select
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'otp_email_log') as policies,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'otp_email_log'
      and grantee in ('anon', 'authenticated')) as grants_to_clients,
  case
    when c.relrowsecurity
     and (select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'otp_email_log') = 0
     and (select count(*) from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'otp_email_log'
             and grantee in ('anon', 'authenticated')) = 0
    then 'ok'
    else 'ВНИМАНИЕ: журнал квот доступен клиентским ролям'
  end as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'otp_email_log';


-- ------------------------------------------------------------
-- 4) Гейт работает: админ да, обычный пользователь нет.
-- ------------------------------------------------------------
-- Вызывается от роли postgres, поэтому email_login_allowed доступна
-- напрямую. Подставьте реальные адреса.
select
  public.email_login_allowed('tayshinaleksander@gmail.com') as admin_allowed,
  public.email_login_allowed('nekto@primer.rs')             as stranger_allowed,
  case
    when public.email_login_allowed('tayshinaleksander@gmail.com')
     and not public.email_login_allowed('nekto@primer.rs')
    then 'ok'
    else 'ВНИМАНИЕ: гейт пропускает не тех или не пропускает админа'
  end                                                       as verdict;


-- ------------------------------------------------------------
-- 5) Ответ клиентской RPC нейтрален и списывает квоту.
-- ------------------------------------------------------------
-- ВНИМАНИЕ: этот блок ПИШЕТ в otp_email_log (по строке на вызов) —
-- в отличие от остальных блоков он не только читает. Так и задумано:
-- проверить списание квоты, не списав её, нельзя.
--
-- Ожидается: у существующего админа allowed = true, у постороннего
-- allowed = false, и в обоих случаях used вырос. Одинаковая форма
-- ответа — это и есть нейтральность: по ней нельзя отличить «нет
-- такого адреса» от «нет прав».
select
  public.rpc_check_email_login('nekto@primer.rs', '203.0.113.1') as stranger_answer;

-- Убедиться, что попытка постороннего попала в журнал: перебор
-- адресов должен стоить квоты, иначе он бесплатен.
select email, ip, created_at
  from public.otp_email_log
 order by created_at desc
 limit 5;


-- ------------------------------------------------------------
-- 6) РУЧНАЯ ПРОВЕРКА
-- ------------------------------------------------------------
-- ПЕРЕД НЕЙ ОБЯЗАТЕЛЬНО (без этого код не придёт):
--
--   а) supabase functions deploy auth-email-hook --no-verify-jwt
--      Флаг обязателен: GoTrue приходит со своей подписью, а не с
--      JWT пользователя.
--
--   б) Dashboard → Authentication → Hooks → Send Email Hook:
--      включить, указать URL функции, скопировать секрет;
--      supabase secrets set SEND_EMAIL_HOOK_SECRET='v1,whsec_…'
--
--   в) Dashboard → Authentication → Providers → Email:
--      «Allow new users to sign up» — ВЫКЛЮЧИТЬ. Вход по почте
--      открывает существующий аккаунт и не должен создавать новые.
--
--   г) Секреты Resend уже заданы (общие с send-email):
--      RESEND_API_KEY, MAIL_FROM.
--
-- ЧТО ПРОВЕРИТЬ:
--
--   1. /login → вкладка «Почта» → адрес администратора → «Получить
--      код». Письмо приходит за секунды (не через 5 минут: код идёт
--      мимо очереди email_queue, синхронно из хука).
--      В письме: код крупно, БЕЗ единой ссылки и кнопки — письмо с
--      кодом главная мишень фишинга, и приучать нажимать в нём
--      кнопку нельзя.
--
--   2. Ввести код → сессия → /admin открывается.
--
--   3. Чужой адрес → «Для этого адреса вход по почте не настроен».
--      Тот же текст для существующего НЕ-администратора: разные
--      ответы превратили бы форму входа в способ выяснять, кто
--      зарегистрирован на площадке.
--
--   4. Обход клиентской проверки. В консоли браузера на /login:
--
--        await supabase.auth.signInWithOtp({ email: 'chuzhoy@primer.rs' })
--
--      Ожидается: письмо НЕ приходит. Код GoTrue сгенерирует, но хук
--      откажет на втором рубеже гейта, и код останется никому не
--      известным. Это и есть настоящая защита канала — клиентская
--      RPC только экономит запросы и даёт понятный текст.
--
--   5. Квота. Шесть запросов кода на один адрес подряд: шестой
--      отвечает отказом (лимит 5 за 24 часа).
--
--   6. Пользователь БЕЗ телефона (пункт 6 задания):
--      * /my → кабинет открывается, нигде не «undefined»;
--      * /my/profile → в поле телефона «—», под ним подсказка
--        «Номер не привязан к аккаунту — вход выполняется по почте»,
--        а НЕ «номер используется для входа»;
--      * /sell → поле телефона ПОКАЗАНО (у вошедшего с номером оно
--        скрыто), кнопка публикации заблокирована до валидного
--        номера, объявление публикуется без запроса SMS.
--        До правки подача падала с невнятной ошибкой: телефон брался
--        из сессии, а его там нет.
-- ------------------------------------------------------------
