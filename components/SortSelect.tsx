'use client';

// ============================================================
// RS AUTO — Выбор сортировки.
// ============================================================
// Два представления одного набора вариантов:
//   * МОБИЛЬНЫЕ — нативный <select>. Шесть вариантов сортировки в виде
//     горизонтальной ленты чипсов растягивали страницу вправо и давали
//     горизонтальный скролл всего документа на 360px;
//   * ДЕСКТОП — чипсы-ссылки: они видны все сразу и остаются настоящими
//     <a href>, то есть индексируются и открываются в новой вкладке.
//
// Мобильный select — Client Component (переход по onChange), десктопные
// чипсы — обычные ссылки внутри того же компонента. Разделять на два
// файла смысла нет: набор вариантов и сборка адреса общие.
// ============================================================

import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();
  const current = filters.sort ?? 'fresh';

  // Смена сортировки всегда возвращает на первую страницу: оставаться
  // на 5-й странице при новом порядке бессмысленно.
  const hrefFor = (key: (typeof SORT_OPTIONS)[number]['key']) =>
    localeHref(locale, basePath) + buildQuery(filters, { sort: key, page: 1 });

  return (
    <>
      {/* Мобильные: компактный нативный список. Занимает одну строку
          независимо от числа вариантов. */}
      <select
        value={current}
        onChange={(e) => router.push(hrefFor(e.target.value as never))}
        aria-label={t('catalog_sort')}
        className="h-10 max-w-[52vw] truncate rounded-control border border-neutral-15 bg-white px-2.5 text-caption outline-none focus:border-brand-primary sm:hidden"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {opt[locale]}
          </option>
        ))}
      </select>

      {/* Десктоп: чипсы-ссылки в один ряд.
          flex-wrap здесь НЕЛЬЗЯ: шесть вариантов переносятся на вторую
          строку и наезжают на счётчик слева. Вместо переноса — лента с
          прокруткой, как было до редизайна. */}
      <div className="hidden min-w-0 items-center gap-2 text-caption sm:flex">
        <span className="shrink-0 text-neutral-50">{t('catalog_sort')}:</span>

        {/* min-w-0 + overflow-x-auto: лента сжимается по доступному
            месту и прокручивается внутри себя, вместо того чтобы
            распирать панель и уезжать на вторую строку. */}
        <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto">
          {SORT_OPTIONS.map((opt) => {
            const active = opt.key === current;
            return (
              <Link
                key={opt.key}
                href={hrefFor(opt.key)}
                className={
                  active
                    ? 'whitespace-nowrap rounded-control bg-brand-dark px-3 py-1.5 font-semibold text-white'
                    : 'whitespace-nowrap rounded-control px-3 py-1.5 text-neutral-60 hover:bg-surface-hoverChip'
                }
                // Варианты сортировки — одна и та же выдача в другом
                // порядке. Индексировать их все не нужно.
                rel="nofollow"
              >
                {opt[locale]}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
