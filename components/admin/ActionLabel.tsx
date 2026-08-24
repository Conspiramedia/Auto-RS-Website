// ============================================================
// RS AUTO — Подпись действия в журнале. Server Component.
// ============================================================
// Переводит код действия из admin_action_log в человеческую фразу.
// Коды пишут RPC (0078, 0080), и перечень открытый: журнал должен
// уметь показать запись, сделанную функцией, о которой этот файл ещё
// не знает.
//
// Отсюда правило: неизвестный код выводится КАК ЕСТЬ, а не
// заменяется на «неизвестное действие». Сырой код говорит хотя бы
// что-то и позволяет найти виновника поиском по кодовой базе;
// заглушка не говорит ничего.
// ============================================================

const ACTIONS: Record<string, { label: string; className: string }> = {
  car_approved: { label: 'Объявление одобрено', className: 'text-success' },
  car_rejected: { label: 'Объявление отклонено', className: 'text-error' },
  car_archived: { label: 'Снято с публикации', className: 'text-error' },
  car_restored: { label: 'Возвращено в выдачу', className: 'text-success' },
};

export function actionLabel(action: string): string {
  return ACTIONS[action]?.label ?? action;
}

export default function ActionLabel({ action }: { action: string }) {
  const known = ACTIONS[action];

  return (
    <span
      className={`whitespace-nowrap font-medium ${known?.className ?? 'text-neutral-70'}`}
    >
      {known?.label ?? action}
    </span>
  );
}
