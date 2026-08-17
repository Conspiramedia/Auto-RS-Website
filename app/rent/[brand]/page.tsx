// ============================================================
// RS AUTO — SEO-страница марки в аренде /rent/{brand}. SSR.
// ============================================================
// Целевая страница под запросы «rent a car BMW Beograd».
// Пререндер строится только по маркам, у которых есть активные АРЕНДНЫЕ
// объявления: страница марки, которая лишь продаётся, отдаст 404.
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

const locale: Locale = 'sr';

type Params = { brand: string };

export async function generateStaticParams() {
  const brands = await fetchSiteBrands('rent');
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
  const brand = await resolveBrand(slug, 'rent');

  if (!brand) {
    return {
      title: 'Marka nije pronađena',
      robots: { index: false, follow: false },
    };
  }

  return buildMetadata({
    locale,
    path: `/rent/${slug}`,
    title: `${brand.brand} rent-a-car — iznajmljivanje u Srbiji`,
    description: `${brand.brand} za izdavanje: ${countNoun(brand.cars_count, 'listing', locale)}. Cena po danu, depozit i uslovi iznajmljivanja.`,
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function RentBrandPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { brand: slug } = await params;
  const sp = await searchParams;

  return (
    <BrandPageView
      locale={locale}
      slug={slug}
      searchParams={sp}
      mode="rent"
    />
  );
}
