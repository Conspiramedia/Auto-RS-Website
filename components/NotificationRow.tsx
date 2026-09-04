'use client';

// ============================================================
// RS AUTO — Строка ленты уведомлений. Client Component.
// ============================================================
// ЗАЧЕМ КЛИЕНТСКАЯ. Уведомление считается отработавшим в тот момент,
// когда человек по нему перешёл: он увидел, что объявление одобрили, и
// открыл его. Требовать после этого ещё и «Отметить все прочитанными» —
// значит заставлять делать руками то, что система уже знает. Раньше
// строка была обычным <Link>, и is_read менялся только массовой
// кнопкой: лента оставалась зелёной у человека, который её всю
// прочитал.
//
// Клиентской становится ТОЛЬКО строка. Сама лента
// (NotificationsPageView) остаётся Server Component: она читает
// таблицу под RLS, а разметка одной строки клиенту ничего не стоит.
//
// ПОРЯДОК ДЕЙСТВИЙ: сначала уходим, потом помечаем.
// Переход НЕ ЖДЁТ ответа сервера — router.push вызывается сразу, а
// markNotificationRead уходит следом и завершается уже на новой
// странице. Обратный порядок (await, затем push) добавил бы к каждому
// клику задержку в один сетевой круг: человек нажал «Открыть
// объявление» и смотрит на замерший экран ради флага, который его в
// эту секунду не интересует.
//
// ЧТО ЕСЛИ ПОМЕТКА НЕ ПРОШЛА. Ничего: строка останется непрочитанной,
// и человек либо перейдёт ещё раз, либо нажмёт «Отметить все». Ронять
// или блокировать навигацию из-за служебного флага нельзя.
//
// ОПТИМИСТИЧНОЕ ГАШЕНИЕ. Точка и зелёный фон снимаются сразу по клику,
// не дожидаясь перерисовки ленты. Иначе при возврате «назад» строка
// какое-то время выглядела бы новой: браузер отдаёт страницу из кэша
// роутера, где is_read ещё прежний.
//
// Непрочитанное отличается фоном и точкой слева, а не только жирным
// шрифтом: жирность в списке из десятка строк перестаёт читаться как
// признак нового.
// ============================================================

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MouseEvent } from 'react';

import Badge from '@/components/ui/Badge';
import { markNotificationRead } from '@/app/my/actions';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import type { SiteNotification } from '@/lib/types';

export default function NotificationRow({
  locale,
  item,
}: {
  locale: Locale;
  item: SiteNotification;
}) {
  const t = getT(locale);
  const router = useRouter();
  const href = targetHref(locale, item);

  const [read, setRead] = useState(item.is_read);

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // Открытие в новой вкладке, средней кнопкой, с модификатором — не
    // наш случай: человек остаётся на ленте, и перехватывать переход
    // нельзя. Браузер сам откроет href, а уведомление останется новым —
    // это честно, ленту он не покидал.
    //
    // ПРОВЕРКА КНОПКИ — «НЕ СРЕДНЯЯ И НЕ ПРАВАЯ», А НЕ «РОВНО ЛЕВАЯ».
    // Раньше здесь стояло e.button !== 0, и на телефоне уведомление
    // переставало отмечаться прочитанным: клик, синтезированный
    // браузером из касания, приходит без реальной кнопки мыши, и часть
    // мобильных движков ставит в button значение -1. Условие срабатывало
    // как на среднем клике, обработчик выходил досрочно, и пометка не
    // отправлялась — на десктопе всё работало, потому что там button
    // честно равен нулю.
    //
    // Смысл проверки был в том, чтобы не перехватывать средний и правый
    // клик (button 1 и 2). Именно это условие теперь и записано, а всё
    // остальное — включая -1 у тач-кликов — считается обычным
    // открытием.
    if (
      e.defaultPrevented ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      e.button === 1 ||
      e.button === 2
    ) {
      return;
    }

    e.preventDefault();

    const wasUnread = !read;
    // Гасим подсветку до навигации — см. «оптимистичное гашение» выше.
    setRead(true);

    // ПОМЕТКА ОТПРАВЛЯЕТСЯ ДО НАВИГАЦИИ, а не после. Раньше порядок был
    // обратным, и на мобильной сети это работало против нас: переход
    // начинался первым, а Server Action мог не успеть уйти. На десктопе
    // разница незаметна, на телефоне — та самая «не отмечается».
    //
    // Промис по-прежнему не ожидается: держать человека на ленте ради
    // ответа незачем, важно лишь, чтобы запрос успел отправиться.
    // Уже прочитанное повторно не трогаем — лишний UPDATE поднял бы
    // строку в журнале репликации без единого изменения данных.
    if (wasUnread) void markNotificationRead(item.id);

    if (href) router.push(href);
  }

  const content = (
    <>
      {/* Индикатор непрочитанного. Занимает место всегда (invisible,
          а не условный рендер) — иначе прочитанные строки съезжали бы
          влево относительно новых, и лента выглядела бы рваной. */}
      <span
        className={[
          'mt-1.5 h-2 w-2 shrink-0 rounded-pill',
          read ? 'invisible' : 'bg-brand-green',
        ].join(' ')}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={[
              'min-w-0 flex-1',
              read ? 'font-medium' : 'font-semibold',
            ].join(' ')}
          >
            {item.title}
          </span>

          <span className="shrink-0 text-small text-neutral-50">
            {shortDate(item.created_at, locale, t)}
          </span>
        </div>

        {item.body && (
          // line-clamp-2: причина отклонения бывает длинной, а лента
          // должна оставаться списком, а не полотном текста. Полный
          // текст виден на самом объявлении.
          <p className="mt-1 line-clamp-2 text-caption text-neutral-60">
            {item.body}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusTag locale={locale} type={item.type} />

          {href && (
            <span className="text-small font-semibold text-brand-blue-ink">
              {ctaLabel(item.type, t)}
            </span>
          )}
        </div>
      </div>
    </>
  );

  const rowClass = [
    'flex gap-3 px-3 py-3 transition-colors duration-fast ease-out',
    read ? '' : 'bg-status-success-subtle',
  ]
    .filter(Boolean)
    .join(' ');

  // Уведомление без цели перехода (или с удалённой сущностью) остаётся
  // обычной строкой: ссылка в никуда хуже её отсутствия. Помечать его
  // прочитанным по клику тоже нельзя — кликать там не по чему.
  if (!href) {
    return (
      <li>
        <div className={rowClass}>{content}</div>
      </li>
    );
  }

  return (
    <li>
      {/* Обычный <a>, а не next/link: переход выполняется вручную через
          router.push после пометки, и Link здесь дал бы вторую,
          конкурирующую навигацию. Атрибут href остаётся настоящим —
          средний клик, «открыть в новой вкладке» и предпросмотр адреса
          в строке состояния работают как у любой ссылки. */}
      <a
        href={href}
        onClick={handleClick}
        className={`${rowClass} hover:bg-surface-hover`}
      >
        {content}
      </a>
    </li>
  );
}

// ------------------------------------------------------------
// Подпись перехода под строкой.
// ------------------------------------------------------------
// Раньше здесь стояла тернарная развилка «диалог или объявление» —
// на двух типах она читалась, на четырёх превратилась бы в лестницу.
// Каждая подпись называет, КУДА человек попадёт: «открыть витрину» и
// «открыть профиль» — разные места, и обещать вместо них «объявление»
// значило бы врать в интерфейсе.
function ctaLabel(
  type: string,
  t: ReturnType<typeof getT>,
): string {
  switch (type) {
    case 'chat_message':
      return t('notif_open_chat');
    case 'dealer_app_approved':
      return t('notif_open_showcase');
    case 'dealer_app_rejected':
      return t('notif_open_profile');
    default:
      return t('notif_open_listing');
  }
}

// ------------------------------------------------------------
// Куда ведёт уведомление.
// ------------------------------------------------------------
// Тип решает адрес перехода:
//   chat_message   → диалог;
//   car_approved   → сама карточка объявления, она опубликована;
//   car_rejected   → кабинет: отклонённое объявление публично
//                    недоступно (get_car_details отдаёт только active и
//                    sold), и ссылка на карточку дала бы владельцу 404
//                    вместо формы правки;
//   остальные      → без перехода. Брони и прочие события приложения
//                    страниц на сайте не имеют, и вести на пустоту
//                    незачем.
function targetHref(locale: Locale, item: SiteNotification): string | null {
  // ОТКАЗ ПО ЗАЯВКЕ САЛОНА — ЕДИНСТВЕННЫЙ ТИП БЕЗ action_id, у
  // которого всё же есть куда вести. Заявка не сущность со своей
  // страницей: она показывается блоком внутри профиля, и адрес у неё
  // постоянный. Поэтому проверка action_id ниже, а не первой строкой.
  if (item.type === 'dealer_app_rejected') {
    return localeHref(locale, '/my/profile');
  }

  if (!item.action_id) return null;

  switch (item.type) {
    case 'chat_message':
      return localeHref(locale, `/my/messages/${item.action_id}`);
    case 'car_approved':
      return localeHref(locale, `/car/${item.action_id}`);
    case 'car_rejected':
      return localeHref(locale, `/my/listing/${item.action_id}/edit`);
    // Статус салона выдан: ведём НА ВИТРИНУ, а не в профиль. Человек
    // только что получил страницу салона и первым делом хочет её
    // увидеть. action_id здесь хранит id владельца — адрес витрины
    // /dealer/{user_id} (см. миграцию 0101).
    case 'dealer_app_approved':
      return localeHref(locale, `/dealer/${item.action_id}`);
    default:
      return null;
  }
}

// ------------------------------------------------------------
// Метка типа события.
// ------------------------------------------------------------
// Цвета — те же роли, что у статусов объявления в кабинете
// (components/StatusBadge, тона Badge): опубликовано — success,
// отклонено — error. Человек узнаёт исход по цвету раньше, чем читает
// заголовок.
function StatusTag({ locale, type }: { locale: Locale; type: string }) {
  const t = getT(locale);

  switch (type) {
    case 'car_approved':
      return <Badge tone="success">{t('my_status_active')}</Badge>;
    case 'car_rejected':
      return <Badge tone="error">{t('my_status_rejected')}</Badge>;
    case 'chat_message':
      return <Badge tone="rent">{t('my_tab_messages')}</Badge>;
    // Решения по заявке на статус салона (0101). Цвета те же роли,
    // что у объявлений: выдан — success, отказ — error. Человек
    // узнаёт исход по цвету раньше, чем читает заголовок.
    case 'dealer_app_approved':
      return <Badge tone="success">{t('notif_tag_dealer_ok')}</Badge>;
    case 'dealer_app_rejected':
      return <Badge tone="error">{t('notif_tag_dealer_no')}</Badge>;
    default:
      // Незнакомый тип (событие, заведённое приложением) метки не
      // получает: выдумывать ей название на основании кода нельзя.
      return null;
  }
}

// ------------------------------------------------------------
// Короткая дата строки.
// ------------------------------------------------------------
// Тот же формат, что в списке диалогов (ChatList.shortDate): сегодня —
// время, вчера — слово, дальше — дата без года. Два разных формата
// даты в соседних вкладках кабинета выглядели бы небрежностью.
function shortDate(
  value: string,
  locale: Locale,
  t: (key: 'notif_today' | 'notif_yesterday') => string,
): string {
  const date = new Date(value);
  const now = new Date();
  const intl = locale === 'ru' ? 'ru-RU' : 'sr-Latn-RS';

  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(intl, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return t('notif_yesterday');
  }

  return new Intl.DateTimeFormat(intl, {
    day: 'numeric',
    month: 'short',
  }).format(date);
}
