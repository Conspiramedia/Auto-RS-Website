-- ============================================================
-- AUTO.RS — Миграция 0145: уровень в админке и в чате
-- ============================================================
-- Хвост пакета 0143/0144. Отдельным файлом, а не правкой 0144:
-- та миграция уже применена на проде, и дописывать в применённый
-- файл нельзя — db push его больше не запустит, и репозиторий разошёлся
-- бы со схемой базы молча.
--
-- ЧТО ЗДЕСЬ:
--   1) admin_get_user     — уровень и его происхождение в карточке
--                           пользователя админки;
--   2) chats_with_details — тип собеседника рядом с его уровнем.
-- ============================================================


-- ============================================================
-- 1) admin_get_user — УРОВЕНЬ В КАРТОЧКЕ ПОЛЬЗОВАТЕЛЯ
-- ============================================================
-- ------------------------------------------------------------
-- Карточка пользователя в админке: показать уровень.
-- ------------------------------------------------------------
-- Тело повторяет 0080; добавлены четыре колонки В КОНЕЦ. Админу нужен
-- не только сам уровень, но и ответ на вопрос «почему он такой»:
-- назначен вручную (и кем, за что) или посчитан, и не действует ли
-- сейчас штраф.
drop function if exists public.admin_get_user(uuid);

create function public.admin_get_user(p_user_id uuid)
returns table (
  user_id              uuid,
  full_name            text,
  email                text,
  phone                text,
  role                 text,
  is_admin             boolean,
  verification_status  text,
  verification_comment text,
  locale               text,
  avatar_url           text,
  rating_avg           numeric,
  reviews_count        integer,
  created_at           timestamptz,
  last_sign_in_at      timestamptz,
  listings_total       integer,
  listings_active      integer,
  listings_rejected    integer,
  listings             jsonb,
  actions              jsonb,
  -- Новое (0144). Строго в конце.
  seller_tier          smallint,
  tier_override        smallint,
  tier_override_reason text,
  tier_penalty_until   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: карточка пользователя доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.email,
    p.phone,
    p.role::text,
    p.is_admin,
    p.verification_status::text,
    p.verification_comment,
    p.locale,
    p.avatar_url,
    p.rating_avg,
    p.reviews_count,
    p.created_at,
    u.last_sign_in_at,

    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status <> 'draft'),
    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status = 'active'),
    (select count(*)::integer from public.cars c
      where c.user_id = p.id and c.status = 'rejected'),

    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'car_id',     c.id,
                  'brand',      c.brand,
                  'model',      c.model,
                  'year',       c.year,
                  'status',     c.status::text,
                  'created_at', c.created_at
                )
                order by c.created_at desc
              )
         from public.cars c
        where c.user_id = p.id),
      '[]'::jsonb
    ),

    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'action',     l.action,
                  'created_at', l.created_at,
                  'actor_name', coalesce(ap.full_name, ap.email, 'модератор'),
                  'payload',    l.payload
                )
                order by l.created_at desc
              )
         from public.admin_action_log l
         left join public.profiles ap on ap.id = l.actor_id
        where l.target_table = 'profiles'
          and l.target_id = p.id),
      '[]'::jsonb
    ),

    p.seller_tier,
    p.tier_override,
    p.tier_override_reason,
    p.tier_penalty_until
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_user_id;
end;
$fn$;

comment on function public.admin_get_user(uuid)
  is 'Карточка пользователя: профиль, объявления, действия администраторов, уровень продавца и его происхождение (0144); только для админа';

grant execute on function public.admin_get_user(uuid) to authenticated;

-- ============================================================
-- 2) chats_with_details — ТИП СОБЕСЕДНИКА РЯДОМ С УРОВНЕМ
-- ============================================================
-- opponent_tier представление уже отдаёт (0144), но одного уровня
-- мало: у золота ДВЕ РАЗНЫЕ ПОДПИСИ — «Проверенная компания» у салона
-- и «Эксперт-продавец» у частника. Без типа собеседника шапка чата
-- называла бы автосалон экспертом-частником, то есть обещала бы
-- покупателю не то, что проверяла площадка.
--
-- Представление пересоздаётся целиком: зависимых объектов у него нет
-- (проверено по pg_depend), security_invoker сохраняется — без него
-- представление отдавало бы чужие диалоги.
drop view if exists public.chats_with_details;

create view public.chats_with_details
with (security_invoker = true)
as
select
  ch.id,
  ch.car_id,
  ch.buyer_id,
  ch.seller_id,
  ch.created_at,

  case when ch.buyer_id = auth.uid() then ch.seller_id else ch.buyer_id end
    as opponent_id,

  opp.full_name  as opponent_name,
  opp.avatar_url as opponent_avatar,

  c.brand,
  c.model,
  c.year,

  img.image_url as car_photo,

  (
    select count(*)
    from public.messages m
    where m.chat_id = ch.id
      and m.is_read = false
      and m.sender_id <> auth.uid()
  )::int as unread_count,

  (
    select max(m.created_at)
    from public.messages m
    where m.chat_id = ch.id
  ) as last_message_at,

  (
    select m.text
    from public.messages m
    where m.chat_id = ch.id
    order by m.created_at desc
    limit 1
  ) as last_message,

  (pref.pinned_at is not null) as pinned,
  pref.pinned_at,

  exists (
    select 1 from public.user_blocks ub
    where ub.blocker_id = auth.uid()
      and ub.blocked_id = case
        when ch.buyer_id = auth.uid() then ch.seller_id
        else ch.buyer_id
      end
  ) as peer_blocked,

  opp.seller_tier as opponent_tier,
  opp.seller_kind as opponent_kind

from public.chats ch
left join public.profiles opp
  on opp.id = case when ch.buyer_id = auth.uid() then ch.seller_id else ch.buyer_id end
join public.cars c
  on c.id = ch.car_id
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
  is 'Чаты + собеседник + машина + непрочитанные + превью + закрепление/блокировка + уровень и тип собеседника (0145). RLS вызывающего';
