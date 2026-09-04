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
//
// ОФОРМЛЕНИЕ — минимализм мессенджера: воздух вместо рамок, свой пузырь
// градиентом, чужой — светло-серой заливкой, дни разделены капсулой.
// Все цвета берутся из brand.chat через Tailwind (bg-chat-*,
// from-chat-accent-*): смена акцента с синего на фирменный зелёный —
// правка одной строки в tailwind.config.ts, разметку трогать не нужно.
// ============================================================

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { markChatRead, sendMessage } from '@/app/my/actions';
import {
  isMessageAllowed,
  splitMessageByContacts,
} from '@/lib/contactGuard';
import Alert from './ui/Alert';
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

// Быстрые вопросы: пара «короткая подпись на чипе → полный текст в
// поле». Списком, а не шестью обращениями подряд в разметке: добавить
// седьмой вопрос — дописать пару ключей в словарь и строку сюда, а не
// копировать очередную кнопку.
//
// ЗАЧЕМ ДВА ТЕКСТА НА ОДИН ВОПРОС. На кнопке — вопрос без
// «Здравствуйте!», в поле уходит он же С приветствием. Все шесть
// заготовок начинаются одинаково, и на чипах это слово не различает
// их ничем, а в сообщении продавцу нужно: первое обращение к
// незнакомому человеку без приветствия звучит грубо.
//
// Подпись — это полный текст МИНУС приветствие, слово в слово.
// Расхождение читалось бы как подмена: нажал одно, в поле появилось
// другое. Полный текст продублирован в title и aria-label, чтобы то,
// что отправится, было видно и при наведении, и скринридеру.
//
// ГДЕ ОНИ ЖИВУТ. В ПУСТОЙ ЛЕНТЕ, по центру, а не полосой над полем
// ввода. Полоса там была и не помещалась: колонка чата ограничена
// max-w-chat = 720px (brand.chat.maxWidth) на любом мониторе, ряду
// оставалось 696px, и шестой чип упирался в край. Горизонтальная
// прокрутка чинила симптом, но чип у границы читался как поломанная
// вёрстка.
//
// В пустой ленте места достаточно, и чипы выложены СЕТКОЙ — на 360px,
// 768px и 1280px все шесть видны целиком, без прокрутки. Заодно ушла
// лишняя полоса над клавиатурой на телефоне. Почему именно сетка, а не
// перенос по строкам, — в комментарии у самой разметки.
//
// Дублировать их ещё и над полем ввода не стали: одни и те же шесть
// кнопок дважды на одном экране — шум.
//
// `as const` обязателен: без него тип ключей расширился бы до string,
// и t() перестал бы принимать их как ключи словаря — опечатку поймает
// компилятор, а не пустая кнопка в чате.
const QUICK_QUESTIONS = [
  { label: 'quick_q1_label', full: 'quick_q1' },
  { label: 'quick_q2_label', full: 'quick_q2' },
  { label: 'quick_q3_label', full: 'quick_q3' },
  { label: 'quick_q4_label', full: 'quick_q4' },
  { label: 'quick_q5_label', full: 'quick_q5' },
  { label: 'quick_q6_label', full: 'quick_q6' },
] as const;

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

  // КОНТАКТЫ И ССЫЛКИ В СООБЩЕНИИ (lib/contactGuard.ts, миграция 0137).
  //
  // Считаем через useMemo: правила прогоняются на каждое нажатие
  // клавиши, а лента при этом перерисовывается ещё и по приходу чужих
  // сообщений — пересчитывать одно и то же на каждый ререндер незачем.
  //
  // Это ВЕРХНИЙ слой, подсказка. Жёсткий барьер — в триггере базы:
  // сообщения пишутся обычным INSERT под RLS, и запрос можно послать
  // мимо формы.
  const blocked = useMemo(() => !isMessageAllowed(text), [text]);

  // Подсказку показываем ОДИН РАЗ: выбрал вопрос — дальше диалог идёт
  // без неё. Гасим по КЛИКУ, а не по факту отправки, поэтому нужен
  // отдельный флаг: между нажатием на чип и отправкой человек правит
  // текст в поле, и висящий над ним список заготовок в этот момент уже
  // мешает — он предлагает заменить то, что покупатель сейчас пишет.
  //
  // Обратно подсказка не возвращается, даже если поле очистить: она
  // помогает начать разговор, а начат он уже выбором вопроса.
  const [quickQuestionsUsed, setQuickQuestionsUsed] = useState(false);

  // БЫСТРЫЕ ВОПРОСЫ: заготовки для первого сообщения продавцу.
  //
  // Второе условие — «покупатель ещё ничего не написал», а не «лента
  // пуста»: продавец мог написать первым (например, ответить на другой
  // чат и перейти сюда), и подсовывать покупателю «Здравствуйте!
  // Автомобиль ещё продаётся?» в уже начатом разговоре незачем.
  //
  // Оно считается по messages, который обновляется realtime-подпиской,
  // и закрывает случаи, до которых флаг выше не дотягивается: диалог,
  // открытый на втором устройстве, и возврат в чат после перезагрузки
  // страницы.
  const showQuickQuestions = useMemo(
    () =>
      !quickQuestionsUsed &&
      !messages.some((m) => m.sender_id === currentUserId),
    [quickQuestionsUsed, messages, currentUserId],
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  // Поле ввода: после нажатия на быстрый вопрос фокус уходит туда,
  // чтобы курсор стоял в конце вставленного текста и его можно было
  // сразу дополнить.
  const inputRef = useRef<HTMLInputElement>(null);

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

    // Проверка здесь, а не только в canSend: отправку запускает ещё и
    // Enter, а он до disabled-состояния кнопки не доходит. Без этой
    // строки сообщение со ссылкой уходило бы на сервер по нажатию
    // Enter и возвращалось оттуда отказом — лишний круг вместо
    // мгновенного ответа.
    if (!isMessageAllowed(clean)) return;

    setError(null);
    // Поле очищаем сразу: ждать ответа сервера, держа текст в поле,
    // выглядит как незасчитанное нажатие.
    setText('');

    startTransition(async () => {
      const result = await sendMessage(chatId, clean);
      if (!result.ok) {
        // Отказ по контактам объясняем причиной, а не общим «не
        // удалось отправить»: до этой ветки доходят те, кто обошёл
        // проверку при вводе, и им тем более нужно объяснение.
        setError(
          result.error === 'contacts_in_message'
            ? t('chat_err_contacts')
            : t('chat_send_failed'),
        );
        // Возвращаем текст, чтобы не заставлять набирать заново.
        setText(clean);
      }
    });
  }

  // Кнопка отправки гаснет, пока в тексте есть ссылка или контакт.
  const canSend = text.trim() !== '' && !pending && !blocked;

  return (
    <>
      {/* Лента. flex-1 + overflow-y-auto: прокручивается она, а не вся
          страница — поле ввода остаётся на месте, как в мессенджере.
          Ширина ограничена max-w-chat и центрирована: на широком
          мониторе полоса реплик во всю панель разносит короткие
          сообщения по дальним краям, и переписку приходится читать
          зигзагом. */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto max-w-chat">
          {messages.length === 0 ? (
            /* ПУСТОЙ ЧАТ: быстрые вопросы вместо одинокой серой строки.
               Здесь для них есть место, и это решает то, что не решалось
               над полем ввода: чипы переносятся по строкам и помещаются
               целиком на любой ширине — горизонтальной прокрутки, из-за
               которой шестой вопрос обрезался, больше нет.

               Условия показа — в showQuickQuestions: подсказка живёт до
               первого выбора (нажал чип — больше не показываем) и не
               появляется, если покупатель в этом диалоге уже писал.
               Как только она отработала, на её месте остаётся обычное
               «Сообщений пока нет»: лента и правда пуста, а текст уже
               лежит в поле ввода и ждёт отправки. */
            <div className="py-6 text-center">
              {showQuickQuestions ? (
                <>
                  {/* Порядок «кнопки → подпись» намеренный: подпись
                      объясняет, что делать с тем, что человек уже
                      увидел. Поставь её сверху — она читалась бы как
                      заголовок пустого экрана, то есть повторяла бы
                      прежнее «Сообщений пока нет». */}
                  {/* СЕТКА, А НЕ ЦЕНТРИРОВАННЫЙ flex-wrap. У переноса с
                      justify-center каждая строка центруется отдельно,
                      и при разной длине вопросов левые края разъезжаются
                      зигзагом — глазу не за что зацепиться, список не
                      читается как список. Колонки дают всем чипам общий
                      левый край и одинаковую ширину.

                      Одна колонка до sm, две с sm: на 360px в две
                      колонки текст переносится внутри КАЖДОГО чипа
                      (проверено — все шесть), и вместо аккуратной
                      таблички получается каша из двухстрочных кнопок.

                      max-w-xl (576px), а не lg: сербские вопросы длиннее
                      русских, и при 512px два из них ломались на две
                      строки. На 576 обе локали укладываются в одну
                      строку на чип. */}
                  <div className="mx-auto grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                    {QUICK_QUESTIONS.map(({ label, full }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          // Полный текст — С приветствием: на кнопке
                          // его нет, потому что там важен сам вопрос,
                          // а продавцу сообщение приходит целиком.
                          setText(t(full));
                          // Подсказка своё отработала — больше не
                          // показываем (см. quickQuestionsUsed).
                          setQuickQuestionsUsed(true);
                          inputRef.current?.focus();
                        }}
                        title={t(full)}
                        aria-label={t(full)}
                        className="rounded-pill bg-chat-input px-3 py-2 text-center text-caption text-neutral-70 transition-colors duration-fast ease-out hover:bg-surface-muted"
                      >
                        {t(label)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-caption text-neutral-50">
                    {t('chat_start_hint')}
                  </p>
                </>
              ) : (
                // Лента пуста, но покупатель уже писал — состояние
                // редкое (сообщения удалены), и подсовывать заготовки
                // тут незачем.
                <p className="text-caption text-neutral-50">
                  {t('chat_no_messages')}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {messages.map((message, index) => (
                <div key={message.id}>
                  {/* Разделитель дня. Ставится перед первым сообщением
                      и всякий раз, когда календарная дата сменилась:
                      без него вчерашняя реплика и сегодняшняя стоят
                      вплотную, а время под пузырём этого не объясняет. */}
                  {startsNewDay(messages, index) && (
                    <div className="flex justify-center py-3">
                      <span className="rounded-pill bg-chat-input px-3 py-1 text-small font-medium text-neutral-60">
                        {dayLabel(message.created_at, locale, t)}
                      </span>
                    </div>
                  )}

                  <Bubble
                    message={message}
                    mine={message.sender_id === currentUserId}
                    locale={locale}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>

      {/* Ввод или баннер блокировки. */}
      <div className="shrink-0 border-t border-neutral-10 bg-white px-3 py-2.5">
        <div className="mx-auto max-w-chat">
          {peerBlocked ? (
            <p className="rounded-control bg-surface-muted px-3 py-2.5 text-center text-caption text-neutral-60">
              {t('chat_blocked')}
            </p>
          ) : (
            <>
              {/* ОДИН РЯД НА ВСЕХ ШИРИНАХ. Прежняя мобильная раскладка в
                  две строки существовала из-за подписи «Отправить»:
                  словом кнопка съедала треть узкого экрана. Круглая
                  кнопка со стрелкой занимает 40px, и ломать строку
                  больше незачем — поле остаётся во всю ширину. */}
              {/* ПРЕДУПРЕЖДЕНИЕ О КОНТАКТАХ.
                  Стоит НАД полем: под ним живёт клавиатура телефона, и
                  сообщение об ошибке там не увидят. Появляется по мере
                  набора — раньше, чем человек потянется к кнопке.

                  Подсветка отдельным блоком, а не поверх input: input
                  не умеет красить куски своего текста, а накладывать
                  позиционированный слой — приём, который ломается на
                  прокрутке длинной строки. */}
              {blocked && (
                <div id="chat-contacts" className="mb-2">
                  <Alert tone="error">{t('chat_err_contacts')}</Alert>
                  <p className="mt-2 text-caption text-neutral-60">
                    {t('chat_contacts_found')}
                  </p>
                  <p className="mt-1 break-words text-caption">
                    {splitMessageByContacts(text).map((chunk, i) =>
                      chunk.match ? (
                        <mark
                          key={i}
                          className="rounded-control bg-status-error px-0.5 text-brand-red"
                        >
                          {chunk.text}
                        </mark>
                      ) : (
                        // Чистые куски приглушены: внимание должно
                        // уходить на подсвеченное.
                        <span key={i} className="text-neutral-50">
                          {chunk.text}
                        </span>
                      ),
                    )}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-invalid={blocked || undefined}
                  aria-describedby={blocked ? 'chat-contacts' : undefined}
                  // Enter отправляет: в переписке это ожидаемое
                  // поведение, а тянуться к кнопке после каждой реплики
                  // утомительно.
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={t('chat_placeholder')}
                  // Pill-поле без рамки: граница здесь лишняя, форму
                  // задаёт заливка. Фокус помечается кольцом, а не
                  // сменой границы, — иначе поле подпрыгивало бы.
                  className="h-10 min-w-0 flex-1 rounded-pill bg-chat-input px-4 text-caption outline-none transition-shadow duration-fast ease-out placeholder:text-neutral-50 focus:ring-2 focus:ring-chat-accent-to"
                  aria-label={t('chat_placeholder')}
                />

                {/* Кнопка отправки. Своя разметка, а не ui/Button:
                    тому нужна подпись и прямоугольная форма контрола,
                    здесь же круг 40px с иконкой. disabled на пустом
                    поле сохранён — как было. */}
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  aria-label={pending ? t('chat_sending') : t('chat_send')}
                  className={[
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-pill text-white transition-opacity duration-fast ease-out',
                    'bg-gradient-to-br from-chat-accent-from to-chat-accent-to',
                    canSend
                      ? 'shadow-bubble hover:opacity-90'
                      : // Неактивная кнопка гасится прозрачностью, а не
                        // серой заливкой: форма и место остаются теми
                        // же, и появление текста не «перекрашивает»
                        // угол экрана.
                        'cursor-not-allowed opacity-40',
                  ].join(' ')}
                >
                  {/* Бумажный самолётик. Инлайновый SVG: одна иконка на
                      экран не стоит ни шрифта, ни зависимости. */}
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 2 11 13" />
                    <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                </button>
              </div>

              {error && (
                <Alert tone="error" className="mt-2">
                  {error}
                </Alert>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------
// Пузырь сообщения.
// ------------------------------------------------------------
// Свои справа градиентом акцента и белым текстом, чужие слева на
// светло-сером — сторона и цвет вместе отвечают на вопрос «кто сказал»
// раньше, чем человек дочитает реплику. Ту же логику показывает чат
// приложения (chat_messages_list.dart), но оформление здесь своё:
// сайт открывают и с монитора, где мелкий контрастный пузырь Flutter
// смотрелся бы плотнее нужного.
//
// ВРЕМЯ ВЫНЕСЕНО ПОД ПУЗЫРЬ, а не оставлено внутри: внутри оно тянуло
// короткую реплику в ширину («Да» превращалось в плашку под время) и
// заставляло держать вторую шкалу цвета для тёмной заливки.
//
// max-w-[78%] нужен, чтобы длинная реплика не растягивалась во всю
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
    <div
      className={`flex flex-col ${mine ? 'items-end' : 'items-start'} py-0.5`}
    >
      <div
        className={[
          'max-w-[78%] rounded-bubble px-3.5 py-2 lg:max-w-[70%]',
          mine
            ? 'bg-gradient-to-br from-chat-accent-from to-chat-accent-to text-white shadow-bubble'
            : 'bg-chat-bubble-peer text-neutral-100',
        ].join(' ')}
      >
        {/* whitespace-pre-wrap сохраняет переносы строк, break-words
            рвёт длинную ссылку без пробелов — иначе она растянула бы
            пузырь за край экрана. */}
        <p className="whitespace-pre-wrap break-words text-caption">
          {message.text}
        </p>
      </div>

      <div className="mt-1 flex items-center gap-1 px-1 text-small text-neutral-50">
        <span>{time(message.created_at, locale)}</span>
        {/* Галочки — только на своих: чужое прочтение отправителю
            не показывают ни здесь, ни в приложении. */}
        {mine && <span>{message.is_read ? '✓✓' : '✓'}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Смена дня между соседними сообщениями.
// ------------------------------------------------------------
// Первое сообщение ленты всегда получает разделитель: без него неясно,
// с какого дня начинается видимый кусок переписки.
function startsNewDay(messages: ChatMessage[], index: number): boolean {
  if (index === 0) return true;

  const prev = new Date(messages[index - 1].created_at);
  const current = new Date(messages[index].created_at);
  return prev.toDateString() !== current.toDateString();
}

// Подпись разделителя: «Сегодня», «Вчера» или дата. Год добавляется
// только для прошлых лет — в свежей переписке он лишний шум.
function dayLabel(
  value: string,
  locale: Locale,
  t: (key: 'chat_today' | 'chat_yesterday') => string,
): string {
  const date = new Date(value);
  const now = new Date();
  const intl = locale === 'ru' ? 'ru-RU' : 'sr-Latn-RS';

  if (date.toDateString() === now.toDateString()) return t('chat_today');

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return t('chat_yesterday');
  }

  return new Intl.DateTimeFormat(intl, {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
}

function time(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'sr-Latn-RS', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
