// ============================================================
// RS AUTO — Пустое состояние каталога. Server Component.
// ============================================================
// Требование проекта: причина + «Сбросить фильтры» + «Сообщить, когда
// появится». Просто «ничего не найдено» — тупик, из которого пользователь
// уходит с сайта.
//
// «Сообщить, когда появится» ведёт в приложение: механика сохранённых
// поисков и пуш-уведомлений уже реализована на бэкенде (saved_searches,
// push_queue) и работает именно там.
// ============================================================

import Button from './ui/Button';
import StateCard from './ui/StateCard';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

type Props = {
  locale: Locale;
  // Путь для сброса фильтров: чистый каталог или SEO-страница марки.
  resetPath: string;
  // Показывать ли кнопку сброса: если фильтров нет, сбрасывать нечего
  // (например, в каталоге пока вообще нет объявлений).
  showReset: boolean;
  // Витрина: заголовок «Нет автомобилей в аренду» точнее общего
  // «Ничего не нашли», когда раздел аренды пуст целиком.
  mode?: 'sale' | 'rent';
};

export default function EmptyState({
  locale,
  resetPath,
  showReset,
  mode = 'sale',
}: Props) {
  const t = getT(locale);

  // Без фильтров пустая выдача означает, что раздел пуст сам по себе —
  // для аренды об этом говорим прямо.
  const title =
    mode === 'rent' && !showReset ? t('rent_empty_title') : t('empty_title');

  return (
    <StateCard
      locale={locale}
      title={title}
      text={t('empty_reason')}
      hint={t('empty_notify_hint')}
      actions={
        <>
          {showReset && (
            <Button
              variant="dark"
              size="sm"
              href={localeHref(locale, resetPath)}
            >
              {t('empty_reset')}
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            href={localeHref(locale, '/app')}
          >
            {t('empty_notify')}
          </Button>
        </>
      }
    />
  );
}
