// ============================================================
// RS AUTO — Пагинация админки. Server Component.
// ============================================================
// Ссылки, а не кнопки с обработчиком: страница входит в адрес, и
// «вторая страница журнала за март» должна пересылаться и
// сохраняться в закладку так же, как фильтры (см. AdminFilters).
//
// Нумерованных страниц нет намеренно — только «назад/вперёд» и
// счётчик. Список из тридцати номеров занимает больше места, чем
// приносит пользы: по журналу ходят последовательно от свежего к
// старому, а прыжок на страницу 17 не имеет смысла, потому что
// никто не знает, что там лежит. Нужен конкретный день — для этого
// есть фильтр по периоду.
// ============================================================

import Link from 'next/link';

type Props = {
  // Путь раздела без строки запроса.
  path: string;
  // Текущие параметры: сохраняем их при переходе, иначе вторая
  // страница потеряет фильтры и покажет не то, что просили.
  params: Record<string, string | undefined>;
  offset: number;
  limit: number;
  total: number;
};

export default function AdminPagination({
  path,
  params,
  offset,
  limit,
  total,
}: Props) {
  // Одна страница — пагинация не нужна вовсе.
  if (total <= limit) return null;

  const hrefFor = (nextOffset: number) => {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      // offset подставляем свой, пустые значения не тащим — они бы
      // засоряли адрес параметрами вида city=.
      if (key === 'offset') continue;
      if (value) search.set(key, value);
    }

    // Первая страница — без параметра: чистый адрес раздела читается
    // лучше, чем тот же адрес с offset=0.
    if (nextOffset > 0) search.set('offset', String(nextOffset));

    const query = search.toString();
    return query ? `${path}?${query}` : path;
  };

  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  const linkClass =
    'rounded-control border border-neutral-15 px-3 py-1.5 text-caption transition-colors duration-fast hover:bg-surface-hover';
  const disabledClass =
    'rounded-control border border-neutral-10 px-3 py-1.5 text-caption text-neutral-30';

  return (
    <div className="mt-4 flex items-center justify-between gap-4">
      <p className="text-caption text-neutral-60">
        {from}–{to} из {total}
      </p>

      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link
            href={hrefFor(Math.max(offset - limit, 0))}
            className={linkClass}
          >
            ← Назад
          </Link>
        ) : (
          // Неактивная кнопка остаётся на месте, а не исчезает: иначе
          // «Вперёд» прыгает влево при переходе на первую страницу.
          <span className={disabledClass}>← Назад</span>
        )}

        {hasNext ? (
          <Link href={hrefFor(offset + limit)} className={linkClass}>
            Вперёд →
          </Link>
        ) : (
          <span className={disabledClass}>Вперёд →</span>
        )}
      </div>
    </div>
  );
}
