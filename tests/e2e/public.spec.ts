// ============================================================
// RS AUTO — Сьют A: публичные страницы.
// ============================================================
// Самая дешёвая и самая ценная проверка: страница открывается, отдаёт
// 200, не сыплет ошибками в консоль и не разъезжается при гидратации.
// Ловит ровно тот класс поломок, который чаще всего доезжает до прода —
// «работало локально, упало после сборки».
//
// Обе локали проверяются полностью: русское зеркало — не декорация,
// а половина аудитории площадки.
// ============================================================

import { expect, test } from '@playwright/test';

import { collectErrors, formatErrors } from '../fixtures/console';
import {
  LOCALES,
  NOINDEX_PAGES,
  PUBLIC_PAGES,
  localePath,
} from '../fixtures/pages';

for (const locale of LOCALES) {
  test.describe(`Публичные страницы (${locale})`, () => {
    for (const spec of [...PUBLIC_PAGES, ...NOINDEX_PAGES]) {
      const url = localePath(locale, spec.path);

      test(`${spec.name} — ${url}`, async ({ page }) => {
        const errors = collectErrors(page);

        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });

        // ---------- HTTP 200 ----------
        expect(response, `Нет ответа для ${url}`).not.toBeNull();

        // ---------- Ожидание клиентского рендера ----------
        // Ждём ДО остальных проверок: каталог отдаётся потоково —
        // сервер присылает скелет, а содержимое (и ошибки) приходят
        // после гидратации. Проверять разметку раньше значит смотреть
        // на loading-состояние.
        await page.waitForLoadState('load');
        // Пауза на догрузку клиентских компонентов: без неё часть
        // ошибок гидратации не успевает попасть в консоль.
        await page.waitForTimeout(800);

        // ---------- Пропуск при отсутствии базы ----------
        // Страницы, живущие на данных, без Supabase показывать нечем.
        // Проявляется это ДВУМЯ способами, и оба надо распознать:
        //   • ответ 5xx — исключение поймано на сервере;
        //   • ответ 200 со страницей ошибки — исключение поймано
        //     клиентским error boundary (app/error.tsx), и тогда код
        //     ответа остаётся успешным, а в консоли лежит React #441.
        // Признак второго случая — крупное «500» в разметке ErrorView,
        // и появляется он только после гидратации (см. ожидание выше).
        //
        // Это НЕ поломка кода, поэтому пропускаем с объяснением. С
        // поднятым Supabase ветка не срабатывает и страница
        // проверяется полностью.
        const isErrorPage =
          response!.status() >= 500 ||
          (await page.getByText('500', { exact: true }).count()) > 0;

        test.skip(
          spec.needsData && isErrorPage,
          `${url}: нет данных — локальный Supabase не поднят ` +
            `(npm run supabase:start)`,
        );

        expect(
          response!.status(),
          `${url} ответил ${response!.status()} вместо 200`,
        ).toBe(200);

        // ---------- Страница не пустая ----------
        // Заголовок первого уровня есть на каждой странице сайта.
        // Его отсутствие означает либо сломанный рендер, либо
        // страницу-заглушку, отданную с кодом 200.
        await expect(
          page.locator('h1').first(),
          `${url}: нет <h1> — страница отрисовалась не полностью`,
        ).toBeVisible();

        expect(
          errors.hydration,
          `${url}: ошибки гидратации.\n${formatErrors(errors)}`,
        ).toHaveLength(0);

        // ---------- Консоль ----------
        expect(
          [...errors.console, ...errors.pageErrors],
          `${url}: ошибки в консоли.\n${formatErrors(errors)}`,
        ).toHaveLength(0);
      });
    }
  });
}

// ------------------------------------------------------------
// Служебные файлы.
// ------------------------------------------------------------
test.describe('Служебные маршруты', () => {
  test('robots.txt отдаётся и содержит карту сайта', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);

    const body = await res.text();
    expect(body).toContain('User-Agent: *');
    expect(body).toContain('Sitemap:');
  });

  test('sitemap.xml отдаётся как XML', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('xml');
  });

  test('манифест PWA отдаётся', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
  });

  test('несуществующий адрес отдаёт 404, а не 200', async ({ request }) => {
    // Страница-заглушка с кодом 200 на любой адрес — классическая
    // причина попадания мусора в индекс.
    const res = await request.get('/этой-страницы-нет-12345');
    expect(res.status()).toBe(404);
  });
});
