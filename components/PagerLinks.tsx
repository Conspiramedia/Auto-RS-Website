// ============================================================
// RS AUTO — Простая постраничная навигация. Server Component.
// ============================================================
// ЧЕМ ОТЛИЧАЕТСЯ ОТ components/Pagination. Тот принимает
// CatalogFilters и собирает адреса через buildQuery — то есть знает
// про марки, цены, коробки и сортировку каталога. Витрине продавца из
// всего этого нужен ОДИН параметр — номер страницы, и передавать туда
// пустой объект фильтров значило бы притворяться каталогом: любой
// новый фильтр каталога автоматически стал бы частью адресов витрины.
//
// Поэтому здесь свой, узкий компонент: путь плюс номер страницы.
// Внешний вид, окно номеров и разметка rel=prev/next повторяют
// Pagination намеренно — посетитель не должен замечать, что это два
// разных компонента.
//
// ССЫЛКИ, А НЕ КНОПКИ, по той же причине, что в каталоге: краулер
// обязан дойти до второй страницы витрины салона, иначе половина его
// автопарка не имеет ни одной входящей ссылки.
// ============================================================

import Link from 'next/link';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

type Props = {
  locale: Locale;
  // Путь без префикса локали и без строки запроса: '/dealer/{id}'.
  basePath: string;
  page: number;
  totalPages: number;
};

// Адрес страницы. Первая — без параметра: '/dealer/x' и
// '/dealer/x?page=1' должны быть одной страницей, а не двумя, иначе
// у витрины появится дубль с тем же содержимым.
function hrefFor(locale: Locale, basePath: string, target: number): string {
  const path = localeHref(locale, basePath);
  return target > 1 ? `${path}?page=${target}` : path;
}

// Окно номеров вокруг текущей страницы — та же логика, что в
// Pagination: показывать все номера подряд вредно для вёрстки на
// мобильном.
function pageWindow(page: number, totalPages: number): number[] {
  const span = 2;
  const from = Math.max(1, page - span);
  const to = Math.min(totalPages, page + span);
  const pages: number[] = [];
  for (let i = from; i <= to; i += 1) pages.push(i);
  return pages;
}

export default function PagerLinks({
  locale,
  basePath,
  page,
  totalPages,
}: Props) {
  const t = getT(locale);

  if (totalPages <= 1) return null;

  const href = (target: number) => hrefFor(locale, basePath, target);
  const pages = pageWindow(page, totalPages);

  const base =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-control px-3 text-caption';

  return (
    <nav
      className="mt-8 flex flex-wrap items-center justify-center gap-1"
      aria-label={t('catalog_page')}
    >
      {page > 1 && (
        <Link
          href={href(page - 1)}
          className={`${base} border border-neutral-15`}
          rel="prev"
        >
          ‹
        </Link>
      )}

      {pages[0] > 1 && (
        <>
          <Link href={href(1)} className={`${base} border border-neutral-15`}>
            1
          </Link>
          {pages[0] > 2 && <span className="px-1 text-neutral-40">…</span>}
        </>
      )}

      {pages.map((p) => (
        <Link
          key={p}
          href={href(p)}
          className={
            p === page
              ? `${base} bg-brand-dark font-semibold text-white`
              : `${base} border border-neutral-15 hover:bg-surface-hoverStrong`
          }
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </Link>
      ))}

      {pages[pages.length - 1] < totalPages && (
        <>
          {pages[pages.length - 1] < totalPages - 1 && (
            <span className="px-1 text-neutral-40">…</span>
          )}
          <Link
            href={href(totalPages)}
            className={`${base} border border-neutral-15`}
          >
            {totalPages}
          </Link>
        </>
      )}

      {page < totalPages && (
        <Link
          href={href(page + 1)}
          className={`${base} border border-neutral-15`}
          rel="next"
        >
          ›
        </Link>
      )}
    </nav>
  );
}

// ------------------------------------------------------------
// <link rel="prev"/"next"> в <head> для той же навигации.
// ------------------------------------------------------------
// Отдельным компонентом по той же причине, что PaginationLinks в
// каталоге: Metadata API не умеет произвольные <link rel>, а обычный
// <link> из тела серверного компонента Next поднимает в <head> сам.
// Адреса строит та же hrefFor, поэтому видимая навигация и разметка
// не могут разойтись.
export function PagerHeadLinks({
  locale,
  basePath,
  page,
  totalPages,
  baseUrl,
}: Props & { baseUrl: string }) {
  if (totalPages <= 1) return null;

  const url = (target: number) =>
    `${baseUrl}${hrefFor(locale, basePath, target)}`;

  return (
    <>
      {page > 1 && <link rel="prev" href={url(page - 1)} />}
      {page < totalPages && <link rel="next" href={url(page + 1)} />}
    </>
  );
}
