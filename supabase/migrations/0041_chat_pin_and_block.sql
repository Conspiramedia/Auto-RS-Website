-- ============================================================
-- AUTO.RS — Миграция 0041: Закрепление диалогов и блокировка собеседников
-- ============================================================
-- Переносим UX-логику из проекта App Baza в модуль чатов:
--   • Закрепление диалога (свайп вправо) — ЛИЧНАЯ настройка пользователя,
--     собеседник её не видит. Закреплённые чаты всплывают наверх списка.
--   • Блокировка собеседника (свайп влево) — заблокированный НЕ МОЖЕТ писать
--     текущему пользователю. Запрет реализован на уровне RLS-политики INSERT
--     messages (сообщение реально не создаётся), а не только в интерфейсе.
--
-- Для этого:
--   1) chat_prefs   — личные настройки диалога (пока только pinned_at);
--   2) user_blocks  — кто кого заблокировал;
--   3) RLS INSERT messages ужесточаем: нельзя писать в чат, если собеседник
--      меня заблокировал;
--   4) VIEW chats_with_details расширяем: pinned, peer_blocked, last_message
--      (превью текста) + учёт сортировки закреплённых.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА: chat_prefs (личные настройки диалога)
-- ------------------------------------------------------------
-- Одна строка = «пользователь X настроил чат Y». Настройка приватная:
-- закрепление у покупателя не влияет на список продавца.
-- pinned_at:
--   NOT NULL — чат закреплён (значение — момент закрепления, для сортировки
--              нескольких закреплённых между собой);
--   NULL     — не закреплён (строка может существовать «пустой» после открепа).
-- ============================================================
create table if not exists public.chat_prefs (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  chat_id    uuid        not null references public.chats (id) on delete cascade,
  pinned_at  timestamptz,                                   -- момент закрепления (null = не закреплён)
  primary key (user_id, chat_id)
);

comment on table public.chat_prefs is 'Личные настройки диалога пользователя (закрепление и т.п.)';

-- Индекс под выборку закреплённых чатов пользователя.
create index if not exists idx_chat_prefs_user_pinned
  on public.chat_prefs (user_id, pinned_at desc);


-- ============================================================
-- 2) ТАБЛИЦА: user_blocks (блокировки пользователей)
-- ------------------------------------------------------------
-- blocker_id заблокировал blocked_id. Пара уникальна (первичный ключ).
-- Направленная связь: A заблокировал B ≠ B заблокировал A.
-- ============================================================
create table if not exists public.user_blocks (
  blocker_id  uuid        not null references auth.users (id) on delete cascade,   -- кто заблокировал
  blocked_id  uuid        not null references auth.users (id) on delete cascade,   -- кого заблокировали
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint chk_no_self_block check (blocker_id <> blocked_id)                    -- нельзя заблокировать себя
);

comment on table public.user_blocks is 'Кто кого заблокировал (направленная связь)';

-- Индекс под проверку «кто заблокировал меня» (для RLS INSERT messages).
create index if not exists idx_user_blocks_blocked
  on public.user_blocks (blocked_id, blocker_id);


-- ============================================================
-- 3) RLS
-- ============================================================
alter table public.chat_prefs  enable row level security;
alter table public.user_blocks enable row level security;

-- ---------- chat_prefs: только свои строки ----------
create policy "chat_prefs_select_own" on public.chat_prefs
  for select to authenticated
  using (user_id = auth.uid());

create policy "chat_prefs_insert_own" on public.chat_prefs
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "chat_prefs_update_own" on public.chat_prefs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "chat_prefs_delete_own" on public.chat_prefs
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------- user_blocks: управляет только сам блокирующий ----------
-- SELECT: пользователь видит свои блокировки (кого он заблокировал) И записи,
-- где заблокировали его — чтобы интерфейс мог показать факт блокировки.
create policy "user_blocks_select_involved" on public.user_blocks
  for select to authenticated
  using (blocker_id = auth.uid() or blocked_id = auth.uid());

-- INSERT/DELETE: заблокировать/разблокировать может только сам блокирующий,
-- и только от своего имени (blocker_id = auth.uid()).
create policy "user_blocks_insert_own" on public.user_blocks
  for insert to authenticated
  with check (blocker_id = auth.uid());

create policy "user_blocks_delete_own" on public.user_blocks
  for delete to authenticated
  using (blocker_id = auth.uid());


-- ============================================================
-- 4) УЖЕСТОЧАЕМ RLS INSERT messages: учёт блокировок
-- ------------------------------------------------------------
-- Прежняя политика messages_insert_participant (миграция 0016) разрешала
-- писать любому участнику чата. Добавляем условие: НЕЛЬЗЯ отправить сообщение,
-- если собеседник по этому чату заблокировал отправителя.
--
-- Собеседник вычисляется относительно отправителя: если sender — buyer, то
-- собеседник seller, и наоборот. Проверяем, что нет записи user_blocks, где
-- blocker = собеседник, blocked = отправитель.
-- ============================================================
drop policy if exists "messages_insert_participant" on public.messages;

create policy "messages_insert_participant" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
        -- собеседник в этом чате не должен был заблокировать отправителя
        and not exists (
          select 1 from public.user_blocks ub
          where ub.blocked_id = auth.uid()
            and ub.blocker_id = case
              when c.buyer_id = auth.uid() then c.seller_id
              else c.buyer_id
            end
        )
    )
  );


-- ============================================================
-- 5) VIEW chats_with_details — добавляем pinned, peer_blocked, last_message
-- ------------------------------------------------------------
-- pinned        — закреплён ли чат текущим пользователем (chat_prefs.pinned_at);
-- pinned_at     — момент закрепления (для сортировки закреплённых, null сверху);
-- peer_blocked  — заблокировал ли ТЕКУЩИЙ пользователь собеседника;
-- last_message  — текст последнего сообщения (превью в списке диалогов).
--
-- security_invoker сохраняем: VIEW применяет RLS вызывающего.
-- ============================================================
create or replace view public.chats_with_details
with (security_invoker = true)
as
select
  ch.id,
  ch.car_id,
  ch.buyer_id,
  ch.seller_id,
  ch.created_at,

  -- Собеседник = НЕ текущий пользователь.
  case when ch.buyer_id = auth.uid() then ch.seller_id else ch.buyer_id end
    as opponent_id,

  -- Профиль собеседника
  opp.full_name  as opponent_name,
  opp.avatar_url as opponent_avatar,

  -- Данные объявления
  c.brand,
  c.model,
  c.year,

  -- Первое фото машины
  img.image_url as car_photo,

  -- Непрочитанные входящие
  (
    select count(*)
    from public.messages m
    where m.chat_id = ch.id
      and m.is_read = false
      and m.sender_id <> auth.uid()
  )::int as unread_count,

  -- Время последнего сообщения (для сортировки списка)
  (
    select max(m.created_at)
    from public.messages m
    where m.chat_id = ch.id
  ) as last_message_at,

  -- Текст последнего сообщения (превью строки диалога)
  (
    select m.text
    from public.messages m
    where m.chat_id = ch.id
    order by m.created_at desc
    limit 1
  ) as last_message,

  -- Закреплён ли чат текущим пользователем
  (pref.pinned_at is not null) as pinned,
  pref.pinned_at,

  -- Заблокировал ли ТЕКУЩИЙ пользователь собеседника
  exists (
    select 1 from public.user_blocks ub
    where ub.blocker_id = auth.uid()
      and ub.blocked_id = case
        when ch.buyer_id = auth.uid() then ch.seller_id
        else ch.buyer_id
      end
  ) as peer_blocked

from public.chats ch
left join public.profiles opp
  on opp.id = case when ch.buyer_id = auth.uid() then ch.seller_id else ch.buyer_id end
join public.cars c
  on c.id = ch.car_id
-- Личные настройки диалога текущего пользователя (закрепление)
left join public.chat_prefs pref
  on pref.chat_id = ch.id and pref.user_id = auth.uid()
left join lateral (
  select ci.image_url
  from public.car_images ci
  where ci.car_id = ch.car_id
  order by ci.order_index asc
  limit 1
) img on true;

comment on view public.chats_with_details
  is 'Чаты + собеседник + машина + непрочитанные + превью + закрепление/блокировка. RLS вызывающего';
