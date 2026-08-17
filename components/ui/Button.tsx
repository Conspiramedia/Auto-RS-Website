// ============================================================
// RS AUTO — Кнопка. Единственный источник стилей действий.
// ============================================================
// До этого набор классов «rounded-control bg-brand-green px-4 py-3
// font-semibold text-white» был скопирован в 16 местах, и любая правка
// главного действия означала 16 одинаковых изменений.
//
// Рендерится либо как <button>, либо как ссылка Next (<Link>) — по
// наличию href. Это важно для SEO и доступности: переход по адресу
// обязан оставаться настоящей ссылкой (её видит краулер, её можно
// открыть в новой вкладке), а действие на странице — кнопкой.
//
// ВАРИАНТЫ (роль, а не цвет):
//   primary     — главное/подтверждающее действие. Зелёный. На экране
//                 он один: это правило бренда, второго яркого CTA быть
//                 не должно.
//   secondary   — равнозначное действие рядом с главным. Контурная.
//   ghost       — третьестепенное: «Назад», ссылки в подвале карточки.
//   destructive — сброс фильтров и деструктивные действия. Красный.
//   dark        — нейтральная тёмная плашка: «Сбросить фильтры»
//                 в пустом состоянии, кнопка фильтров, активный чипс.
// ============================================================

import Link from 'next/link';
import type { ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'dark';
type Size = 'sm' | 'md' | 'lg';

// Базовые классы: общие для всех вариантов и размеров.
// transition + duration-fast дают отклик на наведение — раньше его
// не было ни у одной кнопки, кроме карточки объявления.
const BASE =
  'inline-flex items-center justify-center rounded-control font-semibold transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-40';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-green text-white hover:brightness-95',
  secondary: 'border border-neutral-15 bg-white hover:bg-surface-hover',
  ghost: 'text-brand-blue hover:bg-surface-hover',
  destructive: 'bg-brand-red text-white hover:brightness-95',
  dark: 'bg-brand-dark text-white hover:brightness-110',
};

// Размеры. md — размер по умолчанию, совпадает с прежним px-4 py-3.
const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-caption',
  md: 'px-4 py-3',
  lg: 'px-5 py-3',
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  // Растянуть на всю ширину контейнера — частый случай в формах.
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
};

type ButtonProps = CommonProps & {
  href?: undefined;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
};

type LinkProps = CommonProps & {
  href: string;
  // Внешние ссылки (сторы, deep link) открываются обычным <a>:
  // Link предназначен для внутренней навигации.
  external?: boolean;
  target?: string;
  rel?: string;
};

export default function Button(props: ButtonProps | LinkProps) {
  const {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    className = '',
    children,
  } = props;

  const classes = [
    BASE,
    VARIANTS[variant],
    SIZES[size],
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Ссылка.
  if ('href' in props && props.href !== undefined) {
    const { href, external, target, rel } = props;

    if (external) {
      return (
        <a href={href} target={target} rel={rel} className={classes}>
          {children}
        </a>
      );
    }

    return (
      <Link href={href} target={target} rel={rel} className={classes}>
        {children}
      </Link>
    );
  }

  // Кнопка.
  const { type = 'button', disabled, onClick } = props as ButtonProps;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={classes}
    >
      {children}
    </button>
  );
}
