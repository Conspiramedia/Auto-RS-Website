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
// TextField, а не список. Разряды в них разделяются так же, как в форме
// подачи (NumberInput), а год показывается без разделителя.
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

import { trackEvent } from '@/lib/analytics';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { CatalogFilters } from '@/lib/queries';
import { BRANDS, CITIES } from '@/lib/referenceData';
import {
  MAX_MILEAGE_DIGITS,
  MAX_PRICE_DIGITS,
  YEAR_DIGITS,
} from '@/lib/inputFormat';
import { getBrowserClient } from '@/lib/supabaseClient';
import {
  BODY_TYPES,
  ENGINE_VOLUMES,
  FUELS,
  TRANSMISSIONS,
} from '@/lib/types';
import { useDismissableLayer } from '@/lib/useDismissableLayer';
import type { ListingType, SiteBrand, SiteCity } from '@/lib/types';
import ListPicker, { type PickerOption } from './ListPicker';
import CloseButton from './ui/CloseButton';
import { fieldClassCompact } from './ui/Field';
import NumberInput from './ui/NumberInput';
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
  // Уже с префиксом локали — форма уходит методом GET.
  action: string;
  // Число применённых фильтров для счётчика на кнопке.
  activeCount: number;
  // Витрина: в аренде фильтр цены работает по суточной ставке, поэтому
  // подпись поля обязана это отражать — иначе «до 50» выглядит абсурдом.
  mode?: Exclude<ListingType, 'both'>;
  // Тип объявления зафиксирован адресом страницы (лендинг /rent,
  // SEO-страницы марок и моделей). Сегмент типа перестаёт быть полем
  // формы и становится НАВИГАЦИЕЙ между лендингами: текущий тип
  // подсвечен и некликабелен, остальные — ссылки в каталог.
  lockedType?: boolean;
  // Локаль-адреса для навигационного сегмента. Считаются на сервере
  // (CatalogView) вместе с остальными ссылками каталога: собирать путь
  // строкой в клиентском компоненте правило проекта запрещает.
  // Нужны только при lockedType.
  // Пути витрин для режима навигации: куда отправлять форму, когда
  // человек сменил тип объявления. Без query — его собирает сама
  // GET-форма из своих полей.
  typeNavPaths?: { both: string; sale: string; rent: string };
  // Тип витрины для подсветки сегмента. ОТДЕЛЬНО от mode: тот схлопывает
  // 'both' в 'sale' (смешанная выдача показывает цены как продажа), и
  // подсветка по нему зажигала бы на /all «Продажу» вместо «Все».
  navType?: ListingType;
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
  typeNavPaths,
  navType,
}: Props) {
  const t = getT(locale);
  const [open, setOpen] = useState(false);

  // Escape, блокировка прокрутки под слоем и возврат фокуса на кнопку
  // «Фильтры» — общее поведение закрываемых слоёв
  // (lib/useDismissableLayer). Прокрутка блокируется ВПЕРВЫЕ: шторка
  // была единственным полноэкранным слоем без этого, и палец
  // прокручивал выдачу под ней — при закрытии человек оказывался в
  // другом месте списка.
  //
  // Список выбора внутри шторки гасит своё Escape (stopPropagation),
  // поэтому первое нажатие закрывает только открытый список, а до
  // шторки событие доходит уже следующим нажатием.
  useDismissableLayer({ open, onClose: () => setOpen(false) });

  // Тип объявления. Витрина каталога смешанная, поэтому по умолчанию
  // 'both' — «Все».
  //
  // В режиме навигации (lockedType) стартовое значение берётся из
  // типа САМОЙ витрины: filters.listingType там пуст — тип задан
  // адресом, а не query, и в фильтры его не кладут, чтобы он не
  // попал в счётчик применённых.
  const [listingType, setListingType] = useState<ListingType>(
    lockedType ? (navType ?? mode) : (filters.listingType ?? 'both'),
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

  // Числовые поля фильтров УПРАВЛЯЕМЫЕ — в состоянии лежат чистые
  // цифры, а разделители разрядов рисует NumberInput при показе.
  //
  // Раньше поля были неуправляемыми, и форматирования здесь не было
  // вовсе: панель уходит обычной GET-формой, и «125 000» с пробелами
  // уехало бы прямо в query-строку, где Number() дал бы NaN. Из-за
  // этого цена в подаче показывалась как «125 000», а в фильтрах — как
  // «125000». NumberInput снимает противоречие: видимое поле имени не
  // несёт, а рядом с ним стоит скрытое поле с чистым числом — в адрес
  // попадает только оно.
  const [priceFrom, setPriceFrom] = useState(
    filters.priceFrom != null ? String(filters.priceFrom) : '',
  );
  const [priceTo, setPriceTo] = useState(
    filters.priceTo != null ? String(filters.priceTo) : '',
  );
  const [yearFrom, setYearFrom] = useState(
    filters.yearFrom != null ? String(filters.yearFrom) : '',
  );
  const [yearTo, setYearTo] = useState(
    filters.yearTo != null ? String(filters.yearTo) : '',
  );
  const [mileageMax, setMileageMax] = useState(
    filters.mileageMax != null ? String(filters.mileageMax) : '',
  );

  // ЗАКРЫЛИ ШТОРКУ, НЕ ПРИМЕНИВ, — тип возвращается к текущей выдаче.
  // Сегмент теперь применяется по кнопке, поэтому его состояние может
  // разойтись с тем, что человек видит на странице: выбрал «Аренду»,
  // передумал, закрыл крестиком — и подсветка осталась бы на аренде,
  // хотя выдача прежняя. Остальные поля этим не страдают: их значения
  // видны в чипсах над выдачей, а тип в них не попадает.
  useEffect(() => {
    if (open) return;
    setListingType(
      lockedType ? (navType ?? mode) : (filters.listingType ?? 'both'),
    );
  }, [open, lockedType, navType, mode, filters.listingType]);

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

  // Ступени объёма лежат массивом, а не словарём: у них есть порядок
  // (по возрастанию литров) и границы, которые словарь не выразил бы.
  const engineOptions: PickerOption[] = ENGINE_VOLUMES.map((step) => ({
    value: step.key,
    label: step[locale],
  }));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-control bg-brand-dark px-4 text-caption font-semibold text-white"
      >
        {t('catalog_filters')}

        {/* Значок регуляторов справа от подписи. Inline-SVG, а не иконочная
            библиотека: тянуть зависимость ради одного знака избыточно —
            тем же приёмом собран бургер в шапке.
            currentColor — знак наследует белый цвет текста кнопки. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {/* Три дорожки с бегунками на разной высоте. */}
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
          <circle cx="8" cy="18" r="2" fill="currentColor" stroke="none" />
        </svg>

        {activeCount > 0 && (
          <span className="rounded-pill bg-brand-gold px-2 py-0.5 text-small">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-filter-sheet flex items-end justify-center bg-surface-overlay sm:items-center"
          // Клик по затемнению закрывает шторку. Обработчик висит на
          // самом затемнении, а клик внутри панели гасится ниже: иначе
          // любое нажатие по полю формы схлопывало бы фильтры.
          onClick={() => setOpen(false)}
        >
          <div
            // Высота: экран минус шапка (h-14 = 3.5rem) и небольшой
            // просвет, чтобы шторка не сливалась с ней встык. Прежние
            // 90vh отдавали десятую часть экрана пустому зазору, и
            // формы не хватало по высоте — на телефоне приходилось
            // прокручивать ради двух последних полей.
            //
            // dvh, а не vh: на мобильных vh считается от окна БЕЗ
            // учёта сворачиваемых панелей браузера, поэтому реально
            // видимой площади оказывается ещё меньше обещанной.
            // Единица уже используется в модальных окнах админки.
            //
            // Нижний padding с safe-area: шторка прижата к краю экрана,
            // и на iPhone последние 34 пикселя занимает домашняя
            // полоса — без запаса кнопка «Показать результаты» уходила
            // бы под неё. На десктопе запас не нужен (sm:pb-4).
            className="thin-scrollbar max-h-[calc(100dvh-4.5rem)] w-full overflow-y-auto rounded-t-card bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-h-[90dvh] sm:max-w-lg sm:rounded-card sm:pb-4"
            onClick={(e) => e.stopPropagation()}
            // Те же роли, что у диалога выхода: шторка перекрывает
            // страницу целиком, и скринридер обязан объявить её окном,
            // а не куском выдачи. aria-labelledby указывает на
            // заголовок «Фильтры» — своё имя окно берёт из него.
            role="dialog"
            aria-modal="true"
            aria-labelledby="filters-title"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="filters-title" className="text-h4 font-semibold">
                {t('catalog_filters')}
              </h2>
              <CloseButton
                onClick={() => setOpen(false)}
                label={t('common_close')}
              />
            </div>

            {/* GET-форма: значения уходят в query-параметры адреса.
                Перед отправкой пустые поля отключаются, иначе браузер
                добавит в адрес «?q=&price_from=&year_to=» — мусор в
                ссылке, которой пользователь делится, и лишние варианты
                одного URL для краулера. */}
            <form
              method="get"
              // КУДА ОТПРАВЛЯЕМ. В режиме фильтра — на ту же страницу:
              // тип уходит скрытым полем ?type=. В режиме навигации у
              // каждого типа СВОЯ витрина (/all, /cars, /rent), и
              // смена типа означает переход на другой адрес — он и
              // становится целью формы. Так переключение раздела
              // происходит по «Показать результаты» вместе с
              // остальными фильтрами, а не мгновенно по клику.
              action={
                lockedType ? (typeNavPaths?.[listingType] ?? action) : action
              }
              className="space-y-3"
              onSubmit={(e) => {
                const form = e.currentTarget;
                form
                  .querySelectorAll<HTMLInputElement>('input[name]')
                  .forEach((input) => {
                    if (input.value.trim() === '') input.disabled = true;
                  });

                // СОБЫТИЕ ИМЕННО ЗДЕСЬ, НА ОТПРАВКЕ ФОРМЫ.
                // Человек выбирает марку, коробку, год и цену одним
                // заходом; повесь мы событие на изменение поля — один
                // поиск давал бы с десяток срабатываний, и «сколько
                // раз искали» перестало бы что-либо значить.
                //
                // Считаем ЗАПОЛНЕННЫЕ поля, а не сами значения: марка
                // и город — это то, что человек ищет, и складывать их
                // в аналитику значило бы собирать профиль интересов
                // конкретного посетителя. Число фильтров отвечает на
                // нужный вопрос — пользуются ли фильтрами вообще и
                // насколько сложно.
                //
                // Отключённые выше пустые поля в подсчёт не попадают:
                // проверка идёт по тому же признаку, что и отключение.
                const used = Array.from(
                  form.querySelectorAll<HTMLInputElement>('input[name]'),
                ).filter((input) => !input.disabled).length;

                trackEvent('search_performed', {
                  filters_used: used,
                  // Тип берём из СОСТОЯНИЯ формы, а не из фильтров
                  // страницы: сегмент теперь применяется вместе с
                  // остальными полями, и filters.listingType показал
                  // бы витрину, с которой человек уходит, а не ту,
                  // куда он отправляет поиск.
                  listing_type: listingType,
                });
              }}
            >
              {/* Тип объявления — сегмент из трёх кнопок. Первым полем:
                  он определяет саму выдачу, а не сужает её по признаку.

                  ВЫБОР НЕ ПРИМЕНЯЕТСЯ СРАЗУ. Нажатие только подсвечивает
                  положение; выдача меняется по кнопке «Показать
                  результаты» — как и у всех остальных полей шторки.
                  Раньше в навигационном режиме это были ссылки, и клик
                  уводил со страницы мгновенно, не дав дособрать фильтры.

                  Разница между режимами осталась, но ушла внутрь формы —
                  в её адрес назначения:

                  * /cars с ?type= — ФИЛЬТР. Тип уходит скрытым полем
                    вместе с остальными фильтрами, адрес прежний.

                  * /all, /rent и SEO-страницы марок — НАВИГАЦИЯ
                    (lockedType). У каждого типа своя витрина, поэтому
                    смена типа меняет action формы: отправка уводит на
                    /all, /cars или /rent, унося фильтры полями формы.

                  В счётчик и чипсы навигационный тип не входит:
                  пользователь его не выбирал (см. countable в
                  CatalogView). */}
              <div>
                <label className="mb-1 block text-caption text-neutral-60">
                  {t('filter_listing_type')}
                </label>
                <div className="grid grid-cols-3 gap-1 rounded-control bg-surface-active p-1">
                  {(
                    [
                      ['both', t('filter_type_all')],
                      ['sale', t('mode_sale')],
                      ['rent', t('mode_rent')],
                    ] as const
                  ).map(([value, label]) => {
                    // Активен ВЫБОР В ФОРМЕ — одинаково в обоих
                    // режимах. В навигационном он стартует с типа
                    // текущей витрины, поэтому до первого нажатия
                    // подсвечен раздел, в котором человек находится.
                    const active = listingType === value;

                    const cls =
                      'rounded-control px-2 py-2 text-center text-caption font-semibold transition-colors ' +
                      (active
                        ? 'bg-white text-brand-dark shadow-sticky'
                        : 'text-neutral-55 hover:text-brand-dark');

                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setListingType(value)}
                        className={cls}
                        // Сегмент — это выбор из трёх взаимоисключающих
                        // положений, а не набор независимых кнопок:
                        // aria-pressed сообщает скринридеру, какое
                        // сейчас нажато.
                        aria-pressed={active}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {/* Значение уходит в URL. 'both' — состояние по
                    умолчанию, его в адрес не пишем. В режиме навигации
                    скрытого поля нет вовсе: тип задан маршрутом, и
                    дублировать его в query значило бы вернуть параметр
                    в счётчик фильтров. */}
                {!lockedType && listingType !== 'both' && (
                  <input type="hidden" name="type" value={listingType} />
                )}
              </div>

              {/* Поля свободного поиска здесь БОЛЬШЕ НЕТ: строка
                  поиска стоит над выдачей (components/CatalogView),
                  где подсказки видно до открытия фильтров. Два
                  одинаковых поля с независимыми состояниями разошлись
                  бы в значениях, поэтому в шторке остались только
                  фильтры.
                  Но введённый текст обязан ПЕРЕЖИТЬ применение
                  фильтров: без скрытого поля кнопка «Показать
                  результаты» стирала бы поисковый запрос из адреса. */}
              {filters.q && (
                <input type="hidden" name="q" value={filters.q} />
              )}

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

              {/* Город и пробег делят одну полосу: оба поля —
                  одиночные, в паре они экономят высоту шторки. */}
              <div className="grid grid-cols-2 gap-3">
                <ListPicker
                  size="compact"
                  locale={locale}
                  name="city"
                  label={t('filter_city')}
                  options={cityOptions}
                  value={filters.city ?? ''}
                />

                <div>
                  <label className="mb-1 block text-caption text-neutral-60">
                    {t('filter_mileage')}, {t('common_km')}
                  </label>
                  <NumberInput
                    name="mileage_max"
                    value={mileageMax}
                    onChange={setMileageMax}
                    maxDigits={MAX_MILEAGE_DIGITS}
                    aria-label={`${t('filter_mileage')}, ${t('common_km')}`}
                    className={field}
                  />
                </div>
              </div>

              {/* Цена и год — диапазоны из двух полей каждый, поэтому
                  идут отдельными строками: четыре узких поля в ряд
                  нечитаемы. */}
              <div>
                <label className="mb-1 block text-caption text-neutral-60">
                  {mode === 'rent'
                    ? `${t('rent_price')}, €`
                    : `${t('filter_price')}, €`}
                </label>
                <div className="flex gap-2">
                  <NumberInput
                    name="price_from"
                    value={priceFrom}
                    onChange={setPriceFrom}
                    maxDigits={MAX_PRICE_DIGITS}
                    placeholder={t('filter_from')}
                    aria-label={`${t('filter_price')} ${t('filter_from')}`}
                    className={field}
                  />
                  <NumberInput
                    name="price_to"
                    value={priceTo}
                    onChange={setPriceTo}
                    maxDigits={MAX_PRICE_DIGITS}
                    placeholder={t('filter_to')}
                    aria-label={`${t('filter_price')} ${t('filter_to')}`}
                    className={field}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-caption text-neutral-60">
                  {t('filter_year')}
                </label>
                {/* Границы совпадают с constraint chk_year таблицы cars:
                    от 1900 до следующего года включительно. */}
                <div className="flex gap-2">
                  {/* separator={false}: год — метка на шкале, а не
                      количество. «2019», а не «2 019». */}
                  <NumberInput
                    name="year_from"
                    value={yearFrom}
                    onChange={setYearFrom}
                    maxDigits={YEAR_DIGITS}
                    separator={false}
                    placeholder={t('filter_from')}
                    aria-label={`${t('filter_year')} ${t('filter_from')}`}
                    className={field}
                  />
                  <NumberInput
                    name="year_to"
                    value={yearTo}
                    onChange={setYearTo}
                    maxDigits={YEAR_DIGITS}
                    separator={false}
                    placeholder={t('filter_to')}
                    aria-label={`${t('filter_year')} ${t('filter_to')}`}
                    className={field}
                  />
                </div>
              </div>

              {/* Четыре списка в сетке 2×2. В три колонки подписи
                  значений обрезались, а в столбик четыре поля тянули
                  форму вниз — пара на строку читается и помещается. */}
              <div className="grid grid-cols-2 gap-3">
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

                {/* Объём — ступенями, а не парой полей «от/до»:
                    покупатель мыслит классами моторов, и выбор из
                    списка быстрее ввода двух чисел с телефона. */}
                <ListPicker
                  size="compact"
                  locale={locale}
                  name="engine"
                  label={t('filter_engine')}
                  options={engineOptions}
                  value={filters.engineVolume ?? ''}
                  searchable={false}
                />
              </div>

              {/* ПОКАЗ БИТЫХ И РАЗБОРКИ (0138).
                  ------------------------------------------------------------
                  Обычный чекбокс, а не пикер: значений два, и список
                  из «да/нет» был бы тяжелее самого выбора.

                  ЗДЕСЬ ВАЖНО ПОВЕДЕНИЕ GET-ФОРМЫ: невыбранный чекбокс
                  браузер не отправляет вовсе, поэтому снятая галочка
                  сама даёт ?damaged= без значения, то есть выключенный
                  фильтр и чистый адрес. Скрытого поля-компаньона со
                  значением '0' здесь намеренно НЕТ — оно завело бы
                  второй URL для той же выдачи.

                  value='1' совпадает с тем, что читает parseFilters и
                  пишет buildQuery: три места обязаны сойтись на одной
                  строке, иначе фильтр применится, а чипс не покажется.

                  Стоит НИЖЕ сетки полей и на всю ширину: это не ещё
                  одна характеристика машины в ряду с кузовом и
                  коробкой, а переключатель охвата всей выдачи.

                  Фильтров доступности (in_stock / on_order /
                  in_transit) этот чекбокс НЕ КАСАЕТСЯ: оси
                  независимы. */}
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-caption">
                <input
                  type="checkbox"
                  name="damaged"
                  value="1"
                  defaultChecked={filters.showDamaged === true}
                  className="h-4 w-4 shrink-0 accent-brand-primary"
                />
                <span>{t('filter_show_damaged')}</span>
              </label>

              {/* Сортировку переносим скрытым полем: иначе при применении
                  фильтров выбранный пользователем порядок молча сбросился бы
                  на значение по умолчанию. */}
              {filters.sort && filters.sort !== 'fresh' && (
                <input type="hidden" name="sort" value={filters.sort} />
              )}

              {/* Зазор под кнопкой задаётся ЗДЕСЬ, а не отступом формы.
                  Кнопка — последний элемент прокручиваемого контейнера
                  (max-h-[90vh] + overflow-y-auto), а его нижний padding
                  в конце прокрутки не даёт гарантированного просвета:
                  длинная форма /cars упирала кнопку в край шторки, а
                  короткая /rent (без сегмента типа) помещалась целиком
                  и зазор сохраняла. Разница зависела от длины формы.
                  Собственный padding-bottom принадлежит содержимому и
                  прокручивается вместе с ним — просвет одинаков и при
                  скролле, и без него. */}
              <div className="pb-2">
                <Button type="submit" fullWidth>
                  {t('catalog_apply')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
