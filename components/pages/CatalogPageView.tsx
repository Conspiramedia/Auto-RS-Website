// ============================================================
// RS AUTO — Содержимое страницы каталога /cars, общее для sr и ru.
// ============================================================

import CatalogView from '@/components/CatalogView';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import {
  fetchCatalog,
  fetchCatalogModels,
  fetchShowcaseDealers,
  fetchSiteBrands,
  fetchSiteCities,
} from '@/lib/queries';
import type { SearchParams } from '@/lib/searchParams';
import { buildQuery, parseFilters } from '@/lib/searchParams';
import type { ListingType } from '@/lib/types';

// ТРИ ВИТРИНЫ, У КАЖДОЙ СВОЙ АДРЕС И СВОЙ ТИП СДЕЛКИ.
//
// Тип объявления задаётся МАРШРУТОМ, а не query-параметром: одна выдача
// живёт по одному адресу, и ?type= на этих страницах игнорируется. Так
// у каждой витрины остаётся собственный canonical, а сегмент «Тип
// объявления» в фильтрах работает навигацией между ними (см. df0e812).
//
//   /cars — продажа. Главная витрина: сюда ведут герой главной,
//           подвал, шапка и страницы ошибок;
//   /rent — аренда. Отдельный SEO-лендинг со своей структурой запросов
//           («rent a car Beograd») и своими ценами за сутки;
//   /all  — продажа и аренда вперемешку. СЛУЖЕБНАЯ витрина: содержимым
//           она дублирует два лендинга выше, поэтому закрыта от
//           индексации и не входит в sitemap.
const SECTIONS = {
  catalog: { path: '/cars', type: 'sale' },
  rent: { path: '/rent', type: 'rent' },
  all: { path: '/all', type: 'both' },
} as const;

export type CatalogSection = keyof typeof SECTIONS;

export default async function CatalogPageView({
  locale,
  searchParams,
  section = 'catalog',
}: {
  locale: Locale;
  searchParams: SearchParams;
  section?: CatalogSection;
}) {
  const t = getT(locale);
  const basePath = SECTIONS[section].path;

  const parsed = parseFilters(searchParams);

  // Тип приходит от маршрута и ПЕРЕКРЫВАЕТ query: /cars?type=rent
  // обязан показывать продажу, иначе адрес врёт о своём содержимом.
  const listingType: ListingType = SECTIONS[section].type;

  const filters = { ...parsed, listingType };

  // ------------------------------------------------------------
  // ПЛИТКА САЛОНА В ВЫДАЧЕ: где показывается и почему не везде.
  // ------------------------------------------------------------
  // Показывается на витрине продажи (/cars) и в смешанной (/all) —
  // именно там человек листает общий поток объявлений, и салон уместен
  // как «а вот кто продаёт помногу».
  //
  // В АРЕНДЕ НЕ ПОКАЗЫВАЕТСЯ: get_showcase_dealers (0095) считает
  // активные объявления салона БЕЗ РАЗБОРА ТИПА СДЕЛКИ, и в разделе
  // аренды плитка обещала бы «47 автомобилей», из которых сдаётся,
  // возможно, ни одного. Чтобы показывать её там честно, RPC нужно
  // учить фильтру по типу — отдельная задача.
  //
  // НЕ ПОКАЗЫВАЕТСЯ ПРИ ЯВНОЙ СОРТИРОВКЕ И ФИЛЬТРАХ: человек, который
  // попросил «сначала дешёвые» или сузил выдачу до BMW, ищет конкретное,
  // и плитка салона посреди его результатов — помеха, а не находка.
  // На SEO-страницах марок вопрос не встаёт вовсе: они рендерят
  // CatalogView напрямую и плитку не передают.
  //
  // Проверяем поля ПОИМЁННО, а не через hasActiveFilters: та считает
  // фильтром и listingType, который на этих витринах задан САМИМ
  // МАРШРУТОМ (/cars → sale) и выдачу по воле пользователя не сужает.
  // С ней условие было бы вечно ложным, и плитка не появилась бы
  // никогда — причём молча.
  const narrowed = Boolean(
    parsed.q ||
      parsed.brand ||
      parsed.model ||
      parsed.city ||
      parsed.yearFrom ||
      parsed.yearTo ||
      parsed.mileageMax ||
      parsed.priceFrom ||
      parsed.priceTo ||
      parsed.bodyType ||
      parsed.transmission ||
      parsed.fuel,
  );

  const showDealer =
    (section === 'catalog' || section === 'all') &&
    (parsed.sort ?? 'fresh') === 'fresh' &&
    !narrowed;

  // Справочники марок и городов строятся по тому же типу, что и выдача:
  // в смешанном режиме показываем всё, что вообще есть на площадке.
  const [result, brands, cities, models, dealers] = await Promise.all([
    fetchCatalog(filters),
    fetchSiteBrands(listingType),
    fetchSiteCities(listingType),
    // Модели грузим только когда марка выбрана: иначе список пуст и
    // лишний запрос к БД не нужен.
    filters.brand ? fetchCatalogModels(filters.brand) : Promise.resolve([]),
    // Салоны для плитки. Берём НЕСКОЛЬКО, хотя на странице стоит один:
    // это даёт ротацию по страницам (см. ниже) без запроса на каждую.
    // Запрос не делается вовсе, когда плитка не показывается.
    showDealer ? fetchShowcaseDealers(8) : Promise.resolve([]),
  ]);

  // РОТАЦИЯ ПО СТРАНИЦАМ. На первой странице стоит первый салон, на
  // второй — второй, и так по кругу. Иначе один и тот же салон
  // преследовал бы человека через всю выдачу, а остальные не
  // показались бы никогда — при том что RPC сортирует их по размеру
  // автопарка и мелкие салоны и так в конце списка.
  //
  // Остаток от деления, а не срез: салонов может быть меньше, чем
  // страниц, и лист обязан замкнуться в круг, а не упереться в конец.
  //
  // ПУСТЫЕ САЛОНЫ В ВЫДАЧУ НЕ ПОПАДАЮТ. Плитка занимает место двух
  // объявлений, и оправдать его она обязана содержимым: салон с одной
  // машиной и без описания показал бы покупателю широкий блок с
  // надписью «1 автомобиль» и пустотой под ней — это выглядит
  // недоделкой сайта, а не витриной компании.
  //
  // Порог: не меньше трёх машин И хотя бы две фотографии для ряда
  // миниатюр. Описание в порог не входит намеренно — оно желательно,
  // но живой автопарк с фотографиями сам по себе информативен, тогда
  // как текст без машин бесполезен.
  const worthShowing = dealers.filter(
    (d) => d.active_cars >= 3 && d.preview_photos.length >= 2,
  );

  const dealer =
    worthShowing.length > 0
      ? (worthShowing[((result.page ?? 1) - 1) % worthShowing.length] ?? null)
      : null;

  // Витрина для карточек. Когда пользователь явно отфильтровал выдачу
  // по типу, карточки показывают цену этой сделки: в списке «только
  // аренда» суточная ставка должна быть основной даже у объявления,
  // которое заодно продаётся. При «Всё» цену выбирает само объявление.
  const cardMode: ListingType = listingType;

  return (
    <>
      {/* Шапке передаётся адрес ВМЕСТЕ С ФИЛЬТРАМИ: из него
          переключатель языка собирает ссылку на зеркало. С голым
          basePath смена языка на отфильтрованной выдаче
          (/cars?brand=bmw&city=beograd) уводила на пустой /ru/cars —
          человек терял отбор и не понимал, куда делись машины.

          Тип в query не пишется: его задаёт сам маршрут витрины, и
          лишний ?type= раздвоил бы адрес (см. SECTIONS выше).
          Страница переносится как есть: на зеркале та же выдача, и
          пятая страница обязана остаться пятой. */}
      <SiteHeader
        locale={locale}
        pathname={`${basePath}${buildQuery(filters, { listingType: undefined })}`}
      />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <CatalogView
          locale={locale}
          // Заголовок называет ИМЕННО ту выдачу, что под ним:
          // «Автомобили на продажу», «Автомобили в аренду» либо
          // «Автомобили в Сербии» для смешанной служебной витрины.
          title={
            section === 'rent'
              ? t('rent_title')
              : section === 'all'
                ? t('catalog_mixed_title')
                : t('catalog_title')
          }
          filters={filters}
          result={result}
          brands={brands}
          cities={cities}
          models={models}
          basePath={basePath}
          mode={cardMode}
          // Тип задан адресом на ВСЕХ трёх витринах: сегмент типа
          // работает навигацией между ними и не считается фильтром.
          lockedType
          dealer={dealer}
        />
      </main>

      {/* Ссылки в подвале ведут в тот же раздел, в котором находится
          пользователь: из аренды — на арендные страницы марок. */}
      <SiteFooter
        locale={locale}
        brands={brands.slice(0, 12)}
        mode={section === 'rent' ? 'rent' : 'sale'}
      />
    </>
  );
}
