// ============================================================
// RS AUTO — Содержимое SEO-страницы модели, общее для sr и ru.
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

// Разбор пары слагов в реальные названия из БД.
export async function resolvePair(brandSlug: string, modelSlug: string) {
  const brands = await fetchSiteBrands();
  const brand = brands.find((b) => b.brand_slug === brandSlug);
  if (!brand) return null;

  const models = await fetchSiteModels(brand.brand);
  const model = models.find((m) => m.model_slug === modelSlug);
  if (!model) return null;

  return { brand, model };
}

export default async function ModelPageView({
  locale,
  brandSlug,
  modelSlug,
  searchParams,
}: {
  locale: Locale;
  brandSlug: string;
  modelSlug: string;
  searchParams: SearchParams;
}) {
  const t = getT(locale);

  const pair = await resolvePair(brandSlug, modelSlug);
  if (!pair) notFound();

  const { brand, model } = pair;

  // Марка и модель заданы адресом и перекрывают значения из query.
  const filters = {
    ...parseFilters(searchParams),
    brand: brand.brand,
    model: model.model,
  };

  const [result, brands, cities] = await Promise.all([
    fetchCatalog(filters),
    fetchSiteBrands(),
    fetchSiteCities(),
  ]);

  const name = `${brand.brand} ${model.model}`;

  const breadcrumb = buildBreadcrumbJsonLd([
    { name: t('nav_catalog'), url: `${siteBaseUrl}/cars` },
    { name: brand.brand, url: `${siteBaseUrl}/cars/${brandSlug}` },
    { name: model.model, url: `${siteBaseUrl}/cars/${brandSlug}/${modelSlug}` },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <SmartBanner locale={locale} />
      <SiteHeader locale={locale} pathname={`/cars/${brandSlug}/${modelSlug}`} />

      <main className="mx-auto max-w-6xl px-4 py-6">
        <nav className="mb-4 text-sm text-black/50">
          <Link href={localeHref(locale, '/cars')} className="hover:underline">
            {t('nav_catalog')}
          </Link>
          <span className="mx-1">/</span>
          <Link
            href={localeHref(locale, `/cars/${brandSlug}`)}
            className="hover:underline"
          >
            {brand.brand}
          </Link>
          <span className="mx-1">/</span>
          <span>{model.model}</span>
        </nav>

        <CatalogView
          locale={locale}
          title={`${name} — ${t('catalog_title').toLowerCase()}`}
          filters={filters}
          result={result}
          brands={brands}
          cities={cities}
          basePath={`/cars/${brandSlug}/${modelSlug}`}
        />
      </main>

      <SiteFooter locale={locale} brands={brands.slice(0, 12)} />
    </>
  );
}
