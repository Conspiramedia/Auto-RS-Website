// ============================================================
// RS AUTO — Сообщения (/my/messages), сербская версия.
// ============================================================
// Пакет 1 — фундамент: маршрут существует, содержимое приходит в
// Пакете 4. Метаданные и noindex задаёт layout кабинета.
// ============================================================

import MyPlaceholderView from '@/components/pages/MyPlaceholderView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'sr';

export default function MyMessagesPage() {
  return <MyPlaceholderView locale={locale} titleKey="my_tab_messages" />;
}
