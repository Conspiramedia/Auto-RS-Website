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
    { path: '/sell', priority: 0.8, changeFrequency: 'monthly' as const },
    { path: '/dealers', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/app', priority: 0.5, changeFrequency: 'monthly' as const },
  ].map((entry) => ({
    url: `${siteBaseUrl}${localeHref('sr', entry.path)}`,
    lastModified: now,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
    alternates: alternates(entry.path),
  }));

  // ---------- Страницы марок и моделей ----------
  const brands = await fetchSiteBrands();

  const brandEntries: MetadataRoute.Sitemap = brands.map((b) => ({
    url: `${siteBaseUrl}/cars/${b.brand_slug}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.8,
    alternates: alternates(`/cars/${b.brand_slug}`),
  }));

  // Модели запрашиваем параллельно по всем маркам: последовательный обход
  // при полусотне марок занял бы десятки секунд.
  const modelGroups = await Promise.all(
    brands.map(async (b) => {
      const models = await fetchSiteModels(b.brand);
      return models.map((m) => ({
        url: `${siteBaseUrl}/cars/${b.brand_slug}/${m.model_slug}`,
        lastModified: now,
        changeFrequency: 'daily' as const,
        priority: 0.7,
        alternates: alternates(`/cars/${b.brand_slug}/${m.model_slug}`),
      }));
    }),
  );

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

  return [
    ...staticEntries,
    ...brandEntries,
    ...modelGroups.flat(),
    ...carEntries,
  ];
}
