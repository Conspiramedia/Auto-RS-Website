// ============================================================
// RS AUTO — сбор ошибок консоли и ошибок гидратации.
// ============================================================
// Требование ТЗ: публичные страницы открываются без ошибок в консоли и
// без ошибок гидратации. Второе особенно важно для этого проекта:
// SEO-страницы отдаются с сервера, и рассогласование серверной и
// клиентской разметки React чинит молча — страница выглядит целой, но
// перерисовывается целиком, теряя разметку и время загрузки.
// ============================================================

import type { ConsoleMessage, Page } from '@playwright/test';

export type CollectedErrors = {
  console: string[];
  pageErrors: string[];
  hydration: string[];
};

// ------------------------------------------------------------
// Сообщения, которые НЕ считаются ошибками.
// ------------------------------------------------------------
// Список намеренно короткий и каждый пункт объяснён: «шумный» фильтр
// однажды проглотит настоящую поломку.
const IGNORED_PATTERNS: { pattern: RegExp; why: string }[] = [
  {
    // Chromium ругается на отсутствующий favicon в некоторых
    // конфигурациях запуска; к коду сайта отношения не имеет.
    pattern: /favicon\.ico.*404/i,
    why: 'Загрузка favicon самим браузером, не код страницы',
  },
  {
    // Расширение react-devtools в headless-режиме иногда пишет
    // информационное сообщение уровня error.
    pattern: /Download the React DevTools/i,
    why: 'Информационное сообщение React, не ошибка',
  },
  {
    // Локальный Supabase не поднят — отдельная проверка сообщает об
    // этом внятно, дублировать её падением по консоли незачем.
    pattern: /ERR_CONNECTION_REFUSED.*(54321|supabase)/i,
    why: 'Отсутствие локальной базы проверяется отдельно',
  },
];

function isIgnored(text: string): boolean {
  return IGNORED_PATTERNS.some(({ pattern }) => pattern.test(text));
}

// Признаки ошибки гидратации. React формулирует их по-разному в
// зависимости от версии, поэтому ловим по нескольким устойчивым
// фрагментам, а не по точной строке.
const HYDRATION_MARKERS = [
  'Hydration failed',
  'hydration mismatch',
  "didn't match",
  'did not match',
  'Text content does not match',
  'server rendered HTML',
];

function isHydration(text: string): boolean {
  const lower = text.toLowerCase();
  return HYDRATION_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}

// ------------------------------------------------------------
// Подключение сборщика.
// ------------------------------------------------------------
// Вызывается ДО page.goto: сообщения, выпущенные при загрузке, иначе
// не будут пойманы.
export function collectErrors(page: Page): CollectedErrors {
  const collected: CollectedErrors = {
    console: [],
    pageErrors: [],
    hydration: [],
  };

  page.on('console', (msg: ConsoleMessage) => {
    // Уровень warning не собираем: предупреждений у Next в
    // продакшен-сборке хватает, и падать на них значило бы получить
    // красный CI, который все привыкнут игнорировать.
    if (msg.type() !== 'error') return;

    const text = msg.text();
    if (isIgnored(text)) return;

    if (isHydration(text)) {
      collected.hydration.push(text);
      return;
    }

    collected.console.push(text);
  });

  // Необработанные исключения страницы. Отдельный канал: такие
  // ошибки не всегда попадают в console.
  page.on('pageerror', (err: Error) => {
    const text = `${err.name}: ${err.message}`;
    if (isIgnored(text)) return;

    if (isHydration(text)) {
      collected.hydration.push(text);
      return;
    }

    collected.pageErrors.push(text);
  });

  return collected;
}

// Читаемое сообщение для отчёта о падении: голый массив строк в выводе
// Playwright разобрать тяжело.
export function formatErrors(errors: CollectedErrors): string {
  const parts: string[] = [];

  if (errors.hydration.length > 0) {
    parts.push(
      `Ошибки гидратации (${errors.hydration.length}):\n` +
        errors.hydration.map((e) => `  • ${e}`).join('\n'),
    );
  }
  if (errors.console.length > 0) {
    parts.push(
      `Ошибки в консоли (${errors.console.length}):\n` +
        errors.console.map((e) => `  • ${e}`).join('\n'),
    );
  }
  if (errors.pageErrors.length > 0) {
    parts.push(
      `Необработанные исключения (${errors.pageErrors.length}):\n` +
        errors.pageErrors.map((e) => `  • ${e}`).join('\n'),
    );
  }

  return parts.join('\n\n');
}
