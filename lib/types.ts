// ============================================================
// RS AUTO — Типы данных сайта.
// ============================================================
// Типы повторяют RETURNS TABLE соответствующих RPC в Supabase.
// При изменении сигнатуры функции в миграции — правится и здесь.
//
// ВАЖНО: сайт работает только с продажей (is_for_sale). Поля аренды
// (rent_price_daily, deposit_amount) намеренно не включены в типы —
// аренда выключена продуктовым решением, и её отсутствие должно быть
// видно на уровне компиляции, а не только в рантайме.
// ============================================================

// Режим витрины. Значение уходит в p_listing_type RPC search_cars_public
// (миграция 0055) — набор строк обязан совпадать с миграцией.
// 'both' используется общим поиском; отдельной страницы у него нет.
export type ListingType = 'sale' | 'rent' | 'both';

// Строка каталога. Источник: RPC search_cars_public (миграции 0051, 0055).
export type CatalogCar = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  body_type: string | null;
  transmission: string | null;
  fuel: string | null;
  currency: string;
  // null означает «Договорная» — цена не указана продавцом.
  sale_price: number | null;
  // Суточная ставка аренды. Для объявлений только на продажу — null.
  rent_price_daily: number | null;
  // Залог. Осмыслен только для аренды; в продаже всегда 0.
  deposit_amount: number | null;
  // Одно объявление может быть и продажей, и арендой одновременно.
  is_for_sale: boolean;
  is_for_rent: boolean;
  city: string;
  status: string;
  // Действующее продвижение (is_vip + не истёкший boosted_until).
  is_promoted: boolean;
  site_url: string;
  photo_url: string | null;
  seller_kind: string;
  created_at: string;
  // Общее число объявлений по текущим фильтрам (одинаково во всех строках).
  total_count: number;
};

// Карточка объявления. Источник: RPC get_car_details (миграция 0048).
export type CarDetails = {
  id: string;
  user_id: string;
  is_for_sale: boolean;
  is_for_rent: boolean;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  body_type: string | null;
  transmission: string | null;
  fuel: string | null;
  currency: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  deposit_amount: number | null;
  city: string;
  description: string | null;
  contact_phone: string | null;
  rating_avg: number | null;
  reviews_count: number | null;
  // 'active' | 'sold' для публичного доступа; прочие статусы видит только владелец/админ.
  status: string;
  is_vip: boolean;
  boosted_until: string | null;
  is_promoted: boolean;
  site_url: string;
  seller_kind: string;
  seller_name: string;
  seller_logo_url: string | null;
  seller_avatar_url: string | null;
  seller_since: string;
  created_at: string;
  updated_at: string;
};

// Фотография объявления. Источник: RPC get_car_images (миграция 0052).
export type CarImage = {
  id: string;
  image_url: string;
  order_index: number;
};

// Похожее объявление. Источник: RPC get_similar_cars (миграции 0051, 0055).
export type SimilarCar = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  currency: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  is_for_sale: boolean;
  is_for_rent: boolean;
  city: string;
  site_url: string;
  photo_url: string | null;
};

// Марка со счётчиком. Источник: RPC get_site_brands (миграция 0052).
export type SiteBrand = {
  brand: string;
  brand_slug: string;
  cars_count: number;
};

// Модель со счётчиком. Источник: RPC get_site_models (миграция 0052).
export type SiteModel = {
  brand: string;
  brand_slug: string;
  model: string;
  model_slug: string;
  cars_count: number;
};

// Город со счётчиком. Источник: RPC get_site_cities (миграция 0052).
export type SiteCity = {
  city: string;
  city_slug: string;
  cars_count: number;
};

// Счётчики главной. Источник: RPC get_site_stats (миграции 0052, 0055).
export type SiteStats = {
  // Объявления о продаже.
  cars_total: number;
  // Объявления об аренде.
  rent_total: number;
  brands_total: number;
  cities_total: number;
  dealers_total: number;
};

// ------------------------------------------------------------
// Справочники значений enum'ов БД.
// ------------------------------------------------------------
// Ключ — значение enum в PostgreSQL (менять нельзя, оно уходит в RPC),
// значение — подписи для двух локалей сайта.
// Списки повторяют миграцию 0001_extensions_and_enums.sql приложения.

export const BODY_TYPES: Record<string, { sr: string; ru: string }> = {
  sedan: { sr: 'Limuzina', ru: 'Седан' },
  hatchback: { sr: 'Hečbek', ru: 'Хэтчбек' },
  suv: { sr: 'Džip / SUV', ru: 'Внедорожник' },
  coupe: { sr: 'Kupe', ru: 'Купе' },
  wagon: { sr: 'Karavan', ru: 'Универсал' },
  minivan: { sr: 'Monovolumen', ru: 'Минивэн' },
  pickup: { sr: 'Pikap', ru: 'Пикап' },
  cabrio: { sr: 'Kabriolet', ru: 'Кабриолет' },
};

export const TRANSMISSIONS: Record<string, { sr: string; ru: string }> = {
  manual: { sr: 'Manuelni', ru: 'Механика' },
  automatic: { sr: 'Automatik', ru: 'Автомат' },
  robot: { sr: 'Automatizovani', ru: 'Робот' },
  variator: { sr: 'CVT', ru: 'Вариатор' },
};

export const FUELS: Record<string, { sr: string; ru: string }> = {
  petrol: { sr: 'Benzin', ru: 'Бензин' },
  diesel: { sr: 'Dizel', ru: 'Дизель' },
  hybrid: { sr: 'Hibrid', ru: 'Гибрид' },
  electric: { sr: 'Električni', ru: 'Электро' },
  gas: { sr: 'Gas (TNG)', ru: 'Газ' },
};

// Варианты сортировки каталога. Значение key уходит в p_sort RPC
// search_cars_public — набор строк обязан совпадать с миграцией 0051.
export const SORT_OPTIONS = [
  { key: 'fresh', sr: 'Najnovije', ru: 'Сначала новые' },
  { key: 'price_asc', sr: 'Cena: rastuće', ru: 'Цена: по возрастанию' },
  { key: 'price_desc', sr: 'Cena: opadajuće', ru: 'Цена: по убыванию' },
  { key: 'year_desc', sr: 'Godište: novije', ru: 'Год: новее' },
  { key: 'year_asc', sr: 'Godište: starije', ru: 'Год: старше' },
  { key: 'mileage_asc', sr: 'Kilometraža: manja', ru: 'Пробег: меньше' },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]['key'];

// Проверка значения сортировки из URL. Мусорный ?sort= не должен
// приводить к ошибке — каталог обязан отдать контент краулеру.
export function isSortKey(value: string | undefined): value is SortKey {
  return SORT_OPTIONS.some((o) => o.key === value);
}
