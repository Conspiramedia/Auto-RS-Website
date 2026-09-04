-- ============================================================
-- RS AUTO — ТЕСТ качества описания (миграция 0136).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл ВСТАВЛЯЕТ объявления,
-- чтобы проверить срабатывание триггера. Защита от запуска на проде —
-- первым блоком, всё остальное идёт в транзакции с откатом в конце.
--
-- ЧТО ПРОВЕРЯЕТСЯ:
--   1) десять описаний со ссылками — f_has_external_link даёт true;
--   2) десять описаний с HTML и скриптами — f_has_markup даёт true;
--   3) десять чистых описаний — обе функции дают false;
--   4) триггер отклоняет ссылку, разметку, короткое и длинное
--      описание, и у каждого отказа свой hint;
--   5) описание ровно на границах (30 и 6000) ведёт себя правильно;
--   6) пустое описание по-прежнему допустимо — поле необязательное;
--   7) UPDATE, не трогающий описание, проходит на старой строке со
--      слишком коротким описанием.
--
-- Дополняет 0135_contact_guard_test.sql: там контакты, здесь всё
-- остальное. Разделены по миграциям, чтобы падение сразу называло
-- виновника.
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
      'Тест ВСТАВЛЯЕТ объявления. Запустите: supabase db reset';
  end if;
end $$;


-- ============================================================
-- ТЕСТ 1. ДЕСЯТЬ ОПИСАНИЙ СО ССЫЛКАМИ — ВСЕ ЛОВЯТСЯ.
-- ============================================================
do $$
declare
  v_case   record;
  v_failed text[] := '{}';
begin
  for v_case in
    select * from (values
      ('https со схемой',
       'Pogledajte na https://avito.ru/12345 vise slika automobila'),
      ('http со схемой',
       'Detaljan opis i slike na http://mojauto.rs/oglas/998877'),
      ('www без схемы',
       'Vise informacija na www.mojauto.rs o ovom vozilu i ceni'),
      ('голый домен .rs',
       'Detalji: mojauto.rs/oglas/12345 pogledajte slike i opis'),
      ('голый домен .com',
       'Slike na imgur.com/abc123 ima ih dosta za pregled kupcima'),
      ('поддомен',
       'Sve slike na slike.mojauto.rs u punoj rezoluciji za kupce'),
      ('домен .net',
       'Kompletna istorija servisa na autoistorija.net za proveru'),
      ('домен .io',
       'Izvestaj o vozilu dostupan na carcheck.io pogledajte sami'),
      ('ftp',
       'Dokumentacija na ftp://files.example.com dostupna svima vama'),
      ('youtube',
       'Video snimak motora na youtube.com/watch pogledajte obavezno')
    ) as c(name, text)
  loop
    if not public.f_has_external_link(v_case.text) then
      v_failed := v_failed || v_case.name;
    end if;
  end loop;

  if array_length(v_failed, 1) > 0 then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: ссылки НЕ найдены в описаниях: %',
      array_to_string(v_failed, ', ');
  end if;

  raise notice 'ТЕСТ 1 ok: все 10 описаний со ссылками отклонены';
end $$;


-- ============================================================
-- ТЕСТ 2. ДЕСЯТЬ ОПИСАНИЙ С РАЗМЕТКОЙ — ВСЕ ЛОВЯТСЯ.
-- ============================================================
do $$
declare
  v_case   record;
  v_failed text[] := '{}';
begin
  for v_case in
    select * from (values
      ('парный тег b',
       'Opis <b>odlicno</b> stanje auta i kompletna oprema vozila'),
      ('одиночный br',
       'Prvi vlasnik<br/>Garaziran primerak, nije nikada udaran'),
      ('div с атрибутом',
       '<div class=x>Prodajem auto</div> u odlicnom stanju danas'),
      ('script',
       'Auto <script>alert(1)</script> u odlicnom stanju bez ostecenja'),
      ('незакрытый script',
       'Odlicno stanje <script src=x.js nije nikada udaran auto'),
      ('iframe',
       'Pogledajte <iframe src=x></iframe> i procenite stanje vozila'),
      ('обработчик onclick',
       'onclick=alert(1) odlicno stanje automobila, garaziran'),
      ('javascript:',
       'javascript:void(0) prodajem auto u odlicnom stanju, nov'),
      ('HTML-сущности',
       'Tekst sa &lt;br&gt; oznakama i ostalim stvarima iz oglasa'),
      ('закрывающий тег',
       'Prodajem auto</p> u odlicnom stanju, prvi vlasnik, klima')
    ) as c(name, text)
  loop
    if not public.f_has_markup(v_case.text) then
      v_failed := v_failed || v_case.name;
    end if;
  end loop;

  if array_length(v_failed, 1) > 0 then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: разметка НЕ найдена в описаниях: %',
      array_to_string(v_failed, ', ');
  end if;

  raise notice 'ТЕСТ 2 ok: все 10 описаний с разметкой отклонены';
end $$;


-- ============================================================
-- ТЕСТ 3. ДЕСЯТЬ ЧИСТЫХ ОПИСАНИЙ — НИ ОДНО НЕ ЛОВИТСЯ.
-- ============================================================
-- Эта половина важнее двух предыдущих. Отдельно проверяются фразы с
-- точкой без пробела («nov.Me», «auto.Info», «fiksna.Net»): сербы
-- часто не ставят пробел после точки, и следующее слово регулярно
-- совпадает с доменной зоной. Именно на них правило домена и
-- ошибалось, пока не стало учитывать регистр.
do $$
declare
  v_case   record;
  v_failed text[] := '{}';
begin
  for v_case in
    select * from (values
      ('объём и расход',
       'Motor 1.9 TDI, potrosnja 5.5 litara na 100 km, odlicno stanje.'),
      ('дата обслуживания',
       'Veliki servis uradjen na 120000 km, 15.03.2024. Sve je uredno.'),
      ('диски и шины',
       'Alu felne 17 cola, gume 225/45 R17 iz 2022. godine, kao nove.'),
      ('год выпуска',
       'Automobil 2020. godiste, prvi vlasnik, garaziran, nije udaran.'),
      ('объём 2.0',
       'Dizel 2.0, 140 konjskih snaga, menjac automatik, tempomat.'),
      ('пробег',
       'Predjeno 86 500 km, redovno servisiran u ovlascenom servisu.'),
      ('цена и пробег по-русски',
       'Цена 12 500 евро. Машина 2015 года, пробег 90 000 км, торг.'),
      ('точка без пробела .Me',
       'Auto je nov.Me interesuje samo ozbiljan kupac za ovaj auto.'),
      ('точка без пробела .Info',
       'Prodajem auto.Info na uvid dolazi svako radno vreme danas.'),
      ('сокращение d.o.o.',
       'Sluzbeno vozilo firme d.o.o. u odlicnom stanju, prvi vlasnik.')
    ) as c(name, text)
  loop
    if public.f_has_external_link(v_case.text)
       or public.f_has_markup(v_case.text) then
      v_failed := v_failed || v_case.name;
    end if;
  end loop;

  if array_length(v_failed, 1) > 0 then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН (ЛОЖНЫЕ СРАБАТЫВАНИЯ): чистые описания отклонены: %',
      array_to_string(v_failed, ', ');
  end if;

  raise notice 'ТЕСТ 3 ok: все 10 чистых описаний приняты';
end $$;


-- ============================================================
-- ТЕСТ 4. ТРИГГЕР ОТКЛОНЯЕТ И НАЗЫВАЕТ ПРИЧИНУ.
-- ============================================================
-- Функции могут возвращать что угодно — важно, чтобы результат
-- РЕАЛЬНО останавливал запись, и чтобы hint у каждой причины был свой:
-- по нему клиент выбирает текст для продавца.
do $$
declare
  v_user_id uuid;
  v_case    record;
  v_hint    text;
  v_failed  text[] := '{}';
begin
  select id into v_user_id from public.profiles
   where email = 'admin@rsauto.test' limit 1;

  for v_case in
    select * from (values
      ('ссылка',
       'Pogledajte sve slike na mojauto.rs i javite se ako vam odgovara',
       'links_in_description'),
      ('разметка',
       'Auto <b>odlicno</b> stanje, prvi vlasnik, garaziran primerak',
       'markup_in_description'),
      ('короткое',
       'Prodajem auto',
       'description_too_short'),
      ('длинное',
       repeat('a', 6001),
       'description_too_long')
    ) as c(name, text, want_hint)
  loop
    begin
      insert into public.cars (
        user_id, is_for_sale, is_for_rent,
        brand, model, year, city, currency, sale_price, description
      )
      values (
        v_user_id, true, false,
        'ProbaGuard', 'Test0136', 2018, 'Beograd', 'EUR', 9500, v_case.text
      );

      -- Сюда попадаем, только если вставка ПРОШЛА — а не должна была.
      v_failed := v_failed || (v_case.name || ': вставилось');
    exception
      when check_violation then
        get stacked diagnostics v_hint = pg_exception_hint;
        if v_hint is distinct from v_case.want_hint then
          v_failed := v_failed
            || (v_case.name || ': hint=' || coalesce(v_hint, '<null>')
                || ', ожидался ' || v_case.want_hint);
        end if;
    end;
  end loop;

  if array_length(v_failed, 1) > 0 then
    raise exception 'ТЕСТ 4 ПРОВАЛЕН: %', array_to_string(v_failed, '; ');
  end if;

  raise notice 'ТЕСТ 4 ok: триггер отклонил все четыре нарушения с верными hint';
end $$;


-- ============================================================
-- ТЕСТ 5. ГРАНИЦЫ ДЛИНЫ: 29 и 6001 — нельзя, 30 и 6000 — можно.
-- ============================================================
-- Граница — то место, где ошибаются чаще всего, поэтому проверяется с
-- обеих сторон, а не «примерно короткое / примерно длинное».
do $$
declare
  v_user_id uuid;
  v_id      uuid;
begin
  select id into v_user_id from public.profiles
   where email = 'admin@rsauto.test' limit 1;

  -- 29 символов — отказ.
  begin
    insert into public.cars (
      user_id, is_for_sale, is_for_rent,
      brand, model, year, city, currency, sale_price, description
    )
    values (v_user_id, true, false, 'ProbaGuard', 'Granica', 2018,
            'Beograd', 'EUR', 9500, repeat('a', 29));
    raise exception 'ТЕСТ 5 ПРОВАЛЕН: описание в 29 символов прошло';
  exception
    when check_violation then null;
  end;

  -- 30 символов — проходит.
  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, city, currency, sale_price, description
  )
  values (v_user_id, true, false, 'ProbaGuard', 'Granica30', 2018,
          'Beograd', 'EUR', 9500, repeat('a', 30))
  returning id into v_id;

  if v_id is null then
    raise exception 'ТЕСТ 5 ПРОВАЛЕН: описание в 30 символов не вставилось';
  end if;

  -- 6000 символов — проходит.
  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, city, currency, sale_price, description
  )
  values (v_user_id, true, false, 'ProbaGuard', 'Granica6000', 2018,
          'Beograd', 'EUR', 9500, repeat('a', 6000))
  returning id into v_id;

  if v_id is null then
    raise exception 'ТЕСТ 5 ПРОВАЛЕН: описание в 6000 символов не вставилось';
  end if;

  raise notice 'ТЕСТ 5 ok: границы 29/30 и 6000/6001 соблюдены';
end $$;


-- ============================================================
-- ТЕСТ 6. ПУСТОЕ ОПИСАНИЕ ДОПУСТИМО.
-- ============================================================
-- Поле необязательное с 0034. Минимум в 30 символов применяется
-- только к ЗАПОЛНЕННОМУ описанию: требовать текст от всех значило бы
-- менять правила подачи, а не добавлять проверку.
do $$
declare
  v_user_id uuid;
  v_id      uuid;
begin
  select id into v_user_id from public.profiles
   where email = 'admin@rsauto.test' limit 1;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, city, currency, sale_price, description
  )
  values (v_user_id, true, false, 'ProbaGuard', 'BezOpisa', 2018,
          'Beograd', 'EUR', 9500, null)
  returning id into v_id;

  if v_id is null then
    raise exception 'ТЕСТ 6 ПРОВАЛЕН: объявление без описания не вставилось';
  end if;

  -- Пустая строка эквивалентна отсутствию: f_clean_description
  -- приводит её к NULL.
  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, city, currency, sale_price, description
  )
  values (v_user_id, true, false, 'ProbaGuard', 'PrazanOpis', 2018,
          'Beograd', 'EUR', 9500, '   ')
  returning id into v_id;

  if v_id is null then
    raise exception 'ТЕСТ 6 ПРОВАЛЕН: объявление с пустым описанием не вставилось';
  end if;

  raise notice 'ТЕСТ 6 ok: пустое описание допустимо';
end $$;


-- ============================================================
-- ТЕСТ 7. UPDATE, НЕ ТРОГАЮЩИЙ ОПИСАНИЕ, ПРОХОДИТ ВСЕГДА.
-- ============================================================
-- САМЫЙ ВАЖНЫЙ ТЕСТ СОВМЕСТИМОСТИ, и здесь он нужен даже больше, чем
-- в 0135: объявления, принятые модерацией ДО миграции, короче нового
-- минимума вполне могут быть — на момент их подачи правила не было.
-- Если бы проверка срабатывала на любой UPDATE, публикация,
-- продвижение, счётчик просмотров и продление такого объявления
-- начали бы падать, и миграция сломала бы работающий каталог.
do $$
declare
  v_user_id uuid;
  v_car_id  uuid;
  v_year    integer;
begin
  select id into v_user_id from public.profiles
   where email = 'admin@rsauto.test' limit 1;

  insert into public.cars (
    user_id, is_for_sale, is_for_rent,
    brand, model, year, city, currency, sale_price, description
  )
  values (v_user_id, true, false, 'ProbaGuard', 'Staro', 2012,
          'Subotica', 'EUR', 3200,
          'Mali gradski auto, ekonomican i pouzdan za grad.')
  returning id into v_car_id;

  -- Отключаем триггер и записываем «старое» короткое описание —
  -- имитация строки, попавшей в базу до миграции.
  alter table public.cars disable trigger trg_cars_detect_lang;
  update public.cars set description = 'Prodajem auto' where id = v_car_id;
  alter table public.cars enable trigger trg_cars_detect_lang;

  -- Обычный UPDATE, описания не касающийся. ОБЯЗАН пройти.
  update public.cars set year = 2013 where id = v_car_id;

  select year into v_year from public.cars where id = v_car_id;

  if v_year is distinct from 2013 then
    raise exception
      'ТЕСТ 7 ПРОВАЛЕН: UPDATE без правки описания не применился';
  end if;

  raise notice
    'ТЕСТ 7 ok: UPDATE, не трогающий описание, проходит на старой короткой строке';
end $$;


-- ============================================================
-- ИТОГ
-- ============================================================
do $$
begin
  raise notice '--- 0136_description_quality_test: ВСЕ ТЕСТЫ ПРОЙДЕНЫ ---';
end $$;

rollback;
