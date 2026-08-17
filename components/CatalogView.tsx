// ============================================================
// RS AUTO — Витрина каталога. Server Component.
// ============================================================
// Один компонент обслуживает /cars, /cars/{brand} и /cars/{brand}/{model}:
// у них общий вид и поведение, различаются лишь заголовок, базовый путь и
// предустановленные фильтры. Дублировать эту разметку в трёх страницах
// означало бы чинить любую правку каталога трижды.
// ============================================================

import CarCard from './CarCard';
import InfiniteCarFeed from './InfiniteCarFeed';
import EmptyState from './EmptyState';
import FilterChips from './FilterChips';
import FilterPanel from './FilterPanel';
import Pagination from './Pagination';
import PaginationLinks from './PaginationLinks';
import SortSelect from './SortSelect';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { countNoun } from '@/lib/plural';
import type { CatalogFilters, CatalogResult } from '@/lib/queries';
import { hasActiveFilters } from '@/lib/searchParams';
import type { ListingType, SiteBrand, SiteCity } from '@/lib/types';

type Props = {
  locale: Locale;
  title: string;
  // Текст под заголовком на SEO-страницах (описание марки/модели).
  intro?: string;
  filters: CatalogFilters;
  result: CatalogResult;
  brands: SiteBrand[];
  cities: SiteCity[];
  // Модели выбранной марки для каскадного фильтра. Пусто, когда марка
  // не выбрана.
  models?: { id: string; name: string }[];
  // Базовый путь без префикса локали: '/cars' | '/rent/bmw' | '/cars/bmw/x5'.
  basePath: string;
  // Витрина: определяет, какая цена показывается в карточках и какой
  // раздел считается корневым при сбросе фильтров.
  // 'both' — смешанный фид каталога: цена берётся из самого объявления.
  mode?: ListingType;
  // Тип объявления зафиксирован адресом (SEO-лендинг /rent): сегмент
  // выбора типа в фильтрах скрывается.
  lockedType?: boolean;
  // Бесконечная подгрузка при скролле. Включена ТОЛЬКО в основных
  // витринах (/cars, /rent) и только в дефолтной сортировке.
  // SEO-страницы марок и моделей остаются на обычной пагинации:
  // их задача — стабильная индексируемая выдача, а не «живая лента».
  infinite?: boolean;
};

export default function CatalogView({
  locale,
  title,
  intro,
  filters,
  result,
  brands,
  cities,
  models = [],
  basePath,
  mode = 'sale',
  lockedType = false,
  infinite = false,
}: Props) {
  const t = getT(locale);

  // Витрина для компонентов, которые различают только продажу и аренду
  // (подписи цены в фильтрах, заголовок пустого состояния). Смешанный
  // фид ведёт себя как продажа: цены там в евро за автомобиль.
  const pageMode: Exclude<ListingType, 'both'> =
    mode === 'rent' ? 'rent' : 'sale';

  // Счётчик на кнопке фильтров считает только те фильтры, которые
  // пользователь применил сам. Марка и модель, заданные самим адресом
  // SEO-страницы, в счётчик не входят — их нельзя снять, не уйдя со страницы.
  const rootPath = mode === 'rent' ? '/rent' : '/cars';
  const isBrandPage = basePath !== rootPath;
  const countable: CatalogFilters = isBrandPage
    ? { ...filters, brand: undefined, model: undefined }
    : filters;

  const activeCount = [
    // Тип объявления считается применённым фильтром, только когда он
    // сужает выдачу: 'both' — состояние по умолчанию.
    countable.listingType && countable.listingType !== 'both'
      ? countable.listingType
      : undefined,
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
      {/* rel=prev/next для соседних страниц пагинации. Next поднимает
          эти <link> в <head> сам. */}
      <PaginationLinks
        locale={locale}
        filters={filters}
        basePath={basePath}
        page={result.page}
        totalPages={result.totalPages}
      />

      <h1 className="text-2xl font-bold">{title}</h1>
      {intro && <p className="mt-2 max-w-3xl text-neutral-60">{intro}</p>}

      {/* Панель управления выдачей.
          Десктоп — как было до редизайна: «Фильтры» и счётчик слева,
          сортировка прижата вправо (justify-between), всё в один ряд.
          Мобильный — «Фильтры» + компактный select сортировки в строку,
          счётчик уходит ниже отдельной строкой. */}
      {/* flex-wrap только на мобильном (по умолчанию), на десктопе
          sm:flex-nowrap: иначе широкий блок сортировки не помещается
          рядом с фильтрами и переносится на вторую строку, наезжая
          на счётчик — ровно то, что было видно на скриншоте. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none sm:gap-3">
          {/* action ОБЯЗАН нести префикс локали: форма фильтров уходит
              методом GET, и голый basePath уводил пользователя с
              /ru/cars на сербское зеркало — язык сбрасывался ровно по
              кнопке «Показать результаты». */}
          <FilterPanel
            locale={locale}
            filters={filters}
            brands={brands}
            cities={cities}
            models={models}
            action={localeHref(locale, basePath)}
            activeCount={activeCount}
            mode={pageMode}
            lockedType={lockedType}
          />
          <span className="hidden shrink-0 text-sm text-neutral-50 sm:inline">
            {t('catalog_found')}: {countNoun(result.total, 'listing', locale)}
          </span>
        </div>

        <SortSelect locale={locale} filters={filters} basePath={basePath} />
      </div>

      {/* Счётчик результатов на мобильном — отдельной строкой. */}
      <div className="mt-2 text-sm text-neutral-50 sm:hidden">
        {t('catalog_found')}: {result.total}
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
            mode={pageMode}
          />
        </div>
      ) : (
        <>
          {infinite ? (
            // Бесконечная лента: первая порция уже отрисована сервером
            // (важно для SEO), клиент продолжает её при скролле.
            // Паттерн перенесён из App Baza — см. шапку InfiniteCarFeed.
            <InfiniteCarFeed
              locale={locale}
              initialCars={result.cars}
              filters={filters}
              mode={mode}
              initialSeed={result.seed}
              total={result.total}
            />
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {result.cars.map((car, i) => (
                <CarCard
                  key={car.id}
                  locale={locale}
                  car={car}
                  mode={mode}
                  // Первые четыре карточки — над сгибом, грузим приоритетно.
                  priority={i < 4}
                />
              ))}
            </div>
          )}

          {/* Пагинация-ссылки остаются ВСЕГДА, даже при включённой
              бесконечной ленте. Причина сугубо поисковая: краулер не
              выполняет скролл, и без этих ссылок объявления со второй
              страницы и глубже лишились бы входящих внутренних ссылок.
              Человеку с работающим скриптом они не мешают — это запасной
              путь внизу страницы. */}
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
