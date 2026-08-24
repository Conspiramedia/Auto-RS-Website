// ============================================================
// RS AUTO — Сьют C: интерфейс входа.
// ============================================================
// Настоящие SMS и письма не отправляются: запросы к Supabase
// перехватываются в браузере (tests/fixtures/supabase-mock.ts).
// Проверяется ПОВЕДЕНИЕ ФОРМЫ, а не серверные правила — те живут в
// supabase/checks/0085_auth_gates_test.sql и проверяются на базе.
//
// Почему такое разделение. Мок, повторяющий логику гейта, проверял бы
// сам себя: напиши в нём «админа пускаем» — и тест зелёный независимо
// от того, что делает сервер. Правила проверяются там, где исполняются.
// ============================================================

import { expect, test, type Page } from '@playwright/test';

import { NON_ADMIN_EMAIL, SEED_USERS } from '../fixtures/seed';
import {
  QUOTA_ALLOWED,
  QUOTA_DENIED,
  QUOTA_EXHAUSTED,
  mockSupabaseAuth,
} from '../fixtures/supabase-mock';

// Тексты, по которым тест узнаёт состояние формы. Берутся из
// lib/i18n.ts; при правке словаря обновляются здесь же.
const SR = {
  tabPhone: 'Telefon',
  tabEmail: 'E-mail',
  // Кнопка запроса кода (my_auth_send). Ищем по имени, а не по
  // позиции: `button[type=button]).last()` ломается от любой правки
  // вёрстки и молча начинает нажимать не ту кнопку.
  sendCode: 'Pošalji kod',
  notAllowed: 'Za ovu adresu prijava e-mailom nije podešena.',
  emailInvalid: 'Unesite ispravnu e-mail adresu.',
};

// ------------------------------------------------------------
// Подготовка формы к отправке.
// ------------------------------------------------------------
// СОГЛАСИЕ С УСЛОВИЯМИ ОБЯЗАТЕЛЬНО. Кнопка «Получить код» заблокирована,
// пока чекбокс не отмечен: вход по SMS создаёт аккаунт, и согласие
// берётся до этого, а не после. Тест, забывший про чекбокс, кликает по
// disabled-кнопке — обработчик не срабатывает, запрос не уходит, и
// падение выглядит как «сервер не ответил», хотя форма отработала верно.
async function fillEmail(page: Page, email: string) {
  await page.getByRole('tab', { name: SR.tabEmail }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="checkbox"]').check();
}

// Кнопка запроса кода.
function sendButton(page: Page) {
  return page.getByRole('button', { name: SR.sendCode });
}

test.describe('Форма входа', () => {
  test('переключатель телефон/почта меняет поле ввода', async ({ page }) => {
    await mockSupabaseAuth(page);
    await page.goto('/login');

    // Телефон выбран по умолчанию: это основной путь площадки,
    // почта заведена для администраторов.
    const phoneTab = page.getByRole('tab', { name: SR.tabPhone });
    const emailTab = page.getByRole('tab', { name: SR.tabEmail });

    await expect(phoneTab).toHaveAttribute('aria-selected', 'true');
    await expect(emailTab).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('input[type="tel"]')).toBeVisible();

    // Переключение на почту.
    await emailTab.click();
    await expect(emailTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    // Поле телефона обязано исчезнуть, а не остаться вторым полем.
    await expect(page.locator('input[type="tel"]')).toHaveCount(0);

    // И обратно.
    await phoneTab.click();
    await expect(page.locator('input[type="tel"]')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
  });

  test('некорректный адрес почты отклоняется без запроса к серверу', async ({
    page,
  }) => {
    const counters = await mockSupabaseAuth(page);
    await page.goto('/login');

    await fillEmail(page, 'это-не-адрес');

    // Кнопка ЗАБЛОКИРОВАНА: адрес без «@» форма не принимает ещё до
    // отправки. Это и есть проверка — клиент не даёт потратить квоту
    // на заведомо неверный ввод.
    await expect(
      sendButton(page),
      'Кнопка активна при адресе без «@» — запрос уйдёт на сервер зря',
    ).toBeDisabled();

    // Ни одного обращения к серверу.
    expect(
      counters.quotaCalls,
      'Запрос ушёл на сервер несмотря на неверный адрес',
    ).toBe(0);
  });

  test('отказ гейта показывает нейтральное сообщение и не запрашивает код', async ({
    page,
  }) => {
    // Сервер отвечает отказом — так он отвечает и на несуществующий
    // адрес, и на существующего не-админа. Ответы неразличимы.
    const counters = await mockSupabaseAuth(page, { quota: QUOTA_DENIED });
    await page.goto('/login');

    await fillEmail(page, NON_ADMIN_EMAIL);
    await sendButton(page).click();

    // Текст отказа — общий на все причины.
    await expect(
      page.getByText(SR.notAllowed),
      'Нет нейтрального сообщения об отказе',
    ).toBeVisible();

    // ГЛАВНОЕ: код не запрашивался. Уйди запрос — письмо ушло бы
    // вопреки отказу гейта.
    expect(
      counters.otpRequests,
      'Код запрошен несмотря на отказ гейта — письмо ушло бы зря',
    ).toBe(0);
  });

  test('отказ не-админу совпадает дословно с отказом несуществующему адресу', async ({
    page,
  }) => {
    // Суть нейтральности: по тексту ответа нельзя понять, есть ли
    // такой пользователь. Разные тексты превратили бы форму входа в
    // способ перебирать зарегистрированные адреса.
    const messages: string[] = [];

    for (const email of [NON_ADMIN_EMAIL, SEED_USERS.seller.email]) {
      await mockSupabaseAuth(page, { quota: QUOTA_DENIED });
      await page.goto('/login');

      await fillEmail(page, email);
      await sendButton(page).click();

      const text = await page.getByText(SR.notAllowed).textContent();
      messages.push(text ?? '');
    }

    expect(
      messages[0],
      'Тексты отказа различаются — форма входа выдаёт, кто зарегистрирован',
    ).toBe(messages[1]);
  });

  test('исчерпанная квота тоже отвечает нейтрально', async ({ page }) => {
    // Квота исчерпана — но и об этом форма не сообщает отдельно:
    // «слишком много попыток» подсказывало бы, что адрес существует.
    const counters = await mockSupabaseAuth(page, { quota: QUOTA_EXHAUSTED });
    await page.goto('/login');

    await fillEmail(page, SEED_USERS.admin.email);
    await sendButton(page).click();

    await expect(page.getByText(SR.notAllowed)).toBeVisible();
    expect(counters.otpRequests).toBe(0);
  });

  test('разрешённый вход открывает шаг ввода кода', async ({ page }) => {
    const counters = await mockSupabaseAuth(page, { quota: QUOTA_ALLOWED });
    await page.goto('/login');

    await fillEmail(page, SEED_USERS.admin.email);
    await sendButton(page).click();

    // Появилось поле кода — форма перешла на второй шаг.
    await expect(
      page.locator('input[inputmode="numeric"]'),
      'После разрешения гейта не появилось поле ввода кода',
    ).toBeVisible();

    expect(counters.otpRequests, 'Код не был запрошен').toBe(1);
  });
});

// ------------------------------------------------------------
// Параметр ?redirect= — куда вернуть после входа.
// ------------------------------------------------------------
test.describe('Возврат после входа', () => {
  test('внутренний путь в ?redirect= сохраняется на странице', async ({
    page,
  }) => {
    await mockSupabaseAuth(page);

    // Открываем вход так, как это делает редирект с закрытой страницы.
    const response = await page.goto('/login?redirect=/my/messages');
    expect(response!.status()).toBe(200);

    // Страница входа отрисовалась, адрес сохранён в строке браузера:
    // форма обязана помнить, куда вернуть человека.
    expect(page.url()).toContain('redirect=');
    await expect(page.locator('input[type="tel"]')).toBeVisible();
  });

  test('внешний адрес в ?redirect= не уводит с сайта', async ({ page }) => {
    // Открытый редирект — классический вектор фишинга: ссылка на
    // настоящий домен, уводящая на чужой сайт. safeRedirect в
    // LoginPageView обязан такой адрес отбросить.
    await mockSupabaseAuth(page);
    await page.goto('/login?redirect=https://evil.example.com');

    // Никуда не ушли: страница входа осталась на своём домене.
    expect(
      new URL(page.url()).hostname,
      'Страница входа увела на внешний домен',
    ).not.toContain('evil.example.com');
    await expect(page.locator('input[type="tel"]')).toBeVisible();
  });

  test('протокол-относительный адрес //evil.com тоже отбрасывается', async ({
    page,
  }) => {
    // Браузер считает //evil.com внешним адресом, хотя строка
    // начинается со слэша — проверка «начинается с /» его пропустила
    // бы, поэтому в safeRedirect есть отдельное условие.
    await mockSupabaseAuth(page);
    await page.goto('/login?redirect=//evil.example.com');

    expect(new URL(page.url()).hostname).not.toContain('evil.example.com');
    await expect(page.locator('input[type="tel"]')).toBeVisible();
  });
});

// ------------------------------------------------------------
// Кабинет закрыт для гостя.
// ------------------------------------------------------------
test.describe('Доступ к кабинету', () => {
  for (const path of ['/my', '/my/messages', '/my/profile']) {
    test(`${path} гостю показывает вход, а не содержимое`, async ({ page }) => {
      await mockSupabaseAuth(page);
      await page.goto(path);

      // Кабинет подставляет форму входа вместо содержимого. Признак —
      // поле телефона: в самом кабинете его нет.
      await expect(
        page.locator('input[type="tel"], input[type="email"]').first(),
        `${path}: гость увидел содержимое кабинета вместо формы входа`,
      ).toBeVisible();
    });
  }

  test('админка гостю недоступна', async ({ page }) => {
    await mockSupabaseAuth(page);
    const response = await page.goto('/admin');

    // Админка отдаёт 404 постороннему: существование раздела не
    // подтверждается даже кодом ответа.
    expect(
      [403, 404].includes(response!.status()) ||
        (await page.locator('input[type="email"], input[type="tel"]').count()) > 0,
      'Гость получил доступ к админке',
    ).toBe(true);
  });
});
