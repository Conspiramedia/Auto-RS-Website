// ============================================================
// RS AUTO — Значки метрик кабинета продавца (0141).
// ============================================================
// Иконочного пакета в проекте нет (см. package.json: только next,
// react, supabase и qrcode), поэтому набор нарисован здесь по образцу
// уже существующих — ui/NavIcons.tsx, ui/InstallIcons.tsx,
// ui/ConditionIcons.tsx. Ставить lucide-react ради четырёх значков
// значило бы тянуть зависимость в сборку клиента там, где хватает
// нескольких сотен байт разметки.
//
// Формы повторяют lucide под именами FileText, Eye, Heart,
// MessageCircle — ровно те, что заданы требованием.
//
// ЕДИНЫЙ КАРКАС: viewBox 24, обводка currentColor, толщина 2,
// скруглённые концы и стыки — тот же контракт, что у соседних наборов.
//
// Цвет НЕ задаётся внутри: его наследует currentColor от круга-
// подложки, который красит карточка (text-metric-views и т.д.).
// ============================================================

import type { ReactNode } from 'react';

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

// Обёртка: единственное место, где стоит aria-hidden. Значки
// декоративны — смысл метрики несёт подпись под цифрой, а у самой
// карточки есть aria-label, и озвучивать значок значило бы читать
// метрику дважды.
function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg {...STROKE} aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

// FileText — объявления: лист с текстовыми строками.
export function FileTextIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </Icon>
  );
}

// Eye — просмотры.
export function EyeIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

// Heart — избранное.
export function HeartIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </Icon>
  );
}

// MessageCircle — запросы контакта.
export function MessageCircleIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </Icon>
  );
}
