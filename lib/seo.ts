// ============================================================
// RS AUTO — Сборка SEO-метаданных.
// ============================================================
// CANONICAL — SELF-CANONICAL: каждая страница канонизирует САМА СЕБЯ,
// русское зеркало на себя, сербское на себя. Связаны они через hreflang.
//
// РАНЬШЕ БЫЛО ИНАЧЕ, и это оказалось ошибкой. Canonical всех страниц
// указывал на сербскую версию — «чтобы вес не размывался между двумя
// языковыми копиями». Но canonical означает не «главная версия», а
// «эта страница — ДУБЛИКАТ вон той»: получив /ru/terms с canonical на
// /terms, Google выбрасывает русскую страницу из индекса и показывает
// вместо неё сербскую. Русскоязычный посетитель не находил сайт по
// своим запросам вовсе.
//
// К тому же это противоречило hreflang: набор альтернатив заявлял
// /ru/* самостоятельным языковым зеркалом, а canonical тут же называл
// его дублем. Требование Google однозначно — страницы, связанные
// hreflang, обязаны быть self-canonical, иначе вся связка игнорируется.
//
// Языковые версии — НЕ дубликаты: это разный текст для разной
// аудитории. Вес между ними не «размывается», hreflang как раз и
// сообщает поисковику, что это одна страница на двух языках.
//
// x-default остаётся сербским: он отвечает на другой вопрос — куда
// вести того, чей язык не совпал ни с одним из наших.
// ============================================================

import type { Metadata } from 'next';

import { brand } from './brand';
import { siteBaseUrl } from './supabase';
import type { Locale } from './i18n';
import { HTML_LANG, LOCALES, localeHref } from './i18n';

// Языковые альтернативы страницы для тега <link rel="alternate" hreflang>
// и её собственный канонический адрес.
//
// locale — язык ТЕКУЩЕЙ страницы: от него зависит canonical, который
// обязан указывать на неё саму (см. шапку файла).
// path — путь БЕЗ префикса локали ('/cars', '/car/{id}'): префиксы
// расставляет localeHref.
export function buildAlternates(locale: Locale, path: string) {
  const languages: Record<string, string> = {};

  for (const code of LOCALES) {
    languages[HTML_LANG[code]] = `${siteBaseUrl}${localeHref(code, path)}`;
  }

  // x-default указывает версию для пользователей, чей язык не совпал ни с
  // одним из наших: отправляем их на сербскую — это основной рынок.
  languages['x-default'] = `${siteBaseUrl}${localeHref('sr', path)}`;

  return {
    // Self-canonical: страница канонизирует сама себя. Дубликата здесь
    // нет — есть две языковые версии, связанные hreflang выше.
    canonical: `${siteBaseUrl}${localeHref(locale, path)}`,
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
  // У страницы есть СВОЙ файловый роут opengraph-image.tsx (карточка
  // объявления рисует превью с фотографией и ценой). Тогда ключ images
  // не выставляется вовсе — подробнее ниже, у самого ключа.
  ownOgImage?: boolean;
}): Metadata {
  const { locale, path, title, description, image, noindex, ownOgImage } =
    params;

  // Картинка превью. Приоритет: явно переданная → своя динамическая →
  // брендовая корневая.
  //
  // ЗАЧЕМ ЯВНЫЙ FALLBACK. Файловый роут opengraph-image.tsx
  // распространяется только на СВОЙ сегмент маршрута, а не на весь
  // сайт: он есть у корня и у /car/{id}, поэтому og:image имели ровно
  // две страницы. Все остальные — /about, /contact, /dealers, /faq,
  // /sell, юридические и всё русское зеркало целиком, включая саму
  // /ru, — уходили в соцсети без превью: ссылка выглядела в ленте
  // голой строкой.
  //
  // Корневая картинка абсолютным адресом решает это для всех сразу.
  // Локаль в адресе не участвует: изображение брендовое и одинаковое
  // для обоих языков, второй копии под /ru заводить незачем.
  const ogImage = image ?? `${siteBaseUrl}/opengraph-image`;

  return {
    title,
    description,
    alternates: buildAlternates(locale, path),
    robots: noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title,
      description,
      url: `${siteBaseUrl}${localeHref(locale, path)}`,
      siteName: 'RS Auto',
      locale: locale === 'sr' ? 'sr_RS' : 'ru_RU',
      type: 'website',
      // У страницы со СВОИМ файловым роутом ключ images не выставляется
      // вовсе. Записать сюда undefined нельзя: для Next это всё равно
      // означает «автор сам управляет картинками», и тогда роут
      // opengraph-image.tsx перестаёт подставляться автоматически —
      // карточка уходит в соцсети вообще без og:image. Проверено на
      // /car/{id}: с undefined тега не было, без ключа он появляется.
      //
      // Остальные страницы получают картинку явно (ogImage выше):
      // наследовать корневой роут они не могут.
      ...(ownOgImage
        ? {}
        : { images: [{ url: ogImage, width: 1200, height: 630 }] }),
    },
    twitter: {
      // summary_large_image даёт крупное превью — именно оно продаёт
      // объявление в ленте при репосте.
      card: 'summary_large_image',
      title,
      description,
      // Та же причина, что и выше.
      ...(ownOgImage ? {} : { images: [ogImage] }),
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
    rent_price_daily?: number | null;
    is_for_sale?: boolean;
    is_for_rent?: boolean;
    currency: string;
    city: string;
    description: string | null;
    status: string;
  };
  url: string;
  images: string[];
}) {
  const { car, url, images } = params;

  // Объявление, выставленное ТОЛЬКО в аренду, описывается как аренда:
  // цена за сутки в Offer с unitCode DAY. Помечать суточную ставку как
  // цену продажи нельзя — поисковик показал бы «Golf за 35 €».
  const rentOnly = car.is_for_rent === true && car.is_for_sale !== true;

  // Машина, доступная и к продаже, и к аренде, получает ДВА Offer:
  // schema.org это допускает, и каждый описывает свою сделку честно.
  const saleOffer = {
    '@type': 'Offer',
    url,
    priceCurrency: car.currency || 'EUR',
    price: car.sale_price ?? undefined,
    availability:
      car.status === 'sold'
        ? 'https://schema.org/SoldOut'
        : 'https://schema.org/InStock',
    itemCondition: 'https://schema.org/UsedCondition',
    areaServed: car.city,
  };

  const rentOffer = {
    '@type': 'Offer',
    url,
    priceCurrency: car.currency || 'EUR',
    // priceSpecification с unitCode DAY — стандартный способ выразить
    // «за сутки»; голое price здесь означало бы полную стоимость.
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: car.rent_price_daily ?? undefined,
      priceCurrency: car.currency || 'EUR',
      unitCode: 'DAY',
    },
    availability: 'https://schema.org/InStock',
    itemCondition: 'https://schema.org/UsedCondition',
    areaServed: car.city,
  };

  const offers: unknown[] = [];
  if (car.is_for_sale !== false) offers.push(saleOffer);
  if (car.is_for_rent === true) offers.push(rentOffer);

  return {
    '@context': 'https://schema.org',
    // Для чистой аренды тип Car: он точнее описывает предложение проката,
    // тогда как Vehicle — общий родитель. Оба валидны для schema.org.
    '@type': rentOnly ? 'Car' : 'Vehicle',
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
    // Один Offer отдаём объектом, два — массивом: так разметку читают
    // и валидаторы, и поисковые системы.
    // Договорная цена (null) не подставляется: выдумывать число нельзя,
    // а price: 0 поисковик прочитает как «бесплатно».
    offers: offers.length === 1 ? offers[0] : offers,
  };
}

// ------------------------------------------------------------
// JSON-LD Organization — сведения об операторе площадки.
// ------------------------------------------------------------
// Отдаётся на главной и на /about с /contact. Даёт поисковику связать
// сайт с организацией (панель знаний, логотип в выдаче) и служит
// машиночитаемым источником контактов. Реквизиты берутся из lib/legal —
// того же места, что и тексты документов и страница /contact: три копии
// одних и тех же данных разошлись бы при первой же правке.
export function buildOrganizationJsonLd(params: {
  legalName: string;
  email: string;
  phone?: string;
  address?: string;
}) {
  const { legalName, email, phone, address } = params;

  return {
    '@context': 'https://schema.org',
    // AutoDealer был бы неверен: площадка не продаёт автомобили сама.
    '@type': 'Organization',
    name: brand.name,
    legalName,
    url: siteBaseUrl,
    // ЛОГОТИП. Без него Google не показывает знак организации рядом со
    // сниппетом и в панели знаний: поле logo — прямое требование
    // документации по разметке Organization, а не украшение.
    //
    // Берём icon-512.png: 512×512 с запасом перекрывает минимум Google
    // (112×112 по короткой стороне) и это тот же файл, что уже отдаётся
    // как иконка сайта и в manifest, — второй копии знака заводить не
    // нужно, и при смене логотипа правится один файл.
    //
    // Адрес абсолютный: разметку читают со стороннего домена, и
    // относительный путь там не разрешается.
    logo: `${siteBaseUrl}/icon-512.png`,
    // image дублирует logo намеренно: часть агрегаторов и соцсетей
    // читает именно его, а logo игнорирует.
    image: `${siteBaseUrl}/icon-512.png`,
    // Незаполненные поля не подставляем пустыми строками: разметка с
    // пустым адресом хуже разметки без адреса.
    ...(address ? { address } : {}),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email,
      ...(phone ? { telephone: phone } : {}),
      areaServed: 'RS',
      availableLanguage: ['sr', 'ru'],
    },
  };
}

// ------------------------------------------------------------
// JSON-LD WebSite + SearchAction.
// ------------------------------------------------------------
// SearchAction сообщает поисковику адрес внутреннего поиска. При
// достаточной известности сайта Google показывает строку поиска прямо
// в выдаче (sitelinks searchbox).
//
// ВАЖНО: target обязан указывать на РАБОЧИЙ адрес поиска. У нас это
// каталог с параметром q — тот же, что заполняет форма фильтров.
export function buildWebSiteJsonLd(locale: Locale) {
  const base = `${siteBaseUrl}${localeHref(locale, '/cars')}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: brand.name,
    url: siteBaseUrl,
    inLanguage: HTML_LANG[locale],
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${base}?q={search_term_string}`,
      },
      // Имя параметра фиксировано спецификацией schema.org.
      'query-input': 'required name=search_term_string',
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

// ------------------------------------------------------------
// Обрезка мета-описания по границе слова.
// ------------------------------------------------------------
// Google показывает в сниппете около 160 символов, остальное отсекает
// сам. Проблема не в длине как таковой, а в ТОЧКЕ РЕЗА: описание
// объявления писал продавец, и slice(0, 200) рвал его посреди слова —
// «Prodajem Golf 7 u odličnom sta». Обрываем по последнему пробелу и
// ставим многоточие, чтобы обрыв читался как намеренный.
//
// Пробел ищем во второй половине строки: если его там нет (одно очень
// длинное слово), режем жёстко — иначе от описания остался бы огрызок.
export function truncateDescription(text: string, limit = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;

  // Место под многоточие резервируем заранее: иначе итог вылезет за
  // лимит ровно на один символ.
  const cut = clean.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');

  const body = lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut;

  // Знаки препинания на срезе выглядят как опечатка («в отличном,…»).
  return `${body.replace(/[\s,;:.!?-]+$/, '')}…`;
}

// ------------------------------------------------------------
// JSON-LD ItemList — список объявлений на витрине.
// ------------------------------------------------------------
// Даёт Google понять, что страница — не статья, а СПИСОК ТОВАРОВ, и
// открывает карусель результатов в выдаче. Ставится на каталог, витрины
// марок и моделей и в блок похожих на карточке.
//
// Формат — ListItem с позицией и адресом (url), а не вложенный Product:
// вложенная разметка обязана повторять цену и наличие каждой позиции,
// а они уже описаны на самих карточках объявлений. Дублировать их в
// списке значит гарантированно разойтись с источником при первой же
// смене цены.
//
// position нумеруется с единицы и СКВОЗНО по странице выдачи: на второй
// странице каталога отсчёт продолжается, а не начинается заново —
// иначе два разных объявления заявлены под одним номером.
export function buildItemListJsonLd(params: {
  items: { name: string; url: string }[];
  // Номер первой позиции на странице. Для второй страницы каталога с
  // 24 карточками на странице это 25.
  startPosition?: number;
  // Всего объявлений в выдаче, а не только на текущей странице:
  // сообщает поисковику масштаб раздела.
  totalItems?: number;
}) {
  const { items, startPosition = 1, totalItems } = params;

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...(totalItems !== undefined ? { numberOfItems: totalItems } : {}),
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: startPosition + i,
      name: item.name,
      url: item.url,
    })),
  };
}

// ------------------------------------------------------------
// JSON-LD для справочных страниц (AboutPage, ContactPage, CollectionPage).
// ------------------------------------------------------------
// Один хелпер на три типа: разметка у них отличается только значением
// @type, а состав полей одинаков — имя, адрес, описание и связь с
// издателем. Три почти одинаковые функции разошлись бы при первой
// правке набора полей.
//
// publisher связывает страницу с организацией: без него поисковик не
// знает, кто автор содержимого, и не показывает знак издателя рядом со
// сниппетом.
export function buildPageJsonLd(params: {
  type: 'AboutPage' | 'ContactPage' | 'CollectionPage' | 'WebPage';
  locale: Locale;
  path: string;
  name: string;
  description: string;
}) {
  const { type, locale, path, name, description } = params;

  return {
    '@context': 'https://schema.org',
    '@type': type,
    name,
    description,
    url: `${siteBaseUrl}${localeHref(locale, path)}`,
    inLanguage: HTML_LANG[locale],
    isPartOf: {
      '@type': 'WebSite',
      name: brand.name,
      url: siteBaseUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: brand.name,
      url: siteBaseUrl,
    },
  };
}

// ------------------------------------------------------------
// JSON-LD HowTo — пошаговая инструкция.
// ------------------------------------------------------------
// Даёт расширенный сниппет со списком шагов прямо в выдаче. Google
// требует, чтобы шаги в разметке совпадали с видимыми на странице,
// поэтому строится из того же массива сценариев, что рендерит
// HowItWorksPageView, — копии не заводим.
//
// Каждый шаг получает свой url с якорем: так поисковик может сослаться
// на конкретный шаг, а не на страницу целиком.
export function buildHowToJsonLd(params: {
  locale: Locale;
  path: string;
  name: string;
  description: string;
  steps: { name: string; text: string; anchor?: string }[];
}) {
  const { locale, path, name, description, steps } = params;
  const pageUrl = `${siteBaseUrl}${localeHref(locale, path)}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    description,
    inLanguage: HTML_LANG[locale],
    step: steps.map((step, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: step.name,
      text: step.text,
      url: step.anchor ? `${pageUrl}#${step.anchor}` : pageUrl,
    })),
  };
}
