// ============================================================
// RS AUTO — Карточка объявления в списке. Server Component.
// ============================================================
// Используется в каталоге, на SEO-страницах, на главной и в блоке
// «похожие» — один вид карточки во всех списках.
// ============================================================

import Image from 'next/image';
import Link from 'next/link';

import { formatMileage, formatPrice, formatRentPrice } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import type { ListingType } from '@/lib/types';

type Props = {
  locale: Locale;
  car: {
    id: string;
    brand: string;
    model: string;
    year: number;
    mileage: number | null;
    currency: string;
    sale_price: number | null;
    rent_price_daily?: number | null;
    is_for_sale?: boolean;
    is_for_rent?: boolean;
    city: string;
    photo_url: string | null;
    is_promoted?: boolean;
  };
  // Витрина, в которой показана карточка. Определяет, какая цена главная:
  // в каталоге аренды на первом месте суточная ставка, а не цена продажи.
  mode?: Exclude<ListingType, 'both'>;
  // Первые карточки в выдаче грузятся с приоритетом: изображение над
  // сгибом влияет на LCP, а он входит в Core Web Vitals.
  priority?: boolean;
};

export default function CarCard({
  locale,
  car,
  mode = 'sale',
  priority = false,
}: Props) {
  const t = getT(locale);

  // Цену аренды показываем, когда карточка в арендной витрине и ставка
  // действительно есть. Иначе — цена продажи.
  const showRent = mode === 'rent' && car.rent_price_daily != null;

  return (
    <Link
      href={localeHref(locale, `/car/${car.id}`)}
      className="group block overflow-hidden rounded-card border border-black/10 transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[4/3] bg-black/5">
        {car.photo_url ? (
          <Image
            src={car.photo_url}
            alt={`${car.brand} ${car.model}, ${car.year}`}
            fill
            // Размеры соответствуют сетке ниже (1/2/3 колонки): без них
            // Next отдал бы изображение под всю ширину экрана на всех
            // брейкпоинтах и мобильный трафик вырос бы в разы.
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
            priority={priority}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-black/30">
            {car.brand}
          </div>
        )}

        {car.is_promoted && (
          <span className="absolute left-2 top-2 rounded-control bg-brand-gold px-2 py-1 text-xs font-semibold text-white">
            {t('car_promoted')}
          </span>
        )}
      </div>

      <div className="p-3">
        <div className="truncate font-semibold">
          {car.brand} {car.model}
        </div>

        <div className="mt-1 text-lg font-bold text-brand-primary">
          {showRent
            ? formatRentPrice(car.rent_price_daily ?? null, car.currency, locale)
            : formatPrice(car.sale_price, car.currency, locale)}
        </div>

        {/* Пометка о второй витрине: в каталоге продажи сообщаем, что
            машину можно и арендовать, и наоборот. Это заметно расширяет
            выбор, но не должно спорить с основной ценой — поэтому мелко. */}
        {mode === 'sale' && car.is_for_rent && (
          <div className="mt-0.5 text-xs font-medium text-brand-blue">
            {t('mode_rent')}
          </div>
        )}
        {mode === 'rent' && car.is_for_sale && (
          <div className="mt-0.5 text-xs font-medium text-brand-blue">
            {t('mode_sale')}
          </div>
        )}

        <div className="mt-1 text-sm text-black/60">
          {car.year} · {formatMileage(car.mileage, locale)}
        </div>

        <div className="mt-0.5 truncate text-sm text-black/50">{car.city}</div>
      </div>
    </Link>
  );
}
