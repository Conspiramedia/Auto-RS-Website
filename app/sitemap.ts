// ============================================================
// RS AUTO — sitemap.xml. Генерируется на сервере.
// ============================================================
// Состав: статические разделы + страницы марок и моделей + карточки всех
// активных объявлений на продажу. Каждый URL отдаётся с языковыми
// альтернативами (hreflang) — Google рекомендует указывать их именно
// в sitemap, а не только в разметке страницы.
//
// Ограничение формата — 50 000 URL и 50 МБ на файл. Карточки берём порцией
// с запасом; когда объявлений станет больше, здесь появится sitemap-index
// (отмечено в README как TODO).
// ============================================================

import type { MetadataRoute } from 'next';

import { HTML_LANG, LOCALES, localeHref } from '@/lib/i18n';
import {
  fetchSitemapCars,
  fetchSiteBrands,
  fetchSiteModels,
} from '@/lib/queries';
import { siteBaseUrl } from '@/lib/supabase';

// Пересобираем раз в час: чаще не нужно, поисковики всё равно обходят
// файл реже.
export const revalidate = 3600;

// Языковые альтернативы для одной записи sitemap.
function alternates(path: string) {
  const languages: Record<string, string> = {};
  for (const code of LOCALES) {
    languages[HTML_LANG[code]] = `${siteBaseUrl}${localeHref(code, path)}`;
  }
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
    { path: '/app', priority: 0.5, changeFrequency: 'monthly' as const },
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

  return [...staticEntries, ...saleEntries, ...rentEntries, ...carEntries];
}
