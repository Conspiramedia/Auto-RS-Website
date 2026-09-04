// ============================================================
// RS AUTO — Значки состояния автомобиля (миграция 0138).
// ============================================================
// Иконочного пакета в проекте нет (см. package.json: только next,
// react, supabase и qrcode), поэтому набор нарисован здесь по образцу
// уже существующих — ui/NavIcons.tsx и ui/InstallIcons.tsx. Ставить
// lucide-react ради пяти значков значило бы тянуть зависимость в
// сборку клиента там, где хватает нескольких сотен байт разметки.
//
// Формы повторяют lucide под именами Hammer, Cog, FileX, Ban, Plane —
// ровно те, что заданы требованием. Бейдж состояния читается на бегу,
// и узнаваемость значка здесь важнее оригинальности.
//
// ЕДИНЫЙ КАРКАС: viewBox 24, обводка currentColor, толщина 2,
// скруглённые концы и стыки — тот же контракт, что у NavIcons.
//
// Цвет НЕ задаётся внутри: его наследует currentColor от бейджа,
// поэтому один и тот же значок годится и для белого текста на цветной
// плашке в каталоге, и для цветного текста на разбавленной подложке
// на странице объявления — без единого условия внутри самих иконок.
// ============================================================

import type { ReactNode } from 'react';

import type { CarCondition } from '@/lib/types';

type IconProps = {
  className?: string;
};

// Общие атрибуты. Вынесены, чтобы толщина линии и скругления не
// разъехались между значками — та же причина, что в NavIcons.
const STROKE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// Обёртка: единственное место, где стоит aria-hidden. Значок
// декоративен — рядом всегда стоит подпись состояния, и озвучивать
// его скринридеру значило бы читать бейдж дважды.
function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg {...STROKE} aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

// Hammer — битый: молоток как знак кузовного ремонта.
export function HammerIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m15 12-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9" />
      <path d="M17.64 15 22 10.64" />
      <path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91" />
    </Icon>
  );
}

// Cog — на запчасти: шестерня как знак разборки на детали.
export function CogIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
      <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </Icon>
  );
}

// FileX — без документов: лист бумаги с перечёркиванием.
export function FileXIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m14.5 12.5-5 5" />
      <path d="m9.5 12.5 5 5" />
    </Icon>
  );
}

// Ban — тотал: перечёркнутый круг, знак необратимости.
export function BanIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </Icon>
  );
}

// Plane — только на экспорт: самолёт как знак вывоза из страны.
export function PlaneIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z" />
    </Icon>
  );
}

// Значок по состоянию. У 'normal' значка нет — обычная машина бейджа
// не получает вовсе, и вызывающий до этой функции не доходит.
export function ConditionIcon({
  condition,
  className,
}: {
  condition: CarCondition | string;
  className?: string;
}) {
  switch (condition) {
    case 'damaged':
      return <HammerIcon className={className} />;
    case 'parts':
      return <CogIcon className={className} />;
    case 'no_docs':
      return <FileXIcon className={className} />;
    case 'salvage':
      return <BanIcon className={className} />;
    case 'for_export':
      return <PlaneIcon className={className} />;
    default:
      return null;
  }
}
