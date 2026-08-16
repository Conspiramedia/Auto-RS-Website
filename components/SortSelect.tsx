// ============================================================
// RS AUTO — Выбор сортировки. Server Component.
// ============================================================
// Сделан ссылками, а не <select> с onChange: варианты сортировки должны
// быть настоящими адресами (SSR + возможность поделиться ссылкой на
// «сначала дешёвые»). Клиентский JS для этого не нужен.
// ============================================================

import Link from 'next/link';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import type { CatalogFilters } from '@/lib/queries';
import { buildQuery } from '@/lib/searchParams';
import { SORT_OPTIONS } from '@/lib/types';

type Props = {
  locale: Locale;
  filters: CatalogFilters;
  basePath: string;
};

export default function SortSelect({ locale, filters, basePath }: Props) {
  const t = getT(locale);
  const current = filters.sort ?? 'fresh';

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="hidden text-black/50 sm:inline">{t('catalog_sort')}:</span>

      <div className="no-scrollbar flex gap-1 overflow-x-auto">
        {SORT_OPTIONS.map((opt) => {
          const active = opt.key === current;
          return (
            <Link
              key={opt.key}
              // Смена сортировки всегда возвращает на первую страницу:
              // оставаться на 5-й странице при новом порядке бессмысленно.
              href={
                localeHref(locale, basePath) +
                buildQuery(filters, { sort: opt.key, page: 1 })
              }
              className={
                active
                  ? 'whitespace-nowrap rounded-control bg-brand-dark px-3 py-1.5 font-semibold text-white'
                  : 'whitespace-nowrap rounded-control px-3 py-1.5 text-black/60 hover:bg-black/[0.05]'
              }
              // Варианты сортировки — это одна и та же выдача в другом
              // порядке. Индексировать их все не нужно.
              rel="nofollow"
            >
              {opt[locale]}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
