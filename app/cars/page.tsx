// ============================================================
// RS AUTO — Каталог /cars, сербская версия.
// ============================================================
// Разметка живёт в components/pages/CatalogPageView — она общая с /ru/cars.
// ============================================================

import type { Metadata } from 'next';

import CatalogPageView from '@/components/pages/CatalogPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';
import type { SearchParams } from '@/lib/searchParams';
import { hasActiveFilters, parseFilters } from '@/lib/searchParams';

// Каталог обновляется чаще карточки: новые объявления должны появляться
// без ожидания следующей сборки.
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
    path: '/cars',
    title: t('catalog_title'),
    description:
      'Automobili na prodaju u Srbiji: pretraga po marki, modelu, gradu i ceni.',
    // Отфильтрованные выдачи и страницы пагинации в индекс не отдаём:
    // это тысячи почти одинаковых URL, размывающих вес каталога.
    // Ссылки при этом остаются проходимыми (follow) — краулер дойдёт
    // до карточек объявлений.
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function CarsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return <CatalogPageView locale={locale} searchParams={sp} />;
}
