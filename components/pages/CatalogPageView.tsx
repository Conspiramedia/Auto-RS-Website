// ============================================================
// RS AUTO — Содержимое страницы каталога /cars, общее для sr и ru.
// ============================================================

import CatalogView from '@/components/CatalogView';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import {
  fetchCatalog,
  fetchCatalogModels,
  fetchSiteBrands,
  fetchSiteCities,
} from '@/lib/queries';
import type { SearchParams } from '@/lib/searchParams';
import { parseFilters } from '@/lib/searchParams';

export default async function CatalogPageView({
  locale,
  searchParams,
  // Витрина: один компонент обслуживает и /cars, и /rent.
  mode = 'sale',
}: {
  locale: Locale;
  searchParams: SearchParams;
  mode?: 'sale' | 'rent';
}) {
  const t = getT(locale);
  const basePath = mode === 'rent' ? '/rent' : '/cars';

  // Тип витрины задаётся страницей, а не пользователем: он определяется
  // адресом раздела и не может прийти из query-параметров.
  const filters = { ...parseFilters(searchParams), listingType: mode };

  // Три независимых запроса — параллельно: последовательные утроили бы
  // время ответа страницы.
  const [result, brands, cities, models] = await Promise.all([
    fetchCatalog(filters),
    fetchSiteBrands(mode),
    fetchSiteCities(mode),
    // Модели грузим только когда марка выбрана: иначе список пуст и
    // лишний запрос к БД не нужен.
    filters.brand ? fetchCatalogModels(filters.brand) : Promise.resolve([]),
  ]);

  return (
    <>
      <SmartBanner locale={locale} />
      <SiteHeader locale={locale} pathname={basePath} mode={mode} />

      <main className="mx-auto max-w-6xl px-4 py-6">
        <CatalogView
          locale={locale}
          title={mode === 'rent' ? t('rent_title') : t('catalog_title')}
          filters={filters}
          result={result}
          brands={brands}
          cities={cities}
          models={models}
          basePath={basePath}
          mode={mode}
        />
      </main>

      {/* Ссылки в подвале ведут в тот же раздел, в котором находится
          пользователь: из аренды — на арендные страницы марок. */}
      <SiteFooter locale={locale} brands={brands.slice(0, 12)} mode={mode} />
    </>
  );
}
