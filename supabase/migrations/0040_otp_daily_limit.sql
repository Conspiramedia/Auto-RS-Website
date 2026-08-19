-- ============================================================
-- AUTO.RS — Суточный лимит отправки OTP-кодов на один номер.
-- Цель: экономия на SMS. Клиент ОБЯЗАН вызвать rpc_check_otp_quota
-- ПЕРЕД signInWithOtp. Если лимит исчерпан — SMS не отправляется.
--
-- Важно: это дополнение к rate-limit'у самого Supabase Auth
-- (Dashboard → Authentication → Rate Limits), а не замена ему.
-- Здесь — точный суточный лимит «N кодов на номер за 24 часа».
-- ============================================================

-- Лимит кодов на один номер в скользящее окно 24 часа.
-- Меняется здесь, в одном месте.
-- (значение по умолчанию — 5)

-- ------------------------------------------------------------
-- Таблица-журнал попыток отправки кода.
-- Одна строка = одна успешно разрешённая (не заблокированная) отправка.
-- ------------------------------------------------------------
create table if not exists public.otp_send_log (
  id         bigint generated always as identity primary key,
  phone      text        not null,          -- номер в формате E.164 (+381…)
  created_at timestamptz not null default now()
);

-- Индекс под выборку «сколько отправок на номер за последние сутки».
create index if not exists otp_send_log_phone_time_idx
  on public.otp_send_log (phone, created_at desc);

-- ------------------------------------------------------------
-- RLS: таблица закрыта полностью. Доступ к ней — только через
-- RPC ниже (SECURITY DEFINER). Напрямую ни читать, ни писать нельзя.
-- ------------------------------------------------------------
alter table public.otp_send_log enable row level security;
-- Политик НЕТ намеренно: при включённом RLS и отсутствии политик
-- обычные роли (anon/authenticated) не имеют доступа к строкам.

-- ------------------------------------------------------------
-- RPC: проверка и учёт квоты на отправку OTP.
-- Вызывается АНОНИМНО (до входа), поэтому grant для anon.
-- SECURITY DEFINER — чтобы функция могла писать в закрытую таблицу.
--
-- Логика:
--   1) нормализуем номер (убираем пробелы/дефисы/скобки);
--   2) считаем отправки за последние 24 часа;
--   3) если >= лимита — возвращаем allowed=false и НЕ пишем в журнал;
--   4) иначе — пишем строку и возвращаем allowed=true.
--
-- Возврат (json):
--   { "allowed": bool, "used": int, "limit": int, "remaining": int }
-- ------------------------------------------------------------
create or replace function public.rpc_check_otp_quota(p_phone text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit    constant int := 5;   -- ЛИМИТ: кодов на номер за 24 часа
  v_phone    text;
  v_used     int;
begin
  -- Нормализация номера: оставляем только «+» и цифры.
  -- Так «+381 61 234-56-78» и «+381612345678» считаются одним номером.
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');

  if v_phone = '' or length(v_phone) < 8 then
    -- Некорректный номер — не тратим SMS, сразу отказ.
    return json_build_object(
      'allowed', false, 'used', 0, 'limit', v_limit, 'remaining', 0
    );
  end if;

  -- Сколько отправок уже было за последние сутки.
  select count(*)
    into v_used
    from public.otp_send_log
   where phone = v_phone
     and created_at > now() - interval '24 hours';

  if v_used >= v_limit then
    -- Лимит исчерпан: журнал НЕ трогаем, отправку запрещаем.
    return json_build_object(
      'allowed', false, 'used', v_used, 'limit', v_limit, 'remaining', 0
    );
  end if;

  -- Разрешаем: фиксируем эту отправку в журнале.
  insert into public.otp_send_log (phone) values (v_phone);

  return json_build_object(
    'allowed',   true,
    'used',      v_used + 1,
    'limit',     v_limit,
    'remaining', v_limit - (v_used + 1)
  );
end;
$$;

-- Право вызова — анонимным (вход происходит до авторизации) и вошедшим.
grant execute on function public.rpc_check_otp_quota(text) to anon, authenticated;

-- ------------------------------------------------------------
-- Обслуживание: удаление записей старше 2 суток, чтобы журнал не рос.
-- Можно навесить на pg_cron, если он включён в проекте.
-- ------------------------------------------------------------
create or replace function public.rpc_cleanup_otp_log()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.otp_send_log
   where created_at < now() - interval '2 days';
$$;
