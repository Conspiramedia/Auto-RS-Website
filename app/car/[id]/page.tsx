// ============================================================
// RS AUTO — Карточка объявления /car/{id}, сербская версия. SSR.
// ============================================================
// Путь /car/{id} совпадает с f_car_site_url в БД (миграция 0048), роутом
// приложения и файлом AASA. Менять его нельзя: на нём завязаны deep links.
//
// Разметка живёт в components/pages/CarPageView — она общая с /ru/car/{id}.
// ============================================================

import type { Metadata } from 'next';

import CarPageView from '@/components/pages/CarPageView';
import { carTitle, formatMileage, formatPrice } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { fetchCarDetails } from '@/lib/queries';
import { buildMetadata } from '@/lib/seo';

// Объявления меняются (цена, статус, фото), поэтому страница
// перегенерируется раз в 5 минут вместо статической сборки навсегда.
export const revalidate = 300;

const locale: Locale = 'sr';

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
      title: 'Oglas nije pronađen',
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
    // OG-картинка генерируется динамически соседним роутом opengraph-image.
  });
}

export default async function CarPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  return <CarPageView locale={locale} id={id} />;
}
