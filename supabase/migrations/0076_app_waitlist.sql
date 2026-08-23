-- ============================================================
-- RS AUTO — Миграция 0076: лист ожидания приложения (/app).
-- ============================================================
-- Страница /app до сих пор показывала две кнопки сторов, ведущие в
-- никуда: приложение не опубликовано, ссылка на Google Play отдаёт 404,
-- а ссылка на App Store — поиск по названию. Вместо них на странице
-- теперь заглушка «приложение в разработке» с подпиской на оповещение
-- о релизе, и этой подписке нужно место в базе.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ profiles.email. Вход на площадку —
-- по SMS-коду, и триггер handle_new_user (миграция 0002) кладёт в
-- profiles.email то, что пришло из auth.users, то есть пустоту: адреса
-- пользователей у площадки просто нет. Кроме того, ждать приложение
-- может и гость, не заводивший аккаунт вовсе, — а таких в profiles нет
-- по определению.
--
-- Схема та же, что у contact_messages (0058): таблица закрыта RLS,
-- запись только через SECURITY DEFINER RPC с валидацией и серверным
-- rate-лимитом. Никакого доступа на чтение снаружи: список ожидающих
-- релиза — это база адресов, и отдавать её anon нельзя.
-- ============================================================

create table if not exists public.app_waitlist (
  id uuid primary key default gen_random_uuid(),

  -- Адрес хранится в нижнем регистре: уникальность обязана быть
  -- нечувствительной к регистру, иначе Ivan@ и ivan@ получат по письму.
  email text not null,

  -- Язык, на котором человек подписался: письмо о релизе обязано уйти
  -- на нём же. Тот же перечень, что в contact_messages.
  locale text not null default 'sr' check (locale in ('sr', 'ru')),

  -- Кто подписался, если он был в сессии. Нужно, чтобы при рассылке
  -- не слать письмо и в лист ожидания, и в уведомление внутри кабинета.
  -- ON DELETE SET NULL: удаление аккаунта не отменяет подписку на
  -- оповещение — адрес человек оставил отдельно.
  user_id uuid references auth.users (id) on delete set null,

  -- Оповещение отправлено. Ставится рассылкой в день релиза; до тех пор
  -- строка ждёт. Отдельное поле, а не удаление строки: список тех, кого
  -- уже позвали, нужен, чтобы не позвать дважды.
  notified_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.app_waitlist is
  'Лист ожидания релиза приложения (форма на /app). Пишется только через RPC subscribe_app_waitlist.';

-- Уникальность адреса: повторная подписка тем же человеком не должна
-- плодить строки, иначе в день релиза он получит письмо трижды.
create unique index if not exists idx_app_waitlist_email
  on public.app_waitlist (lower(email));

-- Индекс под рассылку: выбрать всех, кого ещё не оповестили.
create index if not exists idx_app_waitlist_pending
  on public.app_waitlist (created_at)
  where notified_at is null;

-- ------------------------------------------------------------
-- RLS: таблица закрыта полностью.
-- ------------------------------------------------------------
-- Политик НЕТ ни одной, и это намеренно: при включённом RLS отсутствие
-- политики означает запрет для всех ролей, кроме владельца таблицы.
-- Запись идёт через SECURITY DEFINER функцию ниже, чтение — только
-- админом из панели Supabase. Прямой select для anon открыл бы базу
-- адресов на выгрузку.
alter table public.app_waitlist enable row level security;

-- ------------------------------------------------------------
-- RPC подписки на оповещение о релизе.
-- ------------------------------------------------------------
-- Возвращает jsonb: {ok: true} либо {ok: false, error: '<код>'}.
-- Коды совпадают с ключами словаря (app_wait_err_*) — фронтенд
-- показывает текст на языке пользователя и не разбирает сообщения СУБД.
create or replace function public.subscribe_app_waitlist(
  p_email text,
  p_locale text default 'sr'
)
returns jsonb
language plpgsql
security definer
-- Пустой search_path обязателен для SECURITY DEFINER: иначе вызывающий
-- подменит схему и заставит функцию работать со своими объектами.
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_locale text := coalesce(nullif(btrim(p_locale), ''), 'sr');
  v_recent int;
begin
  -- ---------- Валидация ----------
  -- Проверка нестрогая по той же причине, что в submit_contact_message:
  -- задача — отсечь мусор, а не реализовать RFC 5322.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  if length(v_email) > 200 then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  if v_locale not in ('sr', 'ru') then
    v_locale := 'sr';
  end if;

  -- ---------- Rate-лимит ----------
  -- 10 подписок с одного IP не посчитать (его в базе нет), поэтому
  -- ограничиваем общий поток новых строк за минуту: защита от скрипта,
  -- заливающего таблицу чужими адресами. Живой пользователь подписывается
  -- один раз и лимита не замечает.
  select count(*)
    into v_recent
    from public.app_waitlist
   where created_at > now() - interval '1 minute';

  if v_recent >= 20 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  -- ---------- Запись ----------
  -- Повторная подписка тем же адресом — не ошибка, а тот же самый
  -- результат: человек хочет узнать о релизе. Обновляем локаль (мог
  -- переключить язык) и молча возвращаем успех.
  -- Цель конфликта записана выражением ((lower(email))) — ровно так,
  -- как объявлен уникальный индекс выше. Инференс по имени столбца
  -- (on conflict (email)) здесь НЕ сработает: уникальность задана не
  -- на столбце, а на выражении, и Postgres не сопоставит их.
  -- v_email уже приведён к нижнему регистру, поэтому lower() в
  -- выражении совпадает со значением строки.
  insert into public.app_waitlist (email, locale, user_id)
  values (v_email, v_locale, auth.uid())
  on conflict ((lower(email))) do update
     set locale = excluded.locale,
         user_id = coalesce(public.app_waitlist.user_id, excluded.user_id);

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.subscribe_app_waitlist is
  'Подписка на оповещение о релизе приложения: валидация адреса, повторная подписка идемпотентна.';

-- Право вызова: аноним и вошедший. Ждать приложение может кто угодно,
-- защита — валидация и лимит внутри функции.
revoke all on function public.subscribe_app_waitlist(text, text) from public;
grant execute on function public.subscribe_app_waitlist(text, text) to anon, authenticated;

-- ============================================================
-- Проверка после применения:
--
--   select public.subscribe_app_waitlist('test@example.com', 'ru');
--   -- {"ok": true}
--   select public.subscribe_app_waitlist('test@example.com', 'sr');
--   -- {"ok": true}, строка одна, locale обновилась на sr
--   select public.subscribe_app_waitlist('мусор', 'ru');
--   -- {"ok": false, "error": "invalid_email"}
--   select count(*) from public.app_waitlist;  -- 1
-- ============================================================
