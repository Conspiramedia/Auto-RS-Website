// ============================================================
// RS AUTO — окружение тестов и ЗАЩИТА ОТ ПРОГОНА ПО ПРОДУ.
// ============================================================
// Модуль подключается первым: и playwright.config.ts, и каждый тест
// получают адреса только отсюда. Своих `process.env.…` в тестах быть
// не должно — иначе однажды кто-то подставит боевой адрес и узнает об
// этом по тому, что тест на подачу объявления создал живую карточку.
//
// ПОЧЕМУ ЗАЩИТА — КОД, А НЕ СТРОКА В ДОКУМЕНТАЦИИ. «Не запускайте
// тесты против прода» в README не останавливает ничего: достаточно
// забытого .env.local (а он в этом проекте указывает как раз на
// боевой Supabase) и запуска `npx playwright test` без флагов. Здесь
// проверка выполняется до первого теста и роняет прогон с внятным
// сообщением.
// ============================================================

// Адрес, по которому тесты открывают сайт. Меняется только на
// preview-деплой; наружу смотреть не может — см. assertSafeTarget.
//
// ПОРТ 3100, А НЕ 3000 — НАМЕРЕННО. На 3000 у разработчика обычно
// висит `next dev`, и Playwright с reuseExistingServer молча
// подхватывал его вместо своей сборки. Прогон при этом «работал», но
// проверял дев-версию: HMR-сокет и его 403-и сыпались в консоль, а
// SEO-теги и статическая генерация в дев-режиме отличаются от боевых.
// Отдельный порт исключает и это, и обратную неприятность — тесты не
// займут порт, на котором человек работает.
export const TEST_PORT = Number(process.env.TEST_PORT ?? 3100);

export const TEST_BASE_URL =
  process.env.TEST_BASE_URL ?? `http://127.0.0.1:${TEST_PORT}`;

// Локальный Supabase из supabase/config.toml. Порт 54321 фиксирован.
export const TEST_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';

// ------------------------------------------------------------
// Признаки боевого окружения.
// ------------------------------------------------------------
// Список намеренно широкий: и сам домен, и его поддомены, и адреса
// облачного Supabase. Всё, что не локальный адрес и не preview-деплой
// Vercel, считается небезопасным.
const PRODUCTION_MARKERS = ['rsauto.rs', 'supabase.co', 'supabase.in'];

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '0.0.0.0', '::1'];

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    // Неразбираемый адрес — сам по себе повод остановиться: дальше он
    // всё равно сломает Playwright, но уже менее понятной ошибкой.
    throw new Error(
      `[tests/env] Адрес «${raw}» не разбирается как URL. ` +
        `Ожидается вид http://127.0.0.1:3000`,
    );
  }
}

function isLocal(host: string): boolean {
  return LOCAL_HOSTS.includes(host);
}

// Preview-деплои Vercel — единственное разрешённое НЕ локальное место.
// Боевой домен на них не отзывается: у превью всегда вид
// <project>-<hash>-<scope>.vercel.app.
function isVercelPreview(host: string): boolean {
  return host.endsWith('.vercel.app');
}

// ------------------------------------------------------------
// Проверка одного адреса.
// ------------------------------------------------------------
export function assertSafeTarget(raw: string, label: string): void {
  const host = hostOf(raw);

  if (isLocal(host) || isVercelPreview(host)) return;

  const marker = PRODUCTION_MARKERS.find(
    (m) => host === m || host.endsWith(`.${m}`),
  );

  // Сообщение говорит, что именно делать: тест упавший с «нельзя»
  // без объяснения приводит к тому, что защиту просто снимают.
  throw new Error(
    [
      `[tests/env] ОСТАНОВЛЕНО: ${label} указывает на «${host}»` +
        (marker ? ` — это боевое окружение (${marker}).` : '.'),
      '',
      'Тесты создают и меняют данные, поэтому запускаются только против',
      'локального стека или preview-деплоя.',
      '',
      'Как запустить правильно:',
      '  npm run test:e2e          — поднимет локальную сборку сама',
      '  npm run supabase:start    — локальный Supabase в Docker',
      '',
      'Если .env.local указывает на боевой Supabase (так и есть по',
      'умолчанию в этом проекте) — тесты берут значения из .env.test,',
      'который перекрывает его. Проверьте, что файл на месте.',
    ].join('\n'),
  );
}

// ------------------------------------------------------------
// Общая проверка. Вызывается из playwright.config.ts на импорте,
// то есть ДО запуска первого теста.
// ------------------------------------------------------------
assertSafeTarget(TEST_BASE_URL, 'TEST_BASE_URL (адрес сайта)');
assertSafeTarget(TEST_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL (адрес базы)');

// Ключ локального Supabase. Он одинаков у всех локальных стеков —
// это не секрет, а часть публичного контракта CLI, поэтому лежит
// в репозитории и не требует секретов в CI.
export const TEST_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

// Доступен ли локальный Supabase. Проверяется один раз перед сьютами,
// которым нужны настоящие данные: без него они пропускаются, а не
// падают — см. tests/e2e/_setup.ts и docs/testing.md (деградация).
export async function isSupabaseUp(): Promise<boolean> {
  try {
    const res = await fetch(`${TEST_SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: TEST_SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}
