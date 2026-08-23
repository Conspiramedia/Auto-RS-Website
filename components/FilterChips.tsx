// ============================================================
// RS AUTO — Чипсы применённых фильтров. Server Component.
// ============================================================
// Паттерн из требований проекта: компактная кнопка фильтров со счётчиком
// плюс чипсы применённых значений с крестиком. Чипс показывает, ЧТО именно
// сузило выдачу, и снимается в один клик — без открытия панели фильтров.
//
// Каждый чипс — обычная ссылка на тот же каталог без соответствующего
// параметра. Работает без JS и корректно индексируется.
// ============================================================

import Link from 'next/link';

import { formatMileage, formatPrice } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import type { CatalogFilters } from '@/lib/queries';
import { buildQuery } from '@/lib/searchParams';
import { labelBodyType, labelFuel, labelTransmission } from '@/lib/format';

type Props = {
  locale: Locale;
  filters: CatalogFilters;
  // Базовый путь каталога: '/cars' либо SEO-страница '/cars/bmw'.
  basePath: string;
  // Тип объявления зафиксирован адресом страницы (лендинг /rent) —
  // чипс типа не показывается: снять его значило бы уйти со страницы.
  lockedType?: boolean;
};

export default function FilterChips({
  locale,
  filters,
  basePath,
  lockedType = false,
}: Props) {
  const t = getT(locale);

  // Список активных фильтров с подписью и ссылкой на снятие.
  // Ключ фильтра сбрасывается в undefined, страница — на первую.
  const chips: { key: string; label: string; href: string }[] = [];

  const add = (key: keyof CatalogFilters, label: string) => {
    chips.push({
      key: String(key),
      label,
      href:
        localeHref(locale, basePath) +
        buildQuery(filters, { [key]: undefined, page: 1 } as Partial<CatalogFilters>),
    });
  };

  // Тип объявления — первым, как в форме фильтров и в приложении.
  // 'both' не показываем: это состояние по умолчанию, а не условие отбора.
  if (!lockedType && filters.listingType && filters.listingType !== 'both') {
    add(
      'listingType',
      filters.listingType === 'rent' ? t('mode_rent') : t('mode_sale'),
    );
  }
  if (filters.q) add('q', `"${filters.q}"`);
  if (filters.brand) add('brand', filters.brand);
  if (filters.model) add('model', filters.model);
  if (filters.city) add('city', filters.city);
  if (filters.yearFrom) add('yearFrom', `${t('filter_year')} ${t('filter_from')} ${filters.yearFrom}`);
  if (filters.yearTo) add('yearTo', `${t('filter_year')} ${t('filter_to')} ${filters.yearTo}`);
  if (filters.priceFrom)
    add('priceFrom', `${t('filter_from')} ${formatPrice(filters.priceFrom, 'EUR', locale)}`);
  if (filters.priceTo)
    add('priceTo', `${t('filter_to')} ${formatPrice(filters.priceTo, 'EUR', locale)}`);
  if (filters.mileageMax)
    add('mileageMax', `${t('filter_mileage')} ${formatMileage(filters.mileageMax, locale)}`);
  if (filters.bodyType) add('bodyType', labelBodyType(filters.bodyType, locale));
  if (filters.transmission)
    add('transmission', labelTransmission(filters.transmission, locale));
  if (filters.fuel) add('fuel', labelFuel(filters.fuel, locale));

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          className="inline-flex items-center gap-1.5 rounded-control bg-surface-active px-3 py-1.5 text-caption hover:bg-surface-activeHover"
          // Ссылки-снятия фильтра не должны обходиться краулером: они ведут
          // на такие же отфильтрованные выдачи и только тратят краулинговый
          // бюджет.
          rel="nofollow"
        >
          <span>{chip.label}</span>
          <span className="text-neutral-40">×</span>
        </Link>
      ))}

      {/* Сброс всех фильтров разом — ведёт на чистый каталог. */}
      <Link
        href={localeHref(locale, basePath)}
        className="inline-flex items-center rounded-control px-3 py-1.5 text-caption font-semibold text-brand-red hover:bg-status-error-subtle"
        rel="nofollow"
      >
        {t('catalog_reset')}
      </Link>
    </div>
  );
}
