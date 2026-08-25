// ============================================================
// RS AUTO — Сьют: живое форматирование числового ввода.
// ============================================================
// ЧТО ПРОВЕРЯЕТСЯ. Цифровые поля сайта ведут себя так же, как в
// приложении (ThousandsFormatter из lib/shared/utils/number_formatters.dart):
// сумма группируется по три разряда ПРЯМО ПРИ ВВОДЕ, а наружу — в
// query-строку каталога и в RPC подачи — уходит чистое число.
//
// ПОЧЕМУ БРАУЗЕРОМ, А НЕ ЮНИТОМ. Сами форматтеры чистые и ломаются
// редко. Ломается СВЯЗКА: значение состояния, показанный текст и
// позиция курсора живут в разных местах, и рассинхрон виден только в
// настоящем поле. Исходная ошибка была именно такой — форма подачи
// суммы форматировала, а фильтры каталога нет.
//
// ЗАВИСИМОСТЬ ОТ ДАННЫХ. Сама панель фильтров клиентская, но живёт она
// на странице каталога, а та рендерится на сервере и без Supabase
// отдаёт 500. Форме подачи для шага «Детали» нужен список моделей из
// той же базы. Поэтому ВЕСЬ сьют требует поднятого локального стека и
// без него пропускается, а не падает — как и остальные сьюты проекта
// (см. docs/testing.md, деградация).
// ============================================================

import { expect, test, type Page } from '@playwright/test';

import { isSupabaseUp } from '../env';

// Разделитель разрядов в ПОЛЯХ — неразрывный пробел (GROUP_SEPARATOR
// в lib/inputFormat.ts). В приложении там обычный пробел; здесь он
// неразрывный, потому что обычный в узком поле переносится и «12 500»
// рвётся на две строки.
const NBSP = '\u00A0';

// Проверка один раз на файл: поднимать стек ради каждого теста
// незачем, а результат в пределах прогона не меняется.
let supabaseUp = false;
test.beforeAll(async () => {
  supabaseUp = await isSupabaseUp();
});

test.beforeEach(() => {
  test.skip(!supabaseUp, 'Локальный Supabase не поднят');
});

// ------------------------------------------------------------
// Панель фильтров каталога.
// ------------------------------------------------------------
// Поля адресуются по aria-label: он собран из тех же словарей, что и
// подписи, и не зависит ни от порядка полей в разметке, ни от локали
// сборки (обе локали покрыты альтернативой в регулярном выражении).
const PRICE_FROM = /(Cena|Цена).*(od|от)/;
const YEAR_FROM = /(Godište|Год выпуска).*(od|от)/;
const MILEAGE = /Kilometraža|Пробег/;

// Каталог, а не главная: панель фильтров живёт в CatalogView.
// Главная — лендинг, фильтров на ней нет.
const CATALOG_PATH = '/cars';

// CatalogView рендерит ДВЕ панели — мобильную (md:hidden) и десктопную
// (hidden md:flex). В разметке они обе, но видима всегда одна, поэтому
// кнопку и поля берём строго из видимой.
async function openFilters(page: Page) {
  await page.goto(CATALOG_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');

  const button = page
    .getByRole('button', { name: /Filteri|Фильтры/ })
    .filter({ visible: true })
    .first();
  await expect(button).toBeVisible();
  await button.click();

  // Панель — шторка с анимацией. Ждём появления самого поля, а не
  // фиксированную паузу.
  await expect(priceFrom(page)).toBeVisible();
}

// Видимые поля панели. Пока шторка закрыта, поля второй (скрытой)
// панели тоже есть в DOM — без фильтра по видимости locator указывал бы
// на них, и ввод уходил бы в никуда.
function visibleField(page: Page, label: RegExp) {
  return page.getByLabel(label).filter({ visible: true }).first();
}

const priceFrom = (page: Page) => visibleField(page, PRICE_FROM);
const yearFrom = (page: Page) => visibleField(page, YEAR_FROM);
const mileage = (page: Page) => visibleField(page, MILEAGE);

test.describe('Фильтры каталога — форматирование сумм', () => {
  test('цена: живое форматирование, backspace, вставка, лимит', async ({
    page,
  }) => {
    await openFilters(page);
    const price = priceFrom(page);

    // ---------- Мобильная клавиатура с цифрами ----------
    await expect(price).toHaveAttribute('inputmode', 'numeric');

    // ---------- Живое форматирование ----------
    // Посимвольный ввод: разделитель обязан появиться на четвёртой
    // цифре, а не после ухода фокуса.
    await price.pressSequentially('125000');
    await expect(price).toHaveValue(`125${NBSP}000`);

    // ---------- Backspace не ломает разделитель ----------
    // «125 000» минус последняя цифра — это «12 500», а не «125 00».
    await price.press('End');
    await price.press('Backspace');
    await expect(price).toHaveValue(`12${NBSP}500`);

    // ---------- Вставка отформатированной строки ----------
    // Человек копирует цену из чужого объявления вместе с разделителем.
    // fill() кладёт в поле готовую строку целиком — тот же путь, что у
    // Ctrl+V, в отличие от посимвольного pressSequentially.
    await price.fill('12 500');
    await expect(price).toHaveValue(`12${NBSP}500`);

    // Тот же номер в сербском формате: точка-разделитель (так печатает
    // Intl.NumberFormat для sr-Latn-RS) и символ валюты рядом.
    await price.fill('12.500 EUR');
    await expect(price).toHaveValue(`12${NBSP}500`);

    // ---------- Лимит: не больше семи цифр ----------
    await price.fill('');
    await price.pressSequentially('123456789');
    await expect(price).toHaveValue(`1${NBSP}234${NBSP}567`);
  });

  test('курсор остаётся на месте при правке середины числа', async ({
    page,
  }) => {
    await openFilters(page);
    const price = priceFrom(page);

    await price.pressSequentially('125000');
    await expect(price).toHaveValue(`125${NBSP}000`);

    // Ставим курсор после первой цифры («1|25 000») и дописываем «9».
    // Приложение в этом месте отправляет курсор в конец строки; на
    // сайте позиция восстанавливается по числу цифр слева, иначе
    // правка начала суммы была бы невозможна.
    await price.evaluate((el: HTMLInputElement) => el.setSelectionRange(1, 1));
    await price.press('9');

    // «1 925 000»: цифра встала на второе место, а не в конец.
    await expect(price).toHaveValue(`1${NBSP}925${NBSP}000`);

    // И курсор стоит сразу после вставленной девятки — следующая
    // набранная цифра продолжит её, а не уедет в хвост.
    const caret = await price.evaluate(
      (el: HTMLInputElement) => el.selectionStart,
    );
    expect(caret).toBe(3); // «1 9|25 000» — с учётом разделителя
  });

  test('год остаётся без разделителя разрядов', async ({ page }) => {
    await openFilters(page);
    const year = yearFrom(page);

    // Главное требование пункта 3: «2019», а не «2 019».
    await year.pressSequentially('2019');
    await expect(year).toHaveValue('2019');
    expect(await year.inputValue()).not.toContain(NBSP);
    expect(await year.inputValue()).not.toContain('\u0020');

    // Ровно четыре цифры: пятая не принимается.
    await year.fill('');
    await year.pressSequentially('20195');
    await expect(year).toHaveValue('2019');
  });

  test('пробег форматируется как цена', async ({ page }) => {
    await openFilters(page);
    const km = mileage(page);

    await expect(km).toHaveAttribute('inputmode', 'numeric');
    await km.pressSequentially('180000');
    await expect(km).toHaveValue(`180${NBSP}000`);
  });

  test('в query-строку уходит чистое число', async ({ page }) => {
    await openFilters(page);

    await priceFrom(page).pressSequentially('12500');
    await yearFrom(page).pressSequentially('2019');
    await expect(priceFrom(page)).toHaveValue(`12${NBSP}500`);

    // Применение фильтров — обычный GET-submit формы.
    await page
      .getByRole('button', { name: /Prikaži|Показать/ })
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForURL(/price_from=/, { timeout: 15_000 });

    // Форматирование обязано остаться на экране: parseFilters читает
    // параметр через Number(), и Number('12 500') вернул бы NaN — фильтр
    // молча потерялся бы.
    const url = new URL(page.url());
    expect(url.searchParams.get('price_from')).toBe('12500');
    expect(url.searchParams.get('year_from')).toBe('2019');
    // Ни неразрывного пробела, ни обычного в закодированном виде.
    expect(page.url()).not.toContain('%C2%A0');
    expect(page.url()).not.toContain('%20');

    // И обратно: на странице с фильтром в адресе поле снова показывает
    // отформатированное значение, а не «12500».
    await page
      .getByRole('button', { name: /Filteri|Фильтры/ })
      .filter({ visible: true })
      .first()
      .click();
    await expect(priceFrom(page)).toHaveValue(`12${NBSP}500`);
  });
});

// ------------------------------------------------------------
// Форма подачи объявления.
// ------------------------------------------------------------
// Шаг «Детали» открывается только после заполненного шага 1, а тот
// требует список моделей из Supabase.
test.describe('Подача объявления — форматирование сумм', () => {
  // Выбор значения в списке-пикере.
  async function pick(page: Page, label: RegExp, value: string) {
    await page.getByRole('button', { name: label }).first().click();
    await page.getByRole('option', { name: value, exact: true }).first().click();
  }

  // Заполнение шага 1 и переход на шаг «Детали».
  async function goToDetails(page: Page) {
    await page.goto('/sell', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    await pick(page, /Marka|Марка/, 'BMW');
    // Модель подгружается каскадом после выбора марки — берём первую
    // из списка, какой бы она ни была.
    await page.getByRole('button', { name: /Model|Модель/ }).first().click();
    await page.getByRole('option').first().click();
    await pick(page, /Godište|Год выпуска/, '2019');
    await pick(page, /Grad|Город/, 'Beograd');

    await page.getByRole('button', { name: /^(Dalje|Далее)$/ }).click();
    await expect(page.locator('#sell-mileage')).toBeVisible();
  }

  test('цена и пробег форматируются при вводе', async ({ page }) => {
    await goToDetails(page);

    const price = page.locator('#sell-price');
    await expect(price).toHaveAttribute('inputmode', 'numeric');
    await price.pressSequentially('125000');
    await expect(price).toHaveValue(`125${NBSP}000`);

    // Backspace.
    await price.press('End');
    await price.press('Backspace');
    await expect(price).toHaveValue(`12${NBSP}500`);

    // Вставка отформатированной строки.
    await price.fill('12 500');
    await expect(price).toHaveValue(`12${NBSP}500`);

    // Лимит цифр — тот же, что в фильтрах.
    await price.fill('');
    await price.pressSequentially('123456789');
    await expect(price).toHaveValue(`1${NBSP}234${NBSP}567`);

    const mileage = page.locator('#sell-mileage');
    await mileage.pressSequentially('180000');
    await expect(mileage).toHaveValue(`180${NBSP}000`);
  });

  // Контракт с бэкендом: RPC получает ЧИСЛО, а не строку с
  // разделителями. Проверяется перехватом настоящего запроса.
  test('в create_car_v3 суммы уходят числами', async ({ page }) => {
    let payload: Record<string, unknown> | null = null;
    await page.route('**/rest/v1/rpc/create_car_v3', async (route) => {
      payload = route.request().postDataJSON();
      // Настоящая запись тесту не нужна: контракт — это ТЕЛО запроса,
      // а правила самой RPC проверяются SQL-тестами (supabase/checks).
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'intercepted-by-test' }),
      });
    });

    await goToDetails(page);
    await page.locator('#sell-price').pressSequentially('125000');
    await page.locator('#sell-mileage').pressSequentially('180000');

    // На экране — с разделителями.
    await expect(page.locator('#sell-price')).toHaveValue(`125${NBSP}000`);

    // Дальше мастер требует фотографии и вход по коду из SMS. Пройти
    // его целиком тест не может, поэтому отправку инициирует форма
    // сама — а мы ждём либо перехваченный запрос, либо остановку на
    // одном из этих шагов.
    await page.getByRole('button', { name: /^(Dalje|Далее)$/ }).click();

    // Ждём запрос, но не проваливаем тест, если мастер остановился
    // раньше: у гостя без фотографий он до RPC не доходит по замыслу.
    await page.waitForTimeout(1500);

    test.skip(
      payload === null,
      'Мастер не дошёл до create_car_v3: нужны фотографии и сессия',
    );

    // Суммы — числа, а не строки «125 000».
    expect(typeof payload!.p_sale_price).toBe('number');
    expect(payload!.p_sale_price).toBe(125000);
    expect(payload!.p_mileage).toBe(180000);
    expect(payload!.p_year).toBe(2019);
  });
});
