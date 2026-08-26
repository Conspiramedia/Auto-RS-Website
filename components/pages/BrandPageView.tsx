// ============================================================
// RS AUTO — Содержимое SEO-страницы марки, общее для sr и ru.
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

// Поиск марки по слагу. Возвращает отображаемое название из БД:
// в заголовке нужно «Mercedes-Benz», а не «mercedes-benz» из адреса.
export async function resolveBrand(slug: string, mode: 'sale' | 'rent' = 'sale') {
  const brands = await fetchSiteBrands(mode);
  return brands.find((b) => b.brand_slug === slug) ?? null;
}

export default async function BrandPageView({
  locale,
  slug,
  searchParams,
  mode = 'sale',
}: {
  locale: Locale;
  slug: string;
  searchParams: SearchParams;
  mode?: 'sale' | 'rent';
}) {
  const t = getT(locale);
  const root = mode === 'rent' ? '/rent' : '/cars';

  const brand = await resolveBrand(slug, mode);
  // Марки нет среди активных объявлений этой витрины — страницы не
  // существует. Марка может продаваться, но не сдаваться: тогда
  // /cars/bmw открывается, а /rent/bmw отдаёт 404. Это верно —
  // иначе в индекс попала бы страница с пустой выдачей.
  if (!brand) notFound();

  // Марка и витрина задаются адресом страницы и переопределяют query:
  // /cars/bmw?brand=audi должен показывать BMW, иначе адрес врёт.
  const filters = {
    ...parseFilters(searchParams),
    brand: brand.brand,
    listingType: mode,
  };

  const [result, brands, cities, models, allModels] = await Promise.all([
    fetchCatalog(filters),
    fetchSiteBrands(mode),
    fetchSiteCities(mode),
    // models — для блока перелинковки: только модели с объявлениями
    // (страницы без контента создавать нельзя).
    fetchSiteModels(brand.brand, mode),
    // allModels — для выпадающего фильтра: полный справочник марки,
    // как в приложении.
    fetchCatalogModels(brand.brand),
  ]);

  // Хлебные крошки для поиска. Адреса собираются через localeHref —
  // разметка обязана указывать на ТО ЖЕ зеркало, что видимые ссылки
  // ниже: на /ru/cars/bmw крошка в JSON-LD ведёт на /ru/cars, а не на
  // сербский /cars. Требование Google — соответствие разметки тому,
  // что видит посетитель. Канонический адрес страницы остаётся
  // сербским, но задаётся он через alternates (lib/seo), а не здесь.
  const breadcrumb = buildBreadcrumbJsonLd([
    // Цепочка начинается с главной: Google считает полной ту, что
    // ведёт от корня сайта. Ссылка на главную в интерфейсе есть —
    // это логотип в шапке, поэтому требование «разметка повторяет
    // видимую навигацию» соблюдено.
    { name: t('nav_home'), url: `${siteBaseUrl}${localeHref(locale, '/')}` },
    {
      name: mode === 'rent' ? t('rent_title') : t('nav_catalog'),
      url: `${siteBaseUrl}${localeHref(locale, root)}`,
    },
    {
      name: brand.brand,
      url: `${siteBaseUrl}${localeHref(locale, `${root}/${slug}`)}`,
    },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      {/* Адрес с фильтрами — для переключателя языка (см. подробный
          комментарий в CatalogPageView). Марка и тип сделки заданы
          САМИМ МАРШРУТОМ и в query не переносятся: /ru/cars/bmw уже
          несёт их в пути, а дубль в параметрах раздвоил бы адрес. */}
      <SiteHeader
        locale={locale}
        pathname={`${root}/${slug}${buildQuery(filters, {
          listingType: undefined,
          brand: undefined,
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
          <span>{brand.brand}</span>
        </nav>

        <CatalogView
          locale={locale}
          title={`${brand.brand} — ${(mode === 'rent' ? t('rent_title') : t('catalog_title')).toLowerCase()}`}
          filters={filters}
          result={result}
          brands={brands}
          cities={cities}
          models={allModels}
          basePath={`${root}/${slug}`}
          mode={mode}
          // Тип задан адресом SEO-страницы — сегмент скрыт.
          lockedType
        />

        {/* Перелинковка на страницы моделей: главный источник внутренних
            ссылок для глубоких SEO-страниц. */}
        {models.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-h3 font-semibold">
              {brand.brand}: {t('filter_model')}
            </h2>
            <div className="flex flex-wrap gap-2">
              {models.map((m) => (
                <Link
                  key={m.model_slug}
                  href={localeHref(locale, `${root}/${slug}/${m.model_slug}`)}
                  className="rounded-control border border-neutral-15 px-3 py-1.5 text-caption hover:bg-surface-hover"
                >
                  {m.model}{' '}
                  <span className="text-neutral-40">({m.cars_count})</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter locale={locale} brands={brands.slice(0, 12)} mode={mode} />
    </>
  );
}
