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
    // Каталог — смешанный фид (продажа и аренда), заголовок это отражает.
    title: t('catalog_mixed_title'),
    description:
      'Автомобили в Сербии: продажа и аренда. Поиск по марке, модели, городу и цене.',
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
