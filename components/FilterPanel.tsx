'use client';

// ============================================================
// RS AUTO — Панель фильтров. Client Component.
// ============================================================
// Открывается по компактной кнопке со счётчиком применённых фильтров
// (паттерн из требований проекта). Mobile-first: на телефоне — шторка
// на весь экран, на десктопе — выпадающая панель.
//
// ВСЕ СПРАВОЧНЫЕ ПОЛЯ — ВЫБОР ИЗ СПИСКА, как в приложении
// (filters_screen.dart): марка, модель, город, кузов, коробка, топливо.
// Свободного текста нет нигде, кроме поиска по объявлениям.
// Цена, год и пробег остаются числовыми полями — в приложении это тоже
// TextField, а не список.
//
// Форма отправляется методом GET на тот же адрес: значения пикеров
// уходят в query-параметры через скрытые input, страница
// перерисовывается на сервере. Никакого клиентского состояния выдачи —
// это и даёт работающий SSR и шаринг ссылки.
//
// КАСКАД «МАРКА → МОДЕЛЬ» повторяет приложение: при смене марки модель
// сбрасывается, список моделей грузится с сервера (get_car_models —
// та же RPC, что вызывает приложение).
// ============================================================

import { useEffect, useState } from 'react';

import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { CatalogFilters } from '@/lib/queries';
import { BRANDS, CITIES, YEAR_MIN, yearMax } from '@/lib/referenceData';
import { getBrowserClient } from '@/lib/supabaseClient';
import { BODY_TYPES, FUELS, TRANSMISSIONS } from '@/lib/types';
import type { ListingType, SiteBrand, SiteCity } from '@/lib/types';
import ListPicker, { type PickerOption } from './ListPicker';
import { fieldClassCompact } from './ui/Field';
import Button from './ui/Button';

type Props = {
  locale: Locale;
  filters: CatalogFilters;
  // Марки и города с активными объявлениями — источник СЧЁТЧИКОВ.
  // Сами списки берутся из полного справочника (lib/referenceData),
  // чтобы совпадать с приложением.
  brands: SiteBrand[];
  cities: SiteCity[];
  // Модели выбранной марки, отрендеренные сервером. Нужны, чтобы при
  // открытии страницы с уже выбранной маркой список был доступен сразу,
  // без ожидания клиентского запроса.
  models: { id: string; name: string }[];
  // Куда отправлять форму: '/cars', '/rent' или SEO-страница с маркой.
  action: string;
  // Число применённых фильтров для счётчика на кнопке.
  activeCount: number;
  // Витрина: в аренде фильтр цены работает по суточной ставке, поэтому
  // подпись поля обязана это отражать — иначе «до 50» выглядит абсурдом.
  mode?: Exclude<ListingType, 'both'>;
  // Тип объявления зафиксирован адресом страницы (SEO-лендинг /rent) —
  // сегмент выбора типа скрывается.
  lockedType?: boolean;
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
  lockedType = false,
}: Props) {
  const t = getT(locale);
  const [open, setOpen] = useState(false);

  // Тип объявления. Витрина каталога смешанная, поэтому по умолчанию
  // 'both' — «Всё». На SEO-лендинге /rent тип задан адресом и сегмент
  // не показывается: сменить его там означало бы уйти со страницы.
  const [listingType, setListingType] = useState<ListingType>(
    filters.listingType ?? 'both',
  );

  // Выбранная марка и модели для каскада. Стартуют из фильтров страницы.
  const [brand, setBrand] = useState(filters.brand ?? '');
  const [modelList, setModelList] =
    useState<{ id: string; name: string }[]>(models);
  const [loadingModels, setLoadingModels] = useState(false);
  // Ключ для перемонтирования пикера модели: при смене марки прежнее
  // значение обязано сброситься, иначе останется модель от другой марки.
  const [modelKey, setModelKey] = useState(0);

  // Компактный вариант поля из общего паттерна: в панели фильтров
  // полей много, и они плотнее, чем в формах подачи.
  const field = fieldClassCompact;

  // Числовые поля фильтров (цена, год, пробег) остаются НЕуправляемыми:
  // они уходят обычной GET-формой, и значение читает браузер, а не React.
  // Поэтому здесь не форматирование с разделителями тысяч (пробелы
  // попали бы в URL), а только отсечение нецифр прямо при вводе —
  // ровно как ограничение digitsOnly в приложении.
  function onlyDigits(e: React.FormEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const clean = input.value.replace(/[^0-9]/g, '');
    if (input.value !== clean) input.value = clean;
  }

  // Догрузка моделей при смене марки прямо в панели. На сервере модели
  // уже пришли для марки из URL — повторный запрос делаем только когда
  // пользователь выбрал другую марку.
  useEffect(() => {
    if (!brand) {
      setModelList([]);
      return;
    }

    if (brand === (filters.brand ?? '')) {
      setModelList(models);
      return;
    }

    let cancelled = false;
    setLoadingModels(true);

    getBrowserClient()
      .rpc('get_car_models', { p_brand_name: brand })
      .then(({ data, error }) => {
        if (cancelled) return;
        // Ошибку не показываем: список моделей — уточняющий фильтр,
        // и без него панель должна остаться работоспособной.
        setModelList(error ? [] : ((data ?? []) as { id: string; name: string }[]));
        setLoadingModels(false);
      });

    return () => {
      cancelled = true;
    };
  }, [brand, filters.brand, models]);

  // Счётчики объявлений по марке и городу. Ключ нормализован, чтобы
  // «BMW» из справочника нашёл счётчик для «bmw» из базы.
  const brandCounts = new Map(
    brands.map((b) => [b.brand.trim().toLowerCase(), b.cars_count]),
  );
  const cityCounts = new Map(
    cities.map((c) => [c.city.trim().toLowerCase(), c.cars_count]),
  );

  // Марка или город из адреса SEO-страницы может отсутствовать в
  // справочнике (продавец ввёл своё название). Добавляем в список,
  // иначе выбранное значение не отобразится.
  const brandNames = filters.brand && !BRANDS.includes(filters.brand)
    ? [...BRANDS, filters.brand].sort((a, b) => a.localeCompare(b))
    : BRANDS;

  const cityNames = filters.city && !CITIES.includes(filters.city)
    ? [...CITIES, filters.city].sort((a, b) => a.localeCompare(b))
    : CITIES;

  const brandOptions: PickerOption[] = brandNames.map((b) => ({
    value: b,
    label: b,
    count: brandCounts.get(b.trim().toLowerCase()),
  }));

  const cityOptions: PickerOption[] = cityNames.map((c) => ({
    value: c,
    label: c,
    count: cityCounts.get(c.trim().toLowerCase()),
  }));

  const modelOptions: PickerOption[] = modelList.map((m) => ({
    value: m.name,
    label: m.name,
  }));

  // Подписи enum'ов берём из общих справочников — они совпадают
  // со значениями в БД и с приложением.
  const enumOptions = (
    dict: Record<string, { sr: string; ru: string }>,
  ): PickerOption[] =>
    Object.entries(dict).map(([value, labels]) => ({
      value,
      label: labels[locale],
    }));

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
        <div className="fixed inset-0 z-filter-sheet flex items-end justify-center bg-surface-overlay sm:items-center">
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-card bg-white p-4 sm:max-w-lg sm:rounded-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('catalog_filters')}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2 text-2xl leading-none text-neutral-40"
                aria-label="×"
              >
                ×
              </button>
            </div>

            {/* GET-форма: значения уходят в query-параметры адреса.
                Перед отправкой пустые поля отключаются, иначе браузер
                добавит в адрес «?q=&price_from=&year_to=» — мусор в
                ссылке, которой пользователь делится, и лишние варианты
                одного URL для краулера. */}
            <form
              method="get"
              action={action}
              className="space-y-3"
              onSubmit={(e) => {
                const form = e.currentTarget;
                form
                  .querySelectorAll<HTMLInputElement>('input[name]')
                  .forEach((input) => {
                    if (input.value.trim() === '') input.disabled = true;
                  });
              }}
            >
              {/* Тип объявления — сегмент из трёх кнопок. Первым полем:
                  он определяет саму выдачу, а не сужает её по признаку.
                  На лендинге /rent тип задан адресом и сегмент скрыт. */}
              {!lockedType && (
                <div>
                  <label className="mb-1 block text-sm text-neutral-60">
                    {t('filter_listing_type')}
                  </label>
                  <div className="grid grid-cols-3 gap-1 rounded-control bg-surface-active p-1">
                    {(
                      [
                        ['both', t('filter_type_all')],
                        ['sale', t('mode_sale')],
                        ['rent', t('mode_rent')],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setListingType(value)}
                        className={
                          'rounded-control px-2 py-2 text-sm font-semibold transition-colors ' +
                          (listingType === value
                            ? 'bg-white text-brand-dark shadow-sticky'
                            : 'text-neutral-55 hover:text-brand-dark')
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* Значение уходит в URL. 'both' — состояние по
                      умолчанию, его в адрес не пишем. */}
                  {listingType !== 'both' && (
                    <input type="hidden" name="type" value={listingType} />
                  )}
                </div>
              )}

              {/* Единственное поле свободного ввода — поиск по тексту
                  объявления. В приложении он тоже отдельной строкой. */}
              <div>
                <label className="mb-1 block text-sm text-neutral-60">
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
                <ListPicker
                  size="compact"
                  locale={locale}
                  name="brand"
                  label={t('filter_brand')}
                  options={brandOptions}
                  value={brand}
                  onChange={(v) => {
                    setBrand(v);
                    // Сброс модели при смене марки — как в приложении.
                    setModelKey((k) => k + 1);
                  }}
                />

                {/* Модель доступна только после выбора марки: перечислять
                    модели всех 124 марок разом бессмысленно. */}
                <ListPicker
                  size="compact"
                  key={modelKey}
                  locale={locale}
                  name="model"
                  label={t('filter_model')}
                  options={modelOptions}
                  value={modelKey === 0 ? (filters.model ?? '') : ''}
                  disabled={!brand || loadingModels || modelOptions.length === 0}
                  emptyHint={
                    !brand
                      ? t('picker_model_no_brand')
                      : loadingModels
                        ? t('picker_search')
                        : t('picker_model_empty')
                  }
                />
              </div>

              <ListPicker
                size="compact"
                locale={locale}
                name="city"
                label={t('filter_city')}
                options={cityOptions}
                value={filters.city ?? ''}
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-neutral-60">
                    {mode === 'rent'
                      ? `${t('rent_price')}, €`
                      : `${t('filter_price')}, €`}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"

                      inputMode="numeric"
                      name="price_from"
                      onInput={onlyDigits}
                      min={0}
                      defaultValue={filters.priceFrom ?? ''}
                      placeholder={t('filter_from')}
                      className={field}
                    />
                    <input
                      type="text"

                      inputMode="numeric"
                      name="price_to"
                      onInput={onlyDigits}
                      min={0}
                      defaultValue={filters.priceTo ?? ''}
                      placeholder={t('filter_to')}
                      className={field}
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-neutral-60">
                    {t('filter_year')}
                  </label>
                  {/* Границы совпадают с constraint chk_year таблицы cars:
                      от 1900 до следующего года включительно. */}
                  <div className="flex gap-2">
                    <input
                      type="text"

                      inputMode="numeric"

                      maxLength={4}
                      name="year_from"

                      onInput={onlyDigits}
                      min={YEAR_MIN}
                      max={yearMax()}
                      defaultValue={filters.yearFrom ?? ''}
                      placeholder={t('filter_from')}
                      className={field}
                    />
                    <input
                      type="text"

                      inputMode="numeric"

                      maxLength={4}
                      name="year_to"

                      onInput={onlyDigits}
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
                <label className="mb-1 block text-sm text-neutral-60">
                  {t('filter_mileage')}, {t('common_km')}
                </label>
                <input
                  type="text"

                  inputMode="numeric"
                  name="mileage_max"
                  onInput={onlyDigits}
                  min={0}
                  defaultValue={filters.mileageMax ?? ''}
                  className={field}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <ListPicker
                  size="compact"
                  locale={locale}
                  name="body"
                  label={t('filter_body')}
                  options={enumOptions(BODY_TYPES)}
                  value={filters.bodyType ?? ''}
                  // Десять пунктов — поиск не нужен, как и в приложении,
                  // где короткие списки показываются без него.
                  searchable={false}
                />

                <ListPicker
                  size="compact"
                  locale={locale}
                  name="gearbox"
                  label={t('filter_transmission')}
                  options={enumOptions(TRANSMISSIONS)}
                  value={filters.transmission ?? ''}
                  searchable={false}
                />

                <ListPicker
                  size="compact"
                  locale={locale}
                  name="fuel"
                  label={t('filter_fuel')}
                  options={enumOptions(FUELS)}
                  value={filters.fuel ?? ''}
                  searchable={false}
                />
              </div>

              {/* Сортировку переносим скрытым полем: иначе при применении
                  фильтров выбранный пользователем порядок молча сбросился бы
                  на значение по умолчанию. */}
              {filters.sort && filters.sort !== 'fresh' && (
                <input type="hidden" name="sort" value={filters.sort} />
              )}

              <Button type="submit" fullWidth>
                {t('catalog_apply')}
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
