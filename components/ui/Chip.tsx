// ============================================================
// RS AUTO — Чипс. Три роли в одном компоненте.
// ============================================================
// На сайте чипсы встречаются в трёх местах, и раньше каждое несло
// свой набор классов:
//   * применённый фильтр с «×» (FilterChips) — removable;
//   * вариант сортировки (SortSelect, десктоп) — ссылка, active/default;
//   * популярная марка (главная, подвал) — ссылка-ярлык.
//
// Рендерится как <a>, <button> или <span> — по переданным свойствам.
// Ссылочная форма обязательна для фильтров и сортировки: это настоящие
// адреса, которые должны открываться в новой вкладке и индексироваться.
// ============================================================

import Link from 'next/link';
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  // Ссылка. Для варианта «удаляемый фильтр» ведёт на выдачу без него.
  href?: string;
  // Подсвеченное состояние: текущая сортировка, выбранное значение.
  active?: boolean;
  size?: 'sm' | 'md';
  // Не индексировать: варианты сортировки — та же выдача в другом
  // порядке, отдавать на них вес не нужно.
  nofollow?: boolean;
  // Подпись для скринридера, когда текст чипса сам по себе неполон
  // («BMW ×» → «Убрать фильтр: марка BMW»).
  ariaLabel?: string;
  className?: string;
};

const BASE =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-control font-medium transition-colors duration-fast ease-out';

const SIZES = {
  sm: 'px-2.5 py-1 text-small',
  md: 'px-3 py-1.5 text-caption',
} as const;

export default function Chip({
  children,
  href,
  active = false,
  size = 'md',
  nofollow = false,
  ariaLabel,
  className = '',
}: Props) {
  const classes = [
    BASE,
    SIZES[size],
    active
      ? 'bg-brand-dark font-semibold text-white'
      : 'border border-neutral-15 text-neutral-60 hover:bg-surface-hover',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (href) {
    return (
      <Link
        href={href}
        className={classes}
        aria-label={ariaLabel}
        rel={nofollow ? 'nofollow' : undefined}
      >
        {children}
      </Link>
    );
  }

  return (
    <span className={classes} aria-label={ariaLabel}>
      {children}
    </span>
  );
}
