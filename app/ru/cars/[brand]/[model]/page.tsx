// ============================================================
// RS AUTO — SEO-страница модели /ru/cars/{brand}/{model}, русская версия.
// ============================================================

import type { Metadata } from 'next';

import ModelPageView, { resolvePair } from '@/components/pages/ModelPageView';
import type { Locale } from '@/lib/i18n';
import { fetchSiteBrands, fetchSiteModels } from '@/lib/queries';
import { buildMetadata } from '@/lib/seo';
import type { SearchParams } from '@/lib/searchParams';
import { hasActiveFilters, parseFilters } from '@/lib/searchParams';

export const revalidate = 300;

const locale: Locale = 'ru';

type Params = { brand: string; model: string };

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
      title: 'Модель не найдена',
      robots: { index: false, follow: false },
    };
  }

  const name = `${pair.brand.brand} ${pair.model.model}`;

  return buildMetadata({
    locale,
    path: `/cars/${brandSlug}/${modelSlug}`,
    title: `${name} — подержанные автомобили в Сербии`,
    description: `${name}: ${pair.model.cars_count} объявлений о продаже. Цены, год выпуска и пробег — поиск по городу.`,
    noindex: hasActiveFilters(filters) || (filters.page ?? 1) > 1,
  });
}

export default async function RuModelPage({
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
