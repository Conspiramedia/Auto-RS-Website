// ============================================================
// RS AUTO — SEO-страница модели в аренде /rent/{brand}/{model}. SSR.
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

// Пары «марка + модель», доступные именно в аренде.
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
      title: 'Model nije pronađen',
      robots: { index: false, follow: false },
    };
  }

  const name = `${pair.brand.brand} ${pair.model.model}`;

  return buildMetadata({
    locale,
    path: `/rent/${brandSlug}/${modelSlug}`,
    title: `${name} rent-a-car — iznajmljivanje po danu`,
    description: `${name} za izdavanje: ${countNoun(pair.model.cars_count, 'listing', locale)}. Cena po danu, depozit, preuzimanje u gradu.`,
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function RentModelPage({
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
