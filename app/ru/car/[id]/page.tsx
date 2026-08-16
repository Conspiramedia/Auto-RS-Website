// ============================================================
// RS AUTO — Карточка объявления /ru/car/{id}, русская версия. SSR.
// ============================================================
// Canonical указывает на сербскую версию (/car/{id}) — правило проекта
// «одно объявление — один canonical-URL». Связь версий даёт hreflang.
// ============================================================

import type { Metadata } from 'next';

import CarPageView from '@/components/pages/CarPageView';
import { carTitle, formatMileage, formatPrice } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { fetchCarDetails } from '@/lib/queries';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 300;

const locale: Locale = 'ru';

type Params = { id: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const car = await fetchCarDetails(id);

  if (!car) {
    return {
      title: 'Объявление не найдено',
      robots: { index: false, follow: false },
    };
  }

  const title = `${carTitle(car)} — ${formatPrice(car.sale_price, car.currency, locale)}`;
  const description = car.description
    ? car.description.slice(0, 200)
    : `${carTitle(car)}, ${car.city}. ${formatMileage(car.mileage, locale)}.`;

  return buildMetadata({
    locale,
    path: `/car/${id}`,
    title,
    description,
  });
}

export default async function RuCarPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  return <CarPageView locale={locale} id={id} />;
}
