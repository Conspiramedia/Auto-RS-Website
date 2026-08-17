// ============================================================
// RS AUTO — Контейнер-карточка.
// ============================================================
// Обёртка «граница + радиус контейнера + внутренний отступ», которая
// в разметке встречалась россыпью: формы, блок цены на карточке
// объявления, пустое состояние, экран успеха подачи.
//
// Тень по умолчанию НЕ включена: на сайте карточки разделяются
// границей, а тень появляется только у кликабельной карточки
// объявления при наведении (hoverable). Тень «на всякий случай»
// сделала бы страницу шумной.
// ============================================================

import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  // Внутренний отступ. none — когда содержимое само управляет
  // отступами (карточка объявления с фотографией во всю ширину).
  padding?: 'none' | 'sm' | 'md';
  // Реакция на наведение для кликабельных карточек.
  hoverable?: boolean;
  className?: string;
};

const PADDINGS = {
  none: '',
  sm: 'p-3',
  // Прежнее «p-4 sm:p-6» форм — самый частый вариант.
  md: 'p-4 sm:p-6',
} as const;

export default function Card({
  children,
  padding = 'md',
  hoverable = false,
  className = '',
}: Props) {
  const classes = [
    'rounded-card border border-neutral-10',
    PADDINGS[padding],
    hoverable
      ? 'overflow-hidden transition-shadow duration-fast ease-out hover:shadow-card'
      : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <div className={classes}>{children}</div>;
}
