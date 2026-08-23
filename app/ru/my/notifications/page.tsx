// ============================================================
// RS AUTO — Уведомления (/ru/my/notifications), русская версия.
// ============================================================
// Разметка живёт в components/pages/NotificationsPageView — общая с
// /my/notifications. Метаданные (noindex) и проверку сессии задаёт
// layout кабинета.
// ============================================================

import NotificationsPageView from '@/components/pages/NotificationsPageView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'ru';

export default function RuMyNotificationsPage() {
  return <NotificationsPageView locale={locale} />;
}
