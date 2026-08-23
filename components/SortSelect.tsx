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
//
// Какое из двух представлений показать, по умолчанию решает медиазапрос
// (variant='auto'). Но вызывающий может задать его явно — см. проп
// variant ниже: в каталоге сортировка стоит в двух разных по тесноте
// рядах, и там выбор диктует раскладка, а не ширина экрана.
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
  // Какое представление показать. По умолчанию 'auto' — прежнее
  // поведение: компонент выбирает его сам по ширине экрана
  // (select до 640px, чипсы выше).
  //
  // Явные значения нужны там, где представление определяется НЕ
  // шириной экрана, а местом в раскладке. В каталоге сортировка стоит
  // в двух разных рядах — тесном верхнем (до 768px) и просторном
  // нижнем (с 768px), — и каждый ряд знает нужное ему представление
  // точнее, чем медиазапрос внутри компонента: при 'auto' в диапазоне
  // 640–767px в верхний ряд попала бы лента чипсов, которой там не
  // хватает места.
  variant?: 'auto' | 'compact' | 'chips';
};

export default function SortSelect({
  locale,
  filters,
  basePath,
  variant = 'auto',
}: Props) {
  const t = getT(locale);
  const router = useRouter();
  const current = filters.sort ?? 'fresh';

  // Смена сортировки всегда возвращает на первую страницу: оставаться
  // на 5-й странице при новом порядке бессмысленно.
  const hrefFor = (key: (typeof SORT_OPTIONS)[number]['key']) =>
    localeHref(locale, basePath) + buildQuery(filters, { sort: key, page: 1 });

  // Классы видимости нужны ТОЛЬКО в режиме auto: там представление
  // выбирает медиазапрос. При явном variant элемент показывается
  // всегда — его показом управляет обёртка снаружи.
  const selectVisibility = variant === 'auto' ? 'sm:hidden' : '';
  const chipsVisibility = variant === 'auto' ? 'hidden sm:flex' : 'flex';

  return (
    <>
      {/* Компактный нативный список. Занимает одну строку независимо
          от числа вариантов, поэтому подходит для тесных рядов. */}
      {variant !== 'chips' && (
        <select
          value={current}
          onChange={(e) => router.push(hrefFor(e.target.value as never))}
          aria-label={t('catalog_sort')}
          className={`h-10 max-w-[52vw] truncate rounded-control border border-neutral-15 bg-white px-2.5 text-caption outline-none focus:border-brand-primary ${selectVisibility}`}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt[locale]}
            </option>
          ))}
        </select>
      )}

      {/* Чипсы-ссылки в один ряд: видны все варианты сразу, и каждый
          остаётся настоящим <a href>.
          flex-wrap здесь НЕЛЬЗЯ: шесть вариантов переносятся на вторую
          строку и наезжают на счётчик слева. Вместо переноса — лента с
          прокруткой, как было до редизайна. */}
      {variant !== 'compact' && (
        <div
          className={`${chipsVisibility} min-w-0 items-center gap-2 text-caption`}
        >
          <span className="shrink-0 text-neutral-50">
            {t('catalog_sort')}:
          </span>

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
      )}
    </>
  );
}
