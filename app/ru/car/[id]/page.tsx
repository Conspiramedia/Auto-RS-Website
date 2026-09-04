// ============================================================
// RS AUTO — Карточка объявления /ru/car/{id}, русская версия. SSR.
// ============================================================
// Canonical — self-canonical: страница канонизирует сама себя
// (/ru/car/{id}), сербская версия — себя. Связь версий даёт hreflang;
// подробности и история правки — в шапке lib/seo.ts.
//
// Разметка живёт в components/pages/CarPageView — она общая с /car/{id}.
// ============================================================

import type { Metadata } from 'next';

import CarPageView from '@/components/pages/CarPageView';
import {
  carTitle,
  formatMileage,
  formatPrice,
  labelFuel,
  labelTransmission,
} from '@/lib/format';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { fetchCarDetails } from '@/lib/queries';
import {
  buildCarFallbackDescription,
  prefixDescriptionWithCondition,
  buildMetadata,
  truncateDescription,
} from '@/lib/seo';

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

  // Объявления нет — см. комментарий в сербской версии: canonical и
  // hreflang нужны и здесь, robots остаётся прежним.
  if (!car) {
    return buildMetadata({
      locale,
      path: `/car/${id}`,
      title: 'Объявление не найдено',
      description: getT(locale)('nf_text'),
      noindex: true,
      nofollow: true,
    });
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
    return buildMetadata({
      locale,
      path: `/car/${id}`,
      title: `${car.brand} ${car.model}, ${car.year} — Объявление недоступно`,
      description: getT(locale)('nf_text'),
      // follow остаётся — см. комментарий выше.
      noindex: true,
    });
  }

  const title = `${carTitle(car)} — ${formatPrice(car.sale_price, car.currency, locale)}`;
  // Описание режется по границе слова и укладывается в 160 символов —
  // столько показывает Google. Раньше здесь стоял slice(0, 200), и
  // текст продавца обрывался посреди слова.
  // Описание продавца короче 70 символов для сниппета бесполезно: в нём
  // нет ни года, ни пробега, ни города — того, по чему объявление
  // находят. Такое описание заменяется собранным из характеристик, а не
  // дополняется (см. buildCarFallbackDescription).
  const ownDescription = car.description
    ? truncateDescription(car.description)
    : '';

  // СОСТОЯНИЕ В НАЧАЛЕ ОПИСАНИЯ (0138). Применяется и к описанию
  // продавца, и к собранному запасному: пометка обязана быть в
  // сниппете независимо от того, откуда взялся текст.
  //
  // Доступность («в пути», «под заказ») в описание НЕ идёт — см.
  // prefixDescriptionWithCondition.
  const conditionSeoLabel =
    car.condition && car.condition !== 'normal'
      ? getT(locale)(`condition_seo_${car.condition}` as DictKey)
      : null;

  const baseDescription =
    ownDescription.length >= 70
      ? ownDescription
      : buildCarFallbackDescription({
          title: carTitle(car),
          city: car.city,
          mileage: formatMileage(car.mileage, locale),
          fuel: labelFuel(car.fuel, locale),
          transmission: labelTransmission(car.transmission, locale),
          price: formatPrice(car.sale_price, car.currency, locale),
          tail: getT(locale)('car_meta_fallback_tail'),
          extra: getT(locale)('car_meta_fallback_extra'),
        });

  const description = prefixDescriptionWithCondition(
    baseDescription,
    conditionSeoLabel,
  );

  return buildMetadata({
    locale,
    path: `/car/${id}`,
    title,
    description,
    // Карточка — товар: og:type product и product:price:* (см.
    // комментарий в сербской версии).
    ogType: 'product',
    ...(car.sale_price != null
      ? { price: { amount: car.sale_price, currency: car.currency } }
      : {}),
    // Своя динамическая OG-картинка (см. соседний opengraph-image).
    ownOgImage: true,
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
