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
// ПАНЕЛЬ ВЫНЕСЕНА ПОРТАЛОМ В <body>. Пикер стоит ВНУТРИ шторки
// фильтров, у которой overflow-y-auto, а такой предок обрезает своих
// absolute-потомков по краю — z-index тут бессилен, обрезка идёт до
// наложения слоёв. На десктопе нижние поля («Топливо») открывали
// список, у которого была видна лишь верхняя строка. Портал уводит
// панель из-под обрезки, а координаты поля замеряются и передаются
// в fixed-позицию. Тот же приём уже применён в CardActions.
//
// ЗНАЧЕНИЕ УХОДИТ В URL: компонент рендерит скрытый <input name>,
// поэтому обычная GET-форма фильтров подхватывает выбор без JS-обвязки,
// а страница остаётся полностью SSR.
//
// ПОИСК нормализует диакритику и регистр (normalizeForSearch), поэтому
// «uzice» находит «Užice» — на сайте это важнее, чем в приложении:
// сербской раскладки на клавиатуре у пользователя может не быть.
// ============================================================

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

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

// useLayoutEffect на сервере печатает предупреждение — там его просто
// не существует. Панель всё равно рисуется только после mounted,
// поэтому на сервере подменяем его безвредным useEffect.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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
  const fieldRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Координаты десктопной панели в системе fixed. null — панель ещё
  // не отрисована (первый кадр) либо идёт мобильная раскладка, где
  // список прижат к низу экрана и в замерах не нуждается.
  const [at, setAt] = useState<{
    // Задан ровно один из двух якорей: панель либо свисает от поля
    // вниз (top), либо растёт вверх и держится нижним краем (bottom).
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // Портал монтируется только на клиенте: на сервере document нет.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Значение может измениться извне (сброс фильтров, смена марки).
  useEffect(() => {
    setSelected(value);
  }, [value]);

  // ------------------------------------------------------------
  // ПОЗИЦИЯ ДЕСКТОПНОЙ ПАНЕЛИ.
  // ------------------------------------------------------------
  // Считается от прямоугольника поля. Пересчитывается на скролле и
  // ресайзе: панель вынесена в <body> и за полем сама не поедет.
  // Закрывать её на скролле, как делает меню в CardActions, здесь
  // нельзя — шторку фильтров прокручивают ИМЕННО чтобы дотянуться
  // до нужного пункта списка.
  // useLayoutEffect, а не useEffect: замер обязан пройти ДО покраски.
  // Обычный эффект отрисовал бы первый кадр с at === null, то есть по
  // мобильным классам, и панель на десктопе мигала бы внизу экрана,
  // прежде чем встать под поле.
  useIsomorphicLayoutEffect(() => {
    if (!open) {
      // Сброс обязателен: иначе следующее открытие отрисует первый
      // кадр по координатам прошлого раза, и панель мигнёт не на
      // своём месте — страница за это время могла прокрутиться.
      setAt(null);
      return;
    }

    // Мобильная раскладка — шит снизу, замеры не нужны.
    const isDesktop = () => window.innerWidth >= 640;

    const measure = () => {
      const field = fieldRef.current;
      if (!field || !isDesktop()) {
        setAt(null);
        return;
      }

      const box = field.getBoundingClientRect();
      // Воздух до кромки окна, чтобы панель не липла к краю.
      const GUTTER = 8;
      // Отступ панели от поля — тот же, что давал класс sm:mt-1.
      const OFFSET = 4;
      // Потолок высоты панели. 20rem прежнего класса sm:max-h-80 были
      // слишком тесными: «Кузов» (десять пунктов плюс «Все») в них не
      // помещался и получал полосу прокрутки даже там, где на экране
      // места хватало. Потолок поднят до половины окна — короткие
      // справочники (кузов, коробка, топливо) теперь показываются
      // целиком, а длинным (город, марка — сотня с лишним пунктов)
      // ограничение по-прежнему нужно: без него панель заняла бы
      // экран от края до края.
      const MAX = Math.max(320, Math.round(window.innerHeight * 0.5));

      const below = window.innerHeight - box.bottom - OFFSET - GUTTER;
      const above = box.top - OFFSET - GUTTER;

      // ФАКТИЧЕСКАЯ высота, которая нужна списку целиком.
      //
      // Меряем НЕ саму панель: на ней уже стоит вычисленный maxHeight
      // и overflow-hidden, поэтому её scrollHeight вернул бы текущую
      // обрезанную высоту. Это замкнуло бы расчёт на себя — панель
      // «доказывала» бы, что ей хватает ровно того, что ей выдали.
      //
      // Складываем содержимое: полную высоту прокручиваемого списка
      // (scrollHeight ленты пунктов) плюс всё, что над ним, — шапку
      // мобильного шита и строку поиска. Разность offsetHeight
      // панели и её списка как раз и даёт эту надстройку.
      const panel = panelRef.current;
      const list = listRef.current;
      const chrome =
        panel && list ? panel.offsetHeight - list.offsetHeight : 0;
      // На первом открытии рефов ещё нет — исходим из потолка.
      const needed =
        list != null
          ? Math.min(MAX, list.scrollHeight + chrome)
          : MAX;

      // Вверх раскрываемся, когда снизу список ЦЕЛИКОМ не помещается,
      // а сверху помещается. Прежний порог сравнивал место с
      // константой и потому промахивался: у «Кузова» снизу было
      // больше порога, но меньше самого списка — он раскрывался вниз
      // и получал полосу прокрутки, хотя сверху вставал целиком.
      // Если не помещается ни там, ни там — идём в сторону, где
      // места больше.
      const fitsBelow = below >= needed;
      const fitsAbove = above >= needed;
      const openAbove = fitsBelow ? false : fitsAbove || above > below;
      const space = openAbove ? above : below;

      const next = {
        top: openAbove ? undefined : box.bottom + OFFSET,
        // Отсчёт снизу окна: так панель растёт вверх от поля, а не
        // от собственной высоты, которую до отрисовки не измерить.
        bottom: openAbove
          ? window.innerHeight - box.top + OFFSET
          : undefined,
        left: box.left,
        width: box.width,
        // Панель не выше доступного места и не выше, чем ей реально
        // нужно: без второго ограничения короткий список растягивал
        // бы панель на всё свободное пространство пустотой внизу.
        // Если места меньше, чем нужно, — остаток берёт на себя
        // собственная прокрутка списка.
        maxHeight: Math.max(120, Math.min(MAX, space, needed)),
      };

      // Сверяем со старым положением: measure висит на скролле, и без
      // проверки каждый его вызов давал бы новый объект, то есть
      // рендер на каждый пиксель прокрутки.
      setAt((prev) =>
        prev &&
        prev.top === next.top &&
        prev.bottom === next.bottom &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.maxHeight === next.maxHeight
          ? prev
          : next,
      );
    };

    // Первый проход: панели в DOM ещё нет, высота берётся по потолку.
    measure();

    // ВТОРОЙ ПРОХОД — обязателен. На первом ref панели пуст, и высота
    // списка неизвестна: «Кузов» с его девятью пунктами считался бы
    // равным потолку и уходил вниз, к обрезке. Здесь панель уже
    // отрисована, scrollHeight настоящий — направление уточняется.
    // requestAnimationFrame, а не второй вызов подряд: React
    // применяет разметку после эффекта, до кадра.
    const raf = requestAnimationFrame(measure);

    // capture: true — прокручивается не окно, а шторка фильтров;
    // её событие scroll не всплывает, и без перехвата панель
    // осталась бы висеть на прежнем месте.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  // Закрытие по клику вне панели и по Escape — привычное поведение
  // выпадающих списков; без него панель на десктопе «залипает».
  useEffect(() => {
    if (!open) return;

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Панель живёт в портале, ВНЕ boxRef, поэтому одной проверки
      // на обёртку мало: клик по пункту списка считался бы кликом
      // снаружи и закрывал бы список раньше, чем выбор доходил до
      // обработчика.
      if (panelRef.current?.contains(target)) return;
      if (boxRef.current && !boxRef.current.contains(target)) {
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

    // capture: true — ОБЯЗАТЕЛЬНО, иначе stopPropagation выше ничего не
    // даёт. Оба слушателя (пикера и шторки) висят на одном document, а
    // остановка всплытия не действует на соседей по одному узлу:
    // порядок решала бы очерёдность подписки, а шторка монтируется
    // раньше пикера — и Escape закрывал бы её вместе со списком.
    // Перехват проходит до всплытия, поэтому пикер успевает погасить
    // событие раньше, чем его увидит шторка.
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey, true);
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
    // Пустое поле зовёт открыть список («Выбрать»), а не сообщает
    // о значении. Пункт сброса внутри списка остаётся на filter_any.
    t('picker_placeholder');

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
        ref={fieldRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={
          // Высота и размер шрифта берутся из тех же токенов, что и
          // <input> (components/ui/Field). Раньше здесь стояло py-2 +
          // text-caption, а у input — py-2.5 + text-body, и на шаге 1 подачи
          // «Год выпуска» и «Город» оказывались разной высоты.
          `flex w-full items-center justify-between gap-2 rounded-control border border-neutral-15 bg-white px-3 text-left ${
            size === 'compact'
              ? `${FIELD_HEIGHT_COMPACT} text-caption`
              : `${FIELD_HEIGHT} text-body`
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

      {open &&
        !disabled &&
        mounted &&
        // Портал в <body>: см. пояснение в шапке файла — внутри
        // шторки с overflow панель обрезалась бы её краем.
        createPortal(
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
              ref={panelRef}
              id={listId}
              role="listbox"
              aria-label={label}
              className={
                // Мобильные: шит снизу — координаты не нужны, панель
                // прижата к краям экрана. Десктоп: fixed по замеру.
                // z-tooltip — самый верхний слой: сам список должен быть
                // над собственным затемнением (z-modal).
                'fixed inset-x-0 bottom-0 z-tooltip flex max-h-[75vh] flex-col overflow-hidden rounded-t-card bg-white shadow-modal ' +
                // sm:max-h-none — потолок 75vh нужен только мобильному
                // шиту; на десктопе высоту задаёт вычисленный
                // maxHeight, и класс-потолок спорил бы с ним.
                'sm:inset-x-auto sm:max-h-none sm:rounded-card sm:border sm:border-neutral-15'
              }
              // Координаты приходят готовыми из эффекта: обращаться
              // к window прямо в рендере нельзя — он идёт и на сервере.
              style={
                at
                  ? {
                      // 'auto', а не undefined: undefined НЕ гасит
                      // класс bottom-0 мобильной раскладки, и панель,
                      // свисающая вниз, растянулась бы до низа окна.
                      top: at.top ?? 'auto',
                      bottom: at.bottom ?? 'auto',
                      left: at.left,
                      width: at.width,
                      maxHeight: at.maxHeight,
                      // Инлайновые координаты обязаны победить классы
                      // мобильной раскладки (inset-x-0, bottom-0).
                      right: 'auto',
                    }
                  : undefined
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
                    className="w-full rounded-control border border-neutral-15 px-3 py-2 text-caption outline-none focus:border-brand-primary"
                    // autoFocus только на десктопе: на мобильном он поднимает
                    // клавиатуру поверх списка ещё до того, как пользователь
                    // увидел варианты.
                    autoFocus={
                      typeof window !== 'undefined' && window.innerWidth >= 640
                    }
                  />
                </div>
              )}

              {/* min-h-0 — обязателен: без него flex-потомок не даёт
                  себя сжать ниже содержимого, и панель на десктопе
                  переросла бы вычисленный maxHeight. Потолок 55vh
                  остаётся для мобильного шита. */}
              <div
                ref={listRef}
                className="thin-scrollbar min-h-0 max-h-[55vh] flex-1 overflow-y-auto sm:max-h-none"
              >
                {/* «Указать своё» — первым пунктом, как в приложении. */}
                {showCustom && (
                  <button
                    type="button"
                    onClick={() => pick(trimmed)}
                    className="flex w-full items-center gap-2 border-b border-neutral-10 px-4 py-3 text-left text-caption hover:bg-surface-hoverStrong"
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
                      'flex w-full items-center justify-between px-4 py-3 text-left text-caption hover:bg-surface-hoverStrong ' +
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
                      'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-caption hover:bg-surface-hoverStrong ' +
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
                  <div className="px-4 py-6 text-center text-caption text-neutral-60">
                    {t('picker_nothing')}
                  </div>
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
