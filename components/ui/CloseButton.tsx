// ============================================================
// RS AUTO — Кнопка закрытия («крестик»). Единый паттерн для всех
// слоёв, которые пользователь может закрыть: шторка фильтров, список
// выбора, форма подачи, галерея объявления.
// ============================================================
// Зачем отдельный компонент. Раньше крестик был написан заново в каждом
// оверлее, и расходились три вещи сразу: цвет (neutral-40 против
// neutral-60), сам символ (текстовый «×» вместо знака) и aria-label —
// в двух местах там стояло «×», из-за чего скринридер зачитывал имя
// символа, а не действие. Подпись обязана приходить из словаря.
//
// ВАРИАНТЫ (по подложке, на которой лежит крестик):
//   plain   — на белом фоне панели: шторка фильтров, список выбора,
//             форма подачи. Ничего не рисует вокруг знака.
//   overlay — поверх фотографии: галерея объявления. Тёмный знак на
//             белом круге — единственный вариант, который читается
//             и на светлом небе, и на чёрном кузове.
//
// Знак — inline-SVG, а не текстовый символ «×»: у текстового варианта
// метрики зависят от шрифта, и он смещается относительно центра.
// Тем же приёмом собраны бургер в шапке и значок фильтров.
// ============================================================

type Variant = 'plain' | 'overlay';

type Props = {
  onClick: () => void;
  // Подпись для скринридера. Обязательна и всегда из словаря: у кнопки
  // нет текста, и без неё она озвучивается как «кнопка».
  label: string;
  variant?: Variant;
  className?: string;
};

// Размер кликабельной области — 40px. Это минимум, при котором в
// крестик попадают пальцем: тот же размер, что у бургера в шапке.
const VARIANTS: Record<Variant, string> = {
  plain:
    'inline-flex h-10 w-10 items-center justify-center rounded-control ' +
    'text-neutral-60 transition-colors hover:bg-surface-hover hover:text-neutral-100',
  // shadow-modal — та же тень, что у всплывающих панелей: круг обязан
  // отделяться от фотографии, иначе на светлом кадре он сливается с ней.
  overlay:
    'inline-flex h-10 w-10 items-center justify-center rounded-full ' +
    'bg-white text-neutral-100 shadow-modal transition-colors hover:bg-surface-hover',
};

export default function CloseButton({
  onClick,
  label,
  variant = 'plain',
  className = '',
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${VARIANTS[variant]} ${className}`.trim()}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    </button>
  );
}
