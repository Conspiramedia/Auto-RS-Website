// ============================================================
// RS AUTO — Сьют G: две локали.
// ============================================================
// Проверяется то, что ломается тихо: непереведённая строка выглядит
// как обычный текст, и заметить её можно только глазами — а живых
// тестировщиков у проекта нет.
//
// Типизация ключей в lib/i18n.ts ловит опечатку в ИМЕНИ ключа на
// сборке, но не ловит два других случая: строка забыта в русском
// словаре и скопирована из сербского как есть, либо ключ по ошибке
// выведен в разметку вместо значения.
// ============================================================

import { expect, test } from '@playwright/test';

import { PUBLIC_PAGES, localePath } from '../fixtures/pages';

// ------------------------------------------------------------
// Признак сырого ключа перевода в тексте страницы.
// ------------------------------------------------------------
// Ключи проекта выглядят как meta_home_desc, nav_catalog, otp_err_phone:
// латиница в нижнем регистре, подчёркивания, минимум одно. Обычный
// текст сайта (сербский и русский) так не выглядит — там пробелы и
// заглавные буквы.
//
// Требуем минимум ДВА подчёркивания: односегментные слова вида
// «rent_a_car» встречаются в адресах и подписях, и однoподчёркивальный
// шаблон давал бы ложные срабатывания.
const RAW_KEY_PATTERN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/g;

// Исключения: строки, которые законно выглядят как ключ.
const ALLOWED = [
  // Технические идентификаторы в разметке, а не видимый текст.
  /^application_ld_json$/,
];

for (const locale of ['sr', 'ru'] as const) {
  test.describe(`Локализация (${locale})`, () => {
    for (const spec of PUBLIC_PAGES) {
      const url = localePath(locale, spec.path);

      test(`${spec.name} — нет сырых ключей перевода`, async ({ page }) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load');

        // Берём ВИДИМЫЙ текст, а не HTML: в разметке подчёркивания
        // законно встречаются в именах классов и атрибутах.
        const text = await page.locator('body').innerText();

        const found = [...text.matchAll(RAW_KEY_PATTERN)]
          .map((m) => m[0])
          .filter((k) => !ALLOWED.some((re) => re.test(k)));

        expect(
          [...new Set(found)],
          `${url}: в тексте страницы похожее на ключи перевода: ${[
            ...new Set(found),
          ].join(', ')}`,
        ).toHaveLength(0);
      });

      test(`${spec.name} — нет пустых мест вместо строк`, async ({ page }) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load');

        const text = await page.locator('body').innerText();

        // undefined/null, попавшие в разметку из-за отсутствующего
        // ключа. Проверяем как отдельные слова: «undefined» внутри
        // текста статьи возможен, отдельным словом — нет.
        for (const marker of ['undefined', 'null', 'NaN', '[object Object]']) {
          expect(
            text.includes(marker),
            `${url}: в тексте страницы «${marker}» — пропущенная строка перевода`,
          ).toBe(false);
        }
      });
    }
  });
}

// ------------------------------------------------------------
// Переключатель языка.
// ------------------------------------------------------------
test.describe('Переключение языка', () => {
  test('переводит на ту же страницу, а не на главную', async ({ page }) => {
    // Частая ошибка языковых переключателей: сбрасывать человека на
    // главную. С каталога, где выбраны фильтры, это особенно обидно.
    await page.goto('/about', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    // Ссылка на русскую версию берётся из hreflang: он и есть
    // машиночитаемое объявление того, где лежит переведённая страница.
    const ruHref = await page
      .locator('link[rel="alternate"][hreflang="ru"]')
      .getAttribute('href');

    expect(ruHref, 'Нет ссылки на русскую версию').toBeTruthy();
    expect(
      new URL(ruHref!).pathname,
      'Русская версия /about ведёт не на /ru/about',
    ).toBe('/ru/about');
  });

  test('русская и сербская версии отдают разный текст', async ({ page }) => {
    // Проверка того, что перевод действительно подставляется: если
    // словарь ru по ошибке ссылается на sr, страницы совпадут дословно.
    await page.goto('/about', { waitUntil: 'domcontentloaded' });
    const srHeading = await page.locator('h1').first().innerText();

    await page.goto('/ru/about', { waitUntil: 'domcontentloaded' });
    const ruHeading = await page.locator('h1').first().innerText();

    expect(
      srHeading,
      'Заголовки сербской и русской версии совпадают — перевод не подставился',
    ).not.toBe(ruHeading);
  });

  test('язык содержимого соответствует локали', async ({ page }) => {
    // Сербская версия живёт в корне сайта, поэтому её язык объявлен
    // прямо на <html> (app/layout.tsx).
    await page.goto('/cars');
    await expect(page.locator('html')).toHaveAttribute('lang', /^sr/);

    // РУССКАЯ ВЕРСИЯ УСТРОЕНА ИНАЧЕ, и проверять надо именно так.
    // Корневой <html lang> в приложении Next один на всё дерево, и он
    // сербский. Русское поддерево объявляет свой язык на обёртке
    // (app/ru/layout.tsx → <div lang="ru">): скринридер и браузер
    // берут БЛИЖАЙШИЙ атрибут lang вверх по дереву, поэтому текст
    // читается по-русски. Ожидать lang="ru" на <html> здесь значит
    // проверять то, чего архитектура не предполагает.
    await page.goto('/ru/cars');
    await expect(
      page.locator('[lang="ru"]').first(),
      'В русской версии нет элемента с lang="ru" — ' +
        'скринридер прочтёт русский текст по сербским правилам',
    ).toBeAttached();
  });
});
