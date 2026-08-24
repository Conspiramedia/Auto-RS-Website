// ============================================================
// RS AUTO — Чипс статуса объявления. Server Component.
// ============================================================
// Цвета берутся из брендовых токенов и совпадают со смыслом статуса
// на всём сайте: active зелёный (опубликовано), moderation золотой
// (ждёт решения), rejected красный (отказ), archived и sold серые
// (вне выдачи, но по разным причинам).
//
// Заливка приглушённая, а не сплошная: в таблице на 50 строк восемь
// ярких плашек в колонке перебивают собственно данные. Цветом здесь
// сообщается категория, а не тревога.
//
// Неизвестный статус выводится как есть серым. В enum car_status
// могут добавить значение раньше, чем сюда, и «пусто вместо статуса»
// в списке хуже, чем незнакомое слово.
// ============================================================

const STATUS: Record<string, { label: string; className: string }> = {
  active: {
    label: 'Опубликовано',
    className: 'bg-status-success text-success',
  },
  moderation: {
    label: 'На проверке',
    className: 'bg-status-warning text-warning',
  },
  rejected: {
    label: 'Отклонено',
    className: 'bg-status-error text-error',
  },
  archived: {
    label: 'В архиве',
    className: 'bg-surface-muted text-neutral-60',
  },
  sold: {
    label: 'Продано',
    className: 'bg-surface-muted text-neutral-60',
  },
  draft: {
    label: 'Черновик',
    className: 'bg-surface-muted text-neutral-50',
  },
};

export default function StatusChip({ status }: { status: string }) {
  const known = STATUS[status];

  return (
    <span
      className={[
        'inline-block whitespace-nowrap rounded-pill px-2 py-0.5 text-micro font-medium',
        known?.className ?? 'bg-surface-muted text-neutral-60',
      ].join(' ')}
    >
      {known?.label ?? status}
    </span>
  );
}
