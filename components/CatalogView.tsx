// ============================================================
// RS AUTO — Витрина каталога. Server Component.
// ============================================================
// Один компонент обслуживает /cars, /cars/{brand} и /cars/{brand}/{model}:
// у них общий вид и поведение, различаются лишь заголовок, базовый путь и
// предустановленные фильтры. Дублировать эту разметку в трёх страницах
// означало бы чинить любую правку каталога трижды.
// ============================================================

import CarCard from './CarCard';
import EmptyState from './EmptyState';
import FilterChips from './FilterChips';
import FilterPanel from './FilterPanel';
import Pagination from './Pagination';
import SortSelect from './SortSelect';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { CatalogFilters, CatalogResult } from '@/lib/queries';
import { hasActiveFilters } from '@/lib/searchParams';
import type { SiteBrand, SiteCity } from '@/lib/types';

type Props = {
  locale: Locale;
  title: string;
  // Текст под заголовком на SEO-страницах (описание марки/модели).
  intro?: string;
  filters: CatalogFilters;
  result: CatalogResult;
  brands: SiteBrand[];
  cities: SiteCity[];
  // Базовый путь без префикса локали: '/cars' | '/cars/bmw' | '/cars/bmw/x5'.
  basePath: string;
};

export default function CatalogView({
  locale,
  title,
  intro,
  filters,
  result,
  brands,
  cities,
  basePath,
}: Props) {
  const t = getT(locale);

  // Счётчик на кнопке фильтров считает только те фильтры, которые
  // пользователь применил сам. Марка и модель, заданные самим адресом
  // SEO-страницы, в счётчик не входят — их нельзя снять, не уйдя со страницы.
  const isBrandPage = basePath !== '/cars';
  const countable: CatalogFilters = isBrandPage
    ? { ...filters, brand: undefined, model: undefined }
    : filters;

  const activeCount = [
    countable.q,
    countable.brand,
    countable.model,
    countable.city,
    countable.yearFrom,
    countable.yearTo,
    countable.mileageMax,
    countable.priceFrom,
    countable.priceTo,
    countable.bodyType,
    countable.transmission,
    countable.fuel,
  ].filter(Boolean).length;

  return (
    <>
      <h1 className="text-2xl font-bold">{title}</h1>
      {intro && <p className="mt-2 max-w-3xl text-black/60">{intro}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FilterPanel
            locale={locale}
            filters={filters}
            brands={brands}
            cities={cities}
            action={basePath}
            activeCount={activeCount}
          />
          <span className="text-sm text-black/50">
            {t('catalog_found')}: {result.total}
          </span>
        </div>

        <SortSelect locale={locale} filters={filters} basePath={basePath} />
      </div>

      <div className="mt-3">
        <FilterChips locale={locale} filters={countable} basePath={basePath} />
      </div>

      {result.cars.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            locale={locale}
            resetPath={basePath}
            showReset={hasActiveFilters(countable)}
          />
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {result.cars.map((car, i) => (
              <CarCard
                key={car.id}
                locale={locale}
                car={car}
                // Первые четыре карточки — над сгибом, грузим приоритетно.
                priority={i < 4}
              />
            ))}
          </div>

          <Pagination
            locale={locale}
            filters={filters}
            basePath={basePath}
            page={result.page}
            totalPages={result.totalPages}
          />
        </>
      )}
    </>
  );
}
