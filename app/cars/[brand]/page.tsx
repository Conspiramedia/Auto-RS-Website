// ============================================================
// RS AUTO — SEO-страница марки /cars/{brand}, сербская версия. SSR.
// ============================================================
// Целевая страница под запросы вида «BMW Srbija», «polovni BMW». Марка
// приходит слагом из адреса; слаг строится тем же правилом, что и в БД
// (f_slugify, миграция 0052), поэтому ссылки сайта и sitemap совпадают.
//
// Разметка живёт в components/pages/BrandPageView — общая с /ru.
// ============================================================

import type { Metadata } from 'next';

import BrandPageView, { resolveBrand } from '@/components/pages/BrandPageView';
import type { Locale } from '@/lib/i18n';
import { fetchSiteBrands } from '@/lib/queries';
import { buildMetadata } from '@/lib/seo';
import type { SearchParams } from '@/lib/searchParams';
import { hasActiveFilters, parseFilters } from '@/lib/searchParams';

export const revalidate = 300;

const locale: Locale = 'sr';

type Params = { brand: string };

// Страницы марок известны заранее — отдаём их списком для пререндера.
// Марки без активных объявлений сюда не попадают: пустая страница в индексе
// вредит сайту (см. пояснение в миграции 0052).
export async function generateStaticParams() {
  const brands = await fetchSiteBrands();
  return brands.map((b) => ({ brand: b.brand_slug }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const brand = await resolveBrand(slug);

  if (!brand) {
    return {
      title: 'Marka nije pronađena',
      robots: { index: false, follow: false },
    };
  }

  return buildMetadata({
    locale,
    path: `/cars/${slug}`,
    title: `${brand.brand} — automobili na prodaju u Srbiji`,
    description: `${brand.brand}: ${brand.cars_count} oglasa na prodaju u Srbiji. Pretraga po modelu, godištu, ceni i gradu.`,
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { brand: slug } = await params;
  const sp = await searchParams;

  return <BrandPageView locale={locale} slug={slug} searchParams={sp} />;
}
