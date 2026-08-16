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
  SimilarCar,
  SiteBrand,
  SiteCity,
  SiteModel,
  SiteStats,
  SortKey,
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
};

export type CatalogResult = {
  cars: CatalogCar[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
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
  // Страховка продуктового правила: сайт показывает только продажу.
  // Объявление, выставленное исключительно в аренду, на сайте не существует.
  if (!car.is_for_sale) return null;

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
): Promise<SimilarCar[]> {
  const { data, error } = await supabase.rpc('get_similar_cars', {
    p_car_id: id,
    p_limit: limit,
  });

  // Блок «похожие» второстепенен: если он не загрузился, карточка обязана
  // открыться. Поэтому ошибку не бросаем, а отдаём пустой список.
  if (error) return [];

  return (data ?? []) as SimilarCar[];
}

// ------------------------------------------------------------
// Справочники для SEO-страниц и фильтров (миграция 0052).
// ------------------------------------------------------------
export async function fetchSiteBrands(): Promise<SiteBrand[]> {
  const { data, error } = await supabase.rpc('get_site_brands');
  if (error) {
    throw new Error(`Ошибка загрузки марок: ${error.message}`);
  }
  return (data ?? []) as SiteBrand[];
}

export async function fetchSiteModels(brand: string): Promise<SiteModel[]> {
  const { data, error } = await supabase.rpc('get_site_models', {
    p_brand: brand,
  });
  if (error) {
    throw new Error(`Ошибка загрузки моделей: ${error.message}`);
  }
  return (data ?? []) as SiteModel[];
}

export async function fetchSiteCities(): Promise<SiteCity[]> {
  const { data, error } = await supabase.rpc('get_site_cities');
  if (error) {
    throw new Error(`Ошибка загрузки городов: ${error.message}`);
  }
  return (data ?? []) as SiteCity[];
}

export async function fetchSiteStats(): Promise<SiteStats> {
  const { data, error } = await supabase.rpc('get_site_stats');
  if (error) {
    throw new Error(`Ошибка загрузки статистики: ${error.message}`);
  }
  const rows = (data ?? []) as SiteStats[];
  return (
    rows[0] ?? { cars_total: 0, brands_total: 0, cities_total: 0, dealers_total: 0 }
  );
}

// ------------------------------------------------------------
// Объявления для sitemap.xml. RPC get_sitemap_cars (миграция 0052).
// ------------------------------------------------------------
export async function fetchSitemapCars(
  offset = 0,
  limit = 5000,
): Promise<{ id: string; site_url: string; updated_at: string }[]> {
  const { data, error } = await supabase.rpc('get_sitemap_cars', {
    p_offset: offset,
    p_limit: limit,
  });

  // Sitemap не должен ронять сборку: при ошибке отдаём статические разделы.
  if (error) return [];

  return (data ?? []) as { id: string; site_url: string; updated_at: string }[];
}
