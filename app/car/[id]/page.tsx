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
import { buildMetadata, truncateDescription } from '@/lib/seo';

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

  // Снятое с публикации: RPC отдаёт урезанную карточку (миграция 0072),
  // и страница показывает экран «объявление снято». В индексе ей места
  // нет — контента не осталось, — но follow оставляем: ссылки на
  // каталог и похожие должны обходиться, чтобы вес исчезнувшей
  // страницы перетёк на живые.
  // Признак постороннего — пустая витрина продавца: владельцу и
  // админу объявление приходит целиком, и для них это обычная
  // карточка со своими метаданными.
  if (car.status !== 'active' && car.status !== 'sold' && !car.seller_name) {
    return {
      title: `${car.brand} ${car.model}, ${car.year} — Oglas nije dostupan`,
      robots: { index: false, follow: true },
    };
  }

  const title = `${carTitle(car)} — ${formatPrice(car.sale_price, car.currency, locale)}`;
  // Описание режется по границе слова и укладывается в 160 символов —
  // столько показывает Google. Раньше здесь стоял slice(0, 200), и
  // текст продавца обрывался посреди слова.
  const description = car.description
    ? truncateDescription(car.description)
    : `${carTitle(car)}, ${car.city}. ${formatMileage(car.mileage, locale)}.`;

  return buildMetadata({
    locale,
    path: `/car/${id}`,
    title,
    description,
    // OG-картинка генерируется динамически соседним роутом
    // opengraph-image: фотография объявления с ценой. Флаг говорит
    // buildMetadata не подставлять брендовую картинку по умолчанию —
    // иначе она перекрыла бы свою, более ценную для репоста.
    ownOgImage: true,
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
