// ============================================================
// RS AUTO — Таблица. Примитив ОБЩЕГО ui, не админский.
// ============================================================
// Заведён ради админки (очередь, объявления, пользователи, журнал), но
// живёт в components/ui: таблица — обычный примитив, и класть её в
// components/admin значило бы, что второй раздел сайта, которому
// понадобится табличный вывод, заведёт свою копию.
//
// SERVER COMPONENT ПО УМОЛЧАНИЮ — и это главное архитектурное решение.
// Здесь нет ни 'use client', ни состояния, ни обработчиков. Строка,
// ведущая на другую страницу, — это <Link> внутри render конкретной
// колонки, а НЕ onRowClick на всей строке:
//   * страница остаётся в SSR, разметка приходит готовой;
//   * ссылка работает как ссылка — открывается в новой вкладке
//     средней кнопкой, копируется, видна в статусной строке;
//   * клавиатура и скринридер получают настоящий <a>, а не div,
//     который «тоже кликается».
// onRowClick в пропсах есть, но он — исключение, а не основной путь;
// как только он задан, таблица становится клиентской. Подробности в
// комментарии к самому пропу.
//
// ЧЕГО ТАБЛИЦА НЕ ДЕЛАЕТ НАМЕРЕННО:
//   * не форматирует данные. Ни дат, ни цен, ни статусов. Форматируют
//     на стороне вызова через render — иначе примитив пришлось бы
//     учить локалям, валютам и часовым поясам, и он стал бы вторым
//     lib/format, только хуже. Для чисел таблица даёт ровно то, что
//     относится к вёрстке: align="right" и tabular-nums;
//   * не сортирует и не фильтрует. Это делает сервер: набор строк
//     приходит готовым;
//   * не изобретает пустое состояние и загрузку — берёт StateCard и
//     SkeletonBox, как весь остальной сайт.
//
// АДАПТИВ. Основной режим — не горизонтальный скролл, а СОКРАЩЕНИЕ
// состава колонок: hideBelow убирает второстепенные на узких экранах.
// Скролл оставлен страховкой на случай, когда даже урезанный набор не
// влезает (длинные названия), но проектировать под него нельзя:
// таблица, которую надо возить пальцем вбок, на телефоне не читается.
// ============================================================

import type { ReactNode } from 'react';

import StateCard from '@/components/ui/StateCard';
import { SkeletonBox } from '@/components/ui/Skeleton';
import TableRowButton from '@/components/ui/TableRowButton';

// Порог, ниже которого колонка скрывается. Значения — брейкпоинты
// Tailwind: sm 640px, md 768px, lg 1024px.
export type HideBelow = 'sm' | 'md' | 'lg';

export type Column<T> = {
  // Идентификатор колонки. Служит React-ключом ячейки и не обязан
  // совпадать с полем объекта: колонка «Действия» данных не имеет.
  key: string;
  // Заголовок. ReactNode, а не string: в шапку иногда нужен значок
  // сортировки или подсказка.
  header: ReactNode;
  // Ширина колонки как CSS-значение ('120px', '20%', 'minmax(0,1fr)').
  // Не задана — распределяется браузером по содержимому.
  width?: string;
  // Выравнивание. right — для чисел и дат: цифры, выровненные по
  // правому краю, сравниваются взглядом по разрядам.
  align?: 'left' | 'right' | 'center';
  // Как нарисовать ячейку. Не задан — берётся row[key] как есть,
  // если это примитив (строка или число).
  render?: (row: T) => ReactNode;
  // Скрыть колонку ниже указанного брейкпоинта.
  hideBelow?: HideBelow;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  // Ключ строки. Функция, а не имя поля: идентификатор бывает
  // составным (пара id + дата в журнале).
  rowKey: (row: T) => string;
  // Плотность. compact по умолчанию — админка про то, чтобы видеть
  // много строк сразу, а не про воздух.
  density?: 'compact' | 'normal';
  // Пустое состояние. Строка — заголовок готовой карточки; ReactNode —
  // своя разметка целиком (например, с кнопкой действия).
  empty?: string | ReactNode;
  // Скелетон вместо строк. Число строк-заглушек берётся из
  // loadingRows, чтобы блок занимал примерно ту же высоту, что и
  // будущие данные, и страница не прыгала при подмене.
  loading?: boolean;
  loadingRows?: number;
  // Липкая шапка для длинных списков. Работает внутри прокрутки
  // страницы; отдельного скролл-контейнера таблица не заводит.
  stickyHeader?: boolean;
  // ИСКЛЮЧЕНИЕ, А НЕ ОСНОВНОЙ ПУТЬ. Передавать его можно только из
  // Client Component: функция в пропе через границу сервер→клиент не
  // сериализуется. Сама таблица при этом серверной быть не перестаёт —
  // клиентской становится одна строка (components/ui/TableRowButton).
  //
  // Для НАВИГАЦИИ он не нужен и вреден: <Link> внутри render даёт то
  // же самое, оставаясь в SSR, и ведёт себя как настоящая ссылка.
  // Оправдан там, где адреса у действия нет, — выделение строки в
  // массовых операциях.
  onRowClick?: (row: T) => void;
  className?: string;
};

// Классы выравнивания. Статические строки, а не сборка вида
// `text-${align}`: Tailwind сканирует исходники и вырезает всё, чего
// не видит буквально, — динамическое имя не попало бы в сборку.
const ALIGN: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

// Скрытие по брейкпоинтам — по той же причине справочником.
const HIDE: Record<HideBelow, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

// Плотность. compact: 8px по вертикали (brand.spacing.sm) даёт строку
// 36–40px при text-caption — норма рабочего инструмента.
// normal: 12px, когда таблица стоит на странице продукта.
const DENSITY: Record<'compact' | 'normal', { cell: string; head: string }> = {
  compact: { cell: 'px-3 py-2', head: 'px-3 py-2' },
  normal: { cell: 'px-4 py-3', head: 'px-4 py-3' },
};

export default function Table<T>({
  columns,
  rows,
  rowKey,
  density = 'compact',
  empty,
  loading = false,
  loadingRows = 5,
  stickyHeader = false,
  onRowClick,
  className = '',
}: Props<T>) {
  const d = DENSITY[density];

  // Классы ячейки собираются один раз на колонку, а не на каждую
  // ячейку: при 200 строках это 200 лишних конкатенаций на колонку.
  const cellClass = (col: Column<T>, head: boolean) =>
    [
      head ? d.head : d.cell,
      ALIGN[col.align ?? 'left'],
      // tabular-nums на колонках с правым выравниванием: цифры разной
      // ширины (1 и 8) иначе не встают в столбик, и глазом сравнить
      // «12 300» и «9 800» становится нельзя. Это единственное, что
      // таблица знает про числа, — форматирует их вызывающая сторона.
      col.align === 'right' ? 'tabular-nums' : '',
      col.hideBelow ? HIDE[col.hideBelow] : '',
    ]
      .filter(Boolean)
      .join(' ');

  // ---------- Загрузка ----------
  // Скелетон рисуется В ТОЙ ЖЕ таблице с той же шапкой и теми же
  // ширинами колонок: подменять его отдельным блоком значит менять
  // геометрию при появлении данных.
  const body = loading ? (
    Array.from({ length: loadingRows }, (_, i) => (
      <tr key={`skeleton-${i}`} className="border-t border-neutral-10">
        {columns.map((col) => (
          <td key={col.key} className={cellClass(col, false)}>
            {/* h-4 = высота строки text-caption: подмена на реальный
                текст не сдвигает соседние строки. */}
            <SkeletonBox className="h-4 w-full" />
          </td>
        ))}
      </tr>
    ))
  ) : (
    rows.map((row) => {
      const cells = columns.map((col) => (
        <td key={col.key} className={cellClass(col, false)}>
          {col.render
            ? col.render(row)
            : // Без render показываем поле как есть, но только
              // примитив. Объект попал бы в React как ошибка рендера
              // целого экрана — лучше прочерк и забытый render, чем
              // упавшая страница.
              renderPrimitive((row as Record<string, unknown>)[col.key])}
        </td>
      ));

      // Обычная строка — обычный <tr>, и таблица остаётся серверной.
      // Подсветки наведения у неё НЕТ намеренно: подсвечивается сама
      // ссылка внутри ячейки, иначе строка обещала бы клик целиком
      // там, где кликабельна только её часть.
      if (!onRowClick) {
        return (
          <tr key={rowKey(row)} className="border-t border-neutral-10">
            {cells}
          </tr>
        );
      }

      // Клик по строке задан — только эта строка становится
      // клиентской (см. шапку TableRowButton). Замыкание на row
      // создаётся здесь, чтобы клиентскому компоненту не нужно было
      // знать ни про тип строки, ни про сам обработчик списка.
      return (
        <TableRowButton
          key={rowKey(row)}
          onClick={() => onRowClick(row)}
          className="border-t border-neutral-10"
        >
          {cells}
        </TableRowButton>
      );
    })
  );

  // ---------- Пусто ----------
  // Проверяется ПОСЛЕ loading: пустой массив во время загрузки — это
  // ещё не «ничего нет».
  if (!loading && rows.length === 0) {
    // ReactNode передали — рисуем как есть: вызывающая сторона знает
    // про свои кнопки и ссылки больше, чем примитив.
    if (empty && typeof empty !== 'string') return <>{empty}</>;

    // Строка или ничего — общая карточка сайта. locale='ru': таблица
    // заведена под админку, которая одноязычна. Появится табличный
    // вывод на витрине — locale станет пропом; заводить его сейчас
    // означало бы требовать его от всех вызовов админки без пользы.
    return (
      <StateCard
        locale="ru"
        title={typeof empty === 'string' ? empty : 'Пусто'}
        text={
          typeof empty === 'string' ? undefined : 'Здесь пока нет записей.'
        }
        className={className}
      />
    );
  }

  return (
    // overflow-x-auto — СТРАХОВКА, а не режим работы: основной приём
    // сужения — hideBelow. rounded-card + border на контейнере, потому
    // что скругление на <table> не обрезает содержимое ячеек.
    <div
      className={`overflow-x-auto rounded-card border border-neutral-10 ${className}`}
    >
      <table className="w-full border-collapse text-caption">
        {/* colgroup задаёт ширины один раз на колонку, а не повторяет
            их в каждой ячейке: с ним браузеру не нужно измерять
            содержимое, чтобы разложить таблицу. */}
        {columns.some((c) => c.width) && (
          <colgroup>
            {columns.map((col) => (
              <col
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className={col.hideBelow ? HIDE[col.hideBelow] : undefined}
              />
            ))}
          </colgroup>
        )}

        <thead
          className={[
            'bg-surface-subtle text-neutral-60',
            stickyHeader ? 'sticky top-0 z-10' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`${cellClass(col, true)} font-medium`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>{body}</tbody>
      </table>
    </div>
  );
}

// Значение без render. Строку и число показываем, всё остальное
// (объект, массив, null) — прочерком: пустая ячейка выглядит как
// потерянные данные, прочерк честно говорит «значения нет».
function renderPrimitive(value: unknown): ReactNode {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return <span className="text-neutral-30">—</span>;
}
