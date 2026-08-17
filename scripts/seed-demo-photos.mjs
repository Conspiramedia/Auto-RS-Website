// ============================================================
// RS AUTO — Разовая заливка фотографий к демо-объявлениям.
// ============================================================
// ЗАЧЕМ: миграция 0054 создала 27 демо-объявлений без фотографий,
// поэтому каталог показывает заглушки, а галерея и OG-картинка не
// проверяются на реальных данных.
//
// ЧТО ДЕЛАЕТ:
//   1. читает демо-объявления (марка/модель) из БД;
//   2. ищет фото машин через официальный API Unsplash или Pexels;
//   3. скачивает по 3 кадра на объявление;
//   4. кладёт их в бакет car-images по пути {user_id}/{car_id}/{n}.jpg;
//   5. прописывает публичные ссылки в car_images с order_index 0..2.
//
// ПОЧЕМУ SERVICE_ROLE: RLS разрешает запись в car-images и car_images
// только владельцу объявления (auth.uid() = user_id). Демо-продавец —
// служебная запись, войти под ней нельзя, поэтому нужен ключ, который
// работает в обход RLS. Скрипт запускается ЛОКАЛЬНО и разово; ключ
// берётся из .env.local, который исключён из git.
//
// ЗАПУСК:
//   node scripts/seed-demo-photos.mjs
//   node scripts/seed-demo-photos.mjs --dry-run   (без записи)
//
// ПОВТОРНЫЙ ЗАПУСК безопасен: объявления, у которых уже есть фото,
// пропускаются. Чтобы перезалить, добавьте --force.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------
// Загрузка .env.local. Своим парсером, а не зависимостью dotenv:
// файл простой, а лишний пакет ради трёх строк не нужен.
// ------------------------------------------------------------
function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    console.error('Не найден .env.local в текущей папке.');
    process.exit(1);
  }
  return env;
}

const env = loadEnv();

// ------------------------------------------------------------
// Прокси для доступа к API фотостоков.
// ------------------------------------------------------------
// В некоторых сетях api.unsplash.com и api.pexels.com недоступны
// напрямую (соединение отваливается по таймауту), но открываются через
// локальный прокси. Node с версии 24 умеет использовать HTTPS_PROXY для
// встроенного fetch, но только при включённом NODE_USE_ENV_PROXY.
//
// Этот флаг читается ОДИН РАЗ при старте процесса, поэтому присвоить его
// в коде уже поздно — приходится перезапустить себя же с нужным
// окружением. Проверено: без перезапуска запросы молча падают по таймауту.
//
// Если прокси в системе не задан, перезапуска не происходит и запросы
// идут напрямую.
if (
  (process.env.HTTPS_PROXY || process.env.https_proxy) &&
  !process.env.NODE_USE_ENV_PROXY
) {
  const { spawnSync } = await import('node:child_process');

  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
    },
  );

  process.exit(result.status ?? 1);
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const UNSPLASH_KEY = env.UNSPLASH_ACCESS_KEY;
const PEXELS_KEY = env.PEXELS_API_KEY;

const DEMO_USER_ID = '00000000-0000-4000-a000-0000000000de';
const PHOTOS_PER_CAR = 3;
const BUCKET = 'car-images';

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

// ------------------------------------------------------------
// Проверка конфигурации до начала работы: понятная ошибка лучше,
// чем падение на первом же запросе.
// ------------------------------------------------------------
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local.\n' +
      'Ключ: Supabase Dashboard → Settings → API → service_role (secret).',
  );
  process.exit(1);
}

if (!UNSPLASH_KEY && !PEXELS_KEY) {
  console.error(
    'Нужен ключ фотостока в .env.local — хотя бы один из двух:\n' +
      '  UNSPLASH_ACCESS_KEY  (https://unsplash.com/developers)\n' +
      '  PEXELS_API_KEY       (https://www.pexels.com/api/)',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ------------------------------------------------------------
// Поиск фотографий. Оба API возвращают разную форму ответа, поэтому
// приводим их к общему виду: массив прямых ссылок на изображения.
// ------------------------------------------------------------
async function searchUnsplash(query, count) {
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(count));
  url.searchParams.set('orientation', 'landscape');
  // content_filter=high отсекает неуместные кадры — на витрине
  // автомобилей случайная картинка была бы неприятным сюрпризом.
  url.searchParams.set('content_filter', 'high');

  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
  });

  if (!res.ok) {
    throw new Error(`Unsplash ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  // Берём вариант regular (~1080px): для карточки каталога и OG-превью
  // этого достаточно, а full весит в разы больше.
  return (data.results ?? []).map((p) => p.urls.regular);
}

async function searchPexels(query, count) {
  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(count));
  url.searchParams.set('orientation', 'landscape');

  const res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });

  if (!res.ok) {
    throw new Error(`Pexels ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return (data.photos ?? []).map((p) => p.src.large);
}

// Поиск с деградацией запроса: если по «BMW X5 car» ничего не нашлось,
// пробуем более общий запрос, чтобы объявление не осталось без фото.
async function findPhotos(brand, model) {
  const queries = [`${brand} ${model} car`, `${brand} car`, 'car'];

  for (const query of queries) {
    try {
      const urls = UNSPLASH_KEY
        ? await searchUnsplash(query, PHOTOS_PER_CAR)
        : await searchPexels(query, PHOTOS_PER_CAR);

      if (urls.length > 0) return urls.slice(0, PHOTOS_PER_CAR);
    } catch (e) {
      console.warn(`  поиск "${query}" не удался: ${e.message}`);
    }
  }

  return [];
}

// ------------------------------------------------------------
// Основной проход
// ------------------------------------------------------------
async function main() {
  console.log(
    `Источник фото: ${UNSPLASH_KEY ? 'Unsplash' : 'Pexels'}` +
      (dryRun ? ' | РЕЖИМ ПРОВЕРКИ (запись отключена)' : ''),
  );

  const { data: cars, error } = await supabase
    .from('cars')
    .select('id, brand, model, year')
    .eq('user_id', DEMO_USER_ID)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Не удалось прочитать объявления:', error.message);
    process.exit(1);
  }

  if (!cars || cars.length === 0) {
    console.error(
      'Демо-объявления не найдены. Применена ли миграция 0054_seed_site_demo.sql?',
    );
    process.exit(1);
  }

  console.log(`Найдено демо-объявлений: ${cars.length}\n`);

  let uploaded = 0;
  let skipped = 0;

  for (const [index, car] of cars.entries()) {
    const label = `[${index + 1}/${cars.length}] ${car.brand} ${car.model}, ${car.year}`;

    // Уже есть фотографии — не трогаем, если не задан --force.
    const { count } = await supabase
      .from('car_images')
      .select('id', { count: 'exact', head: true })
      .eq('car_id', car.id);

    if (count > 0 && !force) {
      console.log(`${label} — уже есть ${count} фото, пропускаем`);
      skipped += 1;
      continue;
    }

    const photoUrls = await findPhotos(car.brand, car.model);

    if (photoUrls.length === 0) {
      console.warn(`${label} — фото не найдены, пропускаем`);
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`${label} — нашлось ${photoUrls.length} фото (запись отключена)`);
      continue;
    }

    // При --force убираем прежние строки, иначе order_index задвоится.
    if (force && count > 0) {
      await supabase.from('car_images').delete().eq('car_id', car.id);
    }

    const rows = [];

    for (const [i, photoUrl] of photoUrls.entries()) {
      const res = await fetch(photoUrl);
      if (!res.ok) {
        console.warn(`  кадр ${i + 1}: скачать не удалось (${res.status})`);
        continue;
      }

      const bytes = Buffer.from(await res.arrayBuffer());
      // Путь начинается с user_id — того же формата, что использует
      // приложение и форма подачи на сайте (требование политики RLS).
      const path = `${DEMO_USER_ID}/${car.id}/${i}.jpg`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });

      if (upErr) {
        console.warn(`  кадр ${i + 1}: загрузка не удалась — ${upErr.message}`);
        continue;
      }

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      rows.push({ car_id: car.id, image_url: pub.publicUrl, order_index: i });
    }

    if (rows.length === 0) {
      console.warn(`${label} — ни один кадр не загрузился`);
      skipped += 1;
      continue;
    }

    const { error: insErr } = await supabase.from('car_images').insert(rows);

    if (insErr) {
      console.warn(`${label} — запись в car_images не удалась: ${insErr.message}`);
      skipped += 1;
      continue;
    }

    console.log(`${label} — загружено ${rows.length} фото`);
    uploaded += 1;

    // Пауза между объявлениями: у Unsplash demo-приложения лимит
    // 50 запросов в час, у Pexels — 200. Без паузы легко упереться
    // в 429 на середине списка.
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(
    `\nГотово. Объявлений с новыми фото: ${uploaded}, пропущено: ${skipped}.`,
  );

  if (!dryRun && uploaded > 0) {
    console.log(
      'Дальше: пересоберите сайт (npm run build) — карточки и OG-картинки\n' +
        'начнут рендериться с фотографиями.',
    );
  }
}

main().catch((e) => {
  console.error('Скрипт остановлен:', e);
  process.exit(1);
});
