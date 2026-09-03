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
//   info        — связь и вспомогательные шаги: «Отправить код».
//                 Синий, как в приложении: он не конкурирует с зелёным
//                 «Опубликовать», хотя стоит на том же экране.
// ============================================================

import Link from 'next/link';
import type { ReactNode } from 'react';

type Variant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'destructive'
  | 'dark'
  | 'info';
// Размеры покрывают ВСЕ высоты кнопок, которые реально есть на сайте.
// Вводить «примерно похожий» размер вместо точного нельзя: замена
// хардкода на компонент обязана быть визуально неотличимой.
//   xs — компактный CTA в шапке на мобильном (там дорог каждый пиксель);
//   sm — действия в пустом состоянии и чипсы сортировки;
//   md — поля форм и кнопки шагов подачи;
//   lg — главные действия на экранах 404/500 и в герое.
//   xl — парные CTA в герое главной: они шире прочих, потому что
//        стоят на пустом поле и должны читаться как главный вход.
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

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
  info: 'bg-brand-blue text-white hover:brightness-95',
};

// Размеры. md — размер по умолчанию, совпадает с прежним px-4 py-3.
// Значения перенесены из разметки без изменений: подписи кнопок берут
// ступени caption (14px) и small (12px) из шкалы бренда.
const SIZES: Record<Size, string> = {
  xs: 'px-2.5 py-2.5 text-small sm:px-3 sm:text-caption',
  sm: 'px-4 py-2.5 text-caption',
  md: 'px-4 py-3',
  lg: 'px-5 py-3',
  xl: 'px-6 py-3',
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
  // Кнопка-переключатель (избранное): состояние «нажата». Скринридер
  // объявляет его сам, и без атрибута смена подписи остаётся для него
  // просто другим текстом, без указания, что это два состояния одного
  // переключателя.
  //
  // Поле перечислено явно, а не расширением ButtonHTMLAttributes:
  // props здесь закрытые намеренно — открытый набор позволил бы
  // передать снаружи className-конфликты и обработчики, которые
  // компонент не контролирует.
  'aria-pressed'?: boolean;
};

type LinkProps = CommonProps & {
  href: string;
  // Внешние ссылки (сторы, deep link) открываются обычным <a>:
  // Link предназначен для внутренней навигации.
  external?: boolean;
  target?: string;
  rel?: string;
  // Побочное действие при переходе — на практике отправка события
  // аналитики. Переход при этом остаётся НАСТОЯЩЕЙ ссылкой: обработчик
  // ничего не отменяет и не подменяет навигацию. Подменять её нельзя —
  // сломались бы открытие в новой вкладке и предзагрузка Next.
  onClick?: () => void;
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
    const { href, external, target, rel, onClick } = props;

    if (external) {
      return (
        <a
          href={href}
          target={target}
          rel={rel}
          onClick={onClick}
          className={classes}
        >
          {children}
        </a>
      );
    }

    return (
      <Link
        href={href}
        target={target}
        rel={rel}
        onClick={onClick}
        className={classes}
      >
        {children}
      </Link>
    );
  }

  // Кнопка.
  const {
    type = 'button',
    disabled,
    onClick,
    'aria-pressed': ariaPressed,
  } = props as ButtonProps;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={ariaPressed}
      className={classes}
    >
      {children}
    </button>
  );
}
