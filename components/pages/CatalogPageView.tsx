// ============================================================
// RS AUTO — Содержимое страницы каталога /cars, общее для sr и ru.
// ============================================================

import CatalogView from '@/components/CatalogView';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { fetchCatalog, fetchSiteBrands, fetchSiteCities } from '@/lib/queries';
import type { SearchParams } from '@/lib/searchParams';
import { parseFilters } from '@/lib/searchParams';

export default async function CatalogPageView({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: SearchParams;
}) {
  const t = getT(locale);
  const filters = parseFilters(searchParams);

  // Три независимых запроса — параллельно: последовательные утроили бы
  // время ответа страницы.
  const [result, brands, cities] = await Promise.all([
    fetchCatalog(filters),
    fetchSiteBrands(),
    fetchSiteCities(),
  ]);

  return (
    <>
      <SmartBanner locale={locale} />
      <SiteHeader locale={locale} pathname="/cars" />

      <main className="mx-auto max-w-6xl px-4 py-6">
        <CatalogView
          locale={locale}
          title={t('catalog_title')}
          filters={filters}
          result={result}
          brands={brands}
          cities={cities}
          basePath="/cars"
        />
      </main>

      <SiteFooter locale={locale} brands={brands.slice(0, 12)} />
    </>
  );
}
