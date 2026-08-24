-- ============================================================
-- AUTO.RS — Миграция 0078: фундамент админ-комнаты сайта (/admin).
-- ------------------------------------------------------------
-- Пакет M1. Что делает:
--   1) admin_action_log — журнал действий модератора (append-only);
--   2) f_admin_log()    — единственная точка записи в журнал;
--   3) admin_guard()    — дешёвая проверка доступа для layout сайта;
--   4) admin_dashboard_stats() — счётчики главной страницы админки;
--   5) approve_car / reject_car — переписаны: журнал в той же
--      транзакции, жёсткая проверка исходного статуса, обязательная
--      причина отклонения.
--
-- ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ:
--   Письма продавцу НЕ ставятся в очередь этой миграцией. Триггер
--   tg_email_on_car_moderation (0071) висит AFTER UPDATE OF status
--   на cars и сам зовёт f_enqueue_email с локалью получателя для
--   переходов → active и → rejected. Дублировать вызов здесь значило
--   бы отправлять продавцу по два письма на каждое решение.
--
--   Роль администратора НЕ редактируется через RPC. Флаг
--   profiles.is_admin ставится вручную в SQL Editor. Функции выдачи
--   прав в кодовой базе нет сознательно: скомпрометированный аккаунт
--   админа не должен уметь плодить админов.
--
-- СОВМЕСТИМОСТЬ С ПРИЛОЖЕНИЕМ: сигнатуры approve_car(uuid) и
-- reject_car(uuid, text), а также их RETURNS public.cars НЕ меняются.
-- Flutter (lib/data/repositories/admin_repository.dart) вызывает их с
-- теми же именованными параметрами car_id / comment и разбирает
-- строку cars — вызовы продолжают работать без правок приложения.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА ЖУРНАЛА: public.admin_action_log
-- ------------------------------------------------------------
-- Append-only след решений модерации. Нужен для разбора спорных
-- случаев («кто отклонил и почему») и для контроля самих модераторов.
--
-- actor_id ссылается на auth.users, а НЕ на profiles: профиль
-- теоретически может быть удалён каскадом, а запись журнала должна
-- пережить это. on delete restrict — удаление пользователя, который
-- что-то модерировал, должно упереться в журнал, а не стереть его.
--
-- target_id — uuid без внешнего ключа: журнал переживает удаление
-- объекта, на который ссылается (объявление удалили — запись о его
-- отклонении осталась). Какая именно это сущность, говорит
-- target_table.
--
-- payload — свободный jsonb (причина отклонения, прежний статус).
-- Схему здесь не фиксируем: набор полей у разных действий разный,
-- а журнал читается человеком, а не кодом.
-- ============================================================
create table if not exists public.admin_action_log (
  id            bigint      generated always as identity primary key,
  actor_id      uuid        not null references auth.users (id) on delete restrict,
  action        text        not null,
  target_table  text,
  target_id     uuid,
  payload       jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),

  constraint chk_admin_log_action check (length(action) between 1 and 64)
);

comment on table public.admin_action_log
  is 'Журнал действий администратора: кто, что, над чем и когда. Запись только через f_admin_log(), чтение — из админки сайта';
comment on column public.admin_action_log.actor_id
  is 'Кто выполнил действие; берётся из auth.uid() внутри f_admin_log, не из параметра';
comment on column public.admin_action_log.action
  is 'Код действия: car_approved, car_rejected и т.п.';
comment on column public.admin_action_log.payload
  is 'Детали действия (причина, прежний статус) — свободный jsonb';

-- Индексы под три реальных запроса журнала:
--   лента «последние действия», фильтр «действия модератора X»,
--   история конкретного объявления в его карточке.
create index if not exists idx_admin_log_created
  on public.admin_action_log (created_at desc);

create index if not exists idx_admin_log_actor
  on public.admin_action_log (actor_id, created_at desc);

create index if not exists idx_admin_log_target
  on public.admin_action_log (target_id)
  where target_id is not null;


-- ------------------------------------------------------------
-- RLS: deny-all + явный отзыв табличных грантов.
-- ------------------------------------------------------------
-- ВАЖНО: RLS не отменяет гранты, а накладывается поверх них. Роль
-- authenticated в Supabase по умолчанию получает права на новые
-- таблицы схемы public через ALTER DEFAULT PRIVILEGES, поэтому одного
-- enable row level security мало — нужен явный revoke. Делаем оба
-- шага: политик нет вовсе (значит, любой доступ под RLS запрещён),
-- и грантов нет тоже.
--
-- Пишет в таблицу только f_admin_log() — она security definer и
-- работает от владельца, на которого RLS не распространяется
-- (force row level security не ставим именно поэтому: он заблокировал
-- бы запись самому владельцу, и журнал стал бы недоступен на запись).
-- Читает журнал админка через admin_log_list() (пакет M7) — тоже
-- definer с is_admin() внутри.
--
-- UPDATE и DELETE не выдаются никому и никогда: журнал, который
-- можно подчистить, не журнал.
-- ------------------------------------------------------------
alter table public.admin_action_log enable row level security;

revoke all on public.admin_action_log from anon, authenticated;


-- ============================================================
-- 2) f_admin_log() — единственная точка записи в журнал
-- ------------------------------------------------------------
-- actor_id берётся ИЗ auth.uid() ВНУТРИ функции, а не из параметра.
-- Это принципиально: параметр позволил бы вызывающему подписать
-- действие чужим именем, и журнал перестал бы что-либо доказывать.
--
-- Функция не проверяет is_admin(): она вызывается только из
-- админских RPC, которые уже проверили права первой строкой.
-- Отдельная проверка здесь была бы лишним запросом к profiles на
-- каждое действие. Прямой вызов извне невозможен — execute
-- никому не выдаётся (см. revoke ниже).
-- ============================================================
create or replace function public.f_admin_log(
  p_action       text,
  p_target_table text default null,
  p_target_id    uuid default null,
  p_payload      jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor uuid := auth.uid();
begin
  -- Без сессии писать в журнал нечего: анонимной модерации не бывает.
  if v_actor is null then
    raise exception 'Журнал действий требует авторизации'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.admin_action_log (actor_id, action, target_table, target_id, payload)
  values (v_actor, p_action, p_target_table, p_target_id, coalesce(p_payload, '{}'::jsonb));
end;
$fn$;

comment on function public.f_admin_log(text, text, uuid, jsonb)
  is 'Запись в журнал действий администратора; автор берётся из auth.uid(), не из параметра';

-- Вызывается только изнутри других definer-функций — снаружи не нужна.
revoke all on function public.f_admin_log(text, text, uuid, jsonb) from public, anon, authenticated;


-- ============================================================
-- 3) admin_guard() — проверка доступа для app/admin/layout.tsx
-- ------------------------------------------------------------
-- Обёртка над is_admin() с осмысленным для сайта именем и без
-- исключения: layout получает boolean и сам решает, что показать
-- (в нашем случае — notFound(), 404 вместо 403, чтобы не
-- подтверждать существование раздела посторонним).
--
-- Это НЕ защита. Настоящая защита — is_admin() первой строкой в
-- каждой админской RPC. Guard всего лишь избавляет от отрисовки
-- интерфейса тому, кто всё равно не сможет ничего сделать.
-- ============================================================
create or replace function public.admin_guard()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin();
$fn$;

comment on function public.admin_guard()
  is 'true, если текущий пользователь — админ. Для layout админки сайта; настоящая защита — is_admin() внутри каждой RPC';

grant execute on function public.admin_guard() to authenticated;


-- ============================================================
-- 4) admin_dashboard_stats() — счётчики главной страницы админки
-- ------------------------------------------------------------
-- Один запрос вместо восьми: страница показывает всю картину сразу,
-- а не мигает счётчиками по мере ответов.
--
-- «Сегодня» считается по времени сервера (UTC). Белград — UTC+1/+2,
-- расхождение на границе суток возможно и осознанно принято:
-- цифра «одобрено сегодня» справочная, не отчётная.
--
-- email_failed вынесен на дашборд намеренно. Это не статистика, а
-- операционный инцидент: письма продавцам не уходят, а очередь
-- молчит. Заметить это должен модератор, открывающий админку
-- каждый день, а не тот, кто однажды заглянет в таблицу.
-- ============================================================
create or replace function public.admin_dashboard_stats()
returns table (
  queue_count     bigint,   -- ждут проверки прямо сейчас
  rejected_today  bigint,   -- отклонено с начала суток
  approved_today  bigint,   -- одобрено с начала суток
  active_total    bigint,   -- опубликовано всего
  users_total     bigint,   -- зарегистрировано всего
  users_new_7d    bigint,   -- новых за неделю
  email_pending   bigint,   -- писем ждёт отправки
  email_failed    bigint    -- писем провалилось (ИНЦИДЕНТ)
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: сводка доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    (select count(*) from public.cars c
      where c.status = 'moderation'),

    -- Одобрения и отклонения берём ИЗ ЖУРНАЛА, а не из cars.status:
    -- статус показывает текущее состояние, а нам нужно количество
    -- решений за сутки. Объявление, отклонённое утром и одобренное
    -- после правки вечером, — два решения, а в cars останется одна
    -- строка со статусом active.
    (select count(*) from public.admin_action_log l
      where l.action = 'car_rejected'
        and l.created_at >= date_trunc('day', now())),

    (select count(*) from public.admin_action_log l
      where l.action = 'car_approved'
        and l.created_at >= date_trunc('day', now())),

    (select count(*) from public.cars c
      where c.status = 'active'),

    (select count(*) from public.profiles),

    (select count(*) from public.profiles p
      where p.created_at >= now() - interval '7 days'),

    (select count(*) from public.email_queue q
      where q.status = 'pending'),

    (select count(*) from public.email_queue q
      where q.status = 'failed');
end;
$fn$;

comment on function public.admin_dashboard_stats()
  is 'Сводка для главной страницы админки: очередь, решения за сутки, пользователи, состояние очереди писем';

grant execute on function public.admin_dashboard_stats() to authenticated;


-- ============================================================
-- 5) approve_car — одобрение с записью в журнал
-- ------------------------------------------------------------
-- Отличия от версии 0039:
--   + запись в admin_action_log В ТОЙ ЖЕ ТРАНЗАКЦИИ. Если журнал
--     не записался, объявление не одобрено. Разъехаться эти два
--     факта не могут — иначе журнал перестал бы быть доказательством.
--   + прежний статус попадает в payload: по журналу видно, это
--     первая публикация (из moderation) или снятие отклонения
--     (из rejected).
--
-- Сигнатура approve_car(uuid) и returns public.cars НЕ ИЗМЕНЕНЫ —
-- приложение продолжает работать без правок.
--
-- FOR UPDATE + проверка исходного статуса оставлены: два модератора,
-- нажавшие «Одобрить» одновременно, сериализуются на блокировке
-- строки, и второй получит check_violation, а не запишет в журнал
-- второе одобрение уже активного объявления.
-- ============================================================
create or replace function public.approve_car(car_id uuid)
returns public.cars
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_car  public.cars;
  v_prev text;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: модерация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку до чтения статуса: между select и update не
  -- должен вклиниться второй модератор.
  select c.* into v_car from public.cars c where c.id = car_id for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', car_id
      using errcode = 'no_data_found';
  end if;

  v_prev := v_car.status::text;

  if v_prev not in ('moderation', 'rejected') then
    raise exception 'Объявление нельзя одобрить: текущий статус = %', v_prev
      using errcode = 'check_violation';
  end if;

  update public.cars
     set status = 'active',
         moderation_comment = null   -- очищаем прежнюю причину
   where id = car_id
   returning * into v_car;

  -- Уведомление в приложении. Письмо на почту НЕ ставим: его ставит
  -- триггер tg_email_on_car_moderation (0071) на смене статуса.
  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_car.user_id,
    'Объявление опубликовано',
    format('%s %s одобрено и опубликовано', v_car.brand, v_car.model),
    'car_approved',
    v_car.id
  );

  -- Журнал — в этой же транзакции, после успешного обновления.
  perform public.f_admin_log(
    'car_approved',
    'cars',
    v_car.id,
    jsonb_build_object(
      'prev_status', v_prev,
      'user_id',     v_car.user_id,
      'brand',       v_car.brand,
      'model',       v_car.model
    )
  );

  return v_car;
end;
$fn$;

comment on function public.approve_car(uuid)
  is 'Одобрить объявление (moderation/rejected → active) с записью в журнал администратора';

grant execute on function public.approve_car(uuid) to authenticated;


-- ============================================================
-- 6) reject_car — отклонение с ОБЯЗАТЕЛЬНОЙ причиной и журналом
-- ------------------------------------------------------------
-- Отличия от версии 0039:
--   + причина обязательна и валидируется НА СЕРВЕРЕ: не null, после
--     btrim не короче 10 символов. Продавец получает письмо
--     «объявление отклонено» — оно бессмысленно и обидно без
--     объяснения, что именно исправить. UI приложения уже не
--     пропускает пустую строку, но проверка в UI — не проверка:
--     RPC доступна любому authenticated-клиенту напрямую.
--   + запись в admin_action_log в той же транзакции.
--   + в cars пишется УЖЕ ОБРЕЗАННАЯ причина (btrim), чтобы в письмо
--     и карточку продавца не уезжали ведущие пробелы и переносы.
--
-- Верхняя граница 1000 символов: поле показывается продавцу в
-- карточке и уходит в письмо, простыня туда не влезет.
--
-- Сигнатура reject_car(uuid, text) с именами параметров car_id и
-- comment и returns public.cars НЕ ИЗМЕНЕНЫ — вызов из Flutter
-- (rpc('reject_car', params: {'car_id':…, 'comment':…})) работает
-- как прежде.
-- ============================================================
create or replace function public.reject_car(car_id uuid, comment text)
returns public.cars
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_car    public.cars;
  v_reason text;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: модерация доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  -- Причина — до всякой работы с объявлением: незачем блокировать
  -- строку ради заведомо неверного вызова.
  v_reason := btrim(coalesce(comment, ''));

  if length(v_reason) < 10 then
    raise exception 'Причина отклонения обязательна и должна содержать не менее 10 символов'
      using errcode = 'check_violation';
  end if;

  if length(v_reason) > 1000 then
    raise exception 'Причина отклонения слишком длинная: % символов, максимум 1000', length(v_reason)
      using errcode = 'check_violation';
  end if;

  select c.* into v_car from public.cars c where c.id = car_id for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', car_id
      using errcode = 'no_data_found';
  end if;

  -- Отклонить можно только то, что лежит на проверке. Повторное
  -- отклонение уже отклонённого — почти всегда двойной клик или
  -- второй модератор, открывший ту же карточку.
  if v_car.status <> 'moderation' then
    raise exception 'Объявление нельзя отклонить: текущий статус = %, ожидался moderation', v_car.status
      using errcode = 'check_violation';
  end if;

  update public.cars
     set status = 'rejected',
         moderation_comment = v_reason
   where id = car_id
   returning * into v_car;

  -- Уведомление в приложении; письмо ставит триггер 0071.
  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_car.user_id,
    'Объявление отклонено',
    v_reason,
    'car_rejected',
    v_car.id                 -- по тапу открыть это объявление
  );

  perform public.f_admin_log(
    'car_rejected',
    'cars',
    v_car.id,
    jsonb_build_object(
      'reason',  v_reason,
      'user_id', v_car.user_id,
      'brand',   v_car.brand,
      'model',   v_car.model
    )
  );

  return v_car;
end;
$fn$;

comment on function public.reject_car(uuid, text)
  is 'Отклонить объявление (moderation → rejected) с обязательной причиной (≥10 символов) и записью в журнал';

grant execute on function public.reject_car(uuid, text) to authenticated;
