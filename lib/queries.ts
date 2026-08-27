// ============================================================
// RS AUTO — Слой доступа к данным. Все вызовы RPC живут здесь.
// ============================================================
// Страницы (app/**) не обращаются к supabase напрямую: любой запрос идёт
// через функции этого файла. Это даёт одну точку для правок при изменении
// сигнатур RPC и не даёт бизнес-логике расползтись по компонентам.
//
// Толстый бэкенд: фильтрация, нормализация текста (двуалфавитность),
// сортировка и подсчёт total_count выполняются в PostgreSQL. Здесь —
// только передача параметров и типизация результата.
// ============================================================

import { supabase } from './supabase';
import type {
  CarDetails,
  CarImage,
  CatalogCar,
  ListingType,
  SimilarCar,
  SiteBrand,
  SiteCity,
  SiteModel,
  SiteStats,
  SortKey,
  DealerProfile,
  SellerListing,
  ShowcaseDealer,
} from './types';

// Набор фильтров каталога. Все поля необязательны: пустой объект —
// это витрина «все объявления».
export type CatalogFilters = {
  q?: string;
  brand?: string;
  model?: string;
  city?: string;
  yearFrom?: number;
  yearTo?: number;
  mileageMax?: number;
  priceFrom?: number;
  priceTo?: number;
  bodyType?: string;
  transmission?: string;
  fuel?: string;
  sort?: SortKey;
  page?: number;
  perPage?: number;
  // Витрина: продажа или аренда. Задаётся не пользователем, а самой
  // страницей (/cars или /rent), поэтому в query-параметры не попадает.
  listingType?: ListingType;
  // ---------- Бесконечная лента (миграция 0059) ----------
  // Соль перемешки одного «круга». Не задан — сервер использует
  // current_date, то есть прежний детерминированный порядок. Именно это
  // нужно SSG-страницам марок/моделей и sitemap: их выдача обязана быть
  // стабильной для краулера.
  seed?: number;
  // Круги 2+: полная перетасовка без блока промо сверху.
  shuffleAll?: boolean;
};

export type CatalogResult = {
  cars: CatalogCar[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  // Соль, которой сервер перемешал ЭТУ выдачу. Возвращается наружу,
  // чтобы бесконечная лента продолжала тот же круг в том же порядке:
  // возьми клиент свой seed, вторая страница пришла бы из другой
  // перетасовки, и часть объявлений задвоилась бы, а часть пропала.
  // null — выдача детерминированная (перемешка по current_date).
  seed: number | null;
};

// ------------------------------------------------------------
// Каталог объявлений. RPC search_cars_public (миграция 0051).
// ------------------------------------------------------------
export async function fetchCatalog(
  filters: CatalogFilters = {},
): Promise<CatalogResult> {
  const page = Math.max(filters.page ?? 1, 1);
  const perPage = Math.min(Math.max(filters.perPage ?? 24, 1), 100);

  const { data, error } = await supabase.rpc('search_cars_public', {
    p_search_query: filters.q ?? null,
    p_brand: filters.brand ?? null,
    p_model: filters.model ?? null,
    p_city: filters.city ?? null,
    p_year_from: filters.yearFrom ?? null,
    p_year_to: filters.yearTo ?? null,
    p_mileage_max: filters.mileageMax ?? null,
    p_price_from: filters.priceFrom ?? null,
    p_price_to: filters.priceTo ?? null,
    p_body_type: filters.bodyType ?? null,
    p_transmission: filters.transmission ?? null,
    p_fuel: filters.fuel ?? null,
    p_sort: filters.sort ?? 'fresh',
    // Postgres принимает смещение, а не номер страницы.
    p_offset: (page - 1) * perPage,
    p_limit: perPage,
    p_listing_type: filters.listingType ?? 'sale',
    // ПАРАМЕТРЫ БЕСКОНЕЧНОЙ ЛЕНТЫ ДОБАВЛЯЮТСЯ ТОЛЬКО КОГДА НУЖНЫ.
    // supabase-js вызывает RPC по ИМЕНАМ параметров, и лишний ключ в
    // объекте — это другая сигнатура: пока миграция 0059 не применена,
    // запрос с p_seed падает с «Could not find the function …».
    // Обычная выдача (SSG марок, sitemap, первый круг) их не передаёт
    // и работает на любой версии функции; лента добавляет их сама и
    // требует применённой 0059.
    ...(filters.seed != null || filters.shuffleAll
      ? {
          p_seed: filters.seed ?? null,
          p_shuffle_all: filters.shuffleAll ?? false,
        }
      : {}),
  });

  if (error) {
    throw new Error(`Ошибка загрузки каталога: ${error.message}`);
  }

  const cars = (data ?? []) as CatalogCar[];
  // total_count дублируется в каждой строке (оконная функция), поэтому
  // берём его из первой. Пустая выдача — ноль результатов.
  const total = cars.length > 0 ? Number(cars[0].total_count) : 0;

  return {
    cars,
    total,
    page,
    perPage,
    totalPages: Math.max(Math.ceil(total / perPage), 1),
    seed: filters.seed ?? null,
  };
}

// ------------------------------------------------------------
// Карточка объявления. RPC get_car_details (миграция 0048).
// ------------------------------------------------------------
// Возвращает null, если объявление не найдено или недоступно публично
// (модерация, отклонённое, архив) — страница отдаст 404.
export async function fetchCarDetails(id: string): Promise<CarDetails | null> {
  const { data, error } = await supabase.rpc('get_car_details', {
    p_car_id: id,
  });

  if (error) {
    throw new Error(`Ошибка загрузки объявления: ${error.message}`);
  }

  const rows = (data ?? []) as CarDetails[];
  if (rows.length === 0) return null;

  const car = rows[0];
  // Объявление должно быть выставлено хотя бы в одну витрину сайта.
  // Такого состояния в БД быть не может (constraint chk_purpose требует
  // is_for_sale or is_for_rent), но проверка защищает от битых данных,
  // если ограничение когда-нибудь ослабят.
  if (!car.is_for_sale && !car.is_for_rent) return null;

  return car;
}

// ------------------------------------------------------------
// Фотографии объявления. RPC get_car_images (миграция 0052).
// ------------------------------------------------------------
export async function fetchCarImages(id: string): Promise<CarImage[]> {
  const { data, error } = await supabase.rpc('get_car_images', {
    p_car_id: id,
  });

  if (error) {
    throw new Error(`Ошибка загрузки фотографий: ${error.message}`);
  }

  return (data ?? []) as CarImage[];
}

// ------------------------------------------------------------
// Похожие объявления. RPC get_similar_cars (миграция 0051).
// ------------------------------------------------------------
export async function fetchSimilarCars(
  id: string,
  limit = 8,
  // 'auto' — режим определяется по самому объявлению на стороне БД:
  // арендному подбираются арендные, остальным — продаваемые.
  listingType: ListingType | 'auto' = 'auto',
): Promise<SimilarCar[]> {
  const { data, error } = await supabase.rpc('get_similar_cars', {
    p_car_id: id,
    p_limit: limit,
    p_listing_type: listingType,
  });

  // Блок «похожие» второстепенен: если он не загрузился, карточка обязана
  // открыться. Поэтому ошибку не бросаем, а отдаём пустой список.
  if (error) return [];

  return (data ?? []) as SimilarCar[];
}

// ------------------------------------------------------------
// Справочники для SEO-страниц и фильтров (миграция 0052).
// ------------------------------------------------------------
// ОШИБКУ ГЛУШИМ, А НЕ БРОСАЕМ — в отличие от каталога и карточки выше.
// Причина в том, ГДЕ эти две функции вызываются: из
// generateStaticParams на страницах марок и моделей, то есть во время
// СБОРКИ. Брошенное отсюда исключение роняет не страницу, а весь
// `next build` целиком — с сообщением «Failed to collect page data»,
// по которому причина не читается.
//
// Так и происходило: сборка без доступа к базе (недоступный Supabase
// во время деплоя, локальный запуск без поднятого стека) падала
// полностью, хотя единственное последствие недоступности справочника —
// что SEO-страницы марок не будут предгенерированы. Они и так
// пересобираются по расписанию (revalidate) и отдаются на лету при
// первом обращении, поэтому пустой список на этапе сборки —
// восстановимая ситуация, а несобравшийся сайт — нет.
//
// Каталог и карточка объявления ошибку по-прежнему бросают: там она
// означает, что человеку нечего показать, и молчаливая пустая витрина
// хуже честной страницы ошибки.
export async function fetchSiteBrands(
  listingType: ListingType = 'sale',
): Promise<SiteBrand[]> {
  const { data, error } = await supabase.rpc('get_site_brands', {
    p_listing_type: listingType,
  });
  if (error) {
    // Пишем в лог сборки: молчаливый пустой список означал бы, что
    // отсутствие SEO-страниц марок осталось незамеченным.
    console.warn(`[queries] Не удалось загрузить марки: ${error.message}`);
    return [];
  }
  return (data ?? []) as SiteBrand[];
}

export async function fetchSiteModels(
  brand: string,
  listingType: ListingType = 'sale',
): Promise<SiteModel[]> {
  const { data, error } = await supabase.rpc('get_site_models', {
    p_brand: brand,
    p_listing_type: listingType,
  });
  if (error) {
    // См. пояснение к fetchSiteBrands: вызывается из
    // generateStaticParams, и исключение здесь роняет сборку.
    console.warn(
      `[queries] Не удалось загрузить модели марки ${brand}: ${error.message}`,
    );
    return [];
  }
  return (data ?? []) as SiteModel[];
}

// ------------------------------------------------------------
// Полный справочник моделей марки. RPC get_car_models (миграция 0029).
// ------------------------------------------------------------
// Та же функция, которую вызывает приложение (fetchModelsByBrand), —
// поэтому списки моделей на сайте и в приложении совпадают.
// В отличие от fetchSiteModels здесь НЕТ фильтра по наличию объявлений:
// это справочник для выпадающего списка, а не источник SEO-страниц.
export async function fetchCatalogModels(
  brand: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.rpc('get_car_models', {
    p_brand_name: brand,
  });

  // Список моделей второстепенен: если он не загрузился, фильтр должен
  // остаться работоспособным без него, а не ронять страницу.
  if (error) return [];

  return (data ?? []) as { id: string; name: string }[];
}

// Города для фильтра. Ошибку глушим по той же причине, что у марок:
// список наполняет ВЫПАДАЮЩИЙ СПИСОК фильтра на страницах, которые
// генерируются при сборке. Без него фильтр по городу останется пустым,
// но каталог продолжит работать — а брошенное исключение уронило бы
// сборку целиком.
export async function fetchSiteCities(
  listingType: ListingType = 'sale',
): Promise<SiteCity[]> {
  const { data, error } = await supabase.rpc('get_site_cities', {
    p_listing_type: listingType,
  });
  if (error) {
    console.warn(`[queries] Не удалось загрузить города: ${error.message}`);
    return [];
  }
  return (data ?? []) as SiteCity[];
}

// Счётчики для главной («N объявлений, M марок»). Запасной вариант с
// нулями уже был предусмотрен ниже на случай пустого ответа — теперь
// он же используется при ошибке.
//
// Нули на главной честнее упавшей сборки: цифры в этом блоке
// иллюстративные, и их отсутствие не мешает ни поиску, ни подаче
// объявления.
export async function fetchSiteStats(): Promise<SiteStats> {
  const { data, error } = await supabase.rpc('get_site_stats');
  if (error) {
    console.warn(`[queries] Не удалось загрузить статистику: ${error.message}`);
  }
  const rows = (error ? [] : (data ?? [])) as SiteStats[];
  return (
    rows[0] ?? {
      cars_total: 0,
      rent_total: 0,
      brands_total: 0,
      cities_total: 0,
      dealers_total: 0,
    }
  );
}

// ------------------------------------------------------------
// Объявления для sitemap.xml. RPC get_sitemap_cars (миграция 0052).
// ------------------------------------------------------------
export async function fetchSitemapCars(
  offset = 0,
  limit = 5000,
  // В карту сайта попадают обе витрины: у аренды те же адреса /car/{id}.
  listingType: ListingType = 'both',
): Promise<
  {
    id: string;
    site_url: string;
    updated_at: string;
    is_for_sale: boolean;
    is_for_rent: boolean;
  }[]
> {
  const { data, error } = await supabase.rpc('get_sitemap_cars', {
    p_offset: offset,
    p_limit: limit,
    p_listing_type: listingType,
  });

  // Sitemap не должен ронять сборку: при ошибке отдаём статические разделы.
  if (error) return [];

  return (data ?? []) as {
    id: string;
    site_url: string;
    updated_at: string;
    is_for_sale: boolean;
    is_for_rent: boolean;
  }[];
}

// ------------------------------------------------------------
// Салоны для sitemap. RPC get_site_dealers (миграция 0072).
// ------------------------------------------------------------
// Только салоны и только с активными объявлениями: витрина без
// объявлений сама уходит в noindex (DealerPageView), и класть её в
// карту означало бы звать краулера на страницу, которая просит себя
// не индексировать. Частные продавцы не включаются — их имя в карте
// сайта было бы лишней публикацией персональных данных.
//
// Ошибку глушим так же, как в fetchSitemapCars: недоступная РПЦ не
// должна ронять сборку карты — лучше карта без витрин, чем её полное
// отсутствие.
export async function fetchSitemapDealers(limit = 1000): Promise<
  {
    user_id: string;
    display_name: string;
    updated_at: string;
    listings: number;
  }[]
> {
  const { data, error } = await supabase.rpc('get_site_dealers', {
    p_limit: limit,
  });

  if (error) return [];

  return (data ?? []) as {
    user_id: string;
    display_name: string;
    updated_at: string;
    listings: number;
  }[];
}

// ------------------------------------------------------------
// Салоны для широкой плитки-витрины. RPC get_showcase_dealers (0095).
// ------------------------------------------------------------
// Плитка салона в ленте каталога. Отдаёт данные салона вместе с
// адресами фотографий его машин — одним запросом, а не вызовом на
// каждый салон.
//
// Ошибку глушим: плитка салона второстепенна рядом с самой выдачей, и
// недоступная RPC не должна ронять каталог. Пустой массив означает
// «плитки нет» — страница просто покажет объявления.
export async function fetchShowcaseDealers(
  limit = 2,
): Promise<ShowcaseDealer[]> {
  const { data, error } = await supabase.rpc('get_showcase_dealers', {
    p_limit: limit,
  });

  if (error) {
    console.warn(`[queries] Не удалось загрузить салоны: ${error.message}`);
    return [];
  }

  return ((data ?? []) as ShowcaseDealer[]).map((dealer) => ({
    ...dealer,
    // Postgres отдаёт text[] массивом, но при пустом результате может
    // прийти null — на клиенте это превратилось бы в падение при
    // .map по превью. Нормализуем здесь, чтобы компонент не проверял.
    preview_photos: dealer.preview_photos ?? [],
  }));
}

// ------------------------------------------------------------
// Публичная карточка продавца. RPC get_dealer_profile (миграция 0043).
// ------------------------------------------------------------
// null — профиля нет: страница отдаст 404. Ошибку RPC не глушим:
// пустая страница дилера вместо ошибки скрыла бы поломку бэкенда.
export async function fetchDealerProfile(
  userId: string,
): Promise<DealerProfile | null> {
  const { data, error } = await supabase.rpc('get_dealer_profile', {
    p_user_id: userId,
  });

  if (error) {
    throw new Error(`Ошибка загрузки профиля продавца: ${error.message}`);
  }

  const rows = (data ?? []) as DealerProfile[];
  return rows[0] ?? null;
}

// ------------------------------------------------------------
// Витрина продавца. RPC get_seller_listings (миграция 0050).
// ------------------------------------------------------------
// status: 'active' — витрина, 'sold' — блок «недавно продано».
// Белый список статусов зашит в самой RPC, поэтому передать
// 'moderation' и увидеть чужие непроверенные объявления нельзя.
export async function fetchSellerListings(
  userId: string,
  status: 'active' | 'sold' = 'active',
  limit = 24,
  offset = 0,
): Promise<SellerListing[]> {
  const { data, error } = await supabase.rpc('get_seller_listings', {
    p_user_id: userId,
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  });

  // Блок «недавно продано» второстепенен: если он не загрузился,
  // витрина обязана открыться. Поэтому ошибку не бросаем.
  if (error) return [];

  return (data ?? []) as SellerListing[];
}
