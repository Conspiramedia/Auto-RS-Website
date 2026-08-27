// ============================================================
// RS AUTO — Витрина каталога. Server Component.
// ============================================================
// Один компонент обслуживает /cars, /cars/{brand} и /cars/{brand}/{model}:
// у них общий вид и поведение, различаются лишь заголовок, базовый путь и
// предустановленные фильтры. Дублировать эту разметку в трёх страницах
// означало бы чинить любую правку каталога трижды.
// ============================================================

import { Fragment } from 'react';

import CarCard from './CarCard';
import DealerShowcaseCard from './DealerShowcaseCard';
import SearchSuggestInput from './SearchSuggestInput';
import EmptyState from './EmptyState';
import FilterChips from './FilterChips';
import FilterPanel from './FilterPanel';
import Pagination from './Pagination';
import PaginationLinks from './PaginationLinks';
import SortSelect from './SortSelect';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref, localePath } from '@/lib/i18n';
import { countNoun } from '@/lib/plural';
import type { CatalogFilters, CatalogResult } from '@/lib/queries';
import { buildItemListJsonLd } from '@/lib/seo';
import { buildQuery, hasActiveFilters } from '@/lib/searchParams';
import { siteBaseUrl } from '@/lib/supabase';
import type {
  ListingType,
  ShowcaseDealer,
  SiteBrand,
  SiteCity,
} from '@/lib/types';

// ------------------------------------------------------------
// Место плитки салона в сетке: после 12-й карточки.
// ------------------------------------------------------------
// Число выбрано арифметикой сетки, а не на глаз. Плитка занимает две
// колонки, и ряд перед ней обязан быть ЗАКОНЧЕН на каждом из трёх
// брейкпоинтов — иначе Grid перенесёт её на следующую строку и оставит
// дыру. Значит позиция обязана делиться на 2 (мобильный), 3 (планшет)
// и 4 (десктоп) одновременно; наименьшее такое число — 12.
//
// Соседние «красивые» позиции не подходят: 6 не делится на 4, 8 — на 3.
//
// Побочная выгода: 12 — ровно середина страницы из 24 объявлений.
// Плитка не перехватывает внимание на первом экране и попадается
// тому, кто уже листает выдачу.
const DEALER_SLOT = 12;

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
  // Салон для широкой плитки в середине выдачи. null — плитки нет
  // (салонов на площадке пока не появилось, либо страница её не
  // показывает: SEO-выдача марок обходится без неё).
  dealer?: ShowcaseDealer | null;
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
  dealer = null,
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
  //   * тип объявления на любой из трёх витрин (lockedType) — именно
  //     из-за него чистый /rent показывал «1 фильтр включён».
  //
  // Признак SEO-подстраницы — вложенность пути, а НЕ сравнение с
  // корнем, вычисленным из mode: у /all витрина mode='sale', и такое
  // сравнение объявило бы саму витрину страницей марки, вычеркнув из
  // счётчика выбранную пользователем марку.
  const isBrandPage = basePath.split('/').filter(Boolean).length > 1;
  const countable: CatalogFilters = {
    ...filters,
    ...(isBrandPage ? { brand: undefined, model: undefined } : null),
    ...(lockedType ? { listingType: undefined } : null),
  };

  // Адреса навигационного сегмента «Тип объявления». Нужны только там,
  // где тип задан маршрутом (lockedType): на /rent и SEO-страницах
  // сегмент переключает не фильтр, а РАЗДЕЛ.
  //
  // Переносим применённые фильтры: человек отобрал BMW в Белграде и
  // жмёт «Продажа» — он ожидает те же BMW в Белграде, а не пустой
  // каталог. Не переносим:
  //   * тип — его задаёт целевая ссылка;
  //   * страницу — на другой выдаче номер страницы бессмысленен и
  //     нередко ведёт за её пределы.
  // Марка и модель SEO-страницы переносятся в query автоматически:
  // они лежат в filters, куда их положил сам маршрут (BrandPageView).
  //
  // У каждого положения сегмента — собственная витрина: /all (продажа
  // и аренда вперемешку), /cars (продажа), /rent (аренда). Тип в query
  // не пишется вовсе: его задаёт сам адрес, а лишний ?type= вернул бы
  // параметр в счётчик фильтров и раздвоил canonical.
  const navQuery = buildQuery(filters, { listingType: undefined, page: 1 });

  const typeNavHrefs = lockedType
    ? {
        both: localePath(locale, '/all', navQuery),
        sale: localePath(locale, '/cars', navQuery),
        rent: localePath(locale, '/rent', navQuery),
      }
    : undefined;

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

  // JSON-LD ItemList текущей выдачи. Ставится ЗДЕСЬ, а не в каждой
  // странице-обёртке: этот компонент обслуживает все шесть витрин
  // (/cars, /rent, /all и страницы марок и моделей обеих витрин), и
  // разметка обязана описывать ровно тот список, который отрисован
  // ниже. Отдельные копии в обёртках разошлись бы с выдачей при первой
  // же правке сортировки.
  //
  // position сквозная по выдаче: на второй странице отсчёт продолжается
  // (см. buildItemListJsonLd) — иначе два разных объявления заявлены
  // под одним номером.
  const itemListJsonLd = buildItemListJsonLd({
    items: result.cars.map((car) => ({
      name: `${car.brand} ${car.model}, ${car.year}`,
      url: `${siteBaseUrl}${localeHref(locale, `/car/${car.id}`)}`,
    })),
    startPosition: (result.page - 1) * result.perPage + 1,
    totalItems: result.total,
  });

  return (
    <>
      {/* Разметка списка объявлений: сообщает поисковику, что страница —
          витрина товаров, и открывает карусель в выдаче.
          Пустую выдачу не размечаем: ItemList без элементов ничего не
          сообщает, а для валидатора это ошибка. */}
      {result.cars.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
        />
      )}

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
            typeNavHrefs={typeNavHrefs}
            navType={mode}
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
          typeNavHrefs={typeNavHrefs}
          navType={mode}
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
          {/* ------------------------------------------------------------
              ВЫДАЧА. Одна сетка на все случаи — бесконечной ленты больше
              нет, каталог везде листается страницами.

              ПЛИТКА САЛОНА ВСТАВЛЕНА В СЕРЕДИНУ, ПОСЛЕ 12-й КАРТОЧКИ.
              Позиция не произвольная: плитка занимает две колонки, и
              встань она там, где ряд не закончен, CSS Grid перенёс бы
              её целиком на следующую строку, оставив дыру. Ряд обязан
              быть целым на ВСЕХ трёх брейкпоинтах, то есть позиция
              обязана делиться и на 2, и на 3, и на 4 — наименьшее
              такое число и есть 12. Позиции 6 и 8, напрашивающиеся
              визуально, дают дыру: 6 не делится на 4 (десктоп), 8 не
              делится на 3 (планшет).

              12 — ровно середина страницы из 24 объявлений: плитка не
              перехватывает внимание на первом экране и попадается
              тому, кто уже листает.

              Вставляется НА СЕРВЕРЕ, вместе со всей страницей. Клиентская
              дорисовка сдвигала бы карточки после гидратации (CLS), а
              резервировать место пришлось бы под элемент, которого может
              и не быть. Страница кэшируется целиком (revalidate = 120),
              и салон в плитке меняется раз в две минуты — для витрины
              это нормально. */}
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {result.cars.map((car, i) => (
              <Fragment key={car.id}>
                <CarCard
                  locale={locale}
                  car={car}
                  mode={mode}
                  // Первые четыре карточки — над сгибом, грузим приоритетно.
                  priority={i < 4}
                />

                {/* Плитка идёт ПОСЛЕ 12-й карточки, то есть при i === 11.
                    Условие на длину списка обязательно: на неполной
                    странице (в выдаче меньше 13 объявлений) плитка
                    оказалась бы последней и висела бы хвостом под
                    коротким рядом, вместо того чтобы стоять в середине. */}
                {dealer && i === DEALER_SLOT - 1 && result.cars.length > DEALER_SLOT && (
                  <DealerShowcaseCard
                    locale={locale}
                    dealer={{
                      id: dealer.id,
                      name: dealer.display_name,
                      city: dealer.company_city,
                      description: dealer.description,
                      logoUrl: dealer.logo_url,
                      activeCars: dealer.active_cars,
                      previewPhotos: dealer.preview_photos,
                      openingHours: dealer.opening_hours,
                      dealerPhone: dealer.dealer_phone,
                    }}
                  />
                )}
              </Fragment>
            ))}
          </div>

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
