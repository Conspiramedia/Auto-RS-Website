// ============================================================
// RS AUTO — Поле формы: подпись + контрол + ошибка.
// ============================================================
// Строка классов поля ввода была продублирована в трёх формах
// (SellForm, DealerForm, FilterPanel, ContactForm). Здесь она одна.
//
// Экспортируются две вещи:
//   fieldClass — сами классы контрола, для случаев, когда разметку
//     обёртки компонент строит сам (ListPicker, select сортировки);
//   Field      — готовая обёртка «подпись + контрол + ошибка».
// Разделение нужно затем, что часть контролов на сайте нестандартные
// (пикер со списком), и навязывать им чужую обёртку было бы хуже.
// ============================================================

import type { ReactNode } from 'react';

// ------------------------------------------------------------
// ВЫСОТА КОНТРОЛОВ — фиксированная, а не выведенная из паддингов.
// ------------------------------------------------------------
// Была ошибка: у <input> стояло py-2.5 + унаследованный body (16px),
// у кнопки пикера — py-2 + caption (14px). Итоговая высота считалась из
// «паддинг + интерлиньяж шрифта» и расходилась на 6px, из-за чего на
// шаге 1 подачи «Год выпуска» (input) и «Город» (пикер) стояли рядом
// разной высоты.
//
// Лечится не подгонкой паддингов, а явной высотой: h-11 (44px) — одна
// ступень для ВСЕХ контролов формы. 44px это ещё и минимальная площадь
// касания по рекомендациям Apple/Google, что важно для мобильной подачи.
//
// py-* при заданной высоте не нужен: содержимое центрируется самим
// контролом (input) или flex-выравниванием (кнопка пикера).
const FIELD_BASE =
  'w-full rounded-control border border-neutral-15 bg-white px-3 outline-none transition-colors duration-fast ease-out focus:border-brand-primary';

// Высота контрола формы. Единая ступень — менять только здесь.
export const FIELD_HEIGHT = 'h-11';

// Компактная высота: панель фильтров, где полей много и они плотнее.
// 40px — на одну ступень ниже, но одинаково для всех её контролов.
export const FIELD_HEIGHT_COMPACT = 'h-10';

// Поле формы: подача объявления, заявка дилера, обратная связь.
export const fieldClass = `${FIELD_BASE} ${FIELD_HEIGHT} text-body`;

// Компактный вариант: панель фильтров.
export const fieldClassCompact = `${FIELD_BASE} ${FIELD_HEIGHT_COMPACT} text-caption`;

// Многострочное поле (textarea): высота задаётся числом строк через
// rows, поэтому фиксированная h-* здесь неприменима — берём паддинг,
// подобранный под ту же вертикальную плотность, что и у h-11.
export const fieldClassTextarea = `${FIELD_BASE} py-2.5 text-body`;

// Классы подписи над контролом.
export const labelClass = 'mb-1 block text-caption text-neutral-60';

type Props = {
  label: string;
  // Связь подписи с контролом. Без htmlFor/id клик по подписи не
  // фокусирует поле, и скринридер не называет его.
  htmlFor?: string;
  // Текст ошибки под полем. Показывается только когда задан.
  error?: string | null;
  // Подсказка под полем: единицы измерения, формат.
  hint?: string;
  className?: string;
  children: ReactNode;
};

export default function Field({
  label,
  htmlFor,
  error,
  hint,
  className = '',
  children,
}: Props) {
  return (
    <div className={className}>
      <label className={labelClass} htmlFor={htmlFor}>
        {label}
      </label>

      {children}

      {hint && !error && (
        <p className="mt-1 text-small text-neutral-50">{hint}</p>
      )}

      {error && <p className="mt-1 text-small text-brand-red">{error}</p>}
    </div>
  );
}
