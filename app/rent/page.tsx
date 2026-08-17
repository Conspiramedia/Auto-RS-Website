// ============================================================
// RS AUTO — Каталог аренды /rent, сербская версия. SSR.
// ============================================================
// Отдельный раздел, а не фильтр над /cars: у аренды свои SEO-страницы,
// своя структура запросов («rent a car Beograd») и свой canonical.
// Разметка общая с продажей — components/pages/CatalogPageView.
// ============================================================

import type { Metadata } from 'next';

import CatalogPageView from '@/components/pages/CatalogPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';
import type { SearchParams } from '@/lib/searchParams';
import { hasActiveFilters, parseFilters } from '@/lib/searchParams';

export const revalidate = 120;

const locale: Locale = 'sr';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/rent',
    title: t('rent_title'),
    description:
      'Rent-a-car u Srbiji: iznajmljivanje automobila po danu. Cene, depozit i uslovi — pretraga po marki i gradu.',
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function RentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return <CatalogPageView locale={locale} searchParams={sp} mode="rent" />;
}
