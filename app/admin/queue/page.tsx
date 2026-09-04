// ============================================================
// RS AUTO — Очередь модерации. Server Component.
// ============================================================
// Список того, что ждёт проверки. Порядок задаёт
// admin_moderation_queue: сначала возвраты после решения
// администратора (0091), затем всё остальное — и внутри обеих групп
// FIFO, старые сверху. При сортировке «новые сверху» первое
// объявление продавца висело бы вечно, пока сверху сыплются свежие.
//
// Возвраты идут первыми потому, что их разбор короче: надо сверить
// одно конкретное замечание, а не оценивать объявление целиком.
//
// Навигация — <Link> в колонке «Объявление», а не клик по строке:
// страница остаётся серверной, ссылка открывается средней кнопкой и
// копируется. Ровно тот путь, ради которого Table (M3) сделан
// серверным.
//
// Пагинации в интерфейсе пока нет намеренно. RPC её поддерживает
// (p_limit/p_offset, total_count), но очередь, доросшая до второй
// страницы, — сама по себе сигнал, что модерация не успевает.
// Показываем первые 100 и общее число: если оно больше, это видно в
// шапке и требует не листалки, а разбора.
// ============================================================

import Link from 'next/link';

import AdminBackBar from '@/components/admin/AdminBackBar';
import Table, { type Column } from '@/components/ui/Table';
import { getServerClient } from '@/lib/supabaseServer';
import type { AdminQueueRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const QUEUE_LIMIT = 100;

// Формат — на стороне вызова: Table про вёрстку, а не про локали.
// С временем, а не только датой: по нему видно, объявление лежит час
// или третьи сутки.
const SUBMITTED = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const columns: Column<AdminQueueRow>[] = [
  {
    key: 'car',
    header: 'Объявление',
    // Метка возврата стоит в этой колонке, а не в отдельной: колонки
    // справа прячутся на узких экранах (hideBelow), а знать, что это
    // повторная проверка, модератору нужно на любом устройстве —
    // именно от этого зависит, что он вообще будет смотреть.
    render: (row) => (
      <div className="min-w-0">
        <Link
          href={`/admin/queue/${row.car_id}`}
          className="font-medium hover:underline"
        >
          {row.brand} {row.model}
        </Link>

        {/* Объявление уже проходило решение администратора: его сняли
            или отклонили, продавец исправил замечание и прислал снова
            (миграция 0091). Разбор такого — не «допустимо ли оно
            вообще», а «устранено ли то, за что сняли», поэтому прежняя
            причина показывается сразу, без открытия карточки. */}
        {row.returned_after_decision && (
          // truncate вместе с min-w-0 у родителя: причина бывает до
          // 1000 символов, и без обрезки одна строка таблицы растянула
          // бы всю вёрстку. Полный текст — в title и в карточке.
          <div
            className="mt-0.5 truncate"
            title={row.last_decision_reason ?? undefined}
          >
            <span className="text-micro font-semibold text-warning">
              Повторная проверка
            </span>
            {row.last_decision_reason && (
              <span className="ml-1 text-micro text-neutral-60">
                · {row.last_decision_reason}
              </span>
            )}
          </div>
        )}
      </div>
    ),
  },
  {
    key: 'year',
    header: 'Год',
    width: '72px',
    align: 'right',
    render: (row) => row.year,
  },
  {
    key: 'photos_count',
    header: 'Фото',
    width: '72px',
    align: 'right',
    hideBelow: 'sm',
    // Ноль фотографий — почти всегда отказ, и это должно бросаться в
    // глаза прямо в списке, до открытия карточки.
    render: (row) =>
      row.photos_count === 0 ? (
        <span className="font-semibold text-error">0</span>
      ) : (
        row.photos_count
      ),
  },
  {
    key: 'city',
    header: 'Город',
    width: '140px',
    hideBelow: 'lg',
    render: (row) => row.city,
  },
  {
    key: 'owner',
    header: 'Продавец',
    width: '200px',
    hideBelow: 'md',
    // Контекст доверия прямо в списке: продавец с отклонениями
    // требует другого внимания, и знать об этом надо до открытия
    // карточки, а не после.
    render: (row) => (
      <span className="block truncate">
        {row.owner_name ?? 'без имени'}
        {row.owner_rejected_count > 0 && (
          <span className="ml-1 text-micro font-medium text-error">
            ×{row.owner_rejected_count}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'created_at',
    header: 'Подано',
    width: '132px',
    align: 'right',
    hideBelow: 'sm',
    render: (row) => SUBMITTED.format(new Date(row.created_at)),
  },
];

export default async function AdminQueuePage() {
  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('admin_moderation_queue', {
    p_limit: QUEUE_LIMIT,
    p_offset: 0,
  });

  if (error) {
    return (
      <>
        <AdminBackBar current="Очередь" />
        <h1 className="mt-2 text-h2 font-bold">Очередь</h1>
        <div className="mt-6 rounded-card border border-error/30 bg-status-error p-4">
          <p className="font-semibold text-error">Очередь не загрузилась</p>
          <p className="mt-1 text-caption text-neutral-70">
            Попробуйте обновить страницу.
          </p>
          <Link
            href="/admin/queue"
            className="mt-2 inline-block text-caption text-brand-blue-ink hover:underline"
          >
            Обновить
          </Link>
        </div>
      </>
    );
  }

  const rows = (data ?? []) as AdminQueueRow[];
  // total_count одинаков во всех строках; пустой ответ — пустая
  // очередь, и это не ошибка.
  const total = rows[0]?.total_count ?? 0;

  return (
    <>
      <AdminBackBar current="Очередь" />

      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-h2 font-bold">Очередь</h1>
        <p className="shrink-0 text-caption text-neutral-60">
          {total > 0 ? `Ждут проверки: ${total}` : 'Пусто'}
        </p>
      </div>

      {total > QUEUE_LIMIT && (
        // Очередь, не помещающаяся на страницу, — сигнал, а не повод
        // для листалки.
        <p className="mt-2 text-caption text-neutral-60">
          Показаны первые {QUEUE_LIMIT}. Очередь растёт быстрее, чем
          разбирается.
        </p>
      )}

      <div className="mt-4">
        <Table
          columns={columns}
          rows={rows}
          rowKey={(row) => row.car_id}
          empty="Очередь пуста"
          stickyHeader
        />
      </div>
    </>
  );
}
