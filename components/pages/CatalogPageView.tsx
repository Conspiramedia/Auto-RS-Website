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

  // Бесконечная лента включается только там, где она уместна:
  //   * дефолтная сортировка (при явной «сначала дешёвые» перемешка
  //     противоречит просьбе пользователя — порядок задан им);
  //   * первая страница (пришёл человек по ссылке на 5-ю страницу —
  //     он ожидает именно её, а не ленту с начала).
  // На SEO-страницах марок и моделей лента не включается вовсе:
  // там нужна стабильная индексируемая выдача.
  const infinite =
    (parsed.sort ?? 'fresh') === 'fresh' && (parsed.page ?? 1) === 1;

  // SEED ПЕРВОГО КРУГА НЕ ГЕНЕРИРУЕТСЯ НА СЕРВЕРЕ — намеренно.
  // Страница кэшируется (revalidate = 120), поэтому случайное число,
  // выбранное при рендере, застыло бы в кэше и было бы ОДНИМ И ТЕМ ЖЕ
  // для всех посетителей до следующей ревалидации — то есть никакой
  // «живости» не дало бы, зато сломало бы детерминированность SSR.
  //
  // Поэтому первый круг идёт с seed = null: сервер перемешивает по
  // current_date (стабильно сутки — то, что нужно и краулеру, и
  // offset-пагинации). Новый seed появляется на СТЫКЕ КРУГОВ уже на
  // клиенте, когда первый круг исчерпан. Именно там разнообразие и
  // нужно — чтобы лента не пошла по второму разу тем же порядком.

  // Справочники марок и городов строятся по тому же типу, что и выдача:
  // в смешанном режиме показываем всё, что вообще есть на площадке.
  const [result, brands, cities, models] = await Promise.all([
    fetchCatalog(filters),
    fetchSiteBrands(listingType),
    fetchSiteCities(listingType),
    // Модели грузим только когда марка выбрана: иначе список пуст и
    // лишний запрос к БД не нужен.
    filters.brand ? fetchCatalogModels(filters.brand) : Promise.resolve([]),
  ]);

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
          infinite={infinite}
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
