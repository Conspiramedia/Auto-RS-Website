// ============================================================
// RS AUTO — Статус объявления в кабинете. Server Component.
// ============================================================
// Маппинг «код статуса из БД → тон и подпись». Вынесен отдельно от
// components/ui/Badge, потому что это две разные задачи: Badge знает,
// КАК выглядит плашка, а этот компонент — ЧТО означает статус.
//
// Тона повторяет _StatusChip приложения (my_cars_screen.dart) один в
// один: продавец, у которого открыты и сайт, и приложение, должен
// видеть один и тот же цвет у одного и того же объявления.
//   moderation → warning      (золотой)        — ждёт проверки
//   active     → success-soft (светло-зелёный) — опубликовано
//   rejected   → error        (красный)        — отклонено
//   sold       → success      (зелёный)        — продано
//   archived   → neutral      (серый)          — в архиве
//
// Зелёный достаётся ОБОИМ хорошим состояниям, но разным весом.
// Продано — сплошная заливка: это результат, ради которого объявление
// подавали, и в списке он должен быть заметнее всего. Опубликовано —
// та же зелень 10% с зелёным текстом: публикация идёт своим чередом
// и внимания не требует. Тёмная плашка у проданного была ошибкой:
// чёрный читается как проблема, а продажа — хорошая новость.
//
// Неизвестный статус (в enum добавили значение, а клиент ещё не знает)
// показывается нейтральным тоном с сырым кодом. Это лучше, чем пустое
// место: продавец увидит, что состояние есть, и сможет назвать его в
// обращении в поддержку.
// ============================================================

import Badge from './ui/Badge';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

// Тона Badge, применимые к статусам. Сужение общего типа Badge до
// подмножества, которое здесь имеет смысл.
type StatusTone =
  | 'warning'
  | 'success'
  | 'success-soft'
  | 'error'
  | 'neutral';

const STATUS_MAP: Record<string, { tone: StatusTone; key: DictKey }> = {
  moderation: { tone: 'warning', key: 'my_status_moderation' },
  active: { tone: 'success-soft', key: 'my_status_active' },
  rejected: { tone: 'error', key: 'my_status_rejected' },
  sold: { tone: 'success', key: 'my_status_sold' },
  archived: { tone: 'neutral', key: 'my_status_archived' },
};

type Props = {
  locale: Locale;
  status: string;
  className?: string;
};

export default function StatusBadge({ locale, status, className }: Props) {
  const t = getT(locale);
  const known = STATUS_MAP[status];

  return (
    <Badge tone={known?.tone ?? 'neutral'} className={className}>
      {known ? t(known.key) : status}
    </Badge>
  );
}
