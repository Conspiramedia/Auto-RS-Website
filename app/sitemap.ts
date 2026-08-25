// ============================================================
// RS AUTO — sitemap.xml. Генерируется на сервере.
// ============================================================
// Состав: статические разделы + страницы марок и моделей + витрины
// салонов + карточки всех активных объявлений на продажу. Каждый URL отдаётся с языковыми
// альтернативами (hreflang) — Google рекомендует указывать их именно
// в sitemap, а не только в разметке страницы.
//
// Ограничение формата — 50 000 URL и 50 МБ на файл. Карточки берём порцией
// с запасом; когда объявлений станет больше, здесь появится sitemap-index
// (отмечено в README как TODO).
// ============================================================

import type { MetadataRoute } from 'next';

import { localeHref } from '@/lib/i18n';
import {
  fetchSitemapCars,
  fetchSitemapDealers,
  fetchSiteBrands,
  fetchSiteModels,
} from '@/lib/queries';
import { buildAlternates } from '@/lib/seo';
import { siteBaseUrl } from '@/lib/supabase';

// Пересобираем раз в час: чаще не нужно, поисковики всё равно обходят
// файл реже.
export const revalidate = 3600;

// Языковые альтернативы для одной записи sitemap.
//
// Список берётся из buildAlternates (lib/seo) — той же функции, что
// собирает теги <link rel="alternate"> в <head> страницы. Раньше здесь
// стояла своя копия цикла по LOCALES, и копия успела разойтись с
// оригиналом: в разметке страниц x-default был, а в карте сайта — нет.
//
// Расхождение не безобидное. Google требует, чтобы набор hreflang был
// ОДИНАКОВ во всех местах, где он заявлен: карта сайта и разметка
// страницы, противоречащие друг другу, — повод отбросить связку
// целиком, и тогда русское зеркало снова остаётся без языковой
// привязки. Одна функция на оба места исключает повторение истории.
//
// canonical из результата отбрасывается: в sitemap запись и так стоит
// под своим адресом в <loc>, отдельного поля для канонического адреса
// формат не предусматривает.
function alternates(path: string) {
  // Локаль записи всегда сербская: карта сайта перечисляет URL по
  // сербским адресам, а русские зеркала указываются альтернативами.
  const { languages } = buildAlternates('sr', path);
  return { languages };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // ---------- Статические разделы ----------
  const staticEntries: MetadataRoute.Sitemap = [
    { path: '/', priority: 1.0, changeFrequency: 'daily' as const },
    { path: '/cars', priority: 0.9, changeFrequency: 'hourly' as const },
    { path: '/rent', priority: 0.9, changeFrequency: 'hourly' as const },
    { path: '/sell', priority: 0.8, changeFrequency: 'monthly' as const },
    { path: '/dealers', priority: 0.6, changeFrequency: 'monthly' as const },
    // Контентные страницы. Приоритет средний: трафика они приносят
    // немного, но отвечают на вопросы «что это за площадка» и «можно ли
    // ей доверять» — а это влияет на конверсию подачи объявления.
    // FAQ выше остальных: он ловит длиннохвостые запросы вида
    // «как продать авто в Сербии» и несёт разметку FAQPage.
    { path: '/faq', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/how-it-works', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/about', priority: 0.4, changeFrequency: 'monthly' as const },
    // Юридические документы: приоритет низкий (трафика они не приносят),
    // но в карте нужны — на них ссылается согласие при подаче объявления,
    // и краулер должен видеть, что страницы существуют.
    { path: '/terms', priority: 0.2, changeFrequency: 'yearly' as const },
    { path: '/privacy', priority: 0.2, changeFrequency: 'yearly' as const },
    // Контакты: страница обязательная (на неё ссылаются документы) и
    // при этом полезная для доверия — приоритет чуть выше юридических.
    { path: '/contact', priority: 0.3, changeFrequency: 'yearly' as const },
  ].map((entry) => ({
    url: `${siteBaseUrl}${localeHref('sr', entry.path)}`,
    lastModified: now,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
    alternates: alternates(entry.path),
  }));

  // ---------- Страницы марок и моделей ----------
  // Обе витрины: у продажи и аренды свои наборы марок и свои адреса.
  const [saleBrands, rentBrands] = await Promise.all([
    fetchSiteBrands('sale'),
    fetchSiteBrands('rent'),
  ]);

  // Сборка записей для одной витрины. Вынесена в функцию, чтобы логика
  // обхода марок и моделей не дублировалась для /cars и /rent.
  async function sectionEntries(
    root: '/cars' | '/rent',
    brandList: typeof saleBrands,
    listingType: 'sale' | 'rent',
  ): Promise<MetadataRoute.Sitemap> {
    const brandUrls: MetadataRoute.Sitemap = brandList.map((b) => ({
      url: `${siteBaseUrl}${root}/${b.brand_slug}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
      alternates: alternates(`${root}/${b.brand_slug}`),
    }));

    // Модели запрашиваем параллельно по всем маркам: последовательный
    // обход при полусотне марок занял бы десятки секунд.
    const modelGroups = await Promise.all(
      brandList.map(async (b) => {
        const models = await fetchSiteModels(b.brand, listingType);
        return models.map((m) => ({
          url: `${siteBaseUrl}${root}/${b.brand_slug}/${m.model_slug}`,
          lastModified: now,
          changeFrequency: 'daily' as const,
          priority: 0.7,
          alternates: alternates(`${root}/${b.brand_slug}/${m.model_slug}`),
        }));
      }),
    );

    return [...brandUrls, ...modelGroups.flat()];
  }

  const [saleEntries, rentEntries] = await Promise.all([
    sectionEntries('/cars', saleBrands, 'sale'),
    sectionEntries('/rent', rentBrands, 'rent'),
  ]);

  // ---------- Карточки объявлений ----------
  const cars = await fetchSitemapCars(0, 45000);

  const carEntries: MetadataRoute.Sitemap = cars.map((car) => ({
    // site_url собран самой БД (f_car_site_url) — используем его, чтобы
    // адрес в sitemap совпадал с каноническим до символа.
    url: car.site_url,
    lastModified: new Date(car.updated_at),
    changeFrequency: 'weekly',
    priority: 0.6,
    alternates: alternates(`/car/${car.id}`),
  }));

  // ---------- Витрины салонов ----------
  // Страница салона — целевая посадочная по запросу «<название салона>
  // Beograd» и приводит десятки объявлений, поэтому индексироваться
  // должна. До сих пор краулер добирался до неё только переходом с
  // карточки объявления.
  //
  // Приоритет 0.5 — ниже карточек: витрина ценна как вход, но сам
  // товар лежит на карточках. changeFrequency weekly: состав
  // объявлений салона меняется, но не ежедневно.
  const dealers = await fetchSitemapDealers(1000);

  const dealerEntries: MetadataRoute.Sitemap = dealers.map((dealer) => ({
    url: `${siteBaseUrl}${localeHref('sr', `/dealer/${dealer.user_id}`)}`,
    lastModified: new Date(dealer.updated_at),
    changeFrequency: 'weekly',
    priority: 0.5,
    alternates: alternates(`/dealer/${dealer.user_id}`),
  }));

  // ------------------------------------------------------------
  // Соблюдение лимита формата.
  // ------------------------------------------------------------
  // 50 000 URL на файл — жёсткое ограничение протокола sitemaps.org.
  // Превышение не игнорируется частично: Google отбрасывает файл
  // ЦЕЛИКОМ, то есть сайт разом теряет карту, а не хвост списка.
  //
  // Раньше запас держался только тем, что карточек запрашивалось
  // 45 000 (fetchSitemapCars выше). Но карточки — не единственный
  // источник записей: к ним добавляются статические разделы, страницы
  // марок и моделей ОБЕИХ витрин и витрины салонов, а их вместе уже
  // около тысячи и число растёт с каждой новой маркой. Момент, когда
  // сумма перевалит за 50 000, наступил бы молча — без ошибки сборки
  // и без записи в логах, просто карта перестала бы приниматься.
  //
  // ПОЧЕМУ ОБРЕЗКА, А НЕ SITEMAP-INDEX. Разбиение на несколько файлов
  // (generateSitemaps) меняет адрес карты на /sitemap/0.xml — а
  // /sitemap.xml уже указан в robots.txt и подан в Search Console.
  // Пока объявлений заметно меньше лимита, обрезка — правильный
  // размен: она гарантирует валидный файл сегодня и не ломает
  // существующий адрес. Переход на индекс описан в README как TODO и
  // делается тогда, когда предупреждение ниже появится в логах сборки.
  //
  // ПОРЯДОК СРЕЗА ЗНАЧИМ. Карточки идут последними, поэтому обрезается
  // именно их хвост, а разделы, марки и модели остаются: посадочные
  // страницы важнее отдельного объявления, и терять их нельзя. Внутри
  // карточек порядок задаёт RPC (свежие раньше), так что отсечётся
  // самое старое.
  const SITEMAP_URL_LIMIT = 50000;

  const all = [
    ...staticEntries,
    ...saleEntries,
    ...rentEntries,
    ...dealerEntries,
    ...carEntries,
  ];

  if (all.length > SITEMAP_URL_LIMIT) {
    // Предупреждение в лог сборки — единственный способ узнать, что
    // пора заводить sitemap-index: сама карта останется валидной и
    // никаких других признаков не подаст.
    console.warn(
      `[sitemap] Записей ${all.length}, лимит ${SITEMAP_URL_LIMIT}. ` +
        `Хвост карточек обрезан. Пора переходить на sitemap-index ` +
        `(generateSitemaps).`,
    );
    return all.slice(0, SITEMAP_URL_LIMIT);
  }

  return all;
}
