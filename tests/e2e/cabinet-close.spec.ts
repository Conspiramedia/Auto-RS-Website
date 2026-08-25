// ============================================================
// RS AUTO — Крестик «закрыть кабинет» на мобильном.
// ============================================================
// Проверяется ровно то, ради чего крестик заведён: он ЕСТЬ на каждом
// разделе кабинета, в него попадают пальцем, и он уводит НА ГЛАВНУЮ,
// а не куда придётся.
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ПРОВЕРКА В public.spec. Кабинет —
// единственная часть сайта за сессией, и тесты здесь требуют
// настоящего входа (tests/fixtures/session.ts). Держать их вместе с
// публичными страницами значило бы, что весь тот сьют начинает
// зависеть от поднятого Supabase.
//
// БЕЗ ЛОКАЛЬНОГО SUPABASE тесты пропускаются с внятной причиной:
// сессию взять неоткуда, а подделанный токен сервер отвергнет —
// getCurrentUser сверяет его с Supabase, а не доверяет cookie.
// ============================================================

import { expect, test } from '@playwright/test';

import { LOCALES, localePath } from '../fixtures/pages';
import { openCabinet } from '../fixtures/session';

// Разделы кабинета — те самые пункты меню, с которых начался разбор:
// «Мои объявления», «Сообщения», «Уведомления», «Профиль».
const SECTIONS = [
  { path: '/my', name: 'Мои объявления' },
  { path: '/my/messages', name: 'Сообщения' },
  { path: '/my/notifications', name: 'Уведомления' },
  { path: '/my/profile', name: 'Профиль' },
];

// Минимальная тач-цель. Число из рекомендаций Apple HIG и Material,
// оно же в чек-листе доступности проекта.
const MIN_TOUCH = 44;

// Подписи крестика из словаря (lib/i18n.ts → my_close). По ним тест
// его и находит: у кнопки нет текста, и aria-label — единственное
// доступное имя. Заодно это проверяет, что подпись не потерялась.
const CLOSE_LABEL = {
  sr: 'Zatvori nalog i idi na početnu',
  ru: 'Закрыть кабинет и перейти на главную',
} as const;

// Тесты гоняются на МОБИЛЬНОМ вьюпорте: именно там крестик —
// единственный способ выйти из кабинета, не открывая меню заново.
// На десктопе он тоже есть, но там рядом видна вся шапка сайта.
test.use({ viewport: { width: 390, height: 844 } });

for (const locale of LOCALES) {
  test.describe(`Крестик кабинета (${locale}, мобильный)`, () => {
    for (const section of SECTIONS) {
      const url = localePath(locale, section.path);

      test(`${section.name} — крестик виден и уводит на главную`, async ({
        page,
      }) => {
        const signedIn = await openCabinet(page, url);

        test.skip(
          !signedIn,
          'Не удалось войти: локальный Supabase не поднят ' +
            '(npm run supabase:start)',
        );

        const close = page.getByRole('link', { name: CLOSE_LABEL[locale] });

        // ---------- 1) Крестик на месте ----------
        // Ровно тот дефект, из-за которого задача и появилась: на
        // разделах кабинета справа от заголовка было пусто.
        await expect(
          close,
          `${url}: нет крестика закрытия рядом с заголовком кабинета`,
        ).toBeVisible();

        // ---------- 2) В него попадают пальцем ----------
        const box = await close.boundingBox();
        expect(box, `${url}: не удалось измерить крестик`).not.toBeNull();

        expect(
          Math.min(box!.width, box!.height),
          `${url}: тач-цель ${box!.width}×${box!.height}px, ` +
            `минимум ${MIN_TOUCH}×${MIN_TOUCH}`,
        ).toBeGreaterThanOrEqual(MIN_TOUCH);

        // ---------- 3) Уводит на главную ----------
        await close.click();
        await page.waitForLoadState('domcontentloaded');

        const expected = localePath(locale, '/');
        const actual = new URL(page.url()).pathname;

        expect(
          // Сербская главная — «/», русская — «/ru». Завершающий слэш
          // допускаем: браузер и Next трактуют «/ru» и «/ru/» одинаково.
          actual.replace(/\/$/, '') || '/',
          `${url}: крестик привёл на «${actual}», ожидалась главная ` +
            `«${expected}». Крестик обязан ЗАКРЫВАТЬ кабинет, а не ` +
            `водить по истории — иначе из глубокой цепочки ` +
            `(список → объявление → правка) он вернул бы внутрь кабинета.`,
        ).toBe(expected === '/' ? '/' : expected);
      });
    }

    test('крестик — ссылка, а не кнопка (открывается в новой вкладке)', async ({
      page,
    }) => {
      // Адрес известен заранее, значит это переход, а не действие.
      // Ссылка копируется, открывается средней кнопкой и работает до
      // загрузки скрипта — кнопка с router.push() ничего этого не даёт.
      const signedIn = await openCabinet(page, localePath(locale, '/my'));
      test.skip(!signedIn, 'Локальный Supabase не поднят');

      const close = page.getByRole('link', { name: CLOSE_LABEL[locale] });
      await expect(close).toHaveAttribute('href', localePath(locale, '/'));
    });
  });
}

// ------------------------------------------------------------
// «←» и «×» не подменяют друг друга.
// ------------------------------------------------------------
// Два контрола решают разные задачи: «←» водит ВНУТРИ кабинета (из
// диалога к списку диалогов), «×» выводит ИЗ него. В открытом диалоге
// видны оба — это не дублирование.
test.describe('Разделение навигации и закрытия', () => {
  test('на разделе без диалога есть только крестик', async ({ page }) => {
    const signedIn = await openCabinet(page, '/my/profile');
    test.skip(!signedIn, 'Локальный Supabase не поднят');

    await expect(
      page.getByRole('link', { name: CLOSE_LABEL.sr }),
    ).toBeVisible();

    // «Все чаты» на профиле быть не должно: возвращаться некуда.
    await expect(
      page.getByRole('link', { name: /Svi razgovori|Все чаты/i }),
      'Ссылка «Все чаты» протекла за пределы диалога',
    ).toHaveCount(0);
  });
});
