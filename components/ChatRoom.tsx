'use client';

// ============================================================
// RS AUTO — Лента сообщений и отправка. Client Component.
// ============================================================
// ПЕРВЫЙ ЭКРАН ПРИХОДИТ С СЕРВЕРА (проп initialMessages): переписка
// открывается сразу, без пустой ленты и спиннера. Дальше компонент
// живёт своей жизнью — подписывается на канал и добавляет новые
// сообщения в конец.
//
// REALTIME. Канал postgres_changes по таблице messages с фильтром
// chat_id: сервер присылает только строки этого диалога, лишний трафик
// на клиента не идёт. Таблица добавлена в публикацию supabase_realtime
// ещё миграцией 0016 — тот же канал слушает приложение
// (chat_repository.dart: messagesStream).
//
// ОТПРАВКА идёт через Server Action, а не прямым insert из браузера:
// после записи нужно обновить список диалогов на сервере (превью
// последнего сообщения, порядок, счётчик). Своё отправленное сообщение
// приходит обратно тем же каналом, поэтому вручную его в ленту не
// добавляем — иначе оно продублировалось бы.
//
// ПРОКРУТКА. Лента всегда показывает низ: переписка читается снизу
// вверх, и открывать её на первом сообщении месячной давности
// бессмысленно. Прокрутка к низу делается и при монтировании, и при
// каждом новом сообщении.
// ============================================================

import { useEffect, useRef, useState, useTransition } from 'react';

import { markChatRead, sendMessage } from '@/app/my/actions';
import Alert from './ui/Alert';
import Button from './ui/Button';
import { fieldClass } from './ui/Field';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';
import type { ChatMessage } from '@/lib/types';

type Props = {
  locale: Locale;
  chatId: string;
  // Кто смотрит: по нему определяется сторона пузыря. Приходит с
  // сервера — на клиенте его пришлось бы ждать отдельным запросом,
  // и первая отрисовка ленты «поехала» бы.
  currentUserId: string;
  initialMessages: ChatMessage[];
  // Собеседник заблокирован текущим пользователем: поле ввода
  // заменяется баннером. Запрет реального уровня — в RLS (0041).
  peerBlocked: boolean;
  // В диалоге есть непрочитанные входящие — их надо погасить при
  // открытии. Считает сервер, гасит клиент (см. useEffect ниже).
  hasUnread: boolean;
};

export default function ChatRoom({
  locale,
  chatId,
  currentUserId,
  initialMessages,
  peerBlocked,
  hasUnread,
}: Props) {
  const t = getT(locale);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const bottomRef = useRef<HTMLDivElement>(null);

  // Подписка на новые сообщения диалога.
  useEffect(() => {
    const supabase = getBrowserClient();

    const channel = supabase
      .channel(`messages:${chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const message = payload.new as ChatMessage;

          setMessages((prev) => {
            // Защита от дубля: при переподключении канал может прислать
            // уже показанное сообщение повторно.
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
        },
      )
      .subscribe();

    return () => {
      // Отписка обязательна: без неё при переходе между диалогами
      // накапливаются каналы, и одно сообщение приходит многократно.
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  // Пометка входящих прочитанными — при открытии диалога, как в
  // приложении. Отсюда, а не из Server Component страницы: markChatRead
  // внутри вызывает revalidatePath, а сброс кэша во время рендера Next
  // запрещает — страница падала бы в 500 на каждом чате с новыми
  // сообщениями. Из useEffect это обычный вызов Server Action
  // отдельным запросом.
  //
  // Зависимость только от chatId: hasUnread намеренно не в списке —
  // после revalidatePath страница перерисуется с hasUnread=false, и
  // изменение пропа не должно считаться поводом позвать действие ещё
  // раз. Один диалог — один вызов.
  useEffect(() => {
    if (!hasUnread) return;
    void markChatRead(chatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Прокрутка к низу при появлении сообщений.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  function submit() {
    const clean = text.trim();
    if (clean === '' || pending) return;

    setError(null);
    // Поле очищаем сразу: ждать ответа сервера, держа текст в поле,
    // выглядит как незасчитанное нажатие.
    setText('');

    startTransition(async () => {
      const result = await sendMessage(chatId, clean);
      if (!result.ok) {
        setError(t('chat_send_failed'));
        // Возвращаем текст, чтобы не заставлять набирать заново.
        setText(clean);
      }
    });
  }

  return (
    <>
      {/* Лента. flex-1 + overflow-y-auto: прокручивается она, а не вся
          страница — поле ввода остаётся на месте, как в мессенджере. */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-caption text-neutral-50">
            {t('chat_no_messages')}
          </p>
        ) : (
          <div className="space-y-2">
            {messages.map((message) => (
              <Bubble
                key={message.id}
                message={message}
                mine={message.sender_id === currentUserId}
                locale={locale}
              />
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Ввод или баннер блокировки. */}
      <div className="border-t border-neutral-10 p-3">
        {peerBlocked ? (
          <p className="rounded-control bg-surface-muted px-3 py-2.5 text-center text-caption text-neutral-60">
            {t('chat_blocked')}
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                // Enter отправляет: в переписке это ожидаемое поведение,
                // а тянуться к кнопке после каждой реплики утомительно.
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={t('chat_placeholder')}
                className={`${fieldClass} flex-1`}
                aria-label={t('chat_placeholder')}
              />
              <Button
                onClick={submit}
                disabled={pending || text.trim() === ''}
                variant="info"
              >
                {pending ? t('chat_sending') : t('chat_send')}
              </Button>
            </div>

            {error && (
              <Alert tone="error" className="mt-2">
                {error}
              </Alert>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------
// Пузырь сообщения.
// ------------------------------------------------------------
// Раскладка повторяет чат приложения (chat_messages_list.dart): свои
// справа с тёмной заливкой, чужие слева на приглушённой подложке,
// радиус контейнера, галочки прочтения только на своих.
//
// max-w-[75%] нужен, чтобы длинная реплика не растягивалась во всю
// ширину: без ограничения теряется сама разница «своё/чужое», которую
// показывает сторона пузыря.
function Bubble({
  message,
  mine,
  locale,
}: {
  message: ChatMessage;
  mine: boolean;
  locale: Locale;
}) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[75%] rounded-card px-3 py-2 lg:max-w-[65%]',
          mine ? 'bg-brand-dark text-white' : 'bg-surface-muted',
        ].join(' ')}
      >
        {/* whitespace-pre-wrap сохраняет переносы строк, break-words
            рвёт длинную ссылку без пробелов — иначе она растянула бы
            пузырь за край экрана. */}
        <p className="whitespace-pre-wrap break-words text-caption">
          {message.text}
        </p>

        <div
          className={`mt-0.5 flex items-center justify-end gap-1 text-small ${
            mine ? 'text-on-dark-70' : 'text-neutral-50'
          }`}
        >
          <span>{time(message.created_at, locale)}</span>
          {/* Галочки — только на своих: чужое прочтение отправителю
              не показывают ни здесь, ни в приложении. */}
          {mine && <span>{message.is_read ? '✓✓' : '✓'}</span>}
        </div>
      </div>
    </div>
  );
}

function time(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'sr-Latn-RS', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
