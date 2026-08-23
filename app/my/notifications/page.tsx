// ============================================================
// RS AUTO — Уведомления (/my/notifications), сербская версия.
// ============================================================
// Разметка живёт в components/pages/NotificationsPageView — общая с
// /ru/my/notifications. Метаданные (noindex) и проверку сессии задаёт
// layout кабинета.
// ============================================================

import NotificationsPageView from '@/components/pages/NotificationsPageView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'sr';

export default function MyNotificationsPage() {
  return <NotificationsPageView locale={locale} />;
}
