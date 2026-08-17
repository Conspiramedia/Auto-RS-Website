// ============================================================
// RS AUTO — <link rel="prev"/"next"> для пагинации каталога.
// ============================================================
// ПОЧЕМУ ОТДЕЛЬНЫМ КОМПОНЕНТОМ, А НЕ ЧЕРЕЗ generateMetadata.
// Metadata API в Next не умеет произвольные <link rel>: поле `other`
// рендерит <meta>, а `alternates` рассчитано на canonical, hreflang и
// media-варианты. Зато обычный <link>, отрисованный в теле серверного
// компонента, Next сам поднимает в <head> — этим и пользуемся.
//
// ЗАЧЕМ ЭТО НУЖНО, если Google в 2019 объявил, что rel=prev/next больше
// не использует как сигнал индексирования: разметку по-прежнему читают
// Bing и Yandex, а браузеры и читалки — для предзагрузки. Стоимость
// нулевая, поэтому оставляем.
//
// Ссылки строятся ТЕМ ЖЕ buildQuery, что и видимая пагинация, поэтому
// адреса совпадают до символа и не плодят дублей для краулера.
// ============================================================

import type { Locale } from '@/lib/i18n';
import { localeHref } from '@/lib/i18n';
import type { CatalogFilters } from '@/lib/queries';
import { buildQuery } from '@/lib/searchParams';
import { siteBaseUrl } from '@/lib/supabase';

type Props = {
  locale: Locale;
  filters: CatalogFilters;
  // Базовый путь без префикса локали: '/cars', '/rent/bmw'.
  basePath: string;
  page: number;
  totalPages: number;
};

export default function PaginationLinks({
  locale,
  filters,
  basePath,
  page,
  totalPages,
}: Props) {
  // Одна страница — соседей нет, разметка не нужна.
  if (totalPages <= 1) return null;

  // Адрес абсолютный: rel=prev/next в <head> должен указывать на
  // полный URL, иначе часть краулеров разрешит его неправильно.
  const url = (target: number) =>
    `${siteBaseUrl}${localeHref(locale, basePath)}${buildQuery(filters, {
      page: target,
    })}`;

  return (
    <>
      {page > 1 && <link rel="prev" href={url(page - 1)} />}
      {page < totalPages && <link rel="next" href={url(page + 1)} />}
    </>
  );
}
