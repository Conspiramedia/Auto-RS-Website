// ============================================================
// RS AUTO — Разбор и сборка query-параметров каталога.
// ============================================================
// Фильтры живут в URL, а не в состоянии клиента. Это обязательное условие
// для SSR и SEO: страница с фильтрами должна открываться по прямой ссылке,
// отдаваться краулеру целиком и корректно шариться.
//
// Имена параметров короткие и стабильные — они видны пользователю в адресе.
// ============================================================

import type { CatalogFilters } from './queries';
import { isSortKey } from './types';
import type { ListingType } from './types';

// Тип, в котором Next отдаёт query-параметры страницы.
export type SearchParams = Record<string, string | string[] | undefined>;

// Первое значение параметра. Дубли (?brand=BMW&brand=Audi) возможны при
// ручной правке адреса — берём первый и игнорируем остальные.
function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// Число из параметра. Мусор ('abc', отрицательные) отбрасываем: каталог
// обязан открыться даже при испорченном URL, а не отдать ошибку.
function num(value: string | string[] | undefined): number | undefined {
  const raw = one(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

// Тип объявления из URL. Значение 'both' («Все») в адрес не пишется —
// это состояние по умолчанию, и явный параметр создал бы второй URL
// для той же выдачи.
function parseListingType(
  value: string | string[] | undefined,
): ListingType | undefined {
  const raw = one(value);
  if (raw === 'sale' || raw === 'rent' || raw === 'both') return raw;
  return undefined;
}

// Разбор query-параметров в фильтры каталога.
export function parseFilters(sp: SearchParams): CatalogFilters {
  const sort = one(sp.sort);

  return {
    listingType: parseListingType(sp.type),
    q: one(sp.q) || undefined,
    brand: one(sp.brand) || undefined,
    model: one(sp.model) || undefined,
    city: one(sp.city) || undefined,
    yearFrom: num(sp.year_from),
    yearTo: num(sp.year_to),
    mileageMax: num(sp.mileage_max),
    priceFrom: num(sp.price_from),
    priceTo: num(sp.price_to),
    bodyType: one(sp.body) || undefined,
    transmission: one(sp.gearbox) || undefined,
    fuel: one(sp.fuel) || undefined,
    // Неизвестное значение сортировки молча заменяется на дефолтное.
    sort: isSortKey(sort) ? sort : 'fresh',
    page: num(sp.page) || 1,
  };
}

// Обратная сборка: фильтры → строка запроса. Пустые значения не попадают
// в адрес, чтобы один и тот же набор фильтров всегда давал один URL
// (иначе получим дубли страниц для поисковика).
export function buildQuery(
  filters: CatalogFilters,
  overrides: Partial<CatalogFilters> = {},
): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();

  // 'both' — состояние по умолчанию, в адрес не пишется: '/cars' и
  // '/cars?type=both' должны быть одной страницей, а не двумя.
  if (merged.listingType && merged.listingType !== 'both') {
    params.set('type', merged.listingType);
  }
  if (merged.q) params.set('q', merged.q);
  if (merged.brand) params.set('brand', merged.brand);
  if (merged.model) params.set('model', merged.model);
  if (merged.city) params.set('city', merged.city);
  if (merged.yearFrom) params.set('year_from', String(merged.yearFrom));
  if (merged.yearTo) params.set('year_to', String(merged.yearTo));
  if (merged.mileageMax) params.set('mileage_max', String(merged.mileageMax));
  if (merged.priceFrom) params.set('price_from', String(merged.priceFrom));
  if (merged.priceTo) params.set('price_to', String(merged.priceTo));
  if (merged.bodyType) params.set('body', merged.bodyType);
  if (merged.transmission) params.set('gearbox', merged.transmission);
  if (merged.fuel) params.set('fuel', merged.fuel);
  // Сортировка по умолчанию в адрес не пишется: '/cars' и '/cars?sort=fresh'
  // должны быть одной страницей, а не двумя.
  if (merged.sort && merged.sort !== 'fresh') params.set('sort', merged.sort);
  if (merged.page && merged.page > 1) params.set('page', String(merged.page));

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// Признак «фильтры применены». Нужен для показа кнопки сброса и для
// решения о noindex: отфильтрованные выдачи в индекс не отдаём.
export function hasActiveFilters(filters: CatalogFilters): boolean {
  return Boolean(
    // Выбранный тип объявления сужает выдачу так же, как любой другой
    // фильтр, поэтому '/cars?type=rent' в индекс не отдаём: за арендой
    // закреплён отдельный лендинг /rent.
    (filters.listingType && filters.listingType !== 'both') ||
      filters.q ||
      filters.brand ||
      filters.model ||
      filters.city ||
      filters.yearFrom ||
      filters.yearTo ||
      filters.mileageMax ||
      filters.priceFrom ||
      filters.priceTo ||
      filters.bodyType ||
      filters.transmission ||
      filters.fuel,
  );
}
