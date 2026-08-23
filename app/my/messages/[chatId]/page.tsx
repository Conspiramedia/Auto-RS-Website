// ============================================================
// RS AUTO — Диалог (/my/messages/[chatId]), сербская версия.
// ============================================================
// Разметка живёт в components/pages/ChatRoomPageView — общая с /ru/my/messages/[chatId].
// Метаданные (noindex) и проверку сессии задаёт layout кабинета.
// ============================================================

import ChatRoomPageView from '@/components/pages/ChatRoomPageView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'sr';

type Params = { chatId: string };

export default async function ChatRoomPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { chatId } = await params;
  return <ChatRoomPageView locale={locale} chatId={chatId} />;
}
