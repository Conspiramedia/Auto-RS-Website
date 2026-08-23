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
      <Card padding="none" className="px-6 py-12 text-center">
        <p className="text-neutral-60">{t('my_action_error')}</p>
      </Card>
    );
  }

  const chats = (data ?? []) as ChatListItem[];

  if (chats.length === 0) {
    return (
      <Card padding="none" className="px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">{t('chat_empty_title')}</h2>
        <p className="mx-auto mt-2 max-w-md text-neutral-60">
          {t('chat_empty_text')}
        </p>
      </Card>
    );
  }

  return (
    <Card padding="none" className="max-w-2xl overflow-hidden">
      <ChatList locale={locale} chats={chats} />
    </Card>
  );
}
