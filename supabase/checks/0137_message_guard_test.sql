-- ============================================================
-- RS AUTO — ТЕСТ запрета контактов в сообщениях (миграция 0137).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл ВСТАВЛЯЕТ чат и сообщения,
-- чтобы проверить срабатывание триггера. Защита от запуска на проде —
-- первым блоком, всё остальное идёт в транзакции с откатом в конце.
--
-- ЧТО ПРОВЕРЯЕТСЯ:
--   1) десять сообщений со ссылками, телефонами, почтой и никнеймами
--      триггер ОТКЛОНЯЕТ, и у каждого отказа hint = contacts_in_message;
--   2) десять обычных реплик с числами (год, пробег, цена, время)
--      проходят — ложных срабатываний нет;
--   3) отметка is_read проходит на сообщении, где ссылка уже есть:
--      триггер стоит только на INSERT, и старую переписку читать можно.
--
-- ЗАЧЕМ ЭТО ПРИ ЕСТЬ ЮНИТ-ТЕСТАХ. Те проверяют TypeScript-слой, этот —
-- SQL. Правила общие по смыслу, но записаны разными диалектами
-- регулярок, и совпадение поведения нужно доказывать на каждой
-- стороне. Клиент к тому же обходится: messages пишется обычным INSERT
-- под RLS, и запрос можно послать мимо Server Action.
-- ============================================================

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- 0) ЗАЩИТА: это точно не боевая база?
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from public.profiles where email = 'admin@rsauto.test'
  ) then
    raise exception
      'ОСТАНОВЛЕНО: не найден тестовый админ admin@rsauto.test. '
      'Похоже, это не локальная база с применённым seed. '
      'Тест ВСТАВЛЯЕТ чаты и сообщения. Запустите: supabase db reset';
  end if;
end $$;


-- ------------------------------------------------------------
-- ПОДГОТОВКА: чат между двумя тестовыми пользователями.
-- ------------------------------------------------------------
-- Создаём объявление и чат напрямую: start_chat опирается на auth.uid(),
-- которого в psql нет. Проверяется здесь триггер сообщений, а не
-- правила создания чата.
create temporary table t_ctx (buyer uuid, seller uuid, chat uuid, car uuid);

do $$
declare
  v_seller uuid;
  v_buyer  uuid;
  v_car    uuid;
  v_chat   uuid;
begin
  select id into v_seller from public.profiles
   where email = 'admin@rsauto.test' limit 1;

  -- Второй участник — любой другой профиль из seed.
  select id into v_buyer from public.profiles
   where id <> v_seller limit 1;

  if v_buyer is null then
    raise exception
      'ОСТАНОВЛЕНО: в базе только один профиль, чат построить не из кого. '
      'Запустите: supabase db reset';
  end if;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, city, currency, sale_price, description
  )
  values (v_seller, true, false, 'ProbaChat', 'Test0137', 2018,
          'Beograd', 'EUR', 9500,
          'Odlicno stanje, prvi vlasnik, redovno servisiran auto.')
  returning id into v_car;

  insert into public.chats (car_id, buyer_id, seller_id)
  values (v_car, v_buyer, v_seller)
  returning id into v_chat;

  insert into t_ctx values (v_buyer, v_seller, v_chat, v_car);
end $$;


-- ============================================================
-- ТЕСТ 1. ДЕСЯТЬ СООБЩЕНИЙ С КОНТАКТАМИ — ВСЕ ОТКЛОНЯЮТСЯ.
-- ============================================================
do $$
declare
  v_ctx    record;
  v_case   record;
  v_hint   text;
  v_failed text[] := '{}';
begin
  select * into v_ctx from t_ctx;

  for v_case in
    select * from (values
      ('сербский мобильный',
       'Zovite me na 064 123 4567 dogovorimo se oko cene'),
      ('международный +381',
       'Posaljite poruku na +381 60 123 4567 molim vas'),
      ('русский со скобками',
       'Пишите на 8 (999) 123-45-67, так будет удобнее'),
      ('русский слитно',
       'Мой телефон 79161234567, звоните после шести вечера'),
      ('email',
       'Napisite mi na mail prodavac.auto@gmail.com za detalje'),
      ('t.me',
       'Nadjite me na t.me/prodavac tamo sam stalno dostupan'),
      ('wa.me',
       'Pisite na wa.me/381641234567 tamo mi je brze da odgovorim'),
      ('@никнейм',
       'Moj instagram @car_seller_rs pogledajte tamo jos slika'),
      ('https-ссылка',
       'Pogledajte jos slika na https://imgur.com/abc123 evo'),
      ('www-домен',
       'Sve fotografije su na www.mojauto.rs pogledajte tamo')
    ) as c(name, text)
  loop
    begin
      insert into public.messages (chat_id, sender_id, text)
      values (v_ctx.chat, v_ctx.buyer, v_case.text);

      -- Сюда попадаем, только если сообщение ПРОШЛО — а не должно было.
      v_failed := v_failed || (v_case.name || ': отправилось');
    exception
      when check_violation then
        get stacked diagnostics v_hint = pg_exception_hint;
        if v_hint is distinct from 'contacts_in_message' then
          v_failed := v_failed
            || (v_case.name || ': hint=' || coalesce(v_hint, '<null>'));
        end if;
    end;
  end loop;

  if array_length(v_failed, 1) > 0 then
    raise exception 'ТЕСТ 1 ПРОВАЛЕН: %', array_to_string(v_failed, '; ');
  end if;

  raise notice 'ТЕСТ 1 ok: все 10 сообщений с контактами отклонены';
end $$;


-- ============================================================
-- ТЕСТ 2. ДЕСЯТЬ ОБЫЧНЫХ РЕПЛИК — ВСЕ ПРОХОДЯТ.
-- ============================================================
-- Половина содержит числа: год, пробег, цену, время встречи. Ровно то,
-- из-за чего наивный фильтр «цифры = телефон» сделал бы чат
-- неработающим, а покупателя — неспособным задать обычный вопрос.
do $$
declare
  v_ctx    record;
  v_case   record;
  v_failed text[] := '{}';
begin
  select * into v_ctx from t_ctx;

  for v_case in
    select * from (values
      ('приветствие',
       'Dobar dan, da li je auto jos uvek dostupan za prodaju?'),
      ('вопрос о пробеге',
       'Koliko ima kilometara? Vidim 86 500 u oglasu.'),
      ('торг',
       'Da li moze 9 500 evra? To mi je maksimum koji mogu.'),
      ('год выпуска',
       'Auto je iz 2020. godine, je li tako? Prvi vlasnik?'),
      ('приветствие по-русски',
       'Здравствуйте! Машина ещё продаётся?'),
      ('пробег по-русски',
       'Какой пробег? В объявлении указано 86 500 км.'),
      ('цена по-русски',
       'Цена 9 500 € окончательная или возможен торг?'),
      ('время встречи',
       'Mogu li da dodjem u subotu oko 15 casova da pogledam?'),
      ('вопрос об истории',
       'Da li je bio u nekom udesu? Ima li tragova popravke?'),
      ('характеристики',
       'Motor 2.0 dizel, menjac automatik — je li tako?')
    ) as c(name, text)
  loop
    begin
      insert into public.messages (chat_id, sender_id, text)
      values (v_ctx.chat, v_ctx.buyer, v_case.text);
    exception
      when check_violation then
        v_failed := v_failed || v_case.name;
    end;
  end loop;

  if array_length(v_failed, 1) > 0 then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН (ЛОЖНЫЕ СРАБАТЫВАНИЯ): обычные реплики отклонены: %',
      array_to_string(v_failed, ', ');
  end if;

  raise notice 'ТЕСТ 2 ok: все 10 обычных реплик отправлены';
end $$;


-- ============================================================
-- ТЕСТ 3. СТАРУЮ ПЕРЕПИСКУ МОЖНО ЧИТАТЬ.
-- ============================================================
-- Триггер стоит ТОЛЬКО на INSERT. Единственный UPDATE по сообщениям —
-- отметка is_read получателем; сработай проверка и на нём, вся старая
-- переписка со ссылками стала бы непрочитываемой, а счётчик
-- непрочитанных — вечным.
do $$
declare
  v_ctx    record;
  v_msg    uuid;
  v_read   boolean;
begin
  select * into v_ctx from t_ctx;

  -- Заводим «старое» сообщение со ссылкой в обход триггера — имитация
  -- строки, попавшей в базу до миграции.
  alter table public.messages disable trigger trg_messages_check_text;
  insert into public.messages (chat_id, sender_id, text)
  values (v_ctx.chat, v_ctx.buyer, 'Pogledajte na www.mojauto.rs jos slika')
  returning id into v_msg;
  alter table public.messages enable trigger trg_messages_check_text;

  -- Отметка прочитанным ОБЯЗАНА пройти.
  update public.messages set is_read = true where id = v_msg;

  select is_read into v_read from public.messages where id = v_msg;

  if v_read is not true then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: не удалось отметить прочитанным старое сообщение';
  end if;

  raise notice
    'ТЕСТ 3 ok: старое сообщение со ссылкой отмечается прочитанным';
end $$;


-- ============================================================
-- ИТОГ
-- ============================================================
do $$
begin
  raise notice '--- 0137_message_guard_test: ВСЕ ТЕСТЫ ПРОЙДЕНЫ ---';
end $$;

rollback;
