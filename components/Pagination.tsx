// ============================================================
// RS AUTO — Пагинация каталога. Server Component.
// ============================================================
// Обычные ссылки: краулер должен уметь дойти до глубоких страниц каталога,
// а «показать ещё» на скрипте такой возможности не даёт.
// ============================================================

import Link from 'next/link';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import type { CatalogFilters } from '@/lib/queries';
import { buildQuery } from '@/lib/searchParams';

type Props = {
  locale: Locale;
  filters: CatalogFilters;
  basePath: string;
  page: number;
  totalPages: number;
};

// Окно номеров вокруг текущей страницы: показывать 200 ссылок подряд
// бессмысленно и вредно для вёрстки на мобильных.
function pageWindow(page: number, totalPages: number): number[] {
  const span = 2;
  const from = Math.max(1, page - span);
  const to = Math.min(totalPages, page + span);
  const pages: number[] = [];
  for (let i = from; i <= to; i += 1) pages.push(i);
  return pages;
}

export default function Pagination({
  locale,
  filters,
  basePath,
  page,
  totalPages,
}: Props) {
  const t = getT(locale);

  // Одна страница — навигация не нужна.
  if (totalPages <= 1) return null;

  const href = (target: number) =>
    localeHref(locale, basePath) + buildQuery(filters, { page: target });

  const pages = pageWindow(page, totalPages);

  const base =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-control px-3 text-sm';

  return (
    <nav
      className="mt-8 flex flex-wrap items-center justify-center gap-1"
      aria-label={t('catalog_page')}
    >
      {page > 1 && (
        <Link href={href(page - 1)} className={`${base} border border-black/15`} rel="prev">
          ‹
        </Link>
      )}

      {/* Ссылка на первую страницу, если окно начинается не с неё. */}
      {pages[0] > 1 && (
        <>
          <Link href={href(1)} className={`${base} border border-black/15`}>
            1
          </Link>
          {pages[0] > 2 && <span className="px-1 text-black/40">…</span>}
        </>
      )}

      {pages.map((p) => (
        <Link
          key={p}
          href={href(p)}
          className={
            p === page
              ? `${base} bg-brand-dark font-semibold text-white`
              : `${base} border border-black/15 hover:bg-black/[0.04]`
          }
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </Link>
      ))}

      {pages[pages.length - 1] < totalPages && (
        <>
          {pages[pages.length - 1] < totalPages - 1 && (
            <span className="px-1 text-black/40">…</span>
          )}
          <Link href={href(totalPages)} className={`${base} border border-black/15`}>
            {totalPages}
          </Link>
        </>
      )}

      {page < totalPages && (
        <Link href={href(page + 1)} className={`${base} border border-black/15`} rel="next">
          ›
        </Link>
      )}
    </nav>
  );
}
