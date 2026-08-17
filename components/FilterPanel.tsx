'use client';

// ============================================================
// RS AUTO — Панель фильтров. Client Component.
// ============================================================
// Открывается по компактной кнопке со счётчиком применённых фильтров
// (паттерн из требований проекта). Mobile-first: на телефоне — шторка
// на весь экран, на десктопе — выпадающая панель.
//
// Форма отправляется методом GET на тот же адрес: фильтры оказываются в
// query-параметрах, страница перерисовывается на сервере. Никакого
// клиентского состояния выдачи — это и даёт работающий SSR и шаринг ссылки.
// ============================================================

import { useState } from 'react';

import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { CatalogFilters } from '@/lib/queries';
import { BODY_TYPES, FUELS, TRANSMISSIONS } from '@/lib/types';
import type { ListingType, SiteBrand, SiteCity } from '@/lib/types';

type Props = {
  locale: Locale;
  filters: CatalogFilters;
  brands: SiteBrand[];
  cities: SiteCity[];
  // Куда отправлять форму: '/cars', '/rent' или SEO-страница с маркой.
  action: string;
  // Число применённых фильтров для счётчика на кнопке.
  activeCount: number;
  // Витрина: в аренде фильтр цены работает по суточной ставке, поэтому
  // подпись поля обязана это отражать — иначе «до 50» выглядит абсурдом.
  mode?: Exclude<ListingType, 'both'>;
};

export default function FilterPanel({
  locale,
  filters,
  brands,
  cities,
  action,
  activeCount,
  mode = 'sale',
}: Props) {
  const t = getT(locale);
  const [open, setOpen] = useState(false);

  const field =
    'w-full rounded-control border border-black/15 px-3 py-2 text-sm outline-none focus:border-brand-primary';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-control bg-brand-dark px-4 py-2.5 text-sm font-semibold text-white"
      >
        {t('catalog_filters')}
        {activeCount > 0 && (
          <span className="rounded-full bg-brand-gold px-2 py-0.5 text-xs">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-card bg-white p-4 sm:max-w-lg sm:rounded-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('catalog_filters')}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2 text-2xl leading-none text-black/40"
                aria-label="×"
              >
                ×
              </button>
            </div>

            {/* GET-форма: значения уходят в query-параметры адреса. */}
            <form method="get" action={action} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-black/60">
                  {t('filter_search')}
                </label>
                <input
                  type="text"
                  name="q"
                  defaultValue={filters.q ?? ''}
                  placeholder={t('filter_search_ph')}
                  className={field}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-black/60">
                    {t('filter_brand')}
                  </label>
                  <select name="brand" defaultValue={filters.brand ?? ''} className={field}>
                    <option value="">{t('filter_any')}</option>
                    {brands.map((b) => (
                      <option key={b.brand_slug} value={b.brand}>
                        {b.brand} ({b.cars_count})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-black/60">
                    {t('filter_city')}
                  </label>
                  <select name="city" defaultValue={filters.city ?? ''} className={field}>
                    <option value="">{t('filter_any')}</option>
                    {cities.map((c) => (
                      <option key={c.city_slug} value={c.city}>
                        {c.city} ({c.cars_count})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-black/60">
                    {mode === 'rent'
                      ? `${t('rent_price')}, €`
                      : `${t('filter_price')}, €`}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      name="price_from"
                      min={0}
                      defaultValue={filters.priceFrom ?? ''}
                      placeholder={t('filter_from')}
                      className={field}
                    />
                    <input
                      type="number"
                      name="price_to"
                      min={0}
                      defaultValue={filters.priceTo ?? ''}
                      placeholder={t('filter_to')}
                      className={field}
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-black/60">
                    {t('filter_year')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      name="year_from"
                      min={1900}
                      defaultValue={filters.yearFrom ?? ''}
                      placeholder={t('filter_from')}
                      className={field}
                    />
                    <input
                      type="number"
                      name="year_to"
                      min={1900}
                      defaultValue={filters.yearTo ?? ''}
                      placeholder={t('filter_to')}
                      className={field}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-black/60">
                  {t('filter_mileage')}, {t('common_km')}
                </label>
                <input
                  type="number"
                  name="mileage_max"
                  min={0}
                  defaultValue={filters.mileageMax ?? ''}
                  className={field}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-black/60">
                    {t('filter_body')}
                  </label>
                  <select name="body" defaultValue={filters.bodyType ?? ''} className={field}>
                    <option value="">{t('filter_any')}</option>
                    {Object.entries(BODY_TYPES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label[locale]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-black/60">
                    {t('filter_transmission')}
                  </label>
                  <select
                    name="gearbox"
                    defaultValue={filters.transmission ?? ''}
                    className={field}
                  >
                    <option value="">{t('filter_any')}</option>
                    {Object.entries(TRANSMISSIONS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label[locale]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-black/60">
                    {t('filter_fuel')}
                  </label>
                  <select name="fuel" defaultValue={filters.fuel ?? ''} className={field}>
                    <option value="">{t('filter_any')}</option>
                    {Object.entries(FUELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label[locale]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Сортировку переносим скрытым полем: иначе при применении
                  фильтров выбранный пользователем порядок молча сбросился бы
                  на значение по умолчанию. */}
              {filters.sort && filters.sort !== 'fresh' && (
                <input type="hidden" name="sort" value={filters.sort} />
              )}

              <button
                type="submit"
                className="w-full rounded-control bg-brand-green px-4 py-3 font-semibold text-white"
              >
                {t('catalog_apply')}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
