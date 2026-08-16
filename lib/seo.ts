// ============================================================
// RS AUTO — Сборка SEO-метаданных.
// ============================================================
// Правило проекта: одно объявление — один canonical-URL. Канонический
// адрес всегда указывает на СЕРБСКУЮ версию (корень сайта), а русская
// версия связана с ней через hreflang. Так вес страницы не размывается
// между двумя языковыми копиями одного объявления.
// ============================================================

import type { Metadata } from 'next';

import { siteBaseUrl } from './supabase';
import type { Locale } from './i18n';
import { HTML_LANG, LOCALES, localeHref } from './i18n';

// Языковые альтернативы страницы для тега <link rel="alternate" hreflang>.
// path — путь БЕЗ префикса локали ('/cars', '/car/{id}').
export function buildAlternates(path: string) {
  const languages: Record<string, string> = {};

  for (const code of LOCALES) {
    languages[HTML_LANG[code]] = `${siteBaseUrl}${localeHref(code, path)}`;
  }

  // x-default указывает версию для пользователей, чей язык не совпал ни с
  // одним из наших: отправляем их на сербскую — это основной рынок.
  languages['x-default'] = `${siteBaseUrl}${localeHref('sr', path)}`;

  return {
    // Canonical — всегда сербская версия, независимо от текущей локали.
    canonical: `${siteBaseUrl}${localeHref('sr', path)}`,
    languages,
  };
}

// Базовые метаданные страницы: title, description, canonical, hreflang, OG.
export function buildMetadata(params: {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  // Абсолютный URL изображения для OG-превью. Если не передан —
  // используется динамическая OG-картинка страницы.
  image?: string;
  // Страницы фильтров и пагинации не должны попадать в индекс: они
  // порождают тысячи почти одинаковых URL.
  noindex?: boolean;
}): Metadata {
  const { locale, path, title, description, image, noindex } = params;

  return {
    title,
    description,
    alternates: buildAlternates(path),
    robots: noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title,
      description,
      url: `${siteBaseUrl}${localeHref(locale, path)}`,
      siteName: 'RS Auto',
      locale: locale === 'sr' ? 'sr_RS' : 'ru_RU',
      type: 'website',
      images: image ? [{ url: image, width: 1200, height: 630 }] : undefined,
    },
    twitter: {
      // summary_large_image даёт крупное превью — именно оно продаёт
      // объявление в ленте при репосте.
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

// ------------------------------------------------------------
// JSON-LD для карточки объявления (schema.org/Vehicle + Offer).
// ------------------------------------------------------------
// Разметка описывает автомобиль и предложение о продаже. Именно она даёт
// расширенные сниппеты (цена, пробег, год) в результатах поиска.
export function buildVehicleJsonLd(params: {
  car: {
    id: string;
    brand: string;
    model: string;
    year: number;
    mileage: number | null;
    fuel: string | null;
    transmission: string | null;
    body_type: string | null;
    sale_price: number | null;
    currency: string;
    city: string;
    description: string | null;
    status: string;
  };
  url: string;
  images: string[];
}) {
  const { car, url, images } = params;

  return {
    '@context': 'https://schema.org',
    '@type': 'Vehicle',
    name: `${car.brand} ${car.model}, ${car.year}`,
    brand: { '@type': 'Brand', name: car.brand },
    model: car.model,
    vehicleModelDate: String(car.year),
    productionDate: String(car.year),
    description: car.description ?? undefined,
    image: images.length > 0 ? images : undefined,
    url,
    // Пробег в километрах. Отсутствующее значение не подставляем нулём:
    // ноль означал бы новый автомобиль и вводил бы в заблуждение.
    mileageFromOdometer:
      car.mileage !== null
        ? { '@type': 'QuantitativeValue', value: car.mileage, unitCode: 'KMT' }
        : undefined,
    fuelType: car.fuel ?? undefined,
    vehicleTransmission: car.transmission ?? undefined,
    bodyType: car.body_type ?? undefined,
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: car.currency || 'EUR',
      // Договорная цена (null) в разметке не указывается: выдумывать
      // число нельзя, а price: 0 поисковик прочитает как «бесплатно».
      price: car.sale_price ?? undefined,
      // Проданное объявление остаётся доступным по прямой ссылке, и его
      // статус обязан быть отражён честно.
      availability:
        car.status === 'sold'
          ? 'https://schema.org/SoldOut'
          : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/UsedCondition',
      areaServed: car.city,
    },
  };
}

// ------------------------------------------------------------
// JSON-LD «хлебные крошки» для SEO-страниц каталога.
// ------------------------------------------------------------
export function buildBreadcrumbJsonLd(
  items: { name: string; url: string }[],
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
