// ============================================================
// RS AUTO — Витрина каталога. Server Component.
// ============================================================
// Один компонент обслуживает /cars, /cars/{brand} и /cars/{brand}/{model}:
// у них общий вид и поведение, различаются лишь заголовок, базовый путь и
// предустановленные фильтры. Дублировать эту разметку в трёх страницах
// означало бы чинить любую правку каталога трижды.
// ============================================================

import CarCard from './CarCard';
import SearchSuggestInput from './SearchSuggestInput';
import InfiniteCarFeed from './InfiniteCarFeed';
import EmptyState from './EmptyState';
import FilterChips from './FilterChips';
import FilterPanel from './FilterPanel';
import Pagination from './Pagination';
import PaginationLinks from './PaginationLinks';
import SortSelect from './SortSelect';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { countNoun } from '@/lib/plural';
import type { CatalogFilters, CatalogResult } from '@/lib/queries';
import { hasActiveFilters } from '@/lib/searchParams';
import type { ListingType, SiteBrand, SiteCity } from '@/lib/types';

type Props = {
  locale: Locale;
  title: string;
  // Текст под заголовком на SEO-страницах (описание марки/модели).
  intro?: string;
  filters: CatalogFilters;
  result: CatalogResult;
  brands: SiteBrand[];
  cities: SiteCity[];
  // Модели выбранной марки для каскадного фильтра. Пусто, когда марка
  // не выбрана.
  models?: { id: string; name: string }[];
  // Базовый путь без префикса локали: '/cars' | '/rent/bmw' | '/cars/bmw/x5'.
  basePath: string;
  // Витрина: определяет, какая цена показывается в карточках и какой
  // раздел считается корневым при сбросе фильтров.
  // 'both' — смешанный фид каталога: цена берётся из самого объявления.
  mode?: ListingType;
  // Тип объявления зафиксирован адресом (SEO-лендинг /rent): сегмент
  // выбора типа в фильтрах скрывается.
  lockedType?: boolean;
  // Бесконечная подгрузка при скролле. Включена ТОЛЬКО в основных
  // витринах (/cars, /rent) и только в дефолтной сортировке.
  // SEO-страницы марок и моделей остаются на обычной пагинации:
  // их задача — стабильная индексируемая выдача, а не «живая лента».
  infinite?: boolean;
};

export default function CatalogView({
  locale,
  title,
  intro,
  filters,
  result,
  brands,
  cities,
  models = [],
  basePath,
  mode = 'sale',
  lockedType = false,
  infinite = false,
}: Props) {
  const t = getT(locale);

  // Витрина для компонентов, которые различают только продажу и аренду
  // (подписи цены в фильтрах, заголовок пустого состояния). Смешанный
  // фид ведёт себя как продажа: цены там в евро за автомобиль.
  const pageMode: Exclude<ListingType, 'both'> =
    mode === 'rent' ? 'rent' : 'sale';

  // Счётчик на кнопке фильтров считает только те фильтры, которые
  // пользователь применил сам. Системные параметры, заданные самим
  // адресом страницы, в счётчик не входят — их нельзя снять, не уйдя
  // со страницы, и пользователь их не выбирал:
  //   * марка и модель на SEO-страницах /cars/bmw и /cars/bmw/x5;
  //   * тип объявления на лендинге /rent (lockedType) — именно из-за
  //     него счётчик показывал «1 фильтр» на чистом /rent.
  const rootPath = mode === 'rent' ? '/rent' : '/cars';
  const isBrandPage = basePath !== rootPath;
  const countable: CatalogFilters = {
    ...filters,
    ...(isBrandPage ? { brand: undefined, model: undefined } : null),
    ...(lockedType ? { listingType: undefined } : null),
  };

  const activeCount = [
    // Тип объявления считается применённым фильтром, только когда он
    // сужает выдачу: 'both' — состояние по умолчанию.
    countable.listingType && countable.listingType !== 'both'
      ? countable.listingType
      : undefined,
    countable.q,
    countable.brand,
    countable.model,
    countable.city,
    countable.yearFrom,
    countable.yearTo,
    countable.mileageMax,
    countable.priceFrom,
    countable.priceTo,
    countable.bodyType,
    countable.transmission,
    countable.fuel,
  ].filter(Boolean).length;

  return (
    <>
      {/* rel=prev/next для соседних страниц пагинации. Next поднимает
          эти <link> в <head> сам. */}
      <PaginationLinks
        locale={locale}
        filters={filters}
        basePath={basePath}
        page={result.page}
        totalPages={result.totalPages}
      />

      <h1 className="text-h2 font-bold sm:text-h1">{title}</h1>
      {intro && <p className="mt-2 max-w-3xl text-neutral-60">{intro}</p>}

      {/* Панель управления выдачей.
          Десктоп — как было до редизайна: «Фильтры» и счётчик слева,
          сортировка прижата вправо (justify-between), всё в один ряд.
          Мобильный — «Фильтры» + компактный select сортировки в строку,
          счётчик уходит ниже отдельной строкой. */}
      {/* flex-wrap только на мобильном (по умолчанию), на десктопе
          sm:flex-nowrap: иначе широкий блок сортировки не помещается
          рядом с фильтрами и переносится на вторую строку, наезжая
          на счётчик — ровно то, что было видно на скриншоте. */}
      {/* РЯД УПРАВЛЕНИЯ ВЫДАЧЕЙ: поиск, фильтры, счётчик, сортировка.
          Строка поиска рендерится РОВНО ОДИН РАЗ и меняет положение
          переносом, а не второй копией. Раньше здесь стояло два
          экземпляра SearchSuggestInput — мобильный (md:hidden) и
          десктопный (hidden md:block). Скрытие через CSS не убирает
          элемент из DOM: обе копии жили одновременно, и это давало
          два дефекта сразу — дублирующийся id="catalog-q"
          (невалидный HTML: getElementById и aria находят только
          первый, то есть на мобильном ссылались на скрытое поле) и
          две независимые анимации подсказок со своими таймерами,
          крутившие разные фразы вразнобой.

          Раскладка теперь целиком на переносе flex-wrap:
            < 768px — поиск занимает всю ширину (basis-full) и уходит
                      на собственную строку НАД остальными контролами:
                      сжатая до половины экрана строка поиска не
                      читается как строка поиска;
            ≥ 768px — md:basis-0 + md:flex-1 возвращают её в общий ряд
                      первым элементом, слева от «Фильтров», где она
                      забирает свободную ширину.

          flex-nowrap с ряда СНЯТ намеренно. При sm:flex-nowrap
          basis-full не смог бы перенестись, и в диапазоне 640–767px
          поиск сжимался бы в один ряд с «Фильтрами» — ровно та
          раскладка, ради ухода от которой и заводилась вторая копия.
          Перенос теперь работает на всех ширинах, а на десктопе он
          не наступает: там элементам хватает места.

          md:items-start — из-за чипсов под строкой поиска: при
          выравнивании по центру «Фильтры» и сортировка съезжали бы
          вниз на высоту ряда подсказок. По верху все контролы стоят
          на одной линии независимо от того, есть чипсы или нет. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 sm:gap-3 md:items-start">
        {/* min-w-0 обязателен: без него flex-элемент с input внутри
            отказывается сжиматься и выталкивает сортировку за край. */}
        <div className="min-w-0 basis-full md:basis-0 md:flex-1">
          <SearchSuggestInput
            locale={locale}
            filters={filters}
            basePath={basePath}
          />
        </div>

        {/* Блок «Фильтры + счётчик» и сортировка живут в этом ряду
            только до 768px — на мобильном всё остаётся как было.
            С md оба контрола уходят отсюда (md:hidden) и переезжают
            в собственный ряд под чипсами, ниже: на десктопе строка
            поиска занимает всю ширину, а служебная кнопка «Фильтры»
            рядом с ней сжимала поле и вставала вровень с главным
            полем ввода. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none sm:gap-3 md:hidden">
          {/* action ОБЯЗАН нести префикс локали: форма фильтров уходит
              методом GET, и голый basePath уводил пользователя с
              /ru/cars на сербское зеркало — язык сбрасывался ровно по
              кнопке «Показать результаты». */}
          <FilterPanel
            locale={locale}
            filters={filters}
            brands={brands}
            cities={cities}
            models={models}
            action={localeHref(locale, basePath)}
            activeCount={activeCount}
            mode={pageMode}
            lockedType={lockedType}
          />
          {/* Счётчик в этом ряду показывается только в диапазоне
              640–767px: ниже он стоит отдельной строкой, выше —
              под десктопным рядом управления. */}
          <span className="hidden shrink-0 text-caption text-neutral-50 sm:inline md:hidden">
            {t('catalog_found')}: {countNoun(result.total, 'listing', locale)}
          </span>
        </div>

        {/* variant="compact" — ЯВНО компактный список, а не «то, что
            решит сам компонент по ширине». Внутри SortSelect свои
            брейкпоинты (select до 640px, чипсы выше), и без явного
            указания в диапазоне 640–767px здесь развернулась бы лента
            чипсов, которой в этом тесном ряду места нет. */}
        <div className="md:hidden">
          <SortSelect
            locale={locale}
            filters={filters}
            basePath={basePath}
            variant="compact"
          />
        </div>
      </div>

      {/* Счётчик результатов на мобильном — отдельной строкой.
          Подпись склоняется так же, как в десктопной версии выше:
          раньше здесь стояло голое число («Найдено: 2»), и две ширины
          экрана давали разный текст, а приложение — третий вариант. */}
      <div className="mt-2 text-caption text-neutral-50 sm:hidden">
        {t('catalog_found')}: {countNoun(result.total, 'listing', locale)}
      </div>

      <div className="mt-3">
        <FilterChips
          locale={locale}
          filters={countable}
          basePath={basePath}
          lockedType={lockedType}
        />
      </div>

      {/* ------------------------------------------------------------
          ДЕСКТОПНЫЙ РЯД УПРАВЛЕНИЯ (только с 768px).
          ------------------------------------------------------------
          «Фильтры» и сортировка спущены из ряда поиска сюда, под
          применённые чипсы. Порядок сверху вниз идёт по убыванию
          веса: поиск → что уже применено (чипсы) → чем управляем
          (фильтры, сортировка) → сколько получилось (счётчик).
          На мобильном этого ряда нет вовсе: там оба контрола остались
          в ряду поиска.
          variant="chips" — лента ссылок, как была: ряд существует
          только с md, и выбирать представление по внутренним
          брейкпоинтам компоненту здесь не из чего. */}
      <div className="mt-3 hidden items-center gap-3 md:flex">
        <FilterPanel
          locale={locale}
          filters={filters}
          brands={brands}
          cities={cities}
          models={models}
          action={localeHref(locale, basePath)}
          activeCount={activeCount}
          mode={pageMode}
          lockedType={lockedType}
        />

        <SortSelect
          locale={locale}
          filters={filters}
          basePath={basePath}
          variant="chips"
        />
      </div>

      {/* Счётчик результатов на десктопе — ПОД сортировкой отдельной
          строкой. Раньше он стоял в ряду поиска между «Фильтрами» и
          сортировкой: число результатов — это ИТОГ применённых
          настроек, и читаться оно должно после них, а не посреди
          органов управления. */}
      <div className="mt-2 hidden text-caption text-neutral-50 md:block">
        {t('catalog_found')}: {countNoun(result.total, 'listing', locale)}
      </div>

      {result.cars.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            locale={locale}
            resetPath={basePath}
            showReset={hasActiveFilters(countable)}
            mode={pageMode}
          />
        </div>
      ) : (
        <>
          {infinite ? (
            // Бесконечная лента: первая порция уже отрисована сервером
            // (важно для SEO), клиент продолжает её при скролле.
            // Паттерн перенесён из App Baza — см. шапку InfiniteCarFeed.
            <InfiniteCarFeed
              locale={locale}
              initialCars={result.cars}
              filters={filters}
              mode={mode}
              initialSeed={result.seed}
              total={result.total}
            />
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {result.cars.map((car, i) => (
                <CarCard
                  key={car.id}
                  locale={locale}
                  car={car}
                  mode={mode}
                  // Первые четыре карточки — над сгибом, грузим приоритетно.
                  priority={i < 4}
                />
              ))}
            </div>
          )}

          {/* Пагинация-ссылки остаются ВСЕГДА, даже при включённой
              бесконечной ленте. Причина сугубо поисковая: краулер не
              выполняет скролл, и без этих ссылок объявления со второй
              страницы и глубже лишились бы входящих внутренних ссылок.
              Человеку с работающим скриптом они не мешают — это запасной
              путь внизу страницы. */}
          <Pagination
            locale={locale}
            filters={filters}
            basePath={basePath}
            page={result.page}
            totalPages={result.totalPages}
          />
        </>
      )}
    </>
  );
}
