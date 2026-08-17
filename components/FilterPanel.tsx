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
import { BRANDS, CITIES, YEAR_MIN, yearMax } from '@/lib/referenceData';
import { BODY_TYPES, FUELS, TRANSMISSIONS } from '@/lib/types';
import type { ListingType, SiteBrand, SiteCity } from '@/lib/types';

type Props = {
  locale: Locale;
  filters: CatalogFilters;
  // Марки и города с активными объявлениями. Используются НЕ как источник
  // списка, а как источник счётчиков: полный справочник берётся из
  // lib/referenceData (как в приложении), а счётчик показывается только
  // там, где объявления действительно есть.
  brands: SiteBrand[];
  cities: SiteCity[];
  // Модели выбранной марки из полного справочника (get_car_models).
  // Пустой массив, когда марка не выбрана: без неё список моделей
  // был бы на несколько тысяч пунктов и бесполезен.
  models: { id: string; name: string }[];
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
  models,
  action,
  activeCount,
  mode = 'sale',
}: Props) {
  const t = getT(locale);
  const [open, setOpen] = useState(false);

  const field =
    'w-full rounded-control border border-black/15 px-3 py-2 text-sm outline-none focus:border-brand-primary';

  // Счётчики объявлений по марке и городу — для подписи «(12)» рядом с
  // пунктом списка. Ключ нормализован, чтобы «BMW» из справочника нашёл
  // счётчик для «bmw» из базы.
  const brandCounts = new Map(
    brands.map((b) => [b.brand.trim().toLowerCase(), b.cars_count]),
  );
  const cityCounts = new Map(
    cities.map((c) => [c.city.trim().toLowerCase(), c.cars_count]),
  );

  // Подпись пункта: с числом объявлений, если они есть, и без него,
  // если марка сейчас не представлена. Прятать такие пункты нельзя —
  // это и есть расхождение с приложением, которое чинит эта правка.
  const withCount = (name: string, counts: Map<string, number>) => {
    const n = counts.get(name.trim().toLowerCase());
    return n ? `${name} (${n})` : name;
  };

  // Марка из адреса SEO-страницы может отсутствовать в справочнике
  // (продавец ввёл своё название — справочник БД пополняется триггером).
  // Добавляем её в список, иначе выбранное значение не отобразится.
  const brandOptions = filters.brand && !BRANDS.includes(filters.brand)
    ? [...BRANDS, filters.brand].sort((a, b) => a.localeCompare(b))
    : BRANDS;

  const cityOptions = filters.city && !CITIES.includes(filters.city)
    ? [...CITIES, filters.city].sort((a, b) => a.localeCompare(b))
    : CITIES;

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
                    {brandOptions.map((b) => (
                      <option key={b} value={b}>
                        {withCount(b, brandCounts)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Модель — каскадом от марки, как в приложении. Список
                    приходит с сервера для уже выбранной марки; пока марка
                    не выбрана, поле неактивно: перечислять модели всех
                    124 марок разом бессмысленно. */}
                <div>
                  <label className="mb-1 block text-sm text-black/60">
                    {t('filter_model')}
                  </label>
                  <select
                    name="model"
                    defaultValue={filters.model ?? ''}
                    className={field}
                    disabled={!filters.brand}
                  >
                    <option value="">{t('filter_any')}</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-black/60">
                  {t('filter_city')}
                </label>
                <select name="city" defaultValue={filters.city ?? ''} className={field}>
                  <option value="">{t('filter_any')}</option>
                  {cityOptions.map((c) => (
                    <option key={c} value={c}>
                      {withCount(c, cityCounts)}
                    </option>
                  ))}
                </select>
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
                  {/* Границы совпадают с constraint chk_year таблицы cars:
                      от 1900 до следующего года включительно. */}
                  <div className="flex gap-2">
                    <input
                      type="number"
                      name="year_from"
                      min={YEAR_MIN}
                      max={yearMax()}
                      defaultValue={filters.yearFrom ?? ''}
                      placeholder={t('filter_from')}
                      className={field}
                    />
                    <input
                      type="number"
                      name="year_to"
                      min={YEAR_MIN}
                      max={yearMax()}
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
