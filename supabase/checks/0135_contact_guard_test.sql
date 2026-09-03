-- ============================================================
-- RS AUTO — ТЕСТ серверного запрета контактов в описании (0135).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл ВСТАВЛЯЕТ объявления,
-- чтобы проверить срабатывание триггера, поэтому на боевой базе он
-- насорил бы в каталоге. Защита от запуска на проде — первым блоком,
-- всё остальное идёт в транзакции с откатом в конце.
--
-- ЧТО ПРОВЕРЯЕТСЯ:
--   1) десять описаний с контактами — f_has_contact_info даёт true;
--   2) десять описаний с годом, пробегом, ценой и объёмом двигателя —
--      false (ложных срабатываний нет);
--   3) триггер РЕАЛЬНО отклоняет вставку и правку, а не только
--      функция возвращает признак;
--   4) чистое описание вставляется и правится без помех;
--   5) UPDATE, не трогающий описание, проходит даже если в тексте
--      старого объявления номер есть — иначе публикация и продвижение
--      уже принятых модератором объявлений сломались бы.
--
-- ЗАЧЕМ ЭТО ПРИ ЕСТЬ ЮНИТ-ТЕСТАХ КЛИЕНТА (scripts/test-contact-guard.mjs).
-- Те проверяют TypeScript-слой, этот — SQL-слой. Правила ОДИНАКОВЫ по
-- смыслу, но записаны разными диалектами регулярок (PCRE против POSIX,
-- где нет lookbehind), и совпадение поведения нужно доказывать
-- отдельно на каждой стороне. Клиент к тому же обходится, а сервер —
-- нет: именно он источник истины.
--
-- ЗАПУСК:
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
--        -f supabase/checks/0135_contact_guard_test.sql
-- либо через npm run test:sql (см. package.json).
-- ============================================================

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- 0) ЗАЩИТА: это точно не боевая база?
-- ------------------------------------------------------------
-- Признак локального стека: пользователи с доменом @rsauto.test из
-- seed. На боевой базе их нет и быть не может.
do $$
begin
  if not exists (
    select 1 from public.profiles where email = 'admin@rsauto.test'
  ) then
    raise exception
      'ОСТАНОВЛЕНО: не найден тестовый админ admin@rsauto.test. '
      'Похоже, это не локальная база с применённым seed. '
      'Тест ВСТАВЛЯЕТ объявления. Запустите: supabase db reset';
  end if;
end $$;


-- ============================================================
-- ТЕСТ 1. ОПИСАНИЯ С КОНТАКТАМИ — ВСЕ ОТКЛОНЯЮТСЯ.
-- ============================================================
-- Форматы взяты те, какими сербские и русские продавцы пишут номер на
-- самом деле: с плюсом и без, со скобками, точками, дефисами,
-- разрывами по группам, а также почта, @ник и ссылка на телеграм.
do $$
declare
  v_case   record;
  v_failed text[] := '{}';
begin
  for v_case in
    select * from (values
      ('+381 с пробелами',
       'Odlicno stanje, prvi vlasnik. +381 60 123 4567'),
      ('+381 слитно',
       'Auto je u odlicnom stanju, pozovite +381641234567'),
      ('06x с пробелами',
       'Prodajem auto, sve informacije na 064 123 4567'),
      ('06x с дефисами',
       'Kontakt: 060-345-6789, moze zamena'),
      ('06x в скобках',
       'Zvati posle 17h (065) 1234567'),
      ('городской Белград',
       'Auto se nalazi u Beogradu, telefon 011 2345678'),
      ('русский 8 в скобках',
       'Машина в отличном состоянии, звоните 8 (999) 123-45-67'),
      ('русский 7 слитно',
       'Продаю срочно, пишите 79161234567'),
      ('электронная почта',
       'Sve dodatne informacije na mail: prodavac.auto@gmail.com'),
      ('@ник и t.me',
       'Pisite na @prodavac_auto ili t.me/prodavacauto')
    ) as c(name, text)
  loop
    if not public.f_has_contact_info(v_case.text) then
      v_failed := v_failed || v_case.name;
    end if;
  end loop;

  if array_length(v_failed, 1) > 0 then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: контакты НЕ найдены в описаниях: %',
      array_to_string(v_failed, ', ');
  end if;

  raise notice 'ТЕСТ 1 ok: все 10 описаний с контактами отклонены';
end $$;


-- ============================================================
-- ТЕСТ 2. ЧИСТЫЕ ОПИСАНИЯ — ВСЕ ПРИНИМАЮТСЯ.
-- ============================================================
-- Эта половина важнее первой. Пропущенный номер поймает модерация, а
-- ложное срабатывание делает объявление неподаваемым: продавец видит
-- отказ, не понимает, за что, и уходит. Здесь собрано ровно то, из-за
-- чего наивный фильтр «шесть цифр подряд» неприменим — год, пробег с
-- разделителем и без, цена, объём двигателя, размер дисков, даты
-- обслуживания и числа рядом со словом «звоните».
do $$
declare
  v_case   record;
  v_failed text[] := '{}';
begin
  for v_case in
    select * from (values
      ('год выпуска',
       'Automobil 2020. godiste, prvi vlasnik, garazirani.'),
      ('пробег с пробелом',
       'Predjeno 86 500 km, redovno servisiran u ovlascenom servisu.'),
      ('пробег слитно',
       'Kilometraza 145000 km, motor bez ikakvih problema.'),
      ('объём с точкой',
       'Motor 1.9 TDI, potrosnja 5.5 litara na 100 km.'),
      ('объём 2.0',
       'Dizel 2.0, 140 konjskih snaga, menjac automatik.'),
      ('цена в евро',
       'Cena 12 500 evra, moguc mali dogovor pri kupovini.'),
      ('цена в рублях',
       'Цена 1 250 000 рублей, торг при осмотре автомобиля.'),
      ('диски и шины',
       'Alu felne 17 cola, gume 225/45 R17 iz 2022. godine.'),
      ('даты обслуживания',
       'Veliki servis uradjen na 120000 km, 15.03.2024.'),
      ('числа рядом со «звоните»',
       'Звоните после 18 часов. Машина 2015 года, пробег 90 000 км.')
    ) as c(name, text)
  loop
    if public.f_has_contact_info(v_case.text) then
      v_failed := v_failed || v_case.name;
    end if;
  end loop;

  if array_length(v_failed, 1) > 0 then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН (ЛОЖНЫЕ СРАБАТЫВАНИЯ): чистые описания отклонены: %',
      array_to_string(v_failed, ', ');
  end if;

  raise notice 'ТЕСТ 2 ok: все 10 чистых описаний приняты';
end $$;


-- ============================================================
-- ТЕСТ 3. ТРИГГЕР ОТКЛОНЯЕТ ВСТАВКУ.
-- ============================================================
-- Функция может возвращать что угодно — важно, чтобы её результат
-- РЕАЛЬНО останавливал запись. Проверяем на прямом INSERT: он обходит
-- оба RPC и повторяет ровно тот сценарий, ради которого барьер и
-- заводился — вызов мимо формы.
do $$
declare
  v_user_id uuid;
  v_errcode text;
  v_hint    text;
begin
  select id into v_user_id from public.profiles
   where email = 'admin@rsauto.test' limit 1;

  begin
    insert into public.cars (
      user_id, is_for_sale, is_for_rent,
      brand, model, year, city, currency, sale_price, description
    )
    values (
      v_user_id, true, false,
      'Volkswagen', 'Golf', 2018, 'Beograd', 'EUR', 9500,
      'Odlicno stanje. Kontakt telefon 064 123 4567.'
    );

    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: объявление с номером в описании ВСТАВИЛОСЬ';
  exception
    when check_violation then
      get stacked diagnostics
        v_errcode = returned_sqlstate,
        v_hint    = pg_exception_hint;

      -- hint — то, по чему клиент отличает этот отказ от прочих
      -- check_violation (цена, год, залог). Без него sell_err_contacts
      -- не показался бы, и продавец увидел бы русский текст из базы.
      if v_hint is distinct from 'contacts_in_description' then
        raise exception
          'ТЕСТ 3 ПРОВАЛЕН: отказ пришёл без hint=contacts_in_description (hint=%)',
          coalesce(v_hint, '<null>');
      end if;

      raise notice 'ТЕСТ 3 ok: вставка отклонена (% / %)', v_errcode, v_hint;
  end;
end $$;


-- ============================================================
-- ТЕСТ 4. ЧИСТОЕ ОПИСАНИЕ ВСТАВЛЯЕТСЯ И ПРАВИТСЯ.
-- ============================================================
-- Барьер обязан пропускать нормальное объявление: тест 2 проверял
-- функцию, этот — весь путь через триггер, вместе с чисткой текста и
-- определением языка, которые живут в той же функции.
do $$
declare
  v_user_id uuid;
  v_car_id  uuid;
  v_lang    text;
begin
  select id into v_user_id from public.profiles
   where email = 'admin@rsauto.test' limit 1;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, city, currency, sale_price, description
  )
  values (
    v_user_id, true, false,
    'Volkswagen', 'Passat', 2019, 'Novi Sad', 'EUR', 11500,
    'Predjeno 86 500 km, motor 1.9 TDI. Cena 11 500 evra, 2019. godiste.'
  )
  returning id, description_lang into v_car_id, v_lang;

  if v_car_id is null then
    raise exception 'ТЕСТ 4 ПРОВАЛЕН: чистое объявление не вставилось';
  end if;

  -- Правка описания — тоже чистая, тоже обязана пройти.
  update public.cars
     set description = 'Prvi vlasnik, garazirani. Predjeno 90 000 km, 2.0 dizel.'
   where id = v_car_id;

  raise notice
    'ТЕСТ 4 ok: чистое объявление вставлено и отредактировано (lang=%)',
    coalesce(v_lang, '<null>');
end $$;


-- ============================================================
-- ТЕСТ 5. ПРАВКА, ДОБАВЛЯЮЩАЯ НОМЕР, ОТКЛОНЯЕТСЯ.
-- ============================================================
-- Барьер обязан стоять и на редактировании: иначе продавец подал бы
-- чистое объявление, дождался публикации и дописал номер правкой.
do $$
declare
  v_user_id uuid;
  v_car_id  uuid;
begin
  select id into v_user_id from public.profiles
   where email = 'admin@rsauto.test' limit 1;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, city, currency, sale_price, description
  )
  values (
    v_user_id, true, false,
    'Skoda', 'Octavia', 2017, 'Nis', 'EUR', 8900,
    'Redovno servisiran, predjeno 150 000 km.'
  )
  returning id into v_car_id;

  begin
    update public.cars
       set description = 'Redovno servisiran. Zovite na +381 64 111 2233.'
     where id = v_car_id;

    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: правка, добавившая номер, прошла';
  exception
    when check_violation then
      raise notice 'ТЕСТ 5 ok: правка с номером отклонена';
  end;
end $$;


-- ============================================================
-- ТЕСТ 6. UPDATE, НЕ ТРОГАЮЩИЙ ОПИСАНИЕ, ПРОХОДИТ ВСЕГДА.
-- ============================================================
-- САМЫЙ ВАЖНЫЙ ТЕСТ СОВМЕСТИМОСТИ. В каталоге уже лежат объявления,
-- принятые модерацией ДО этой миграции, и в части из них номер в
-- описании есть. Если бы проверка срабатывала на любой UPDATE, то
-- публикация, продвижение, счётчик просмотров и продление таких
-- объявлений начали бы падать — то есть миграция сломала бы работающий
-- каталог. Условие «описание изменилось» в триггере ровно от этого и
-- защищает; здесь оно доказывается.
--
-- Строку с номером заводим в обход триггера: вставить её обычным
-- INSERT теперь нельзя, а воспроизвести старое состояние надо.
do $$
declare
  v_user_id uuid;
  v_car_id  uuid;
  v_views   integer;
begin
  select id into v_user_id from public.profiles
   where email = 'admin@rsauto.test' limit 1;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, city, currency, sale_price, description
  )
  values (
    v_user_id, true, false,
    'Fiat', 'Punto', 2012, 'Subotica', 'EUR', 3200,
    'Mali gradski auto, ekonomican.'
  )
  returning id into v_car_id;

  -- Отключаем триггер и записываем «старое» описание с номером —
  -- имитация строки, попавшей в базу до миграции.
  alter table public.cars disable trigger trg_cars_detect_lang;
  update public.cars
     set description = 'Mali gradski auto. Kontakt 064 999 8877.'
   where id = v_car_id;
  alter table public.cars enable trigger trg_cars_detect_lang;

  -- А теперь обычный UPDATE, описания не касающийся. Он ОБЯЗАН пройти.
  update public.cars
     set year = 2013
   where id = v_car_id;

  select year into v_views from public.cars where id = v_car_id;

  if v_views is distinct from 2013 then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: UPDATE без правки описания не применился';
  end if;

  raise notice
    'ТЕСТ 6 ok: UPDATE, не трогающий описание, проходит на старой строке с номером';
end $$;


-- ============================================================
-- ИТОГ
-- ============================================================
do $$
begin
  raise notice '--- 0135_contact_guard_test: ВСЕ ТЕСТЫ ПРОЙДЕНЫ ---';
end $$;

-- Ничего не оставляем в базе: все вставленные объявления откатываются.
rollback;
