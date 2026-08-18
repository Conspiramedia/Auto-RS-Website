'use client';

// ============================================================
// RS AUTO — Выбор значения из списка. Client Component.
// ============================================================
// Повторяет пикер приложения (_PickerScreen в filters_screen.dart):
// поле-кнопка с текущим значением → полноэкранный список с поиском и
// пунктом «Не важно».
//
// АДАПТИВНОСТЬ (требование задачи):
//   * мобильные — шит снизу на всю высоту, как нативный пикер;
//   * десктоп — выпадающая панель под полем.
// Реализовано одной разметкой с брейкпоинтом sm: два отдельных
// компонента означали бы двойную поддержку одной и той же логики.
//
// ЗНАЧЕНИЕ УХОДИТ В URL: компонент рендерит скрытый <input name>,
// поэтому обычная GET-форма фильтров подхватывает выбор без JS-обвязки,
// а страница остаётся полностью SSR.
//
// ПОИСК нормализует диакритику и регистр (normalizeForSearch), поэтому
// «uzice» находит «Užice» — на сайте это важнее, чем в приложении:
// сербской раскладки на клавиатуре у пользователя может не быть.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';

import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { normalizeForSearch } from '@/lib/referenceData';
import CloseButton from './ui/CloseButton';
import { FIELD_HEIGHT, FIELD_HEIGHT_COMPACT, labelClass } from './ui/Field';

export type PickerOption = {
  // Значение, которое уходит в форму и в URL.
  value: string;
  // Подпись для пользователя. Для enum'ов отличается от value.
  label: string;
  // Число объявлений — показывается серым справа, если задано.
  count?: number;
};

type Props = {
  locale: Locale;
  // Имя поля в GET-форме и в query-параметрах.
  name: string;
  label: string;
  options: PickerOption[];
  // Текущее значение (value, не label).
  value?: string;
  // Подпись, когда ничего не выбрано. По умолчанию «Все».
  placeholder?: string;
  // Поле недоступно: например, модель до выбора марки.
  disabled?: boolean;
  // Текст вместо списка, когда опций нет.
  emptyHint?: string;
  // Разрешить ввод своего значения — как allowCustom в форме подачи
  // приложения. В фильтрах не используется: фильтровать по значению,
  // которого нет в справочнике, бессмысленно.
  allowCustom?: boolean;
  // Показывать поиск. Для списков из 3-5 пунктов он лишний —
  // приложение в таких случаях показывает компактный лист без поиска.
  searchable?: boolean;
  // Высота контрола. 'form' (44px) — формы подачи и обратной связи;
  // 'compact' (40px) — панель фильтров, где полей много и они плотнее.
  // Обе ступени заданы в components/ui/Field и общие с <input>.
  size?: 'form' | 'compact';
  // Вызывается при выборе. Нужен для каскада «марка → модель».
  onChange?: (value: string) => void;
};

export default function ListPicker({
  locale,
  name,
  label,
  options,
  value = '',
  placeholder,
  disabled = false,
  emptyHint,
  allowCustom = false,
  searchable = true,
  size = 'form',
  onChange,
}: Props) {
  const t = getT(locale);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(value);
  const boxRef = useRef<HTMLDivElement>(null);

  // Значение может измениться извне (сброс фильтров, смена марки).
  useEffect(() => {
    setSelected(value);
  }, [value]);

  // Закрытие по клику вне панели и по Escape — привычное поведение
  // выпадающих списков; без него панель на десктопе «залипает».
  useEffect(() => {
    if (!open) return;

    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // Пикер часто открыт ВНУТРИ шторки фильтров, которая слушает
      // Escape на том же document. Без остановки всплытия одно нажатие
      // закрыло бы сразу оба слоя, и пользователь, закрывавший список,
      // терял бы заодно всю форму фильтров.
      e.stopPropagation();
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query);
    if (!q) return options;
    return options.filter((o) => normalizeForSearch(o.label).includes(q));
  }, [options, query]);

  // «Указать своё» показываем, когда введён текст, которого нет
  // в списке — точно как в форме подачи приложения.
  const trimmed = query.trim();
  const showCustom =
    allowCustom &&
    trimmed.length > 0 &&
    !options.some(
      (o) => normalizeForSearch(o.label) === normalizeForSearch(trimmed),
    );

  const currentLabel =
    options.find((o) => o.value === selected)?.label ||
    // Значение может отсутствовать в списке: марка, добавленная
    // продавцом вручную, или значение из адреса страницы.
    selected ||
    placeholder ||
    t('filter_any');

  function pick(next: string) {
    setSelected(next);
    setOpen(false);
    setQuery('');
    onChange?.(next);
  }

  const listId = `picker-${name}`;

  return (
    <div ref={boxRef} className="relative">
      <label className={labelClass}>{label}</label>

      {/* Скрытое поле — то, что реально уходит в GET-форму и в URL.
          Когда значение не выбрано, поле НЕ рендерится: иначе браузер
          добавил бы в адрес пустой параметр (?body=&fuel=), а это мусор
          в ссылке и лишние варианты одного и того же URL для краулера. */}
      {selected !== '' && (
        <input type="hidden" name={name} value={selected} />
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={
          // Высота и размер шрифта берутся из тех же токенов, что и
          // <input> (components/ui/Field). Раньше здесь стояло py-2 +
          // text-sm, а у input — py-2.5 + text-base, и на шаге 1 подачи
          // «Год выпуска» и «Город» оказывались разной высоты.
          `flex w-full items-center justify-between gap-2 rounded-control border border-neutral-15 bg-white px-3 text-left ${
            size === 'compact'
              ? `${FIELD_HEIGHT_COMPACT} text-caption`
              : `${FIELD_HEIGHT} text-base`
          } ` +
          (disabled
            ? 'cursor-not-allowed bg-surface-hover text-neutral-30'
            : 'transition-colors duration-fast ease-out hover:border-neutral-30')
        }
      >
        <span className={selected ? 'truncate' : 'truncate text-neutral-40'}>
          {disabled && emptyHint ? emptyHint : currentLabel}
        </span>
        <span className="shrink-0 text-neutral-40">▾</span>
      </button>

      {open && !disabled && (
        <>
          {/* Затемнение — только на мобильных, где панель занимает экран. */}
          <div
            // Слой modal, а не header: пикер открывается ВНУТРИ шторки
            // фильтров (z-filter-sheet), и затемнение обязано лежать выше
            // неё — иначе шторка просвечивает поверх открытого списка.
            className="fixed inset-0 z-modal bg-surface-overlay sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            id={listId}
            role="listbox"
            aria-label={label}
            className={
              // Мобильные: шит снизу. Десктоп: панель под полем.
              // z-tooltip — самый верхний слой: сам список должен быть
              // над собственным затемнением (z-modal).
              'fixed inset-x-0 bottom-0 z-tooltip max-h-[75vh] overflow-hidden rounded-t-card bg-white shadow-modal ' +
              'sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:max-h-80 sm:w-full sm:rounded-card sm:border sm:border-neutral-15'
            }
          >
            <div className="flex items-center justify-between border-b border-neutral-10 px-4 py-3 sm:hidden">
              <span className="font-semibold">{label}</span>
              <CloseButton
                onClick={() => setOpen(false)}
                label={t('common_close')}
              />
            </div>

            {searchable && (
              <div className="border-b border-neutral-10 p-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    allowCustom
                      ? `${t('picker_search')} / ${t('picker_custom_hint')}`
                      : t('picker_search')
                  }
                  className="w-full rounded-control border border-neutral-15 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                  // autoFocus только на десктопе: на мобильном он поднимает
                  // клавиатуру поверх списка ещё до того, как пользователь
                  // увидел варианты.
                  autoFocus={
                    typeof window !== 'undefined' && window.innerWidth >= 640
                  }
                />
              </div>
            )}

            <div className="max-h-[55vh] overflow-y-auto sm:max-h-64">
              {/* «Указать своё» — первым пунктом, как в приложении. */}
              {showCustom && (
                <button
                  type="button"
                  onClick={() => pick(trimmed)}
                  className="flex w-full items-center gap-2 border-b border-neutral-10 px-4 py-3 text-left text-sm hover:bg-surface-hoverStrong"
                >
                  <span className="text-brand-green">+</span>
                  <span>
                    {t('picker_custom')} «{trimmed}»
                  </span>
                </button>
              )}

              {/* «Все» — сброс значения. В обязательных полях не нужен. */}
              {!allowCustom && (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected === ''}
                  onClick={() => pick('')}
                  className={
                    'flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-surface-hoverStrong ' +
                    (selected === '' ? 'font-semibold' : '')
                  }
                >
                  <span>{placeholder || t('filter_any')}</span>
                  {selected === '' && <span className="text-brand-primary">✓</span>}
                </button>
              )}

              {filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={selected === o.value}
                  onClick={() => pick(o.value)}
                  className={
                    'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-surface-hoverStrong ' +
                    (selected === o.value ? 'font-semibold' : '')
                  }
                >
                  <span className="truncate">{o.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {o.count !== undefined && o.count > 0 && (
                      <span className="text-neutral-40">{o.count}</span>
                    )}
                    {selected === o.value && (
                      <span className="text-brand-primary">✓</span>
                    )}
                  </span>
                </button>
              ))}

              {filtered.length === 0 && !showCustom && (
                <div className="px-4 py-6 text-center text-sm text-neutral-40">
                  {t('picker_nothing')}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
