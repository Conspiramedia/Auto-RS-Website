// ============================================================
// RS AUTO — Содержимое страницы каталога /cars, общее для sr и ru.
// ============================================================

import CatalogView from '@/components/CatalogView';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import {
  fetchCatalog,
  fetchCatalogModels,
  fetchSiteBrands,
  fetchSiteCities,
} from '@/lib/queries';
import type { SearchParams } from '@/lib/searchParams';
import { parseFilters } from '@/lib/searchParams';
import type { ListingType } from '@/lib/types';

export default async function CatalogPageView({
  locale,
  searchParams,
  // Раздел:
  //   'catalog' — /cars, СМЕШАННЫЙ фид. Тип объявления выбирается
  //     фильтром и приходит из query (?type=), по умолчанию «Всё»;
  //   'rent' — SEO-лендинг /rent. Тип зафиксирован адресом, сегмент
  //     выбора типа в фильтрах скрыт.
  section = 'catalog',
}: {
  locale: Locale;
  searchParams: SearchParams;
  section?: 'catalog' | 'rent';
}) {
  const t = getT(locale);
  const isRentLanding = section === 'rent';
  const basePath = isRentLanding ? '/rent' : '/cars';

  const parsed = parseFilters(searchParams);

  // На лендинге аренды тип задан адресом и перекрывает query.
  // В каталоге тип берётся из фильтра, по умолчанию — смешанная выдача.
  const listingType: ListingType = isRentLanding
    ? 'rent'
    : (parsed.listingType ?? 'both');

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
      <SmartBanner locale={locale} />
      <SiteHeader locale={locale} pathname={basePath} />

      <main className="mx-auto max-w-6xl px-4 py-6">
        <CatalogView
          locale={locale}
          title={isRentLanding ? t('rent_title') : t('catalog_mixed_title')}
          filters={filters}
          result={result}
          brands={brands}
          cities={cities}
          models={models}
          basePath={basePath}
          mode={cardMode}
          // На лендинге аренды тип задан адресом — сегмент скрыт.
          lockedType={isRentLanding}
          infinite={infinite}
        />
      </main>

      {/* Ссылки в подвале ведут в тот же раздел, в котором находится
          пользователь: из аренды — на арендные страницы марок. */}
      <SiteFooter
        locale={locale}
        brands={brands.slice(0, 12)}
        mode={isRentLanding ? 'rent' : 'sale'}
      />
    </>
  );
}
