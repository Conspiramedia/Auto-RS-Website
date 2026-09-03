-- ============================================================
-- AUTO.RS — Миграция 0131: письмо о новом сообщении в чате
-- ============================================================
-- ЗАЧЕМ. До сих пор новое сообщение порождало ровно два уведомления:
-- строку в notifications (0024, колокольчик внутри сайта) и задание в
-- push_queue (0045, пуш в мобильное приложение). Оба канала не работают
-- для человека, который зашёл на сайт с компьютера, написал продавцу и
-- закрыл вкладку: приложения у него нет, а колокольчик он увидит,
-- только если вернётся сам. То есть об ответе он не узнаёт никогда.
-- Это ровно та дыра, ради которой в 0071 заводилась очередь писем,
-- но для чата её тогда не закрыли.
--
-- ПОЧЕМУ НЕ ПИСЬМО НА КАЖДОЕ СООБЩЕНИЕ. Переписка идёт очередями:
-- продавец легко отправляет пять реплик подряд. Пять писем за минуту —
-- это отписка от рассылки, а не уведомление. У пуша та же проблема
-- решена склейкой непрочитанного задания (0045), но письмо склеивать
-- нечего: оно уходит из очереди сразу, и назад его не вернуть.
--
-- Поэтому письмо ограничено ДВУМЯ условиями, и каждое отсекает свой
-- вид лишнего:
--   1) ТОЛЬКО НЕПРОЧИТАННОЕ. Если получатель уже прочитал всё, что
--      отправитель написал ранее, и при этом пауза ещё не вышла — он
--      сидит в чате и читает диалог прямо сейчас. Открытый чат гасит
--      рассылку сам, без отдельного признака «онлайн».
--   2) АНТИСПАМ-ПАУЗА. Не чаще одного письма в 15 минут на пару
--      (чат × получатель). Серия реплик даёт одно письмо, а не пять.
--
-- Письмо НЕ зависит от пуша и отправляется даже владельцу приложения.
-- Пуш может не дойти по причинам, которых база не видит: выключены
-- уведомления, протух токен, нет сети. Дубль уведомления — меньшее
-- зло, чем пропущенное сообщение о покупке машины.
--
-- БЛОКИРОВКИ учитываются так же, как в пуше (0045): заблокировавший
-- собеседника не получает от него ни пуша, ни письма.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Отметка последнего письма по чату
-- ------------------------------------------------------------
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ КОЛОНКА В chats. Пауза считается на
-- пару «чат × получатель», а не на чат: покупатель и продавец пишут
-- друг другу независимо, и письмо одному не должно затыкать письмо
-- другому. В chats пришлось бы держать две колонки с ручным выбором
-- нужной по роли — источник ошибок при каждой правке.
create table if not exists public.chat_email_marks (
  chat_id  uuid        not null references public.chats (id) on delete cascade,
  user_id  uuid        not null references auth.users (id)  on delete cascade,
  sent_at  timestamptz not null default now(),
  primary key (chat_id, user_id)
);

comment on table public.chat_email_marks
  is 'Когда получателю последний раз уходило письмо о новом сообщении в чате. Только для антиспам-паузы';

-- RLS: таблица служебная, читает и пишет её только триггер под
-- SECURITY DEFINER. Политик нет вовсе — значит, ни anon, ни
-- authenticated не получают ни строки. Это осознанно: время отправки
-- писем клиенту знать незачем.
alter table public.chat_email_marks enable row level security;

revoke all on public.chat_email_marks from anon, authenticated;


-- ------------------------------------------------------------
-- 2) Триггерная функция
-- ------------------------------------------------------------
create or replace function public.email_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat      public.chats;
  v_recipient uuid;
  v_email     text;
  v_locale    text;
  v_prefix    text;
  v_sender    text;
  v_car       record;
  v_preview   text;
  v_last      timestamptz;
  v_unread    boolean;
begin
  select * into v_chat from public.chats where id = new.chat_id;
  if v_chat.id is null then
    return new;
  end if;

  -- Получатель — участник чата, который не отправитель.
  if new.sender_id = v_chat.buyer_id then
    v_recipient := v_chat.seller_id;
  else
    v_recipient := v_chat.buyer_id;
  end if;

  -- Получатель заблокировал отправителя — письма нет, как и пуша.
  if exists (
    select 1 from public.user_blocks b
    where b.blocker_id = v_recipient
      and b.blocked_id = new.sender_id
  ) then
    return new;
  end if;

  -- Было ли у получателя непрочитанное от этого отправителя ДО текущего
  -- сообщения. Само new проверять нельзя: оно вставлено с is_read =
  -- false всегда, и условие выродилось бы в «истина».
  select exists (
    select 1
      from public.messages m
     where m.chat_id   = new.chat_id
       and m.sender_id = new.sender_id
       and m.id       <> new.id
       and not m.is_read
  ) into v_unread;

  -- Отметка последнего письма по паре (чат × получатель).
  select sent_at into v_last
    from public.chat_email_marks
   where chat_id = new.chat_id
     and user_id = v_recipient;

  -- Пауза ещё не вышла — письмо не отправляем в любом случае: это и
  -- есть защита от серии реплик.
  if v_last is not null and v_last > now() - interval '15 minutes' then
    return new;
  end if;

  -- Пауза вышла, но всё прежнее прочитано, а письмо по чату уже
  -- когда-то уходило — человек в диалоге и читает по мере поступления.
  -- Слать не нужно. Первое же сообщение в чате (v_last is null)
  -- отправляется всегда: получатель о нём ещё ничего не знает.
  if v_last is not null and not v_unread then
    return new;
  end if;

  -- Адрес и язык получателя одним запросом.
  select p.email, p.locale
    into v_email, v_locale
    from public.profiles p
   where p.id = v_recipient;

  -- Почты нет (вход по SMS, профиль не заполнен) — письма не будет.
  -- Колокольчик уже поставил триггер 0024, это штатный путь.
  if v_email is null then
    return new;
  end if;

  -- Имя отправителя для темы письма. Пустое — шаблон подставит
  -- нейтральную формулировку, выдумывать имя за человека нельзя.
  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_sender
    from public.profiles p
   where p.id = new.sender_id;

  -- Объявление, вокруг которого идёт диалог: из письма должно быть
  -- понятно, о какой машине речь, без перехода на сайт.
  select c.brand, c.model, c.year
    into v_car
    from public.cars c
   where c.id = v_chat.car_id;

  -- Превью — те же 50 символов, что в колокольчике и пуше: письмо не
  -- должно раскрывать больше, чем остальные каналы.
  v_preview := left(coalesce(new.text, ''), 50);
  if length(coalesce(new.text, '')) > 50 then
    v_preview := v_preview || '…';
  end if;

  -- Ссылка ведёт прямо в диалог: /my/messages/{chat_id}, с префиксом
  -- локали получателя. Путь совпадает с роутами сайта
  -- (app/my/messages/[chatId] и app/ru/my/messages/[chatId]).
  v_prefix := case when coalesce(v_locale, 'sr') = 'ru' then '/ru' else '' end;

  perform public.f_enqueue_email(
    v_email,
    'new_message',
    jsonb_build_object(
      'locale',   coalesce(v_locale, 'sr'),
      'sender',   v_sender,
      'preview',  v_preview,
      'brand',    v_car.brand,
      'model',    v_car.model,
      'year',     v_car.year,
      'chat_url', public.f_site_base_url() || v_prefix
                    || '/my/messages/' || new.chat_id::text
    ),
    v_recipient
  );

  -- Отметку ставим в конце: письмо без адреса не отправлено, и пауза
  -- по нему начинаться не должна.
  insert into public.chat_email_marks (chat_id, user_id, sent_at)
  values (new.chat_id, v_recipient, now())
  on conflict (chat_id, user_id) do update set sent_at = now();

  return new;
end;
$$;

comment on function public.email_on_new_message()
  is 'Письмо получателю о новом сообщении в чате. Пауза 15 минут на пару чат×получатель';

drop trigger if exists tg_email_on_new_message on public.messages;

create trigger tg_email_on_new_message
  after insert on public.messages
  for each row execute function public.email_on_new_message();
