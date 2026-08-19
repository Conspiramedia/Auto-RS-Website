-- ============================================================
-- AUTO.RS — Миграция 0016: Внутренние чаты покупатель ↔ продавец
-- ============================================================
-- Модуль переписки, привязанной к объявлению (cars). Один чат — это диалог
-- между покупателем (buyer) и продавцом (seller) по конкретной машине.
-- Создание чата — только через RPC start_chat (Thick Backend); прямой INSERT
-- в chats закрыт RLS. Сообщения пишут только участники чата.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА: chats (диалоги по объявлению)
-- ============================================================
create table public.chats (
  id          uuid        primary key default gen_random_uuid(),
  car_id      uuid        not null references public.cars (id) on delete cascade,      -- к какому объявлению
  buyer_id    uuid        not null references auth.users (id) on delete cascade,       -- покупатель (инициатор)
  seller_id   uuid        not null references auth.users (id) on delete cascade,       -- продавец (владелец авто)
  created_at  timestamptz not null default now()
);

comment on table public.chats is 'Диалоги покупатель↔продавец, привязанные к объявлению';

-- Уникальность диалога: одна пара (buyer, seller) по одной машине = один чат.
-- Нужен и для логики "найти существующий или создать", и как защита от гонок
-- (двойной тап «Написать» не создаст два чата — второй INSERT упрётся в индекс).
create unique index uq_chats_car_buyer_seller
  on public.chats (car_id, buyer_id, seller_id);

-- Индексы под выборку "мои чаты"
create index idx_chats_buyer  on public.chats (buyer_id);
create index idx_chats_seller on public.chats (seller_id);
create index idx_chats_car    on public.chats (car_id);


-- ============================================================
-- 2) ТАБЛИЦА: messages (сообщения в чате)
-- ============================================================
create table public.messages (
  id          uuid        primary key default gen_random_uuid(),
  chat_id     uuid        not null references public.chats (id) on delete cascade,     -- в каком чате
  sender_id   uuid        not null references auth.users (id) on delete cascade,       -- кто отправил
  text        text        not null,
  is_read     boolean     not null default false,                                      -- прочитано получателем
  created_at  timestamptz not null default now()
);

comment on table public.messages is 'Сообщения внутри чатов';

-- Индекс под ленту сообщений чата в хронологическом порядке
create index idx_messages_chat on public.messages (chat_id, created_at);


-- ============================================================
-- 3) RLS
-- ============================================================
alter table public.chats    enable row level security;
alter table public.messages enable row level security;

-- ---------- chats ----------
-- SELECT: видит только участник чата (buyer или seller).
create policy "chats_select_participant" on public.chats
  for select to authenticated
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- INSERT напрямую ЗАПРЕЩЁН: политики на insert нет — чат создаётся
-- только через SECURITY DEFINER функцию start_chat (она обходит RLS).

-- ---------- messages ----------
-- SELECT: сообщения видит только участник соответствующего чата.
create policy "messages_select_participant" on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );

-- INSERT: писать может только участник чата, и только от своего имени
-- (sender_id = auth.uid() — нельзя подставить чужого отправителя).
create policy "messages_insert_participant" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );

-- UPDATE: разрешаем участнику помечать сообщения прочитанными (is_read).
-- Ограничение "менять можно только is_read" удобнее контролировать
-- отдельной RPC mark_messages_read; здесь даём базовый доступ участнику.
create policy "messages_update_participant" on public.messages
  for update to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );


-- ============================================================
-- 4) RPC start_chat(p_car_id) — создать чат или вернуть существующий
-- ------------------------------------------------------------
-- buyer_id  = auth.uid() (инициатор — текущий пользователь).
-- seller_id = cars.user_id по p_car_id (владелец объявления).
-- Защита: нельзя начать чат с самим собой.
-- Идемпотентность: если чат (car, buyer, seller) уже есть — вернуть его id,
-- иначе создать новый. ON CONFLICT по уникальному индексу защищает от гонок.
-- ============================================================
create or replace function public.start_chat(p_car_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer   uuid := auth.uid();
  v_seller  uuid;
  v_chat_id uuid;
begin
  -- Требуется авторизация
  if v_buyer is null then
    raise exception 'Требуется авторизация для начала чата'
      using errcode = 'insufficient_privilege';
  end if;

  -- Находим продавца (владельца машины)
  select c.user_id
    into v_seller
  from public.cars c
  where c.id = p_car_id;

  if v_seller is null then
    raise exception 'Объявление % не найдено', p_car_id
      using errcode = 'no_data_found';
  end if;

  -- Нельзя писать самому себе
  if v_buyer = v_seller then
    raise exception 'Нельзя начать чат с самим собой'
      using errcode = 'check_violation';
  end if;

  -- Ищем существующий чат по этой комбинации
  select id
    into v_chat_id
  from public.chats
  where car_id = p_car_id
    and buyer_id = v_buyer
    and seller_id = v_seller;

  if v_chat_id is not null then
    return v_chat_id;   -- чат уже есть — возвращаем его
  end if;

  -- Создаём новый чат. ON CONFLICT — страховка от гонок:
  -- если параллельный вызов успел создать чат, берём существующий id.
  insert into public.chats (car_id, buyer_id, seller_id)
  values (p_car_id, v_buyer, v_seller)
  on conflict (car_id, buyer_id, seller_id) do update
    set car_id = excluded.car_id   -- no-op апдейт, чтобы RETURNING вернул строку
  returning id into v_chat_id;

  return v_chat_id;
end;
$$;

comment on function public.start_chat(uuid)
  is 'Создаёт чат покупатель↔продавец по объявлению или возвращает существующий (идемпотентно)';


-- ============================================================
-- ПРАВА
-- ============================================================
grant execute on function public.start_chat(uuid) to authenticated;


-- ============================================================
-- REALTIME: включаем репликацию таблицы messages
-- ------------------------------------------------------------
-- Без этого клиентский Stream (messagesStream) не будет получать
-- новые сообщения в реальном времени. Оборачиваем в DO-блок с проверкой,
-- т.к. повторное ADD TABLE уже добавленной таблицы вызывает ошибку.
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
