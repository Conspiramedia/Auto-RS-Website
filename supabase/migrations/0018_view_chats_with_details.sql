-- ============================================================
-- AUTO.RS — Миграция 0018: VIEW chats_with_details + счётчик непрочитанных
-- ============================================================
-- Экран «Мои диалоги» (My Chats): список чатов с данными машины,
-- профилем СОБЕСЕДНИКА (не себя) и числом непрочитанных сообщений.
--
-- security_invoker = true — VIEW применяет RLS вызывающего пользователя
-- (политики chats/messages/cars/profiles из предыдущих миграций), поэтому
-- пользователь увидит только свои чаты. Собеседник и счётчик вычисляются
-- относительно auth.uid().
-- ============================================================


-- ============================================================
-- VIEW: chats_with_details
-- ------------------------------------------------------------
-- Для каждого чата:
--   opponent_id   — ID собеседника (динамически: если я buyer → seller, иначе buyer);
--   opponent_name / opponent_avatar — профиль собеседника;
--   brand/model/car_photo — данные объявления и первое фото (order_index ASC);
--   unread_count  — непрочитанные ВХОДЯЩИЕ сообщения (чужие, is_read=false);
--   last_message_at — время последнего сообщения (для сортировки списка).
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
  -- Если auth.uid() — покупатель, то собеседник продавец, и наоборот.
  case when ch.buyer_id = auth.uid() then ch.seller_id else ch.buyer_id end
    as opponent_id,

  -- Профиль собеседника (подтягиваем по вычисленному opponent_id)
  opp.full_name  as opponent_name,
  opp.avatar_url as opponent_avatar,

  -- Данные объявления
  c.brand,
  c.model,
  c.year,

  -- Первое фото машины (минимальный order_index). LATERAL берёт одну строку.
  img.image_url as car_photo,

  -- Непрочитанные ВХОДЯЩИЕ: чужие (sender_id != auth.uid()) и is_read = false
  (
    select count(*)
    from public.messages m
    where m.chat_id = ch.id
      and m.is_read = false
      and m.sender_id <> auth.uid()
  )::int as unread_count,

  -- Время последнего сообщения в чате (null, если сообщений ещё нет)
  (
    select max(m.created_at)
    from public.messages m
    where m.chat_id = ch.id
  ) as last_message_at

from public.chats ch
-- Собеседник: соединяем профиль по динамически вычисленному ID
left join public.profiles opp
  on opp.id = case when ch.buyer_id = auth.uid() then ch.seller_id else ch.buyer_id end
-- Данные машины
join public.cars c
  on c.id = ch.car_id
-- Первое фото объявления по порядку галереи
left join lateral (
  select ci.image_url
  from public.car_images ci
  where ci.car_id = ch.car_id
  order by ci.order_index asc
  limit 1
) img on true;

comment on view public.chats_with_details
  is 'Чаты + собеседник (динамически) + данные машины + счётчик непрочитанных. RLS вызывающего';


-- ============================================================
-- RPC: unread_count_for_chat(p_chat_id) — счётчик непрочитанных для одного чата
-- ------------------------------------------------------------
-- Отдельная функция на случай, если счётчик нужен точечно (например,
-- обновить бэйдж конкретного чата без перезапроса всей VIEW).
-- security_invoker по умолчанию (invoker) + проверка через RLS messages.
-- ============================================================
create or replace function public.unread_count_for_chat(p_chat_id uuid)
returns integer
language sql
stable
as $$
  select count(*)::int
  from public.messages m
  where m.chat_id = p_chat_id
    and m.is_read = false
    and m.sender_id <> auth.uid();
$$;

comment on function public.unread_count_for_chat(uuid)
  is 'Число непрочитанных входящих сообщений в чате для текущего пользователя';

grant execute on function public.unread_count_for_chat(uuid) to authenticated;


-- ============================================================
-- RPC: total_unread_count() — всего непрочитанных по всем чатам
-- ------------------------------------------------------------
-- Для бэйджа на иконке «Чаты» в нижней навигации.
-- RLS messages_select_participant сам ограничит выборку чатами пользователя.
-- ============================================================
create or replace function public.total_unread_count()
returns integer
language sql
stable
as $$
  select count(*)::int
  from public.messages m
  where m.is_read = false
    and m.sender_id <> auth.uid();
$$;

comment on function public.total_unread_count()
  is 'Суммарное число непрочитанных сообщений пользователя (для бэйджа навигации)';

grant execute on function public.total_unread_count() to authenticated;
