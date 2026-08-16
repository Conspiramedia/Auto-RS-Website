// ============================================================
// RS AUTO — Содержимое SEO-страницы марки, общее для sr и ru.
// ============================================================

import Link from 'next/link';
import { notFound } from 'next/navigation';

import CatalogView from '@/components/CatalogView';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import {
  fetchCatalog,
  fetchSiteBrands,
  fetchSiteCities,
  fetchSiteModels,
} from '@/lib/queries';
import { buildBreadcrumbJsonLd } from '@/lib/seo';
import type { SearchParams } from '@/lib/searchParams';
import { parseFilters } from '@/lib/searchParams';
import { siteBaseUrl } from '@/lib/supabase';

// Поиск марки по слагу. Возвращает отображаемое название из БД:
// в заголовке нужно «Mercedes-Benz», а не «mercedes-benz» из адреса.
export async function resolveBrand(slug: string) {
  const brands = await fetchSiteBrands();
  return brands.find((b) => b.brand_slug === slug) ?? null;
}

export default async function BrandPageView({
  locale,
  slug,
  searchParams,
}: {
  locale: Locale;
  slug: string;
  searchParams: SearchParams;
}) {
  const t = getT(locale);

  const brand = await resolveBrand(slug);
  // Марки нет среди активных — страницы не существует.
  if (!brand) notFound();

  // Марка задаётся адресом страницы и переопределяет параметр из query:
  // /cars/bmw?brand=audi должен показывать BMW, иначе адрес врёт.
  const filters = { ...parseFilters(searchParams), brand: brand.brand };

  const [result, brands, cities, models] = await Promise.all([
    fetchCatalog(filters),
    fetchSiteBrands(),
    fetchSiteCities(),
    fetchSiteModels(brand.brand),
  ]);

  const breadcrumb = buildBreadcrumbJsonLd([
    { name: t('nav_catalog'), url: `${siteBaseUrl}/cars` },
    { name: brand.brand, url: `${siteBaseUrl}/cars/${slug}` },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <SmartBanner locale={locale} />
      <SiteHeader locale={locale} pathname={`/cars/${slug}`} />

      <main className="mx-auto max-w-6xl px-4 py-6">
        <nav className="mb-4 text-sm text-black/50">
          <Link href={localeHref(locale, '/cars')} className="hover:underline">
            {t('nav_catalog')}
          </Link>
          <span className="mx-1">/</span>
          <span>{brand.brand}</span>
        </nav>

        <CatalogView
          locale={locale}
          title={`${brand.brand} — ${t('catalog_title').toLowerCase()}`}
          filters={filters}
          result={result}
          brands={brands}
          cities={cities}
          basePath={`/cars/${slug}`}
        />

        {/* Перелинковка на страницы моделей: главный источник внутренних
            ссылок для глубоких SEO-страниц. */}
        {models.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold">
              {brand.brand}: {t('filter_model')}
            </h2>
            <div className="flex flex-wrap gap-2">
              {models.map((m) => (
                <Link
                  key={m.model_slug}
                  href={localeHref(locale, `/cars/${slug}/${m.model_slug}`)}
                  className="rounded-control border border-black/15 px-3 py-1.5 text-sm hover:bg-black/[0.03]"
                >
                  {m.model}{' '}
                  <span className="text-black/40">({m.cars_count})</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter locale={locale} brands={brands.slice(0, 12)} />
    </>
  );
}
