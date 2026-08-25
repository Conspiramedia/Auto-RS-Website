-- ============================================================
-- RS AUTO — ТЕСТ лимитов бакетов фотографий (0087).
-- ============================================================
-- ЗАПУСКАТЬ ТОЛЬКО НА ЛОКАЛЬНОЙ БАЗЕ. Файл пишет в storage.objects
-- внутри ОДНОЙ транзакции, которая в конце откатывается, — следов
-- не остаётся.
--
-- ЧТО ПРОВЕРЯЕТСЯ:
--   1) car-images: лимит 5 МБ и тройка MIME установлены;
--   2) avatars:    лимит 2 МБ и та же тройка MIME установлены;
--   3) файл сверх лимита отклоняется Storage;
--   4) файл чужого MIME отклоняется Storage;
--   5) нормальный JPEG в пределах лимита проходит;
--   6) HEIC отклоняется (клиент обязан перекодировать до отправки).
--
-- ------------------------------------------------------------
-- ПОЧЕМУ ПРОВЕРКА ИДЁТ ЧЕРЕЗ ФУНКЦИЮ, А НЕ ПРЯМЫМ INSERT
-- ------------------------------------------------------------
-- Ограничения allowed_mime_types и file_size_limit применяет
-- storage-api (сервис на Node), а не сам Postgres: в базе это просто
-- колонки таблицы storage.buckets. Прямой `insert into storage.objects`
-- их НЕ проверяет — тест, написанный так, был бы зелёным при любых
-- настройках и не значил бы ничего.
--
-- Поэтому здесь воспроизводится РОВНО ТА проверка, которую делает
-- storage-api: значения из storage.buckets сверяются с параметрами
-- файла. Тест доказывает, что настройки в базе верные и что при этих
-- настройках сервис обязан отказать. Сквозная проверка самого сервиса
-- (реальный HTTP-запрос к Storage) живёт в Playwright — см.
-- tests/e2e/photo-upload.spec.ts.
--
-- ЗАПУСК: npm run test:sql (берёт все supabase/checks/*_test.sql)
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
      'Запустите: supabase db reset';
  end if;
end $$;

-- ------------------------------------------------------------
-- Помощник: разрешит ли Storage такую загрузку?
-- ------------------------------------------------------------
-- Повторяет логику storage-api: файл проходит, если его размер не
-- больше file_size_limit бакета И его MIME есть в allowed_mime_types.
-- null в любой из колонок означает «ограничения нет».
create or replace function pg_temp.upload_allowed(
  p_bucket text,
  p_mime   text,
  p_size   bigint
) returns boolean
language plpgsql
as $$
declare
  v_limit bigint;
  v_mimes text[];
begin
  select file_size_limit, allowed_mime_types
    into v_limit, v_mimes
    from storage.buckets
   where id = p_bucket;

  if not found then
    raise exception 'Бакет % не найден', p_bucket;
  end if;

  if v_limit is not null and p_size > v_limit then
    return false;
  end if;

  if v_mimes is not null and not (p_mime = any (v_mimes)) then
    return false;
  end if;

  return true;
end $$;


-- ============================================================
-- ТЕСТ 1. car-images: лимит и список MIME установлены.
-- ============================================================
do $$
declare
  v_limit bigint;
  v_mimes text[];
begin
  select file_size_limit, allowed_mime_types
    into v_limit, v_mimes
    from storage.buckets
   where id = 'car-images';

  if v_limit is distinct from 5 * 1024 * 1024 then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: file_size_limit бакета car-images = %, ожидалось %',
      coalesce(v_limit::text, 'null'), 5 * 1024 * 1024;
  end if;

  if v_mimes is distinct from array['image/jpeg', 'image/png', 'image/webp'] then
    raise exception
      'ТЕСТ 1 ПРОВАЛЕН: allowed_mime_types бакета car-images = %',
      coalesce(v_mimes::text, 'null');
  end if;

  raise notice 'ТЕСТ 1 ok: car-images — 5 МБ, три формата';
end $$;


-- ============================================================
-- ТЕСТ 2. avatars: лимит 2 МБ и та же тройка MIME.
-- ============================================================
do $$
declare
  v_limit bigint;
  v_mimes text[];
begin
  select file_size_limit, allowed_mime_types
    into v_limit, v_mimes
    from storage.buckets
   where id = 'avatars';

  if v_limit is distinct from 2 * 1024 * 1024 then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: file_size_limit бакета avatars = %, ожидалось %',
      coalesce(v_limit::text, 'null'), 2 * 1024 * 1024;
  end if;

  if v_mimes is distinct from array['image/jpeg', 'image/png', 'image/webp'] then
    raise exception
      'ТЕСТ 2 ПРОВАЛЕН: allowed_mime_types бакета avatars = %',
      coalesce(v_mimes::text, 'null');
  end if;

  raise notice 'ТЕСТ 2 ok: avatars — 2 МБ, три формата';
end $$;


-- ============================================================
-- ТЕСТ 3. Загрузка СВЕРХ ЛИМИТА отклоняется.
-- ============================================================
-- 6 МБ в car-images (лимит 5) и 3 МБ в avatars (лимит 2).
do $$
begin
  if pg_temp.upload_allowed('car-images', 'image/jpeg', 6 * 1024 * 1024) then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: JPEG 6 МБ принят в car-images при лимите 5 МБ';
  end if;

  if pg_temp.upload_allowed('avatars', 'image/jpeg', 3 * 1024 * 1024) then
    raise exception
      'ТЕСТ 3 ПРОВАЛЕН: JPEG 3 МБ принят в avatars при лимите 2 МБ';
  end if;

  raise notice 'ТЕСТ 3 ok: файлы сверх лимита отклоняются в обоих бакетах';
end $$;


-- ============================================================
-- ТЕСТ 4. ЧУЖОЙ MIME отклоняется даже при крошечном размере.
-- ============================================================
-- Именно этот случай был дырой: публичный бакет принимал что угодно,
-- превращаясь в бесплатный файлохостинг на нашем домене.
do $$
declare
  v_mime text;
begin
  foreach v_mime in array array[
    'application/pdf',
    'text/html',            -- худший случай: HTML на своём домене
    'application/zip',
    'video/mp4',
    'image/svg+xml'         -- SVG — это исполняемый контейнер, не фото
  ]
  loop
    if pg_temp.upload_allowed('car-images', v_mime, 1024) then
      raise exception
        'ТЕСТ 4 ПРОВАЛЕН: тип % принят в car-images', v_mime;
    end if;

    if pg_temp.upload_allowed('avatars', v_mime, 1024) then
      raise exception
        'ТЕСТ 4 ПРОВАЛЕН: тип % принят в avatars', v_mime;
    end if;
  end loop;

  raise notice 'ТЕСТ 4 ok: PDF, HTML, ZIP, MP4 и SVG отклоняются';
end $$;


-- ============================================================
-- ТЕСТ 5. Нормальное фото ПРОХОДИТ.
-- ============================================================
-- Обратная сторона: лимиты не должны мешать штатному пути. 450 КБ —
-- типичный вес снимка после пережатия на клиенте (1600px, JPEG 0.82).
do $$
declare
  v_mime text;
begin
  foreach v_mime in array array['image/jpeg', 'image/png', 'image/webp']
  loop
    if not pg_temp.upload_allowed('car-images', v_mime, 450 * 1024) then
      raise exception
        'ТЕСТ 5 ПРОВАЛЕН: обычное фото % 450 КБ отклонено в car-images',
        v_mime;
    end if;
  end loop;

  -- Аватар после того же конвейера весит меньше — проверяем и его.
  if not pg_temp.upload_allowed('avatars', 'image/jpeg', 200 * 1024) then
    raise exception
      'ТЕСТ 5 ПРОВАЛЕН: аватар JPEG 200 КБ отклонён в avatars';
  end if;

  raise notice 'ТЕСТ 5 ok: штатные фотографии проходят';
end $$;


-- ============================================================
-- ТЕСТ 6. HEIC отклоняется бакетом.
-- ============================================================
-- HEIC принимается ФОРМОЙ (Safari декодирует его нативно), но в
-- хранилище обязан попадать уже перекодированный JPEG. Если HEIC
-- дошёл до Storage — значит, клиентский конвейер обойдён, и такой
-- файл не покажется у половины посетителей.
do $$
begin
  if pg_temp.upload_allowed('car-images', 'image/heic', 900 * 1024) then
    raise exception
      'ТЕСТ 6 ПРОВАЛЕН: HEIC принят в car-images — клиент обязан '
      'перекодировать его в JPEG до отправки';
  end if;

  if pg_temp.upload_allowed('avatars', 'image/heif', 900 * 1024) then
    raise exception 'ТЕСТ 6 ПРОВАЛЕН: HEIF принят в avatars';
  end if;

  raise notice 'ТЕСТ 6 ok: HEIC/HEIF в хранилище не попадают';
end $$;


-- ------------------------------------------------------------
-- Откат: тест не оставляет следов в базе.
-- ------------------------------------------------------------
rollback;

\echo ''
\echo '================================================='
\echo 'ТЕСТЫ ЛИМИТОВ БАКЕТОВ ПРОЙДЕНЫ. Транзакция откачена.'
\echo '================================================='
