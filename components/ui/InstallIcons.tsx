// ============================================================
// RS AUTO — Значки для инструкции по установке (/install).
// ============================================================
// Собраны в одном файле, а не разложены по разметке страницы: их
// девять, и вперемешку с текстом шагов они превратили бы читаемый
// список в стену путей SVG.
//
// Все значки — inline-SVG в едином каркасе: 24×24 viewBox, обводка
// currentColor, толщина 2. Цвет НЕ задаётся внутри: его наследует
// currentColor от места вставки, поэтому один и тот же значок годится
// и на синей плашке, и в тёмном заголовке.
//
// Логотипы платформ (Apple, Android) — заливка, а не обводка: это
// фирменные знаки узнаваемой формы, и контурная версия читалась бы
// как чужой значок. Обе фигуры упрощены до силуэта.
// ============================================================

type IconProps = {
  className?: string;
};

// Общие атрибуты контурных значков. Вынесены, чтобы толщина линии и
// скругления не разъехались между девятью иконками.
const STROKE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// ---------- Логотипы платформ (в заголовке карточки) ----------

export function AppleIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M16.4 12.8c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.8.8-3.6 2.1-1.5 2.6-.4 6.5 1.1 8.7.7 1 1.6 2.2 2.7 2.2 1.1 0 1.5-.7 2.8-.7 1.3 0 1.6.7 2.8.7 1.1 0 1.9-1.1 2.6-2.1.8-1.2 1.1-2.4 1.2-2.4 0 0-2.2-.9-2.2-3.4z" />
      <path d="M14.3 6.3c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-.9 2.6 1 .1 2-.5 2.6-1.2z" />
    </svg>
  );
}

export function AndroidIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M5 10.5h14a.5.5 0 0 1 .5.5v6a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2v-6a.5.5 0 0 1 .5-.5z" />
      <path d="M7.2 5.3 6.1 3.6a.4.4 0 0 1 .7-.4l1.1 1.8A6.9 6.9 0 0 1 12 4.2c1.5 0 2.9.3 4.1.9l1.1-1.8a.4.4 0 0 1 .7.4l-1.1 1.7A6 6 0 0 1 19 9.2H5a6 6 0 0 1 2.2-3.9zM9 7.4a.7.7 0 1 0 0-1.4.7.7 0 0 0 0 1.4zm6 0a.7.7 0 1 0 0-1.4.7.7 0 0 0 0 1.4z" />
      <rect x="2" y="10.8" width="2.2" height="6.4" rx="1.1" />
      <rect x="19.8" y="10.8" width="2.2" height="6.4" rx="1.1" />
    </svg>
  );
}

// ---------- Значки шагов ----------

// Браузер: окно с адресной строкой. Шаг «откройте сайт в …».
export function BrowserIcon({ className = '' }: IconProps) {
  return (
    <svg {...STROKE} aria-hidden="true" className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M7 6.5h.01M10 6.5h.01" />
    </svg>
  );
}

// Три точки — меню Chrome в правом верхнем углу.
export function DotsIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

// «Поделиться» в iOS: квадрат со стрелкой вверх.
export function ShareIcon({ className = '' }: IconProps) {
  return (
    <svg {...STROKE} aria-hidden="true" className={className}>
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

// Плюс в рамке — «На экран „Домой“» и «Добавить на главный экран».
export function AddToHomeIcon({ className = '' }: IconProps) {
  return (
    <svg {...STROKE} aria-hidden="true" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

// Установка: стрелка вниз в подставку. Тот же знак, что у пункта
// «Быстрый доступ» в меню, — шаг и пункт меню обязаны опознаваться
// как одно и то же действие.
export function InstallIcon({ className = '' }: IconProps) {
  return (
    <svg {...STROKE} aria-hidden="true" className={className}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

// Галочка в круге — завершающий шаг «подтвердите».
export function CheckIcon({ className = '' }: IconProps) {
  return (
    <svg {...STROKE} aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}
