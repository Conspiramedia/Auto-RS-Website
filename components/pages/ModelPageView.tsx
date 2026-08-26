// ============================================================
// RS AUTO — Содержимое SEO-страницы модели, общее для sr и ru.
// ============================================================

import Link from 'next/link';
import { notFound } from 'next/navigation';

import CatalogView from '@/components/CatalogView';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import {
  fetchCatalog,
  fetchCatalogModels,
  fetchSiteBrands,
  fetchSiteCities,
  fetchSiteModels,
} from '@/lib/queries';
import { buildBreadcrumbJsonLd } from '@/lib/seo';
import type { SearchParams } from '@/lib/searchParams';
import { buildQuery, parseFilters } from '@/lib/searchParams';
import { siteBaseUrl } from '@/lib/supabase';

// Разбор пары слагов в реальные названия из БД.
export async function resolvePair(
  brandSlug: string,
  modelSlug: string,
  mode: 'sale' | 'rent' = 'sale',
) {
  const brands = await fetchSiteBrands(mode);
  const brand = brands.find((b) => b.brand_slug === brandSlug);
  if (!brand) return null;

  const models = await fetchSiteModels(brand.brand, mode);
  const model = models.find((m) => m.model_slug === modelSlug);
  if (!model) return null;

  return { brand, model };
}

export default async function ModelPageView({
  locale,
  brandSlug,
  modelSlug,
  searchParams,
  mode = 'sale',
}: {
  locale: Locale;
  brandSlug: string;
  modelSlug: string;
  searchParams: SearchParams;
  mode?: 'sale' | 'rent';
}) {
  const t = getT(locale);
  const root = mode === 'rent' ? '/rent' : '/cars';

  const pair = await resolvePair(brandSlug, modelSlug, mode);
  if (!pair) notFound();

  const { brand, model } = pair;

  // Марка, модель и витрина заданы адресом и перекрывают значения из query.
  const filters = {
    ...parseFilters(searchParams),
    brand: brand.brand,
    model: model.model,
    listingType: mode,
  };

  const [result, brands, cities, allModels] = await Promise.all([
    fetchCatalog(filters),
    fetchSiteBrands(mode),
    fetchSiteCities(mode),
    // Полный справочник моделей марки — для выпадающего фильтра.
    fetchCatalogModels(brand.brand),
  ]);

  const name = `${brand.brand} ${model.model}`;

  // Адреса крошек — через localeHref: разметка обязана указывать на то
  // же зеркало, что видимые ссылки ниже (подробнее — в BrandPageView).
  const breadcrumb = buildBreadcrumbJsonLd([
    // Корень цепочки — главная (см. пояснение в BrandPageView).
    { name: t('nav_home'), url: `${siteBaseUrl}${localeHref(locale, '/')}` },
    {
      name: mode === 'rent' ? t('rent_title') : t('nav_catalog'),
      url: `${siteBaseUrl}${localeHref(locale, root)}`,
    },
    {
      name: brand.brand,
      url: `${siteBaseUrl}${localeHref(locale, `${root}/${brandSlug}`)}`,
    },
    {
      name: model.model,
      url: `${siteBaseUrl}${localeHref(
        locale,
        `${root}/${brandSlug}/${modelSlug}`,
      )}`,
    },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      {/* Адрес с фильтрами — для переключателя языка (см. подробный
          комментарий в CatalogPageView). Марка, модель и тип сделки
          заданы САМИМ МАРШРУТОМ и в query не переносятся. */}
      <SiteHeader
        locale={locale}
        pathname={`${root}/${brandSlug}/${modelSlug}${buildQuery(filters, {
          listingType: undefined,
          brand: undefined,
          model: undefined,
        })}`}
      />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {/* Крошки — именованная навигация: на странице есть ещё
            <nav> шапки и подвала, и без имени они неразличимы. */}
        <nav
          className="mb-4 text-caption text-neutral-50"
          aria-label={t('nav_aria_breadcrumbs')}
        >
          <Link href={localeHref(locale, root)} className="hover:underline">
            {mode === 'rent' ? t('rent_title') : t('nav_catalog')}
          </Link>
          <span className="mx-1">/</span>
          <Link
            href={localeHref(locale, `${root}/${brandSlug}`)}
            className="hover:underline"
          >
            {brand.brand}
          </Link>
          <span className="mx-1">/</span>
          <span>{model.model}</span>
        </nav>

        <CatalogView
          locale={locale}
          title={`${name} — ${(mode === 'rent' ? t('rent_title') : t('catalog_title')).toLowerCase()}`}
          filters={filters}
          result={result}
          brands={brands}
          cities={cities}
          models={allModels}
          basePath={`${root}/${brandSlug}/${modelSlug}`}
          mode={mode}
          // Тип задан адресом SEO-страницы — сегмент скрыт.
          lockedType
        />
      </main>

      <SiteFooter locale={locale} brands={brands.slice(0, 12)} mode={mode} />
    </>
  );
}
