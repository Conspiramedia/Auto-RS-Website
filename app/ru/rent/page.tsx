// ============================================================
// RS AUTO — Каталог аренды /ru/rent, русская версия.
// ============================================================

import type { Metadata } from 'next';

import CatalogPageView from '@/components/pages/CatalogPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';
import type { SearchParams } from '@/lib/searchParams';
import { hasActiveFilters, parseFilters } from '@/lib/searchParams';

export const revalidate = 120;

const locale: Locale = 'ru';

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
      'Аренда автомобилей в Сербии посуточно. Цены, залог и условия — поиск по марке и городу.',
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function RuRentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return <CatalogPageView locale={locale} searchParams={sp} section="rent" />;
}
