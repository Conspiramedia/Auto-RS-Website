// ============================================================
// RS AUTO — Форматирование значений для отображения.
// ============================================================
// Числа и даты форматируются по локали сайта. Единый модуль нужен, чтобы
// цена в каталоге, на карточке и в OG-картинке выглядела одинаково.
// ============================================================

import { BODY_TYPES, FUELS, TRANSMISSIONS } from './types';
import type { Locale } from './i18n';
import { dict } from './i18n';

// Соответствие локали сайта и локали Intl.
// sr-Latn-RS даёт сербское форматирование чисел (разделитель разрядов —
// точка, десятичный — запятая), ru-RU — привычное русскому пользователю.
const INTL_LOCALE: Record<Locale, string> = {
  sr: 'sr-Latn-RS',
  ru: 'ru-RU',
};

// Цена. null означает «Договорная» — это не ноль и не отсутствие данных,
// а сознательный выбор продавца, поэтому подписываем словами.
export function formatPrice(
  value: number | null,
  currency: string,
  locale: Locale,
): string {
  if (value === null || value === undefined) {
    return dict[locale].car_price_negotiable;
  }

  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency: currency || 'EUR',
    // Цены на авто целые: копейки в объявлении только зашумляют.
    maximumFractionDigits: 0,
  }).format(value);
}

// Цена аренды за сутки: «45 € / dan». Единица измерения обязательна —
// без неё суточная ставка читается как полная цена автомобиля.
export function formatRentPrice(
  value: number | null,
  currency: string,
  locale: Locale,
): string {
  if (value === null || value === undefined) {
    return dict[locale].car_price_negotiable;
  }
  return `${formatPrice(value, currency, locale)} / ${dict[locale].rent_per_day}`;
}

// Залог. Ноль — это не «не указано», а осмысленное «без залога»:
// для арендатора это важное преимущество, поэтому пишем словами.
export function formatDeposit(
  value: number | null,
  currency: string,
  locale: Locale,
): string {
  if (value === null || value === undefined || value === 0) {
    return dict[locale].rent_deposit_none;
  }
  return formatPrice(value, currency, locale);
}

// Пробег. null — продавец не указал, показываем прочерк вместо «0 км»,
// который читался бы как «новая машина».
export function formatMileage(value: number | null, locale: Locale): string {
  if (value === null || value === undefined) return '—';
  const num = new Intl.NumberFormat(INTL_LOCALE[locale]).format(value);
  return `${num} ${dict[locale].common_km}`;
}

// Год выпуска. Через Intl.NumberFormat НЕ проходит и разрядами не
// группируется: «2019», а не «2 019» (ru) и не «2.019» (sr). Год — метка
// на шкале, а не количество.
//
// Функция существует ради этого правила: без неё год выводится голой
// интерполяцией, и первый же, кто пропустит его через общий числовой
// форматтер, получит «2 019», не заметив ошибки.
export function formatYear(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return String(value);
}

// Дата публикации в читаемом виде.
export function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

// Подписи enum'ов БД. Неизвестное значение возвращаем как есть:
// в БД могли добавить новый тип кузова, и лучше показать сырое значение,
// чем пустое место.
export function labelBodyType(value: string | null, locale: Locale): string {
  if (!value) return '—';
  return BODY_TYPES[value]?.[locale] ?? value;
}

export function labelTransmission(value: string | null, locale: Locale): string {
  if (!value) return '—';
  return TRANSMISSIONS[value]?.[locale] ?? value;
}

export function labelFuel(value: string | null, locale: Locale): string {
  if (!value) return '—';
  return FUELS[value]?.[locale] ?? value;
}

// Заголовок объявления: «BMW X5, 2019».
// Используется в <title>, OG и на карточке — везде одинаково.
export function carTitle(car: {
  brand: string;
  model: string;
  year: number;
}): string {
  return `${car.brand} ${car.model}, ${car.year}`;
}

// ------------------------------------------------------------
// Слаг для URL. ДОЛЖЕН совпадать с f_slugify в миграции 0052:
// расхождение сломает ссылки между сайтом и sitemap.
// Порядок операций тот же: нормализация → замена разделителей → обрезка.
// ------------------------------------------------------------
export function slugify(text: string): string {
  // ̀-ͯ — диапазон комбинирующих диакритических знаков, которые
  // появляются после normalize('NFD'). Записан escape-последовательностями
  // намеренно: сами эти символы невидимы в редакторе и легко теряются при
  // копировании файла.
  return text
    .normalize('NFD')
    // Снимаем диакритику (Č Š Ž → C S Z) — так же, как unaccent в Postgres.
    .replace(/[̀-ͯ]/g, '')
    // Đ/đ не раскладываются через NFD, поэтому обрабатываются отдельно.
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
