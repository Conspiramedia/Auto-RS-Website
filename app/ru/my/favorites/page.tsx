// ============================================================
// RS AUTO — Избранное (/ru/my/favorites), русская версия.
// ============================================================
// Разметка живёт в components/pages/FavoritesPageView — общая с
// /my/favorites. Метаданные (noindex) и проверку сессии задаёт
// layout кабинета.
// ============================================================

import FavoritesPageView from '@/components/pages/FavoritesPageView';
import type { Locale } from '@/lib/i18n';
import { parseDealerPage } from '@/lib/dealerPage';
import type { SearchParams } from '@/lib/searchParams';

const locale: Locale = 'ru';

export default async function RuMyFavoritesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Разбор номера страницы общий с витриной салона: правила у них
  // одни и те же — мусор в адресе ('?page=abc', '?page=-3') даёт
  // первую страницу, а не ошибку. Вторая копия того же Number(...)
  // разошлась бы с оригиналом при первой правке.
  const page = parseDealerPage(await searchParams);

  return <FavoritesPageView locale={locale} page={page} />;
}
