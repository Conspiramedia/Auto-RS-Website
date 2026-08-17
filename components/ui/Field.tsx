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

// Классы контрола. Значения те же, что стояли в формах, — перевод
// на токены цвет и размеры не меняет.
export const fieldClass =
  'w-full rounded-control border border-neutral-15 px-3 py-2.5 outline-none transition-colors duration-fast ease-out focus:border-brand-primary';

// Компактный вариант: панель фильтров, где полей много и они плотнее.
export const fieldClassCompact =
  'w-full rounded-control border border-neutral-15 px-3 py-2 text-caption outline-none transition-colors duration-fast ease-out focus:border-brand-primary';

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
