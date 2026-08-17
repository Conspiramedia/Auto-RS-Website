// ============================================================
// RS AUTO — SEO-страница модели /cars/{brand}/{model}, сербская. SSR.
// ============================================================
// Самая конверсионная группа запросов: «BMW X5 Beograd», «polovni Golf 7».
//
// Разметка живёт в components/pages/ModelPageView — общая с /ru.
// ============================================================

import type { Metadata } from 'next';

import ModelPageView, { resolvePair } from '@/components/pages/ModelPageView';
import type { Locale } from '@/lib/i18n';
import { fetchSiteBrands, fetchSiteModels } from '@/lib/queries';
import { countNoun } from '@/lib/plural';
import { buildMetadata } from '@/lib/seo';
import type { SearchParams } from '@/lib/searchParams';
import { hasActiveFilters, parseFilters } from '@/lib/searchParams';

export const revalidate = 300;

const locale: Locale = 'sr';

type Params = { brand: string; model: string };

// Пары «марка + модель» с активными объявлениями. Пререндер строим только
// по ним: комбинаций из справочника были бы тысячи, и почти все — пустые.
export async function generateStaticParams() {
  const brands = await fetchSiteBrands();

  const groups = await Promise.all(
    brands.map(async (b) => {
      const models = await fetchSiteModels(b.brand);
      return models.map((m) => ({ brand: b.brand_slug, model: m.model_slug }));
    }),
  );

  return groups.flat();
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { brand: brandSlug, model: modelSlug } = await params;
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const pair = await resolvePair(brandSlug, modelSlug);

  if (!pair) {
    return {
      title: 'Model nije pronađen',
      robots: { index: false, follow: false },
    };
  }

  const name = `${pair.brand.brand} ${pair.model.model}`;

  return buildMetadata({
    locale,
    path: `/cars/${brandSlug}/${modelSlug}`,
    title: `${name} — polovni automobili u Srbiji`,
    description: `${name}: ${countNoun(pair.model.cars_count, 'listing', locale)} na prodaju. Cene, godišta i kilometraža — pretraga po gradu.`,
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function ModelPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { brand: brandSlug, model: modelSlug } = await params;
  const sp = await searchParams;

  return (
    <ModelPageView
      locale={locale}
      brandSlug={brandSlug}
      modelSlug={modelSlug}
      searchParams={sp}
    />
  );
}
