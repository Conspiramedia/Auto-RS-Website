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
// диалоги» в шапке кабинета.
//
// ВЫСОТА. Лента прокручивается сама, а не тянет за собой страницу:
// h-[calc(100vh-13rem)] — экран минус шапка сайта, заголовок кабинета
// и вкладки. Так поле ввода всегда на месте, как в мессенджере.
// На мобильном высота задаётся минимумом (70vh), а не жёстко: адресная
// строка браузера меняет высоту экрана при прокрутке, и фиксированная
// величина там приводила бы к прыжкам поля ввода.
//
// ТРИ НЕПОДВИЖНЫХ СЛОЯ СВЕРХУ ВНИЗ: шапка собеседника, карточка машины,
// затем прокручиваемая лента и поле ввода. Карточка объявления вынесена
// из шапки и закреплена отдельной строкой намеренно: в переписке о
// машине предмет разговора должен быть виден на любой глубине ленты.
// Внутри шапки под именем ему доставалась одна строка мелким серым —
// по ней не читались ни цена, ни кадр.
//
// ЧУЖОЙ ДИАЛОГ невозможен: RLS chats_select_participant отдаёт только
// свои чаты, и запрос по чужому id вернёт пусто → notFound().
// ============================================================

import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import ChatList, { Avatar } from '@/components/ChatList';
import ChatRoom from '@/components/ChatRoom';
import Card from '@/components/ui/Card';
import { formatPrice, formatRentPrice } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { getCurrentUser, getServerClient } from '@/lib/supabaseServer';
import type { ChatListItem, ChatMessage } from '@/lib/types';

// Сколько последних сообщений отдаёт сервер. Переписка по объявлению
// редко длиннее пары десятков реплик, а весь архив на первом экране
// удлинил бы ответ без пользы: читают всегда конец.
const INITIAL_MESSAGES = 100;

// Цена объявления для закреплённой карточки. Во VIEW chats_with_details
// её нет, и добавлять туда поле ради одного экрана нельзя: вьюху читает
// и приложение, а её пересборка меняет общий контракт бэкенда. Отдельный
// SELECT по cars дешевле и уходит параллельно с остальными запросами.
type ChatCarPrice = {
  currency: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  is_for_sale: boolean;
  is_for_rent: boolean;
};

type Props = {
  locale: Locale;
  chatId: string;
};

export default async function ChatRoomPageView({ locale, chatId }: Props) {
  const t = getT(locale);

  const user = await getCurrentUser();
  if (!user) notFound();

  const supabase = await getServerClient();

  // Список диалогов, сообщения открытого и цена объявления —
  // параллельно: запросы независимы, последовательное ожидание
  // утроило бы задержку.
  const [chatsResult, messagesResult, carResult] = await Promise.all([
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
    // Цена — по связи chats → cars. Строки может не быть: политика
    // cars_select_active_public отдаёт покупателю только активные
    // объявления, и снятое с публикации вернёт пусто. Это не ошибка,
    // карточка тогда просто останется без цены (см. ниже).
    supabase
      .from('chats')
      .select(
        'cars(currency,sale_price,rent_price_daily,is_for_sale,is_for_rent)',
      )
      .eq('id', chatId)
      .maybeSingle(),
  ]);

  const chats = (chatsResult.data ?? []) as ChatListItem[];
  const chat = chats.find((item) => item.id === chatId);

  // Чата нет в списке — значит он чужой или не существует. RLS уже
  // отсеяла его, здесь просто отдаём 404.
  if (!chat) notFound();

  // Вложенный объект связи. Типы схемы в проект не сгенерированы,
  // поэтому приводим явно; отсутствие строки учтено выше.
  const car =
    (carResult.data as { cars: ChatCarPrice | null } | null)?.cars ?? null;

  // Что показывать ценой. Объявление только под аренду выводит суточную
  // ставку: цена продажи у него пуста, и formatPrice отдал бы
  // «Договорная» там, где ставка на самом деле есть.
  const price = car
    ? car.is_for_sale
      ? formatPrice(car.sale_price, car.currency, locale)
      : formatRentPrice(car.rent_price_daily, car.currency, locale)
    : null;

  const messages = ((messagesResult.data ?? []) as ChatMessage[])
    .slice()
    .reverse();

  const carTitle = `${chat.brand} ${chat.model}, ${chat.year}`;

  // Пометка входящих прочитанными НЕ делается здесь. Это мутация, а
  // Next запрещает мутации и сброс кэша (revalidatePath) во время
  // рендера Server Component: вызов markChatRead прямо в теле страницы
  // ронял диалог в 500, как только в нём были непрочитанные — то есть
  // ровно в тех чатах, ради которых её и открывают. Действие вызывает
  // ChatRoom из useEffect после монтирования: там это отдельный POST,
  // где revalidatePath законен.

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* Левая панель — только десктоп. */}
      <Card
        padding="none"
        className="hidden overflow-hidden lg:block lg:h-[calc(100vh-13rem)] lg:overflow-y-auto"
      >
        <ChatList locale={locale} chats={chats} activeChatId={chatId} />
      </Card>

      {/* Правая панель: шапка, карточка машины, лента, поле ввода. */}
      {/* min-h на мобильном обязателен: без явной высоты flex-1 внутри
          ленты схлопывается по содержимому, и переписка из двух реплик
          прижимает поле ввода к самому верху экрана. 70vh оставляет
          место шапке сайта и не спорит с адресной строкой браузера,
          которая меняет высоту при прокрутке. */}
      <Card
        padding="none"
        className="flex min-h-[70vh] flex-col overflow-hidden bg-chat-surface lg:h-[calc(100vh-13rem)] lg:min-h-0"
      >
        {/* ---------------------------------------------------------
            Шапка диалога: аватар, имя, под ним машина серым; справа
            миниатюра кадра.
            ---------------------------------------------------------
            Белая, без тени — от ленты её отделяет тонкая линия. Тень
            читалась бы как ещё один слой поверх и утяжеляла верх экрана
            без нужды.

            Путь назад («Все чаты») живёт в строке заголовка кабинета
            (MyHeaderBack): здесь он сначала стоял слева от аватара и
            отжимал собеседника вправо, а затем строкой над ним — и
            занимал целую строку ради одной ссылки. */}
        <div className="shrink-0 border-b border-neutral-10 bg-white px-3 py-2.5">
          <div className="mx-auto flex max-w-chat items-center gap-3">
            <Avatar
              name={chat.opponent_name}
              url={chat.opponent_avatar}
              size="lg"
            />

            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">
                {chat.opponent_name?.trim() || t('car_seller')}
              </div>
              <div className="truncate text-caption text-neutral-60">
                {carTitle}
              </div>
            </div>

            {/* Кадр машины справа. aria-hidden: то же фото стоит в
                карточке ниже вместе с названием, и скринридеру эта
                миниатюра ничего не добавляет. */}
            <span
              aria-hidden
              className="relative h-10 w-14 shrink-0 overflow-hidden rounded-control bg-surface-muted"
            >
              {chat.car_photo && (
                <Image
                  src={chat.car_photo}
                  alt=""
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              )}
            </span>
          </div>
        </div>

        {/* ---------------------------------------------------------
            Закреплённая карточка объявления.
            ---------------------------------------------------------
            Не входит в прокручиваемую область: предмет переписки виден
            на любой её глубине. Высота ~68px — фото 48px плюс отступы;
            выше плашка начала бы отъедать ленту, ниже фото перестало бы
            читаться.

            Ссылкой целиком, а не строкой текста внутри: открыть
            объявление из диалога нужно постоянно, и человек ожидает,
            что кликается вся плашка. */}
        <Link
          href={localeHref(locale, `/car/${chat.car_id}`)}
          className="shrink-0 border-b border-neutral-10 bg-white px-3 py-2 transition-colors duration-fast ease-out hover:bg-surface-hover active:bg-surface-active"
        >
          <div className="mx-auto flex max-w-chat items-center gap-3">
            <span className="relative h-12 w-16 shrink-0 overflow-hidden rounded-control bg-surface-muted">
              {chat.car_photo && (
                <Image
                  src={chat.car_photo}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="truncate text-caption font-bold">{carTitle}</div>

              {/* Цены может не быть: объявление снято с публикации, и
                  RLS не отдала строку покупателю. Пустое место вместо
                  прочерка — обещать цену, которой не видно, хуже, чем
                  промолчать; ссылка при этом остаётся рабочей. */}
              {price && (
                <div className="truncate text-caption font-semibold text-brand-green">
                  {price}
                </div>
              )}
            </div>

            {/* Шеврон: подсказка, что плашка ведёт дальше. */}
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0 text-neutral-30"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </div>
        </Link>

        <ChatRoom
          locale={locale}
          chatId={chatId}
          currentUserId={user.id}
          initialMessages={messages}
          peerBlocked={chat.peer_blocked}
          hasUnread={chat.unread_count > 0}
        />
      </Card>
    </div>
  );
}
