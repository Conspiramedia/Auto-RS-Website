// ============================================================
// RS AUTO — Диалог /my/messages/[chatId]. Server Component.
// ============================================================
// ДВЕ ПАНЕЛИ НА ДЕСКТОПЕ (1024+): слева список диалогов, справа лента.
// Переключение между диалогами — обычная навигация по ссылке: список
// перерисовывается вместе со страницей, но выглядит неподвижным, потому
// что разметка и данные те же. Это заметно проще клиентского роутера
// внутри страницы и не ломает «назад» в браузере.
//
// НА МОБИЛЬНОМ панель списка скрыта (hidden lg:block): 320px рядом с
// лентой не помещаются, а показывать их стеком значит заставить
// прокручивать весь список до переписки. Вместо этого — ссылка «Все
// диалоги» в шапке ленты.
//
// ВЫСОТА. Лента прокручивается сама, а не тянет за собой страницу:
// h-[calc(100vh-13rem)] — экран минус шапка сайта, заголовок кабинета
// и вкладки. Так поле ввода всегда на месте, как в мессенджере.
// На мобильном высота задаётся минимумом (70vh), а не жёстко: адресная
// строка браузера меняет высоту экрана при прокрутке, и фиксированная
// величина там приводила бы к прыжкам поля ввода.
//
// ЧУЖОЙ ДИАЛОГ невозможен: RLS chats_select_participant отдаёт только
// свои чаты, и запрос по чужому id вернёт пусто → notFound().
// ============================================================

import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { markChatRead } from '@/app/my/actions';
import ChatList, { Avatar } from '@/components/ChatList';
import ChatRoom from '@/components/ChatRoom';
import Card from '@/components/ui/Card';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { getCurrentUser, getServerClient } from '@/lib/supabaseServer';
import type { ChatListItem, ChatMessage } from '@/lib/types';

// Сколько последних сообщений отдаёт сервер. Переписка по объявлению
// редко длиннее пары десятков реплик, а весь архив на первом экране
// удлинил бы ответ без пользы: читают всегда конец.
const INITIAL_MESSAGES = 100;

type Props = {
  locale: Locale;
  chatId: string;
};

export default async function ChatRoomPageView({ locale, chatId }: Props) {
  const t = getT(locale);

  const user = await getCurrentUser();
  if (!user) notFound();

  const supabase = await getServerClient();

  // Список диалогов и сообщения открытого — параллельно: запросы
  // независимы, последовательное ожидание удвоило бы задержку.
  const [chatsResult, messagesResult] = await Promise.all([
    supabase
      .from('chats_with_details')
      .select('*')
      .order('pinned_at', { ascending: false, nullsFirst: false })
      .order('last_message_at', { ascending: false, nullsFirst: false }),
    supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      // Берём ПОСЛЕДНИЕ сообщения: сортировка по убыванию с limit,
      // затем разворот. Прямая сортировка с limit отдала бы начало
      // переписки, а нужен её конец.
      .order('created_at', { ascending: false })
      .limit(INITIAL_MESSAGES),
  ]);

  const chats = (chatsResult.data ?? []) as ChatListItem[];
  const chat = chats.find((item) => item.id === chatId);

  // Чата нет в списке — значит он чужой или не существует. RLS уже
  // отсеяла его, здесь просто отдаём 404.
  if (!chat) notFound();

  const messages = ((messagesResult.data ?? []) as ChatMessage[])
    .slice()
    .reverse();

  // Входящие помечаются прочитанными при открытии — как в приложении.
  // await не нужен: результат на отрисовку не влияет, а ждать запись
  // перед показом переписки значит задержать её на ровном месте.
  if (chat.unread_count > 0) void markChatRead(chatId);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* Левая панель — только десктоп. */}
      <Card
        padding="none"
        className="hidden overflow-hidden lg:block lg:h-[calc(100vh-13rem)] lg:overflow-y-auto"
      >
        <ChatList locale={locale} chats={chats} activeChatId={chatId} />
      </Card>

      {/* Правая панель: шапка диалога, лента, поле ввода. */}
      {/* min-h на мобильном обязателен: без явной высоты flex-1 внутри
          ленты схлопывается по содержимому, и переписка из двух реплик
          прижимает поле ввода к самому верху экрана. 70vh оставляет
          место шапке сайта и не спорит с адресной строкой браузера,
          которая меняет высоту при прокрутке. */}
      <Card
        padding="none"
        className="flex min-h-[70vh] flex-col overflow-hidden lg:h-[calc(100vh-13rem)] lg:min-h-0"
      >
        {/* Шапка диалога — только собеседник, от левого края. Путь
            назад («Все чаты») переехал в строку заголовка кабинета
            (MyHeaderBack): здесь он сначала стоял слева от аватара и
            отжимал собеседника вправо, а затем строкой над ним — и
            занимал целую строку ради одной ссылки. В шапке кабинета
            для неё уже есть свободное место справа. */}
        <div className="border-b border-neutral-10 p-3">
          <div className="flex items-center gap-3">
            <Avatar
              name={chat.opponent_name}
              url={chat.opponent_avatar}
              size="lg"
            />

            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">
                {chat.opponent_name?.trim() || t('car_seller')}
              </div>

              {/* Объявление, по которому идёт переписка, — ссылкой:
                  открыть карточку из диалога нужно постоянно, и искать
                  её в каталоге заново было бы издевательством. */}
              <Link
                href={localeHref(locale, `/car/${chat.car_id}`)}
                className="mt-0.5 flex items-center gap-1.5 text-caption text-neutral-60 hover:text-brand-primary"
              >
                <span className="relative h-6 w-8 shrink-0 overflow-hidden rounded-sm bg-surface-muted">
                  {chat.car_photo && (
                    <Image
                      src={chat.car_photo}
                      alt=""
                      fill
                      sizes="32px"
                      className="object-cover"
                    />
                  )}
                </span>
                <span className="truncate">
                  {chat.brand} {chat.model}, {chat.year}
                </span>
              </Link>
            </div>
          </div>
        </div>

        <ChatRoom
          locale={locale}
          chatId={chatId}
          currentUserId={user.id}
          initialMessages={messages}
          peerBlocked={chat.peer_blocked}
        />
      </Card>
    </div>
  );
}
