// ============================================================
// RS AUTO — SEO-страница модели в аренде /ru/rent/{brand}/{model}.
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

const locale: Locale = 'ru';

type Params = { brand: string; model: string };

export async function generateStaticParams() {
  const brands = await fetchSiteBrands('rent');

  const groups = await Promise.all(
    brands.map(async (b) => {
      const models = await fetchSiteModels(b.brand, 'rent');
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
  const pair = await resolvePair(brandSlug, modelSlug, 'rent');

  if (!pair) {
    return {
      title: 'Модель не найдена',
      robots: { index: false, follow: false },
    };
  }

  const name = `${pair.brand.brand} ${pair.model.model}`;

  return buildMetadata({
    locale,
    path: `/rent/${brandSlug}/${modelSlug}`,
    title: `${name} в аренду — прокат посуточно`,
    description: `${name} в аренду: ${countNoun(pair.model.cars_count, 'listing', locale)}. Цена за сутки, залог, получение в городе.`,
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function RuRentModelPage({
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
      mode="rent"
    />
  );
}
