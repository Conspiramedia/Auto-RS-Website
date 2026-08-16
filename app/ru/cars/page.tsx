// ============================================================
// RS AUTO — Каталог /ru/cars, русская версия.
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
    path: '/cars',
    title: t('catalog_title'),
    description:
      'Автомобили на продажу в Сербии: поиск по марке, модели, городу и цене.',
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function RuCarsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return <CatalogPageView locale={locale} searchParams={sp} />;
}
