// ============================================================
// RS AUTO — SEO-страница марки /ru/cars/{brand}, русская версия.
// ============================================================

import type { Metadata } from 'next';

import BrandPageView, { resolveBrand } from '@/components/pages/BrandPageView';
import type { Locale } from '@/lib/i18n';
import { fetchSiteBrands } from '@/lib/queries';
import { countNoun } from '@/lib/plural';
import { buildMetadata } from '@/lib/seo';
import type { SearchParams } from '@/lib/searchParams';
import { hasActiveFilters, parseFilters } from '@/lib/searchParams';

export const revalidate = 300;

const locale: Locale = 'ru';

type Params = { brand: string };

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
      title: 'Марка не найдена',
      robots: { index: false, follow: false },
    };
  }

  return buildMetadata({
    locale,
    path: `/cars/${slug}`,
    title: `${brand.brand} — автомобили на продажу в Сербии`,
    description: `${brand.brand}: ${countNoun(brand.cars_count, 'listing', locale)} о продаже в Сербии. Поиск по модели, году, цене и городу.`,
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function RuBrandPage({
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
