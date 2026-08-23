// ============================================================
// RS AUTO — Список диалогов /my/messages. Server Component.
// ============================================================
// Экран БЕЗ открытого диалога. На десктопе двухпанельная раскладка
// здесь не строится намеренно: правая панель была бы пустой рамкой на
// две трети экрана. Вместо этого список ограничен по ширине и стоит
// слева — ровно там, где он окажется, когда диалог откроют.
//
// Данные читаются из VIEW chats_with_details под RLS вызывающего:
// пользователь видит только те чаты, где он покупатель или продавец.
// ============================================================

import ChatList from '@/components/ChatList';
import Card from '@/components/ui/Card';
import StateCard from '@/components/ui/StateCard';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { getServerClient } from '@/lib/supabaseServer';
import type { ChatListItem } from '@/lib/types';

type Props = {
  locale: Locale;
};

export default async function ChatsPageView({ locale }: Props) {
  const t = getT(locale);
  const supabase = await getServerClient();

  const { data, error } = await supabase
    .from('chats_with_details')
    .select('*')
    // Порядок задаёт сервер: закреплённые сверху, затем свежие.
    // nullsFirst: false обязателен — у незакреплённых pinned_at равен
    // NULL, и без этого они всплыли бы над закреплёнными.
    .order('pinned_at', { ascending: false, nullsFirst: false })
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error) {
    return (
      <StateCard locale={locale} variant="error" retryPath="/my/messages" />
    );
  }

  const chats = (data ?? []) as ChatListItem[];

  if (chats.length === 0) {
    return (
      <StateCard
        locale={locale}
        title={t('chat_empty_title')}
        text={t('chat_empty_text')}
      />
    );
  }

  return (
    <Card padding="none" className="max-w-2xl overflow-hidden">
      <ChatList locale={locale} chats={chats} />
    </Card>
  );
}
