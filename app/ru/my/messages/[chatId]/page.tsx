// ============================================================
// RS AUTO — Диалог (/ru/my/messages/[chatId]), русская версия.
// ============================================================
// Разметка живёт в components/pages/ChatRoomPageView — общая с /my/messages/[chatId].
// Метаданные (noindex) и проверку сессии задаёт layout кабинета.
// ============================================================

import ChatRoomPageView from '@/components/pages/ChatRoomPageView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'ru';

type Params = { chatId: string };

export default async function RuChatRoomPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { chatId } = await params;
  return <ChatRoomPageView locale={locale} chatId={chatId} />;
}
