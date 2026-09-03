// ============================================================
// RS AUTO — Избранное (/my/favorites), сербская версия.
// ============================================================
// Разметка живёт в components/pages/FavoritesPageView — общая с
// /ru/my/favorites. Проверку сессии задаёт layout кабинета.
//
// СВОИ МЕТАДАННЫЕ, А НЕ УНАСЛЕДОВАННЫЕ ОТ LAYOUT'А. Все разделы
// кабинета показывали во вкладке браузера один и тот же заголовок
// «Moj nalog» — layout задаёт его один на всё поддерево. Человек с
// несколькими открытыми вкладками не мог отличить избранное от
// переписки и настроек.
//
// title.absolute, а не обычный title: корневой layout оборачивает
// заголовок шаблоном «%s | RS Auto» (app/layout.tsx), и обычное
// значение дало бы «Favoriti | RS Auto» — с вертикальной чертой
// вместо тире. absolute шаблон обходит и печатает строку как есть.
//
// robots ЗДЕСЬ НЕ ПОВТОРЯЕТСЯ: noindex, nofollow, nocache и
// noimageindex уже стоят в generateMetadata layout'а кабинета и
// наследуются страницей. Дублировать их значило бы завести второй
// источник истины — при правке layout'а эта копия молча осталась бы
// прежней. Проверено на отдаваемом HTML: тег приходит от layout'а.
//
// description ГАСИТСЯ ЯВНО, значением null. Просто не указать его
// мало: корневой layout задаёт общее описание сайта («Kupovina i
// prodaja automobila u Srbiji»), и оно наследуется всем поддеревом —
// проверено на отдаваемом HTML, тег приходил на личную страницу.
// null в Next означает «убрать унаследованное», тогда как undefined
// значит «не переопределять». Страница закрыта от индексации, в
// выдаче не появится, и описывать её поисковику не для кого.
// ============================================================

import type { Metadata } from 'next';

import FavoritesPageView from '@/components/pages/FavoritesPageView';
import { parseDealerPage } from '@/lib/dealerPage';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { SearchParams } from '@/lib/searchParams';
import { brand } from '@/lib/brand';

const locale: Locale = 'sr';

export function generateMetadata(): Metadata {
  const t = getT(locale);

  return {
    title: { absolute: `${t('favorites_title')} — ${brand.name}` },
    description: null,
  };
}

export default async function MyFavoritesPage({
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
