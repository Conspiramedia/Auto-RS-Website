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

import Link from 'next/link';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

type Props = {
  locale: Locale;
  // Путь для сброса фильтров: чистый каталог или SEO-страница марки.
  resetPath: string;
  // Показывать ли кнопку сброса: если фильтров нет, сбрасывать нечего
  // (например, в каталоге пока вообще нет объявлений).
  showReset: boolean;
};

export default function EmptyState({ locale, resetPath, showReset }: Props) {
  const t = getT(locale);

  return (
    <div className="rounded-card border border-black/10 px-6 py-12 text-center">
      <h2 className="text-xl font-semibold">{t('empty_title')}</h2>
      <p className="mx-auto mt-2 max-w-md text-black/60">{t('empty_reason')}</p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {showReset && (
          <Link
            href={localeHref(locale, resetPath)}
            className="rounded-control bg-brand-dark px-4 py-2.5 text-sm font-semibold text-white"
          >
            {t('empty_reset')}
          </Link>
        )}

        <Link
          href={localeHref(locale, '/app')}
          className="rounded-control border border-black/15 px-4 py-2.5 text-sm font-semibold hover:bg-black/[0.03]"
        >
          {t('empty_notify')}
        </Link>
      </div>

      <p className="mx-auto mt-3 max-w-md text-sm text-black/50">
        {t('empty_notify_hint')}
      </p>
    </div>
  );
}
