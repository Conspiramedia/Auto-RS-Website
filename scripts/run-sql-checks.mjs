// ============================================================
// RS AUTO — запуск SQL-тестов серверных гейтов.
// ============================================================
// Гоняет файлы supabase/checks/*_test.sql против ЛОКАЛЬНОГО Supabase.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ СТРОКА В package.json. Три причины,
// и каждая — про то, чтобы падение было понятным:
//   1) строку подключения надо взять у `supabase status`, а её формат
//      зависит от версии CLI;
//   2) без запущенного Docker команда падает с невнятной ошибкой
//      про сокет — здесь она превращается в понятное сообщение;
//   3) нужна ЗАЩИТА: адрес базы проверяется на признаки боевой, и
//      скрипт отказывается работать, если это не localhost.
//
// ВЫХОДНОЙ КОД. 0 — все тесты прошли ИЛИ стек не поднят (пропуск);
// 1 — тест провалился. Пропуск не красит CI: в CI Docker есть всегда,
// и там стек поднимается заранее, так что пропуск возможен только на
// машине разработчика без Docker.
// ============================================================

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CHECKS_DIR = 'supabase/checks';

// ------------------------------------------------------------
// 1) Строка подключения к локальной базе.
// ------------------------------------------------------------
function getLocalDbUrl() {
  try {
    // `supabase status -o env` печатает переменные вида DB_URL="...".
    const out = execSync('npx supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });

    const match = out.match(/^DB_URL="?([^"\n]+)"?/m);
    return match ? match[1] : null;
  } catch {
    // Стек не поднят или Docker не запущен — оба случая обрабатываются
    // одинаково: пропускаем с объяснением.
    return null;
  }
}

// ------------------------------------------------------------
// 2) ЗАЩИТА: адрес точно локальный?
// ------------------------------------------------------------
// Тесты ПИШУТ в otp_email_log. Уйди они в боевую базу — исказили бы
// настоящие квоты входа администраторов.
function assertLocal(dbUrl) {
  const host = (() => {
    try {
      return new URL(dbUrl).hostname;
    } catch {
      return '';
    }
  })();

  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);

  if (!local) {
    console.error(
      [
        '',
        `ОСТАНОВЛЕНО: база «${host}» не является локальной.`,
        '',
        'SQL-тесты пишут в журнал отправок и на боевой базе исказили бы',
        'квоты входа. Запускать их можно только против локального стека:',
        '',
        '  npm run supabase:start',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}

// ------------------------------------------------------------
// 3) Прогон.
// ------------------------------------------------------------
function main() {
  const dbUrl = getLocalDbUrl();

  if (!dbUrl) {
    // Деградация, а не падение: на машине без запущенного Docker
    // остальные проверки (tsc, build, Playwright по статике) должны
    // идти дальше. В CI до этой ветки не доходит — там стек поднят.
    console.warn(
      [
        '',
        '⚠  Локальный Supabase не отвечает — SQL-тесты ПРОПУЩЕНЫ.',
        '',
        'Это не ошибка: без Docker серверные гейты проверить негде.',
        'Чтобы прогнать их, запустите Docker Desktop и выполните:',
        '',
        '  npm run supabase:start',
        '  npm run supabase:reset   # применит миграции и seed',
        '  npm run test:sql',
        '',
      ].join('\n'),
    );
    process.exit(0);
  }

  assertLocal(dbUrl);

  if (!existsSync(CHECKS_DIR)) {
    console.error(`Каталог ${CHECKS_DIR} не найден`);
    process.exit(1);
  }

  // Берём только файлы с суффиксом _test.sql. Рядом лежат *_verify.sql —
  // они только читают каталоги и предназначены для ручного просмотра
  // вывода, а не для автоматического прогона с кодом возврата.
  const files = readdirSync(CHECKS_DIR)
    .filter((f) => f.endsWith('_test.sql'))
    .sort();

  if (files.length === 0) {
    console.warn(`В ${CHECKS_DIR} нет файлов *_test.sql`);
    process.exit(0);
  }

  let failed = 0;

  for (const file of files) {
    const path = join(CHECKS_DIR, file);
    console.log(`\n▶ ${file}`);

    try {
      // psql с ON_ERROR_STOP внутри файла: любой raise exception
      // прекращает выполнение и возвращает ненулевой код.
      const out = execFileSync('psql', [dbUrl, '-f', path], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      // Показываем notice'ы — в них написано, какой тест прошёл.
      console.log(out.trim());
      console.log(`✓ ${file}`);
    } catch (err) {
      failed += 1;
      console.error(`✗ ${file} ПРОВАЛЕН`);
      // stderr psql содержит текст исключения из теста — это и есть
      // объяснение, что сломалось.
      if (err.stderr) console.error(String(err.stderr).trim());
      if (err.stdout) console.error(String(err.stdout).trim());

      // psql может отсутствовать на машине разработчика: Supabase CLI
      // его не ставит. Отличаем это от провала теста.
      if (err.code === 'ENOENT') {
        console.error(
          [
            '',
            'psql не найден в PATH. Он входит в состав клиента PostgreSQL:',
            '  Windows: https://www.postgresql.org/download/windows/',
            '  macOS:   brew install libpq',
            '',
          ].join('\n'),
        );
      }
    }
  }

  if (failed > 0) {
    console.error(`\nПровалено файлов: ${failed} из ${files.length}`);
    process.exit(1);
  }

  console.log(`\nВсе SQL-тесты пройдены (${files.length}).`);
}

main();
