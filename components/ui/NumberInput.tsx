'use client';

// ============================================================
// RS AUTO — Числовое поле с живым форматированием.
// ============================================================
// ОДНО место, где числовой ввод связывается с форматтерами из
// lib/inputFormat.ts. Без него каждая форма писала бы свой onChange, и
// правила разъехались бы ровно так, как они разъехались в приложении:
// форма подачи форматировала суммы, а экран фильтров — нет.
//
// ЧТО ДЕЛАЕТ КОМПОНЕНТ
//   1. Форматирует значение ПО МЕРЕ ВВОДА: «125000» → «125 000».
//      Перенос ThousandsFormatter из приложения
//      (lib/shared/utils/number_formatters.dart).
//   2. Держит курсор на месте. Приложение ставит его в конец строки на
//      каждом изменении — в браузере это ломало бы правку середины
//      числа, поэтому позиция восстанавливается по числу цифр слева
//      (caretAfterFormat).
//   3. Принимает вставку отформатированной строки: «12 500», «12.500»,
//      «12 500 €» дают одинаковые цифры (digitsOnly).
//   4. Ограничивает длину в цифрах, а не значение: лишняя цифра просто
//      не появляется в поле.
//   5. Отдаёт наружу ЧИСТЫЕ ЦИФРЫ (onChange) — в состояние формы и в
//      БД уходит число, форматирование остаётся только на экране.
//
// ГОД — частный случай: separator={false}. «2019» не должно
// превращаться в «2 019».
// ============================================================

import { useLayoutEffect, useRef } from 'react';

import {
  caretAfterFormat,
  digitsBefore,
  digitsOnly,
  formatThousands,
  MAX_PRICE_DIGITS,
} from '@/lib/inputFormat';

type Props = {
  // Значение в ЦИФРАХ, без разделителей: «125000». Так оно лежит в
  // состоянии формы и в таком виде уходит в RPC.
  value: string;
  // Наружу отдаются тоже цифры — вызывающему коду не нужно ничего
  // разбирать обратно.
  onChange: (digits: string) => void;
  // Сколько цифр максимум. Цена и пробег — 7, год — 4.
  maxDigits?: number;
  // Разделитель разрядов. false — для года.
  separator?: boolean;
  // Скрытое поле с чистым значением: нужно формам, которые уходят
  // обычным submit (GET-фильтры каталога). Видимое поле в таких формах
  // имени не имеет — иначе в URL уехала бы строка с пробелами.
  name?: string;
  id?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
};

export default function NumberInput({
  value,
  onChange,
  maxDigits = MAX_PRICE_DIGITS,
  separator = true,
  name,
  id,
  placeholder,
  className,
  required,
  disabled,
  'aria-label': ariaLabel,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  // Куда поставить курсор после перерисовки. null — не трогать:
  // значение изменилось не от ввода (предзаполнение формы при правке
  // объявления), и двигать курсор в чужом поле не нужно.
  const caret = useRef<number | null>(null);

  // Показываемая строка. Считается из чистых цифр на каждый рендер —
  // отдельного состояния для неё нет, поэтому разойтись с value она
  // не может.
  const shown = separator ? formatThousands(value) : value;

  // Курсор восстанавливаем в useLayoutEffect, а не в onChange: на момент
  // onChange в поле ещё стоит НЕотформатированный текст, который React
  // перезапишет при рендере, сбросив выделение в конец.
  useLayoutEffect(() => {
    if (caret.current === null || !ref.current) return;
    ref.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const pos = e.target.selectionStart ?? raw.length;

    // Цифры слева от курсора СЧИТАЕМ ДО обрезки по длине: это якорь,
    // по которому курсор вернётся на место после переформатирования.
    const before = digitsBefore(raw, pos);
    const digits = digitsOnly(raw).replace(/^0+(?=\d)/, '').slice(0, maxDigits);
    const next = separator ? formatThousands(digits) : digits;

    // Курсор не может уехать правее, чем есть цифр: при отбрасывании
    // лишней цифры (набрана восьмая при лимите семь) якорь нужно
    // подтянуть, иначе курсор встанет за концом строки.
    caret.current = caretAfterFormat(next, Math.min(before, digits.length));

    onChange(digits);
  }

  return (
    <>
      <input
        ref={ref}
        // type="text", а не "number": числовое поле в браузере
        // отказывается показывать строку с пробелами, режет ведущие
        // нули по-своему и добавляет стрелки-спиннеры, которых нет
        // в макете.
        type="text"
        // Мобильная клавиатура с цифрами. Аналог
        // TextInputType.number в приложении.
        inputMode="numeric"
        id={id}
        value={shown}
        onChange={handleChange}
        placeholder={placeholder}
        className={className}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        autoComplete="off"
      />

      {/* Чистое число для форм с обычным submit. Видимое поле выше
          имени не несёт, поэтому в query-строку попадает только это. */}
      {name && <input type="hidden" name={name} value={value} />}
    </>
  );
}
