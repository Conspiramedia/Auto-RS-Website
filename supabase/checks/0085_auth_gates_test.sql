-- ============================================================
-- RS AUTO — ТЕСТ серверных гейтов входа (rpc_check_email_login).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл ПИШЕТ в otp_email_log и
-- заводит временных пользователей, поэтому на боевой базе он исказил
-- бы настоящие квоты. Защита от запуска на проде — первым блоком.
--
-- ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ ФАЙЛОВ *_verify.sql РЯДОМ. Те только ЧИТАЮТ
-- каталоги: проверяют, что функция существует, что она definer и что
-- гранты те, что задумывались. Здесь проверяется ПОВЕДЕНИЕ: кого
-- функция пускает, кому отказывает и когда исчерпывается квота —
-- то, что нельзя увидеть в pg_proc.
--
-- ЗАЧЕМ ЭТО ОТДЕЛЬНО ОТ PLAYWRIGHT. UI-тесты входа перехватывают
-- запросы к Supabase и до этих функций не доходят вовсе. Мок,
-- повторяющий их логику, проверял бы сам себя. Правила проверяются
-- там, где исполняются, — в базе.
--
-- ЗАПУСК:
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
--        -f supabase/checks/0085_auth_gates_test.sql
-- либо через npm run test:sql (см. package.json).
--
-- Все проверки идут в ОДНОЙ транзакции, которая в конце откатывается:
-- журнал отправок и временные пользователи не остаются в базе.
-- ============================================================

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- 0) ЗАЩИТА: это точно не боевая база?
-- ------------------------------------------------------------
-- Признак локального стека: пользователи с доменом @rsauto.test из
-- seed. На боевой базе их нет и быть не может — регистрация идёт по
-- телефону, а seed туда не заливается.
do $$
begin
  if not exists (
    select 1 from public.profiles where email = 'admin@rsauto.test'
  ) then
    raise exception
      'ОСТАНОВЛЕНО: не найден тестовый админ admin@rsauto.test. '
      'Похоже, это не локальная база с применённым seed. '
      'Тест ПИШЕТ в otp_email_log и на боевой базе исказил бы квоты. '
      'Запустите: supabase db reset';
  end if;
end $$;

-- Чистим журнал от следов предыдущего прогона: квота считается за
-- окно времени, и остаток от прошлого запуска сдвинул бы счётчики.
delete from public.otp_email_log
 where email like '%@rsauto.test' or ip like '203.0.113.%';


-- ============================================================
-- ТЕСТ 1. Админа гейт ПРОПУСКАЕТ.
-- ============================================================
do $$
declare
  v_reply json;
begin
  v_reply := public.rpc_check_email_login('admin@rsauto.test', '203.0.113.1');

  if (v_reply->>'allowed')::boolean is not true then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: админу отказано во входе по почте. Ответ: %',
      v_reply;
  end if;

  raise notice 'ТЕСТ 1 ok: админ пропущен (%)', v_reply;
end $$;


-- ============================================================
-- ТЕСТ 2. Не-админу гейт ОТКАЗЫВАЕТ.
-- ============================================================
-- Проверяются оба случая: существующий пользователь без прав и
-- вовсе несуществующий адрес.
do $$
declare
  v_existing json;
  v_unknown  json;
begin
  -- Существующий продавец — не админ.
  v_existing := public.rpc_check_email_login('seller@rsauto.test', '203.0.113.2');

  if (v_existing->>'allowed')::boolean is not false then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: не-админ получил разрешение на вход. Ответ: %',
      v_existing;
  end if;

  -- Адреса нет в базе вовсе.
  v_unknown := public.rpc_check_email_login('nobody@rsauto.test', '203.0.113.3');

  if (v_unknown->>'allowed')::boolean is not false then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: несуществующий адрес получил разрешение. Ответ: %',
      v_unknown;
  end if;

  raise notice 'ТЕСТ 2 ok: не-админу и неизвестному адресу отказано';
end $$;


-- ============================================================
-- ТЕСТ 3. Отказ НЕЙТРАЛЕН — по ответу нельзя узнать причину.
-- ============================================================
-- Суть требования: форма входа не должна работать как способ
-- проверять, кто зарегистрирован на площадке. Ответ существующему
-- не-админу обязан совпадать с ответом на выдуманный адрес ПОЛНОСТЬЮ,
-- включая счётчики квоты.
do $$
declare
  v_existing json;
  v_unknown  json;
begin
  -- Оба запроса с ОДНОГО IP и по адресам, у которых одинаковая
  -- история (по одной прошлой попытке из теста 2), — иначе
  -- расхождение счётчиков было бы следствием разной истории, а не
  -- разного отношения функции к адресам.
  delete from public.otp_email_log
   where email in ('cmp-a@rsauto.test', 'cmp-b@rsauto.test');

  v_existing := public.rpc_check_email_login('cmp-a@rsauto.test', '203.0.113.9');
  v_unknown  := public.rpc_check_email_login('cmp-b@rsauto.test', '203.0.113.9');

  if v_existing::text is distinct from v_unknown::text then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: ответы различаются и выдают существование адреса. '
      'Не-админ: %, неизвестный: %',
      v_existing, v_unknown;
  end if;

  raise notice 'ТЕСТ 3 ok: отказ нейтрален (%)', v_existing;
end $$;


-- ============================================================
-- ТЕСТ 4. КВОТА НА АДРЕС исчерпывается (5 писем за 24 часа).
-- ============================================================
-- Проверяется и то, что квота списывается ПРИ ОТКАЗЕ ПО ГЕЙТУ.
-- Списывай функция только успешные попытки — перебор адресов был бы
-- бесплатным, и защита не работала бы вовсе.
do $$
declare
  v_reply     json;
  v_limit     constant int := 5;
  i           int;
  v_last_ok   boolean;
begin
  delete from public.otp_email_log where email = 'quota@rsauto.test';

  -- Пять попыток подряд. Адрес не админский, то есть каждая получает
  -- отказ по гейту — и всё равно обязана тратить квоту.
  for i in 1..v_limit loop
    v_reply := public.rpc_check_email_login('quota@rsauto.test', null);
  end loop;

  -- После пяти попыток квота исчерпана: остаток обязан быть нулевым.
  if (v_reply->>'remaining')::int <> 0 then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: после % попыток остаток квоты %, ожидался 0. '
      'Похоже, квота не списывается при отказе по гейту — '
      'значит, перебор адресов бесплатен. Ответ: %',
      v_limit, v_reply->>'remaining', v_reply;
  end if;

  -- Шестая попытка обязана упереться в лимит.
  v_reply := public.rpc_check_email_login('quota@rsauto.test', null);
  v_last_ok := (v_reply->>'allowed')::boolean;

  if v_last_ok is not false then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: попытка сверх лимита разрешена. Ответ: %', v_reply;
  end if;

  -- Записей ровно столько, сколько попыток уложилось в лимит:
  -- отклонённая по квоте в журнал не пишется (иначе лимит
  -- продлевал бы сам себя).
  if (select count(*) from public.otp_email_log
       where email = 'quota@rsauto.test') <> v_limit then
    raise exception
      'ТЕСТ 4 ПРОВАЛЕН: в журнале % записей, ожидалось %',
      (select count(*) from public.otp_email_log
        where email = 'quota@rsauto.test'), v_limit;
  end if;

  raise notice 'ТЕСТ 4 ok: квота на адрес исчерпывается за % попыток', v_limit;
end $$;


-- ============================================================
-- ТЕСТ 5. IP-ЛИМИТ срабатывает ДО гейта (20 запросов за час).
-- ============================================================
-- Порядок принципиален. Перебор адресов идёт с одного IP, и
-- остановить его надо РАНЬШЕ, чем он потратит квоты десятков чужих
-- ящиков. Если бы сначала проверялся гейт, каждая попытка успевала бы
-- записаться в журнал жертвы.
do $$
declare
  v_reply    json;
  v_ip       constant text := '203.0.113.77';
  v_limit_ip constant int  := 20;
  i          int;
  v_victim_before int;
  v_victim_after  int;
begin
  delete from public.otp_email_log where ip = v_ip;
  delete from public.otp_email_log where email = 'victim@rsauto.test';

  -- Забиваем лимит IP запросами по РАЗНЫМ адресам — так выглядит
  -- настоящий перебор.
  for i in 1..v_limit_ip loop
    v_reply := public.rpc_check_email_login(
      'probe' || i || '@rsauto.test', v_ip
    );
  end loop;

  select count(*) into v_victim_before
    from public.otp_email_log where email = 'victim@rsauto.test';

  -- Запрос сверх лимита IP по ещё не тронутому адресу.
  v_reply := public.rpc_check_email_login('victim@rsauto.test', v_ip);

  if (v_reply->>'allowed')::boolean is not false then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: запрос сверх IP-лимита разрешён. Ответ: %', v_reply;
  end if;

  select count(*) into v_victim_after
    from public.otp_email_log where email = 'victim@rsauto.test';

  -- ГЛАВНОЕ: квота чужого адреса НЕ ТРОНУТА. Это и означает, что
  -- IP-лимит отработал раньше гейта и раньше записи в журнал.
  if v_victim_after <> v_victim_before then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: IP-лимит сработал ПОСЛЕ записи в журнал — '
      'перебор с одного IP тратит квоты чужих адресов. Было %, стало %',
      v_victim_before, v_victim_after;
  end if;

  raise notice 'ТЕСТ 5 ok: IP-лимит срабатывает до гейта и до списания квоты';
end $$;


-- ============================================================
-- ТЕСТ 6. Мусор вместо адреса отклоняется без записи в журнал.
-- ============================================================
-- Иначе счётчик квоты дробился бы на бесконечные варианты написания
-- одного и того же адреса.
do $$
declare
  v_reply json;
  v_rows  int;
begin
  delete from public.otp_email_log where email like '%не-адрес%';

  v_reply := public.rpc_check_email_login('это-не-адрес', '203.0.113.5');

  if (v_reply->>'allowed')::boolean is not false then
    raise exception 'ТЕСТ 6 ПРОВАЛЕН: неверный адрес принят. Ответ: %', v_reply;
  end if;

  select count(*) into v_rows
    from public.otp_email_log where email like '%не-адрес%';

  if v_rows <> 0 then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: мусорный адрес попал в журнал (% записей)', v_rows;
  end if;

  raise notice 'ТЕСТ 6 ok: мусор отклонён и в журнал не попал';
end $$;


-- ============================================================
-- ТЕСТ 7. Гранты: голая проверка админства наружу НЕ выдана.
-- ============================================================
-- email_login_allowed отвечает на вопрос «этот адрес админский?»
-- прямо. Будь она доступна anon — перебор адресов стал бы тривиальным
-- и в обход всяких квот.
do $$
declare
  v_anon_can_raw  boolean;
  v_anon_can_rpc  boolean;
begin
  select has_function_privilege('anon', p.oid, 'execute')
    into v_anon_can_raw
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'email_login_allowed'
   limit 1;

  select has_function_privilege('anon', p.oid, 'execute')
    into v_anon_can_rpc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rpc_check_email_login'
   limit 1;

  if v_anon_can_raw then
    raise exception
      'ТЕСТ 7 ПРОВАЛЕН: email_login_allowed доступна anon — '
      'это готовый перебор адресов в обход квоты';
  end if;

  if not v_anon_can_rpc then
    raise exception
      'ТЕСТ 7 ПРОВАЛЕН: rpc_check_email_login НЕ доступна anon — '
      'вход по почте не работает вовсе (функция зовётся до входа)';
  end if;

  raise notice 'ТЕСТ 7 ok: гранты на месте';
end $$;


-- ------------------------------------------------------------
-- Откат: тест не оставляет следов в базе.
-- ------------------------------------------------------------
rollback;

\echo ''
\echo '============================================'
\echo 'ВСЕ ТЕСТЫ ГЕЙТОВ ПРОЙДЕНЫ. Транзакция откачена.'
\echo '============================================'
