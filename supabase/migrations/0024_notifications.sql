-- ============================================================
-- AUTO.RS — Миграция 0024: Уведомления + авто-генерация триггерами
-- ============================================================
-- Системные алерты пользователям при новых сообщениях и смене статуса броней.
-- Запись в notifications делают только триггеры (SECURITY DEFINER),
-- прямой клиентский INSERT закрыт RLS. Пользователь читает свои уведомления
-- и помечает их прочитанными.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА: notifications
-- ------------------------------------------------------------
-- type      — категория: 'chat_message' | 'booking_status_changed' | ...
-- action_id — ID связанной сущности (chat_id / booking_id) для перехода
--             по тапу на уведомление.
-- ============================================================
create table public.notifications (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,  -- получатель
  title       text        not null,
  body        text,
  type        text        not null,
  action_id   uuid,                                                                -- chat_id / booking_id
  is_read     boolean     not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.notifications is 'Системные уведомления пользователей (генерируются триггерами)';

-- Индекс под выборку "мои уведомления" и подсчёт непрочитанных
create index idx_notifications_user
  on public.notifications (user_id, created_at desc);
create index idx_notifications_unread
  on public.notifications (user_id) where not is_read;


-- ============================================================
-- RLS: пользователь видит и помечает прочитанными только свои
-- ------------------------------------------------------------
-- INSERT напрямую ЗАПРЕЩЁН (политики на insert нет) — пишут только триггеры
-- через SECURITY DEFINER, обходя RLS.
-- ============================================================
alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications
  for select to authenticated using (auth.uid() = user_id);

-- UPDATE: владелец может менять свои уведомления (в первую очередь is_read)
create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ============================================================
-- 2) ТРИГГЕР tg_notify_on_message — уведомление о новом сообщении
-- ------------------------------------------------------------
-- AFTER INSERT на messages. Определяет получателя (второй участник чата)
-- и создаёт уведомление с обрезанным до 50 символов текстом.
-- SECURITY DEFINER — чтобы писать в notifications в обход RLS.
-- ============================================================
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat        public.chats;
  v_recipient   uuid;
  v_preview     text;
begin
  -- Находим чат сообщения
  select * into v_chat
  from public.chats
  where id = new.chat_id;

  if v_chat.id is null then
    return new;  -- на всякий случай: нет чата — молча выходим
  end if;

  -- Получатель = участник чата, который НЕ отправитель
  if new.sender_id = v_chat.buyer_id then
    v_recipient := v_chat.seller_id;
  else
    v_recipient := v_chat.buyer_id;
  end if;

  -- Превью текста: обрезаем до 50 символов, длинный — с многоточием
  v_preview := left(new.text, 50);
  if length(new.text) > 50 then
    v_preview := v_preview || '…';
  end if;

  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_recipient,
    'Новое сообщение',
    v_preview,
    'chat_message',
    new.chat_id            -- по тапу открыть этот чат
  );

  return new;
end;
$$;

create trigger tg_notify_on_message
  after insert on public.messages
  for each row execute function public.notify_on_message();


-- ============================================================
-- 3) ТРИГГЕР tg_notify_on_booking_status — уведомления по броням
-- ------------------------------------------------------------
-- AFTER INSERT OR UPDATE OF status на bookings.
--   INSERT           → уведомление ВЛАДЕЛЬЦУ машины ("Новый запрос на аренду").
--   UPDATE статуса   → уведомление КЛИЕНТУ, текст зависит от нового статуса.
-- SECURITY DEFINER для записи в notifications.
-- ============================================================
create or replace function public.notify_on_booking_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_title  text;
  v_body   text;
begin
  if tg_op = 'INSERT' then
    -- Новая бронь — уведомляем владельца машины
    select user_id into v_owner
    from public.cars
    where id = new.car_id;

    if v_owner is not null then
      insert into public.notifications (user_id, title, body, type, action_id)
      values (
        v_owner,
        'Новый запрос на аренду',
        'Поступил новый запрос на бронирование вашего автомобиля',
        'booking_status_changed',
        new.id
      );
    end if;

    return new;
  end if;

  -- UPDATE: реагируем только если статус реально изменился
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- Текст под новый статус (адресат — клиент)
    case new.status
      when 'confirmed' then v_title := 'Бронь подтверждена';
                            v_body  := 'Владелец подтвердил вашу бронь. Можно переходить к оплате.';
      when 'paid'      then v_title := 'Бронь оплачена';
                            v_body  := 'Оплата прошла успешно. Хорошей поездки!';
      when 'rejected'  then v_title := 'Бронь отклонена';
                            v_body  := 'К сожалению, владелец отклонил вашу бронь.';
      when 'cancelled' then v_title := 'Бронь отменена';
                            v_body  := 'Бронирование было отменено.';
      when 'completed' then v_title := 'Аренда завершена';
                            v_body  := 'Аренда завершена. Оставьте отзыв о поездке!';
      else v_title := null;  -- прочие статусы уведомлением не сопровождаем
    end case;

    if v_title is not null then
      insert into public.notifications (user_id, title, body, type, action_id)
      values (
        new.customer_id,     -- уведомляем клиента
        v_title,
        v_body,
        'booking_status_changed',
        new.id
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger tg_notify_on_booking_status
  after insert or update of status on public.bookings
  for each row execute function public.notify_on_booking_status();


-- ============================================================
-- REALTIME: включаем репликацию notifications
-- ------------------------------------------------------------
-- Чтобы бэйдж и лента уведомлений обновлялись в реальном времени.
-- Идемпотентно (DO-блок с проверкой), чтобы повторный прогон не падал.
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
