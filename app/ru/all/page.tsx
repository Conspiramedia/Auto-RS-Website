// ============================================================
// RS AUTO — Смешанная витрина /all, русская версия. SSR.
// ============================================================
// Русское зеркало /all. Разбор раздела — в комментарии app/all/page.tsx.
// ============================================================

import type { Metadata } from 'next';

import CatalogPageView from '@/components/pages/CatalogPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';
import type { SearchParams } from '@/lib/searchParams';

export const revalidate = 120;

const locale: Locale = 'ru';

export function generateMetadata(): Metadata {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/all',
    title: t('catalog_mixed_title'),
    description: t('meta_all_desc'),
    // noindex БЕЗУСЛОВНЫЙ, а не по признаку применённых фильтров, как
    // на /cars и /rent: сама витрина — дубль двух лендингов, и в индекс
    // не должна попадать ни с фильтрами, ни без них. Ссылки при этом
    // остаются проходимыми (follow) — краулер дойдёт до карточек.
    noindex: true,
  });
}

export default async function RuAllPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return <CatalogPageView locale={locale} searchParams={sp} section="all" />;
}
