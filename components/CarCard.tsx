// ============================================================
// RS AUTO — Карточка объявления в списке. Server Component.
// ============================================================
// Используется в каталоге, на SEO-страницах, на главной и в блоке
// «похожие» — один вид карточки во всех списках.
// ============================================================

import Image from 'next/image';

import {
  formatMileage,
  formatPrice,
  formatRentPrice,
  formatYear,
} from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import type { ListingType } from '@/lib/types';
import Badge from './ui/Badge';
import Card from './ui/Card';
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
    // 'private' | 'dealer'. Необязательное: карточка показывается и
    // там, где тип продавца не читается (например, в блоке «недавно
    // просмотренные»), и пометка там просто не рисуется.
    seller_kind?: string;
    // Машины нет в наличии, салон привезёт под заказ (0118).
    // Необязательное по той же причине, что seller_kind выше.
    is_on_order?: boolean;
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
    // Card padding="none": содержимое карточки само управляет отступами —
    // фотография идёт во всю ширину, текстовый блок под ней со своим p-3.
    // hoverable даёт тень при наведении — ровно то, что раньше было
    // выписано в этой строке хардкодом.
    <Card
      padding="none"
      hoverable
      className="group block"
      href={localeHref(locale, `/car/${car.id}`)}
    >
      <div className="relative aspect-[4/3] bg-surface-muted">
        {car.photo_url ? (
          <Image
            src={car.photo_url}
            alt={`${car.brand} ${car.model}, ${car.year}`}
            fill
            // Размеры соответствуют сетке карточек (2/3/4 колонки на
            // 360/768/1280): без них Next отдал бы изображение под всю
            // ширину экрана на всех брейкпоинтах и мобильный трафик
            // вырос бы в разы. Границы совпадают с md/xl сетки —
            // разъехавшись, они дали бы размытое фото либо лишние
            // килобайты.
            sizes="(max-width: 767px) 50vw, (max-width: 1279px) 33vw, 25vw"
            className="object-cover"
            priority={priority}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-caption text-neutral-30">
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
            <Badge tone="rent" size="xs">
              {t('badge_rent')}
            </Badge>
          )}

          {/* «Просмотрено» — клиентская метка: история открытых
              объявлений лежит в localStorage, серверу она недоступна.
              Дорисовывается поверх фотографии после гидратации.
              ml-auto прижимает её к правому краю, пока обе метки
              помещаются в строку; при переносе она уходит на вторую
              строку, оставаясь у правого края. */}
          <ViewedBadge locale={locale} carId={car.id} className="ml-auto" />
        </div>

        {/* НИЖНИЙ РЯД: продвижение и «на заказ». Верхний занят метками
            аренды и просмотра, и третью плашку туда не втиснуть — в
            сетке каталога карточка на 360px выходит 156px.

            Общий контейнер, а не два абсолютных слоя: у объявления
            салона может быть и продвижение, и пометка «на заказ»
            одновременно, а абсолютные элементы вне потока разойтись
            сами не могут и налезли бы друг на друга — та же ошибка,
            что уже была в верхнем ряду.

            «На заказ» справа: это свойство предложения, а продвижение
            — купленное место, и смешивать их в одну кучу слева не
            стоит. justify-between разводит их по углам, а когда плашка
            одна, ml-auto у второй прижимает её к своему краю. */}
        {(car.is_promoted || car.is_on_order) && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-end gap-1.5">
            {car.is_promoted && (
              <Badge tone="promoted" size="xs">
                {t('car_promoted')}
              </Badge>
            )}

            {car.is_on_order && (
              <Badge tone="info-soft" size="xs" className="ml-auto">
                {t('badge_on_order')}
              </Badge>
            )}
          </div>
        )}
      </div>

      <div className="p-3">
        <div className="truncate font-semibold">
          {car.brand} {car.model}
        </div>

        <div className="mt-1 text-h4 font-bold text-brand-primary">
          {showRent
            ? formatRentPrice(car.rent_price_daily ?? null, car.currency, locale)
            : formatPrice(car.sale_price, car.currency, locale)}
        </div>

        {/* Вторая цена. Объявление, доступное и к продаже, и к аренде,
            показывает обе: сверху основная сделка, ниже — вторая с её
            собственной ценой. Просто слово «Аренда» без суммы заставляло
            бы открывать карточку, чтобы узнать ставку. */}
        {car.is_for_sale && car.is_for_rent && car.rent_price_daily != null && (
          <div className="mt-0.5 text-caption font-medium text-brand-blue">
            {showRent
              ? formatPrice(car.sale_price, car.currency, locale)
              : formatRentPrice(car.rent_price_daily, car.currency, locale)}
          </div>
        )}

        {/* В специализированном разделе — короткая пометка о второй
            витрине без цены: она уже показана выше. */}
        {mode === 'sale' && car.is_for_rent && car.rent_price_daily == null && (
          <div className="mt-0.5 text-caption font-medium text-brand-blue">
            {t('mode_rent')}
          </div>
        )}

        <div className="mt-1 text-caption text-neutral-60">
          {formatYear(car.year)} · {formatMileage(car.mileage, locale)}
        </div>

        {/* ГОРОД И ТИП ПРОДАВЦА — В ОДНОЙ СТРОКЕ.
            ------------------------------------------------------------
            «Автосалон» — свойство ПРОДАВЦА, а не объявления, и поверх
            фотографии ему не место: верхний ряд там занят «Арендой» и
            «Просмотрено», и третья плашка в него не помещается — в
            сетке каталога (grid-cols-2 уже на мобильном) карточка на
            360px выходит 156px, ряд бейджей 140px, а три плашки
            требуют 205px. Уменьшать шрифт бесполезно: три плашки
            закроют собой саму фотографию.

            Пометка НЕ ДОБАВЛЯЕТ КАРТОЧКЕ ВЫСОТЫ — она встаёт в уже
            существующую строку города, а не отдельной строкой. Высота
            карточки не меняется, и сетка каталога остаётся ровной.

            Город получает min-w-0 + truncate и отдаёт место пометке:
            без min-w-0 flex-элемент не сжимается ниже своего
            содержимого и вытолкнул бы пометку за край. Пометке
            shrink-0 — она короткая и обрезаться не должна.

            Показывается только у салона: у частника подпись «Частное
            лицо» ничего не сообщает — это состояние по умолчанию, и
            строка бы просто шумела в каждой карточке. */}
        <div className="mt-0.5 flex items-baseline gap-2 text-caption text-neutral-50">
          <span className="min-w-0 truncate">{car.city}</span>
          {car.seller_kind === 'dealer' && (
            <span className="shrink-0 text-small font-medium text-neutral-60">
              {t('car_seller_dealer')}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
