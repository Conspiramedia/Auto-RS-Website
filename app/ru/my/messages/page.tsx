// ============================================================
// RS AUTO — Сообщения (/ru/my/messages), русская версия.
// ============================================================
// Разметка живёт в components/pages/ChatsPageView — общая с /my/messages.
// Метаданные (noindex) и проверку сессии задаёт layout кабинета.
// ============================================================

import ChatsPageView from '@/components/pages/ChatsPageView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'ru';

export default function RuMyMessagesPage() {
  return <ChatsPageView locale={locale} />;
}
