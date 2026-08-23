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
import ViewedBadge from './ViewedBadge';

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
  // Витрина, в которой показана карточка.
  //   'sale' | 'rent' — специализированный раздел: показываем цену
  //     соответствующей сделки;
  //   'both' — смешанный фид каталога: цена выбирается по САМОМУ
  //     объявлению, потому что рядом стоят и продажа, и аренда.
  mode?: ListingType;
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

  // Какую цену считать главной.
  //   * в разделе аренды — всегда суточную ставку;
  //   * в смешанном фиде — ту, что соответствует объявлению: у машины,
  //     которая только сдаётся, суточную. Объявление, доступное и к
  //     продаже, и к аренде, показывает цену продажи основной, а ставку
  //     аренды — второй строкой.
  const rentOnly = car.is_for_rent === true && car.is_for_sale !== true;
  const showRent =
    car.rent_price_daily != null &&
    (mode === 'rent' || (mode === 'both' && rentOnly));

  return (
    <Link
      href={localeHref(locale, `/car/${car.id}`)}
      className="group block overflow-hidden rounded-card border border-neutral-10 transition-shadow hover:shadow-card"
    >
      <div className="relative aspect-[4/3] bg-surface-muted">
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
          <div className="flex h-full items-center justify-center text-sm text-neutral-30">
            {car.brand}
          </div>
        )}

        {/* ВЕРХНИЙ РЯД БЕЙДЖЕЙ — общий контейнер, а не два независимых
            абсолютных слоя.
            Раньше «Аренда» (right-2 top-2) и «Просмотрено» (left-2
            top-2) позиционировались порознь и друг о друге не знали.
            На узкой карточке (360px: фото ~328px) сумма их ширин
            превышала ширину фотографии, и бейджи налезали один на
            другой — «Аренда» отрисовывалась позже и срезала
            «Просмотрено» до «Просмотрен». Абсолютные элементы вне
            потока разойтись сами не могут, поэтому лечится это только
            общим рядом: flex расставляет их и переносит вторую метку
            вниз, когда места не хватает.
            items-start обязателен — иначе растянутые по высоте плашки
            выглядели бы разной толщины при переносе. */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start gap-1.5">
          {/* Бейдж аренды в смешанном фиде: рядом стоят продажа и
              аренда, и различить их только по «€ / dan» в строке цены
              трудно — цвет и слово читаются с первого взгляда. В самом
              разделе аренды бейдж не нужен: там все объявления одного
              типа.
              Стоит ПЕРВЫМ в ряду, хотя визуально был справа: это
              свойство самого объявления, тогда как «Просмотрено» —
              личная метка конкретного посетителя. При таком порядке
              позиция бейджа аренды не зависит от того, открывал ли
              человек карточку, и не прыгает после гидратации. */}
          {mode === 'both' && car.is_for_rent && (
            <span className="rounded-control bg-brand-blue px-1.5 py-0.5 text-micro font-semibold text-white">
              {t('badge_rent')}
            </span>
          )}

          {/* «Просмотрено» — клиентская метка: история открытых
              объявлений лежит в localStorage, серверу она недоступна.
              Дорисовывается поверх фотографии после гидратации.
              ml-auto прижимает её к правому краю, пока обе метки
              помещаются в строку; при переносе она уходит на вторую
              строку, оставаясь у правого края. */}
          <ViewedBadge locale={locale} carId={car.id} className="ml-auto" />
        </div>

        {/* Продвижение — левый НИЖНИЙ угол: верхний ряд занят метками
            аренды и просмотра. Так же разведены бейджи в приложении. */}
        {car.is_promoted && (
          <span className="absolute bottom-2 left-2 rounded-control bg-brand-gold px-1.5 py-0.5 text-micro font-semibold text-white">
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

        {/* Вторая цена. Объявление, доступное и к продаже, и к аренде,
            показывает обе: сверху основная сделка, ниже — вторая с её
            собственной ценой. Просто слово «Аренда» без суммы заставляло
            бы открывать карточку, чтобы узнать ставку. */}
        {car.is_for_sale && car.is_for_rent && car.rent_price_daily != null && (
          <div className="mt-0.5 text-sm font-medium text-brand-blue">
            {showRent
              ? formatPrice(car.sale_price, car.currency, locale)
              : formatRentPrice(car.rent_price_daily, car.currency, locale)}
          </div>
        )}

        {/* В специализированном разделе — короткая пометка о второй
            витрине без цены: она уже показана выше. */}
        {mode === 'sale' && car.is_for_rent && car.rent_price_daily == null && (
          <div className="mt-0.5 text-xs font-medium text-brand-blue">
            {t('mode_rent')}
          </div>
        )}

        <div className="mt-1 text-sm text-neutral-60">
          {car.year} · {formatMileage(car.mileage, locale)}
        </div>

        <div className="mt-0.5 truncate text-sm text-neutral-50">{car.city}</div>
      </div>
    </Link>
  );
}
