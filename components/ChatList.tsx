// ============================================================
// RS AUTO — Список диалогов. Server Component.
// ============================================================
// Используется в ДВУХ ролях, и это одна и та же разметка:
//   * самостоятельная страница /my/messages (мобильный и планшет);
//   * левая панель рядом с лентой сообщений на десктопе.
// Отличие только в ширине контейнера и в подсветке активной строки —
// оба параметра приходят пропсами.
//
// ПОРЯДОК СТРОК задаёт сервер: сначала закреплённые (pinned_at по
// убыванию), затем остальные по времени последнего сообщения. Сортировать
// на клиенте нельзя — при подгрузке список пересобирался бы на глазах.
// Тот же порядок в приложении (chat_repository.dart: fetchMyChatsDetailed).
// ============================================================

import Image from 'next/image';
import Link from 'next/link';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import type { ChatListItem } from '@/lib/types';

type Props = {
  locale: Locale;
  chats: ChatListItem[];
  // Открытый диалог: его строка подсвечивается. На странице списка
  // без выбранного диалога не передаётся.
  activeChatId?: string;
};

export default function ChatList({ locale, chats, activeChatId }: Props) {
  const t = getT(locale);

  return (
    <ul className="divide-y divide-neutral-10">
      {chats.map((chat) => {
        const active = chat.id === activeChatId;

        return (
          <li key={chat.id}>
            <Link
              href={localeHref(locale, `/my/messages/${chat.id}`)}
              className={[
                'flex gap-3 px-3 py-3 transition-colors duration-fast ease-out',
                active ? 'bg-surface-active' : 'hover:bg-surface-hover',
              ].join(' ')}
            >
              <Avatar
                name={chat.opponent_name}
                url={chat.opponent_avatar}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {chat.opponent_name?.trim() || t('car_seller')}
                  </span>

                  {/* Дата последнего сообщения. У пустого диалога её
                      нет — показывать «—» незачем, строка и так короткая. */}
                  {chat.last_message_at && (
                    <span className="shrink-0 text-small text-neutral-50">
                      {shortDate(chat.last_message_at, locale, t)}
                    </span>
                  )}
                </div>

                {/* Объявление, по которому идёт переписка. Мини-фото
                    важнее названия: продавец с десятком объявлений
                    узнаёт машину по кадру быстрее, чем читает марку. */}
                <div className="mt-1 flex items-center gap-1.5 text-caption text-neutral-60">
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
                    {chat.brand} {chat.model}
                  </span>
                </div>

                <div className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-caption text-neutral-60">
                    {chat.last_message ?? t('chat_no_messages')}
                  </span>

                  {/* Счётчик непрочитанных. Зелёный — тот же акцент,
                      что у главного действия: это единственное место
                      строки, требующее внимания. */}
                  {chat.unread_count > 0 && (
                    <span className="shrink-0 rounded-pill bg-brand-green-ink px-1.5 text-small font-semibold leading-5 text-white">
                      {chat.unread_count > 99 ? '99+' : chat.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------
// Аватар собеседника или инициал.
// ------------------------------------------------------------
// Инициал вместо безликой иконки: в списке из нескольких диалогов
// буква различает собеседников, а одинаковые силуэты — нет.
export function Avatar({
  name,
  url,
  size = 'md',
}: {
  name: string | null;
  url: string | null;
  size?: 'md' | 'lg';
}) {
  const box = size === 'lg' ? 'h-11 w-11 text-body' : 'h-10 w-10 text-caption';
  const initial = name?.trim()?.[0]?.toUpperCase() ?? '?';

  return (
    <span
      className={`relative shrink-0 overflow-hidden rounded-pill bg-surface-muted ${box}`}
    >
      {url ? (
        <Image src={url} alt="" fill sizes="44px" className="object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-semibold text-neutral-50">
          {initial}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------
// Короткая дата для строки списка.
// ------------------------------------------------------------
// Сегодняшнее сообщение — время, вчерашнее — слово, остальное — дата
// без года. Полная дата со временем в узкой строке не помещается, а
// год у переписки почти всегда текущий.
function shortDate(
  value: string,
  locale: Locale,
  t: (key: 'chat_today' | 'chat_yesterday') => string,
): string {
  const date = new Date(value);
  const now = new Date();
  const intl = locale === 'ru' ? 'ru-RU' : 'sr-Latn-RS';

  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return new Intl.DateTimeFormat(intl, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return t('chat_yesterday');
  }

  return new Intl.DateTimeFormat(intl, {
    day: 'numeric',
    month: 'short',
  }).format(date);
}
