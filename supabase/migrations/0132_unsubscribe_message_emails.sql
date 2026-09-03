-- ============================================================
-- AUTO.RS — Миграция 0132: отписка от писем о новых сообщениях
-- ============================================================
-- ЗАЧЕМ. Миграция 0131 завела письма о сообщениях в чате. В отличие от
-- модерации и кода входа, они приходят регулярно и по инициативе
-- постороннего человека — собеседника. Канал без отписки в такой
-- ситуации живёт недолго: получатель, которому письма не нужны, жмёт
-- «Спам», и это бьёт по доставляемости ВСЕХ писем площадки, включая
-- код входа. Дешевле дать выключатель, чем потом выбираться из чёрных
-- списков почтовых провайдеров.
--
-- ЧТО ИМЕННО ОТКЛЮЧАЕТСЯ. Только письма о сообщениях. Модерация
-- объявления, код входа, истечение срока — транзакционные письма,
-- ответ площадки на действие самого пользователя; отключаемыми они
-- быть не должны, иначе человек не узнает, что его объявление
-- отклонено. Поэтому флаг именной, а не общий «не писать мне».
--
-- ПОЧЕМУ КОЛОНКА, А НЕ jsonb С НАСТРОЙКАМИ. Видов писем сейчас
-- одиннадцать, и появляются они редко. jsonb дал бы неявный контракт:
-- набор ключей нигде не описан, опечатка в имени ключа тихо включает
-- рассылку обратно, а на общем с приложением бэкенде такое расхождение
-- ловится долго. Колонка с типом и значением по умолчанию проверяется
-- базой.
--
-- ДВА ПУТИ ОТПИСКИ, И ОБА ОБЯЗАТЕЛЬНЫ:
--   1) переключатель в кабинете (/my/profile) — для того, кто пришёл
--      настраивать уведомления осознанно;
--   2) ссылка в подвале письма — для того, у кого забит ящик. Этот
--      второй путь и есть главный: человек, которому предложено
--      «войдите в кабинет и найдите настройку», не входит, а помечает
--      письмо спамом.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Флаг и токен отписки
-- ------------------------------------------------------------
-- ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ true: письма о сообщениях включены, пока
-- человек не отказался. Существующие профили получают true той же
-- строкой — отдельный UPDATE не нужен.
alter table public.profiles
  add column if not exists email_on_message boolean not null default true;

comment on column public.profiles.email_on_message
  is 'Слать ли письма о новых сообщениях в чате. Транзакционных писем (модерация, код входа) не касается';

-- ТОКЕН ОТПИСКИ — ОТДЕЛЬНЫЙ uuid, А НЕ id ПОЛЬЗОВАТЕЛЯ.
-- Токен уезжает в письмо открытым текстом и оседает в почтовых
-- архивах, логах пересылок и у всех, кому письмо переслали. Будь это
-- profiles.id, ссылка раздавала бы идентификатор пользователя, по
-- которому строятся все остальные запросы. Отдельное значение можно
-- при необходимости перевыпустить, не трогая аккаунт.
alter table public.profiles
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

comment on column public.profiles.unsubscribe_token
  is 'Секрет для отписки по ссылке из письма, без авторизации. Не равен id: уезжает в письмо открытым текстом';

-- Поиск по токену идёт на каждой отписке и должен быть точечным.
-- Уникальность заодно исключает коллизию при ручном перевыпуске.
create unique index if not exists uq_profiles_unsubscribe_token
  on public.profiles (unsubscribe_token);

-- Колонка добавлена с default, но у СУЩЕСТВУЮЩИХ строк default
-- проставлен одним значением на всю таблицу только в свежих версиях
-- Postgres; для надёжности раздаём каждому свой токен явно. Условие
-- по уникальному индексу: повторный прогон миграции ничего не менял бы,
-- но лишний UPDATE по всей таблице ни к чему.
update public.profiles
   set unsubscribe_token = gen_random_uuid()
 where unsubscribe_token is null;


-- ------------------------------------------------------------
-- 2) RPC для переключателя в кабинете
-- ------------------------------------------------------------
-- ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ РАСШИРЕНИЕ set_my_contact_email (0071).
-- Ту RPC вызывает мобильное приложение, и её сигнатура —
-- часть контракта: добавлять туда третий параметр нельзя. Изменения
-- в схеме аддитивные, старый вызов продолжает работать как прежде.
create or replace function public.set_my_email_on_message(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  update public.profiles p
     set email_on_message = coalesce(p_enabled, true),
         updated_at       = now()
   where p.id = v_user;

  return coalesce(p_enabled, true);
end;
$$;

comment on function public.set_my_email_on_message(boolean)
  is 'Переключатель писем о новых сообщениях для текущего пользователя';

grant execute on function public.set_my_email_on_message(boolean) to authenticated;


-- ------------------------------------------------------------
-- 3) RPC отписки по токену — без авторизации
-- ------------------------------------------------------------
-- ВЫЗЫВАЕТСЯ АНОНИМНО, и это осознанно. Человек с забитым ящиком не
-- станет вспоминать пароль ради отписки: он нажмёт «Спам». Ссылка,
-- работающая без входа, — единственный вариант, который реально
-- используют.
--
-- ФУНКЦИЯ НЕ СООБЩАЕТ, СУЩЕСТВУЕТ ЛИ ТОКЕН. Возвращает true в обоих
-- случаях. Иначе она превращается в оракул: перебором можно было бы
-- проверять чужие токены, а по факту существования — судить о наличии
-- аккаунта. Отписка по несуществующему токену — не ошибка, а
-- нормальный исход (письмо старое, аккаунт уже удалён).
--
-- РЕЗУЛЬТАТ НЕ РАСКРЫВАЕТ ВЛАДЕЛЬЦА: ни адреса, ни имени, ни id.
-- Страница отписки показывает только «готово».
create or replace function public.unsubscribe_by_token(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null then
    return true;
  end if;

  update public.profiles p
     set email_on_message = false,
         updated_at       = now()
   where p.unsubscribe_token = p_token
     and p.email_on_message;   -- повторный переход по ссылке ничего не пишет

  -- Намеренно всегда true: см. комментарий выше.
  return true;
end;
$$;

comment on function public.unsubscribe_by_token(uuid)
  is 'Отписка от писем о сообщениях по токену из письма. Всегда true: не раскрывает, существует ли токен';

grant execute on function public.unsubscribe_by_token(uuid) to anon, authenticated;


-- ------------------------------------------------------------
-- 4) Триггер писем о сообщениях: учитываем флаг и кладём токен
-- ------------------------------------------------------------
-- Пересоздаём функцию из 0131 целиком (create or replace): в ней
-- меняются две вещи — проверка email_on_message и новое поле payload
-- с адресом отписки. Триггер пересоздавать не нужно, он ссылается на
-- функцию по имени.
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
  v_enabled   boolean;
  v_token     uuid;
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

  -- Адрес, язык, флаг и токен получателя одним запросом.
  select p.email, p.locale, p.email_on_message, p.unsubscribe_token
    into v_email, v_locale, v_enabled, v_token
    from public.profiles p
   where p.id = v_recipient;

  -- Отписался от писем о сообщениях. Колокольчик (0024) и пуш (0045)
  -- при этом продолжают работать: человек отказался от почты, а не от
  -- уведомлений вообще.
  if not coalesce(v_enabled, true) then
    return new;
  end if;

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
                    || '/my/messages/' || new.chat_id::text,
      -- Адрес отписки собираем здесь, а не в шаблоне: токен есть
      -- только у базы, и передавать его отдельным полем ради сборки
      -- ссылки на стороне Edge Function незачем.
      'unsubscribe_url', public.f_site_base_url() || v_prefix
                    || '/unsubscribe?t=' || v_token::text
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
  is 'Письмо получателю о новом сообщении в чате. Пауза 15 минут на пару чат×получатель, учитывает email_on_message';


-- ------------------------------------------------------------
-- 5) Защита токена от перезаписи клиентом
-- ------------------------------------------------------------
-- ПОЧЕМУ ЭТО НУЖНО. Политика profiles_update_own (0063) разрешает
-- владельцу UPDATE своей строки целиком, а колоночных грантов на
-- profiles нет: клиент технически может записать в unsubscribe_token
-- любое значение — например, чужое, подсмотренное в пересланном
-- письме. Тогда отписка по чужой ссылке выключала бы письма ему.
--
-- Отбирать UPDATE на всю таблицу нельзя: через неё идут штатные пути
-- (смена имени, аватара, витрина салона). Поэтому запрет точечный —
-- триггер молча возвращает прежнее значение токена. Именно молча, а
-- не исключением: клиент, отправляющий строку профиля целиком,
-- присылает и это поле, ничего дурного не имея в виду, и падение
-- сохранения профиля было бы регрессом на ровном месте.
--
-- Функции из пункта 3 это не мешает: она работает под SECURITY
-- DEFINER и меняет не токен, а email_on_message.
create or replace function public.protect_unsubscribe_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Перевыпуск токена остаётся возможным из SQL под service_role:
  -- у той роли RLS и клиентские правила не действуют, а строка сюда
  -- приходит уже с новым значением от самой базы.
  if new.unsubscribe_token is distinct from old.unsubscribe_token then
    new.unsubscribe_token := old.unsubscribe_token;
  end if;

  return new;
end;
$$;

comment on function public.protect_unsubscribe_token()
  is 'Не даёт клиенту перезаписать unsubscribe_token через profiles_update_own';

drop trigger if exists tg_protect_unsubscribe_token on public.profiles;

create trigger tg_protect_unsubscribe_token
  before update of unsubscribe_token on public.profiles
  for each row execute function public.protect_unsubscribe_token();
