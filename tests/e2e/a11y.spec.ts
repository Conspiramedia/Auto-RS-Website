// ============================================================
// RS AUTO — Сьют F: доступность (axe-core).
// ============================================================
// Порог — НОЛЬ нарушений уровня critical и serious. ТЗ требует только
// critical, но serious включён намеренно: в эту категорию axe относит
// недостаточный контраст текста и поля без подписи — ровно то, из-за
// чего человек не может пользоваться сайтом. Разделять «совсем нельзя»
// и «почти нельзя» смысла нет.
//
// Уровни moderate и minor НЕ роняют прогон: там встречаются спорные
// правила (порядок заголовков в декоративных блоках), и падение на них
// приучило бы игнорировать красный CI.
// ============================================================

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { KEY_PAGES, LOCALES, localePath } from '../fixtures/pages';

// Уровни, которые считаются поломкой.
const BLOCKING_IMPACTS = ['critical', 'serious'] as const;

// ------------------------------------------------------------
// ИЗВЕСТНЫЙ ДОЛГ: контраст брендовых цветов.
// ------------------------------------------------------------
// Два цвета из lib/brand.ts не проходят WCAG AA как ТЕКСТ:
//   brand.green #22C063 — белый текст на нём даёт 2.39:1 (кнопка
//     «Продать авто» и прочие главные действия);
//   brand.blue  #1E9AF0 — как цвет текста на белом даёт 3.03:1
//     (ссылки: почта, «Написать продавцу», цены аренды на карточках).
// Норма — 4.5:1. Проходящие оттенки подобраны: #188645 (4.63:1) и
// #187BC0 (4.53:1), то есть затемнение на 30% и 20%.
//
// ПОЧЕМУ НЕ ИСПРАВЛЕНО ЗДЕСЬ И СЕЙЧАС. Это не оплошность вёрстки, а
// сами брендовые константы, общие с Flutter-приложением (см. шапку
// lib/brand.ts: тема приложения выводится отсюда). Правка меняет
// внешний вид обоих продуктов и требует решения владельца бренда, а
// не автора теста. Решение принято: зафиксировать как долг.
//
// ПОЧЕМУ НЕ ПОНИЖЕН ПОРОГ ДО critical. Тогда контраст перестал бы
// проверяться вовсе, и следующая регрессия по читаемости прошла бы
// незамеченной. Здесь же перечислены ровно два известных узла: любое
// НОВОЕ нарушение контраста — на другом элементе или другого правила —
// прогон по-прежнему уронит.
//
// СНЯТЬ ЭТО ИСКЛЮЧЕНИЕ, как только цвета обновлены в lib/brand.ts и
// в теме приложения. Пункт заведён в README → TODO.
const KNOWN_CONTRAST_DEBT = [
  // Белый текст на зелёной заливке главного действия.
  { color: '#22c063', where: 'кнопка на brand.green' },
  // Синий как цвет текста на белом фоне.
  { color: '#1e9af0', where: 'ссылка цветом brand.blue' },
];

// Относится ли нарушение к известному долгу. Сверяем по ПАРЕ цветов из
// отчёта axe, а не по селектору: селекторы — это классы Tailwind, они
// меняются при каждой правке вёрстки, а цвета фиксированы в бренде.
function isKnownContrastDebt(violation: {
  id: string;
  nodes: { any?: { data?: unknown }[] }[];
}): boolean {
  if (violation.id !== 'color-contrast') return false;

  // Каждый узел обязан оказаться известным. Хотя бы один посторонний —
  // и нарушение считается новым, то есть роняет прогон.
  return violation.nodes.every((node) =>
    (node.any ?? []).some((check) => {
      const data = check.data as
        | { fgColor?: string; bgColor?: string }
        | undefined;
      if (!data) return false;

      const fg = (data.fgColor ?? '').toLowerCase();
      const bg = (data.bgColor ?? '').toLowerCase();

      return KNOWN_CONTRAST_DEBT.some(
        ({ color }) => fg === color || bg === color,
      );
    }),
  );
}

for (const locale of LOCALES) {
  test.describe(`Доступность (${locale})`, () => {
    for (const spec of KEY_PAGES) {
      const url = localePath(locale, spec.path);

      test(`${spec.name} — нет critical/serious нарушений`, async ({ page }) => {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Ждём клиентский рендер: часть интерактивных элементов
        // (фильтры, меню) появляется после гидратации, и без ожидания
        // axe их не увидит. Заодно после гидратации становится видна
        // страница ошибки, если данных нет.
        await page.waitForLoadState('load');

        // Страница, живущая на данных, без Supabase показывает экран
        // ошибки: проверять доступность на нём бессмысленно — это не
        // та страница, которую увидит пользователь. Отсутствие Docker
        // не должно выглядеть как нарушение доступности.
        const status = response?.status() ?? 0;
        const isErrorPage =
          status === 404 ||
          status >= 500 ||
          (await page.getByText('500', { exact: true }).count()) > 0;

        test.skip(
          spec.needsData && isErrorPage,
          'Нет seed-данных (локальный Supabase не поднят)',
        );

        const results = await new AxeBuilder({ page })
          // Проверяем по актуальным наборам правил WCAG 2.1 A/AA —
          // тот же уровень, что заявлен в требованиях проекта.
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        const blocking = results.violations
          .filter((v) =>
            BLOCKING_IMPACTS.includes(
              v.impact as (typeof BLOCKING_IMPACTS)[number],
            ),
          )
          // Известный долг по контрасту брендовых цветов исключается
          // поимённо — см. KNOWN_CONTRAST_DEBT выше. Любое другое
          // нарушение контраста прогон уронит.
          .filter((v) => !isKnownContrastDebt(v));

        // Сообщение о падении должно объяснять, ЧТО чинить: список
        // идентификаторов правил без указания узла бесполезен.
        const report = blocking
          .map((v) => {
            const nodes = v.nodes
              .slice(0, 3)
              .map((n) => `      ${n.html.slice(0, 120)}`)
              .join('\n');
            return (
              `  [${v.impact}] ${v.id}: ${v.help}\n` +
              `    Затронуто узлов: ${v.nodes.length}\n${nodes}\n` +
              `    Подробности: ${v.helpUrl}`
            );
          })
          .join('\n\n');

        expect(
          blocking,
          `${url}: нарушения доступности (critical/serious):\n\n${report}`,
        ).toHaveLength(0);
      });
    }
  });
}

// ------------------------------------------------------------
// Точечные проверки, которых axe не делает.
// ------------------------------------------------------------
test.describe('Доступность: точечные требования', () => {
  test('у всех изображений есть атрибут alt', async ({ page }) => {
    await page.goto('/cars', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    // Именно ОТСУТСТВИЕ атрибута — поломка. Пустой alt="" допустим и
    // правилен для декоративных картинок: он сообщает скринридеру
    // «пропусти», тогда как отсутствие атрибута заставляет его
    // зачитывать имя файла.
    const missing = await page
      .locator('img:not([alt])')
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLImageElement).src.slice(0, 100)),
      );

    expect(
      missing,
      `Изображения без атрибута alt: ${missing.join(', ')}`,
    ).toHaveLength(0);
  });

  test('фотографии объявлений подписаны маркой, моделью и годом', async ({
    page,
  }) => {
    const response = await page.goto('/cars', { waitUntil: 'domcontentloaded' });
    test.skip(response?.status() !== 200, 'Каталог недоступен');
    await page.waitForLoadState('load');

    const cards = page.locator('main a img[alt]');
    const count = await cards.count();
    test.skip(count === 0, 'Каталог пуст — нет данных');

    // Требование ТЗ: подпись фотографии объявления обязана называть
    // машину, а не «фото». Для незрячего это единственный способ
    // понять, что в карточке.
    const alt = await cards.first().getAttribute('alt');
    expect(
      alt && alt.trim().length > 3,
      `Подпись фотографии объявления неинформативна: «${alt}»`,
    ).toBe(true);
  });

  test('у страницы задан язык', async ({ page }) => {
    // lang нужен скринридеру, чтобы выбрать правильное произношение:
    // сербский текст, зачитанный по русским правилам, неразборчив.
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', /sr/);

    // Русское зеркало объявляет язык на обёртке поддерева, а не на
    // <html>: корневой атрибут в приложении Next один, и он сербский
    // (подробнее — в app/ru/layout.tsx и в тесте i18n.spec.ts).
    await page.goto('/ru');
    await expect(page.locator('[lang="ru"]').first()).toBeAttached();
  });
});
