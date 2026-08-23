// ============================================================
// RS AUTO — Сообщения (/my/messages), сербская версия.
// ============================================================
// Разметка живёт в components/pages/ChatsPageView — общая с /ru/my/messages.
// Метаданные (noindex) и проверку сессии задаёт layout кабинета.
// ============================================================

import ChatsPageView from '@/components/pages/ChatsPageView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'sr';

export default function MyMessagesPage() {
  return <ChatsPageView locale={locale} />;
}
