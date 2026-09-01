// ============================================================
// RS AUTO — Значки блоков главной страницы.
// ============================================================
// Набор для блока «Почему RS Auto» — четыре причины.
//
// ПОЧЕМУ НЕ lucide-react. Иконочного пакета в проекте нет намеренно —
// причина расписана в ui/NavIcons.tsx: ради полутора десятков значков
// не тянут зависимость в клиентскую сборку. Здесь тот же случай.
// Формы повторяют общепринятые lucide-фигуры (BadgeEuro, Users,
// MessageSquare, TrendingUp), поэтому набор читается как привычный,
// но весит килобайты разметки, а не пакет.
//
// ЕДИНЫЙ КАРКАС — тот же контракт, что у NavIcons и InstallIcons:
// viewBox 24, обводка currentColor, толщина 2, скруглённые концы и
// стыки. Значки из трёх наборов встречаются на одной странице и
// обязаны выглядеть роднёй.
//
// Цвет НЕ задаётся внутри: его наследует currentColor от блока —
// поэтому один и тот же значок работает и на белом, и на подложке.
// ============================================================

type IconProps = {
  className?: string;
};

// Общие атрибуты. Вынесены, чтобы толщина линии и скругления не
// разъехались между значками при правках.
const STROKE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

// ------------------------------------------------------------
// «Почему RS Auto» — четыре причины.
// ------------------------------------------------------------

// Прямой контакт: покупатель пишет продавцу. Облако сообщения
// (MessageSquare).
export function IconDirectContact({ className = '' }: IconProps) {
  return (
    <svg {...STROKE} className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

// Бесплатно. Монета с евро — валюта площадки (BadgeEuro).
export function IconFree({ className = '' }: IconProps) {
  return (
    <svg {...STROKE} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 9.5a3.5 3.5 0 0 0-5.9 1.4" />
      <path d="M9.6 13.1a3.5 3.5 0 0 0 5.9 1.4" />
      <path d="M7.5 11H13" />
      <path d="M7.5 13.5h4.5" />
    </svg>
  );
}

// Две аудитории — группа людей (Users).
export function IconAudience({ className = '' }: IconProps) {
  return (
    <svg {...STROKE} className={className}>
      <path d="M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4" />
      <path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8" />
    </svg>
  );
}

// Запуск рекламы, рост площадки — восходящая линия (TrendingUp).
export function IconGrowth({ className = '' }: IconProps) {
  return (
    <svg {...STROKE} className={className}>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}
