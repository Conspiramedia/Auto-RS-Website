// ============================================================
// RS AUTO — Сьют B: SEO-разметка.
// ============================================================
// Автоматизация ручного аудита: те же проверки, что выполнялись
// глазами перед подачей в поисковики, но теперь на каждый пуш.
// Смысл именно в этом — SEO-регрессия не видна на экране. Страница
// с потерянным canonical или разъехавшимся hreflang выглядит целой,
// а обнаруживается через недели по провалу трафика.
//
// Лимиты title/description взяты из требований: 60 и 155 символов.
// Это не догма поисковика (Google режет по пикселям), а рабочее
// правило, при котором сниппет не обрезается.
// ============================================================

import { expect, test, type Page } from '@playwright/test';

import { SEED_CARS } from '../fixtures/seed';
import {
  CAR_PAGE,
  LOCALES,
  NOINDEX_PAGES,
  PUBLIC_PAGES,
  localePath,
  type TestLocale,
} from '../fixtures/pages';

const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 155;

// Базовый адрес, который обязан стоять во всех абсолютных ссылках
// разметки. Берётся из окружения сборки: локально это 127.0.0.1:3000,
// поэтому проверяем совпадение с ним, а не с боевым доменом —
// требование «все URL на тестовом домене» из ТЗ.
const EXPECTED_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_BASE_URL ?? 'http://127.0.0.1:3100';

// ------------------------------------------------------------
// Ожидаемый абсолютный адрес страницы.
// ------------------------------------------------------------
// Главная — особый случай: localeHref('sr', '/') даёт пустой путь, и
// адрес собирается как «origin» без завершающего слэша. Для поисковика
// https://rsauto.rs и https://rsauto.rs/ — ОДИН И ТОТ ЖЕ адрес
// (слэш после домена подразумевается), поэтому расхождение здесь не
// дефект, и требовать слэш от разметки незачем.
//
// Русская главная при этом получает /ru — тоже без слэша, и по той же
// причине это корректно.
function absoluteUrl(path: string): string {
  return path === '/' ? EXPECTED_ORIGIN : `${EXPECTED_ORIGIN}${path}`;
}

// ------------------------------------------------------------
// Помощники чтения разметки.
// ------------------------------------------------------------
async function metaContent(page: Page, selector: string): Promise<string | null> {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return null;
  return el.getAttribute('content');
}

async function linkHref(page: Page, selector: string): Promise<string | null> {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return null;
  return el.getAttribute('href');
}

// ------------------------------------------------------------
// Есть ли на странице данные из базы.
// ------------------------------------------------------------
// Без поднятого Supabase карточка объявления не существует, и это
// проявляется тремя способами: 404 (объявления нет), 5xx (исключение
// на сервере) или 200 со страницей ошибки от клиентского error
// boundary — тогда в разметке стоит крупное «500».
//
// Отличать эти случаи от настоящей поломки разметки обязательно:
// иначе отсутствие Docker выглядело бы как сломанный JSON-LD.
async function hasData(page: Page, status: number | undefined): Promise<boolean> {
  if (status === undefined || status === 404 || status >= 500) return false;
  // Error boundary отрисовывается после гидратации — ждём её.
  await page.waitForLoadState('load');
  return (await page.getByText('500', { exact: true }).count()) === 0;
}

// Все блоки JSON-LD страницы, распарсенные. Скрипт может содержать
// как объект, так и массив объектов — разметка допускает оба варианта,
// и на сайте используются оба.
async function readJsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();

  const out: Record<string, unknown>[] = [];
  for (const text of raw) {
    // Парсинг без try: невалидный JSON-LD — это и есть поломка,
    // которую тест обязан показать, а не проглотить.
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) out.push(...parsed);
    else out.push(parsed);
  }
  return out;
}

function typesOf(blocks: Record<string, unknown>[]): string[] {
  return blocks.map((b) => String(b['@type'] ?? ''));
}

// ============================================================
// 1) title и description: наличие и лимиты.
// ============================================================
for (const locale of LOCALES) {
  test.describe(`Мета-теги (${locale})`, () => {
    for (const spec of PUBLIC_PAGES) {
      const url = localePath(locale, spec.path);

      test(`${spec.name} — title ≤${TITLE_LIMIT}, description ≤${DESCRIPTION_LIMIT}`, async ({
        page,
      }) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const title = await page.title();
        expect(title.length, `${url}: пустой <title>`).toBeGreaterThan(0);

        // Шаблон «%s | RS Auto» из app/layout.tsx добавляет суффикс к
        // заголовку. Лимит проверяем по ПОЛНОЙ строке — именно её
        // видит поисковик.
        expect(
          title.length,
          `${url}: title ${title.length} символов (лимит ${TITLE_LIMIT}): «${title}»`,
        ).toBeLessThanOrEqual(TITLE_LIMIT);

        const description = await metaContent(page, 'meta[name="description"]');
        expect(description, `${url}: нет meta description`).toBeTruthy();
        expect(
          description!.length,
          `${url}: description ${description!.length} символов ` +
            `(лимит ${DESCRIPTION_LIMIT}): «${description}»`,
        ).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
      });
    }
  });
}

// ============================================================
// 2) Уникальность title и description.
// ============================================================
// Одинаковые заголовки у разных страниц — сигнал поисковику, что это
// дубликаты, и повод показать в выдаче только одну из них.
test.describe('Уникальность мета-тегов', () => {
  for (const locale of LOCALES) {
    test(`заголовки и описания уникальны (${locale})`, async ({ page }) => {
      const titles = new Map<string, string>();
      const descriptions = new Map<string, string>();

      for (const spec of PUBLIC_PAGES) {
        const url = localePath(locale, spec.path);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const title = await page.title();
        const description =
          (await metaContent(page, 'meta[name="description"]')) ?? '';

        const titleTwin = titles.get(title);
        expect(
          titleTwin,
          `Одинаковый title у ${url} и ${titleTwin}: «${title}»`,
        ).toBeUndefined();
        titles.set(title, url);

        const descTwin = descriptions.get(description);
        expect(
          descTwin,
          `Одинаковый description у ${url} и ${descTwin}: «${description}»`,
        ).toBeUndefined();
        descriptions.set(description, url);
      }
    });
  }
});

// ============================================================
// 3) canonical — self-ссылочный.
// ============================================================
// Проверка родилась из настоящей ошибки: canonical русских страниц
// когда-то указывал на сербские, и русское зеркало выпадало из
// индекса целиком (см. шапку lib/seo.ts).
for (const locale of LOCALES) {
  test.describe(`Canonical (${locale})`, () => {
    for (const spec of PUBLIC_PAGES) {
      const url = localePath(locale, spec.path);

      test(`${spec.name} канонизирует сам себя`, async ({ page }) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const canonical = await linkHref(page, 'link[rel="canonical"]');
        expect(canonical, `${url}: нет canonical`).toBeTruthy();

        expect(
          canonical,
          `${url}: canonical ведёт на «${canonical}» вместо себя`,
        ).toBe(absoluteUrl(url));
      });
    }
  });
}

// ============================================================
// 4) hreflang — пары sr ↔ ru и x-default.
// ============================================================
test.describe('Языковые альтернативы', () => {
  for (const spec of PUBLIC_PAGES) {
    test(`${spec.name}: sr и ru указывают друг на друга, x-default — на сербскую`, async ({
      page,
    }) => {
      const srUrl = localePath('sr', spec.path);
      const ruUrl = localePath('ru', spec.path);

      // Ожидаемый набор ссылок ОДИНАКОВ на обеих версиях: это
      // требование Google — hreflang обязан быть взаимным и полным.
      const expected = {
        'sr-Latn': absoluteUrl(srUrl),
        ru: absoluteUrl(ruUrl),
        'x-default': absoluteUrl(srUrl),
      };

      for (const pageUrl of [srUrl, ruUrl]) {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

        for (const [lang, href] of Object.entries(expected)) {
          const actual = await linkHref(
            page,
            `link[rel="alternate"][hreflang="${lang}"]`,
          );
          expect(
            actual,
            `${pageUrl}: hreflang="${lang}" ведёт на «${actual}», ожидалось «${href}»`,
          ).toBe(href);
        }
      }
    });
  }
});

// ============================================================
// 5) Open Graph и Twitter.
// ============================================================
for (const locale of LOCALES) {
  test.describe(`Превью для соцсетей (${locale})`, () => {
    for (const spec of PUBLIC_PAGES) {
      const url = localePath(locale, spec.path);

      test(`${spec.name}: og и twitter заполнены`, async ({ page }) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // og:image проверяется отдельно и строже прочих: именно его
        // отсутствие превращает репост в голую строку в ленте.
        const required = [
          'meta[property="og:title"]',
          'meta[property="og:description"]',
          'meta[property="og:url"]',
          'meta[property="og:type"]',
          'meta[property="og:image"]',
          'meta[name="twitter:card"]',
          'meta[name="twitter:title"]',
          'meta[name="twitter:description"]',
          'meta[name="twitter:image"]',
        ];

        for (const selector of required) {
          const value = await metaContent(page, selector);
          expect(value, `${url}: нет ${selector}`).toBeTruthy();
        }

        // Крупное превью: summary_large_image — то, ради чего
        // картинка вообще рисуется.
        expect(await metaContent(page, 'meta[name="twitter:card"]')).toBe(
          'summary_large_image',
        );

        // og:url обязан совпадать с canonical: расхождение означает,
        // что соцсеть и поисковик считают страницу разными адресами.
        const ogUrl = await metaContent(page, 'meta[property="og:url"]');
        const canonical = await linkHref(page, 'link[rel="canonical"]');
        expect(
          ogUrl,
          `${url}: og:url «${ogUrl}» расходится с canonical «${canonical}»`,
        ).toBe(canonical);

        // Абсолютный адрес картинки: относительный соцсети не
        // разрешают и превью не покажут.
        const ogImage = await metaContent(page, 'meta[property="og:image"]');
        expect(
          ogImage!.startsWith('http'),
          `${url}: og:image не абсолютный — «${ogImage}»`,
        ).toBe(true);
      });
    }
  });
}

// ============================================================
// 6) JSON-LD: разбирается и содержит нужные типы.
// ============================================================
test.describe('Микроразметка JSON-LD', () => {
  test('главная: Organization с логотипом + WebSite', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const blocks = await readJsonLd(page);
    const types = typesOf(blocks);

    expect(types, 'На главной нет Organization').toContain('Organization');
    expect(types, 'На главной нет WebSite').toContain('WebSite');

    const org = blocks.find((b) => b['@type'] === 'Organization')!;
    // logo — требование документации Google для знака организации.
    expect(org.logo, 'Organization без logo').toBeTruthy();
    expect(org.name, 'Organization без name').toBeTruthy();
    expect(org.url, 'Organization без url').toBeTruthy();
  });

  test('о платформе: AboutPage + Organization', async ({ page }) => {
    await page.goto('/about', { waitUntil: 'domcontentloaded' });

    const types = typesOf(await readJsonLd(page));
    expect(types).toContain('AboutPage');
    expect(types).toContain('Organization');
  });

  test('контакты: ContactPage + Organization', async ({ page }) => {
    await page.goto('/contact', { waitUntil: 'domcontentloaded' });

    const blocks = await readJsonLd(page);
    const types = typesOf(blocks);
    expect(types).toContain('ContactPage');
    expect(types, 'На /contact нет Organization').toContain('Organization');

    // Способ связи обязан быть машиночитаемым: ради этого разметка
    // на странице контактов и нужна.
    const contactPage = blocks.find((b) => b['@type'] === 'ContactPage')!;
    expect(contactPage.contactPoint, 'ContactPage без contactPoint').toBeTruthy();
  });

  test('каталог: ItemList с позициями', async ({ page }) => {
    await page.goto('/cars', { waitUntil: 'domcontentloaded' });

    const blocks = await readJsonLd(page);
    const list = blocks.find((b) => b['@type'] === 'ItemList');

    // Без данных каталог пуст и разметки списка на нём нет — это
    // корректное поведение, поэтому проверяем только когда список есть.
    test.skip(!list, 'Каталог пуст — нет данных для ItemList');

    const items = list!.itemListElement as { position: number }[];
    expect(items.length, 'ItemList без позиций').toBeGreaterThan(0);
    // Нумерация с единицы и сквозная — требование schema.org.
    expect(items[0].position).toBe(1);
  });
});

// ============================================================
// 7) Карточка объявления: Vehicle + BreadcrumbList.
// ============================================================
// Требует seed-данных: без локальной базы карточки не существует.
test.describe('Карточка объявления', () => {
  test('Vehicle с ценой, маркой, годом и BreadcrumbList от главной', async ({
    page,
  }) => {
    const response = await page.goto(CAR_PAGE.path, {
      waitUntil: 'domcontentloaded',
    });

    // Нет базы — нет карточки. Пропускаем внятно, а не падаем:
    // отсутствие Docker не должно выглядеть как поломка разметки.
    test.skip(
      !(await hasData(page, response?.status())),
      'Нет seed-данных (локальный Supabase не поднят)',
    );

    const blocks = await readJsonLd(page);
    const types = typesOf(blocks);

    // Тип зависит от вида сделки: Vehicle для продажи, Car для
    // чистой аренды. Наша фикстура — продажа.
    expect(
      types.some((t) => t === 'Vehicle' || t === 'Car'),
      `На карточке нет Vehicle/Car, найдено: ${types.join(', ')}`,
    ).toBe(true);

    const vehicle = blocks.find(
      (b) => b['@type'] === 'Vehicle' || b['@type'] === 'Car',
    )!;

    // Поля, ради которых разметка и ставится: они дают расширенный
    // сниппет с ценой и пробегом.
    expect(vehicle.name, 'Vehicle без name').toBeTruthy();
    expect(vehicle.brand, 'Vehicle без brand').toBeTruthy();
    expect(vehicle.model, 'Vehicle без model').toBeTruthy();
    expect(vehicle.vehicleModelDate, 'Vehicle без года').toBeTruthy();
    expect(vehicle.offers, 'Vehicle без offers').toBeTruthy();

    const offer = (
      Array.isArray(vehicle.offers) ? vehicle.offers[0] : vehicle.offers
    ) as Record<string, unknown>;
    expect(offer.price, 'Offer без цены').toBe(SEED_CARS.activeSale.salePrice);
    expect(offer.priceCurrency, 'Offer без валюты').toBe('EUR');

    // ---------- Хлебные крошки ----------
    expect(types, 'На карточке нет BreadcrumbList').toContain('BreadcrumbList');

    const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList')!;
    const items = crumbs.itemListElement as {
      position: number;
      name: string;
      item: string;
    }[];

    // Цепочка начинается с главной — Google считает начатую с
    // раздела обрезанной.
    expect(
      items.length,
      'Цепочка крошек короче трёх звеньев (главная → каталог → объявление)',
    ).toBeGreaterThanOrEqual(3);
    expect(items[0].position).toBe(1);
    expect(
      items[0].item,
      `Первое звено крошек ведёт на «${items[0].item}», а не на главную`,
    ).toBe(`${EXPECTED_ORIGIN}/`);
  });

  test('снятое объявление уходит в noindex', async ({ page }) => {
    const response = await page.goto(`/car/${SEED_CARS.archived.id}`, {
      waitUntil: 'domcontentloaded',
    });
    test.skip(
      !(await hasData(page, response?.status())),
      'Нет seed-данных (локальный Supabase не поднят)',
    );

    const robots = await metaContent(page, 'meta[name="robots"]');
    expect(
      robots,
      'Снятое объявление обязано быть noindex: содержимого нет, ' +
        'а в индексе останется пустая страница',
    ).toContain('noindex');
  });
});

// ============================================================
// 8) Служебные страницы закрыты от индексации.
// ============================================================
test.describe('Закрытые от индексации разделы', () => {
  for (const spec of NOINDEX_PAGES) {
    test(`${spec.name} помечена noindex`, async ({ page }) => {
      await page.goto(localePath('sr', spec.path), {
        waitUntil: 'domcontentloaded',
      });

      const robots = await metaContent(page, 'meta[name="robots"]');
      expect(robots, `${spec.path}: нет meta robots`).toBeTruthy();
      expect(
        robots,
        `${spec.path}: ожидался noindex, получено «${robots}»`,
      ).toContain('noindex');
    });
  }
});

// ============================================================
// 9) robots.txt и sitemap.xml.
// ============================================================
test.describe('robots.txt', () => {
  test('разрешает обход и закрывает служебные разделы', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();

    expect(body).toContain('User-Agent: *');
    expect(body).toContain('Allow: /');

    // Кабинет, админка и вход обходиться не должны.
    for (const path of ['/my', '/admin', '/login']) {
      expect(
        body,
        `robots.txt не закрывает ${path}`,
      ).toContain(`Disallow: ${path}`);
    }

    // Карта сайта указана и ведёт на тестовый домен, а не на боевой.
    expect(body).toContain(`Sitemap: ${EXPECTED_ORIGIN}/sitemap.xml`);
  });
});

test.describe('sitemap.xml', () => {
  test('валиден, содержит альтернативы и только адреса тестового домена', async ({
    request,
  }) => {
    const xml = await (await request.get('/sitemap.xml')).text();

    expect(xml).toContain('<urlset');
    expect(xml).toContain('<loc>');

    // ---------- Все адреса на ожидаемом домене ----------
    // Требование ТЗ. Оно же ловит ошибку конфигурации, при которой в
    // карту попадает временный адрес превью.
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length, 'Карта сайта пуста').toBeGreaterThan(0);

    const foreign = locs.filter((u) => !u.startsWith(EXPECTED_ORIGIN));
    expect(
      foreign,
      `В карте адреса не с ${EXPECTED_ORIGIN}: ${foreign.slice(0, 5).join(', ')}`,
    ).toHaveLength(0);

    // ---------- Языковые альтернативы ----------
    // Набор обязан совпадать с разметкой страниц, включая x-default:
    // расхождение обесценивает всю связку hreflang.
    expect(xml, 'В карте нет альтернатив hreflang').toContain('hreflang="ru"');
    expect(
      xml,
      'В карте нет x-default — набор альтернатив расходится с разметкой страниц',
    ).toContain('hreflang="x-default"');

    // ---------- Лимит формата ----------
    expect(
      locs.length,
      `В карте ${locs.length} URL — превышен лимит 50 000, ` +
        `Google отбросит файл целиком`,
    ).toBeLessThanOrEqual(50000);

    // ---------- Скрытые объявления не попадают ----------
    // Объявление на модерации или снятое в карте — прямая утечка
    // непроверенного содержимого в индекс.
    const hidden = [SEED_CARS.moderation.id, SEED_CARS.archived.id];
    for (const id of hidden) {
      expect(
        xml.includes(id),
        `В карте есть скрытое объявление ${id}`,
      ).toBe(false);
    }
  });
});
