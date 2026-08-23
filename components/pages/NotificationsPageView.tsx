// ============================================================
// RS AUTO — Лента уведомлений /my/notifications. Server Component.
// ============================================================
// ЗАЧЕМ ЭКРАН. Решение модерации до сих пор существовало только внутри
// приложения: триггеры (0024, 0039) пишут строку в notifications, а
// читал её лишь Flutter-клиент. Продавец, подавший объявление через
// сайт, не узнавал ни об одобрении, ни об отказе — приложения у него
// может не быть вовсе.
//
// Письмо (миграция 0071) закрывает этот разрыв только наполовину: вход
// на площадку идёт по SMS, и почта в профиле у большинства продавцов
// пуста. Эта лента — второй, безусловный канал: она работает всегда,
// потому что не зависит ни от адреса, ни от доставки.
//
// ДАННЫЕ читаются напрямую из таблицы под политикой
// notifications_select_own (0024). RPC здесь не нужна: RLS сама
// оставляет только свои строки, а никакой логики поверх выборки нет.
//
// ЯЗЫК СОДЕРЖИМОГО. title и body написаны по-русски — их пишут триггеры,
// общие с приложением. Переводить их на сербский пришлось бы правкой
// самих триггеров, а это задевает приложение и делается отдельной
// задачей. Каркас экрана при этом локализован полностью.
// ============================================================

import Link from 'next/link';

import MarkAllReadButton from '@/components/MarkAllReadButton';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import StateCard from '@/components/ui/StateCard';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { getServerClient } from '@/lib/supabaseServer';
import type { SiteNotification } from '@/lib/types';

type Props = {
  locale: Locale;
};

export default async function NotificationsPageView({ locale }: Props) {
  const t = getT(locale);
  const supabase = await getServerClient();

  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, type, action_id, is_read, created_at')
    .order('created_at', { ascending: false })
    // Лента без пагинации: сотня последних событий покрывает любой
    // разумный сценарий, а бесконечная прокрутка ради системных
    // сообщений — избыточная механика. Старые записи не нужны никому:
    // решение по объявлению полугодовой давности уже неактуально.
    .limit(100);

  if (error) {
    return (
      <StateCard
        locale={locale}
        variant="error"
        retryPath="/my/notifications"
      />
    );
  }

  const items = (data ?? []) as SiteNotification[];

  // ---------- Пусто ----------
  // Тот же паттерн, что у пустого списка объявлений и диалогов:
  // причина + что здесь появится. Кнопки действия здесь нет намеренно —
  // уведомления приходят сами, звать никуда не нужно.
  if (items.length === 0) {
    return (
      <StateCard
        locale={locale}
        title={t('notif_empty_title')}
        text={t('notif_empty_text')}
      />
    );
  }

  const unreadCount = items.filter((item) => !item.is_read).length;

  return (
    // max-w-2xl — та же ширина, что у списка диалогов: лента строк
    // читается тем хуже, чем она шире, и растягивать её на все 1280px
    // десктопа незачем. Двухпанельная раскладка здесь неприменима:
    // у уведомления нет содержимого, которое можно открыть в правой
    // панели, — есть только переход к объявлению или диалогу.
    <div className="max-w-2xl">
      {unreadCount > 0 && (
        // Строка действия над лентой. На 360px кнопка переносится под
        // счётчик (flex-wrap), на остальных стоит справа.
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption text-neutral-60">
            {t('notif_unread')}: {unreadCount}
          </span>
          <MarkAllReadButton locale={locale} />
        </div>
      )}

      <Card padding="none" className="overflow-hidden">
        <ul className="divide-y divide-neutral-10">
          {items.map((item) => (
            <NotificationRow key={item.id} locale={locale} item={item} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------
// Одна строка ленты.
// ------------------------------------------------------------
// Непрочитанное отличается фоном и точкой слева, а не только жирным
// шрифтом: жирность в списке из десятка строк перестаёт читаться как
// признак нового.
function NotificationRow({
  locale,
  item,
}: {
  locale: Locale;
  item: SiteNotification;
}) {
  const t = getT(locale);
  const href = targetHref(locale, item);

  const content = (
    <>
      {/* Индикатор непрочитанного. Занимает место всегда (invisible,
          а не условный рендер) — иначе прочитанные строки съезжали бы
          влево относительно новых, и лента выглядела бы рваной. */}
      <span
        className={[
          'mt-1.5 h-2 w-2 shrink-0 rounded-pill',
          item.is_read ? 'invisible' : 'bg-brand-green',
        ].join(' ')}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={[
              'min-w-0 flex-1',
              item.is_read ? 'font-medium' : 'font-semibold',
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
            <span className="text-small font-semibold text-brand-blue">
              {item.type === 'chat_message'
                ? t('notif_open_chat')
                : t('notif_open_listing')}
            </span>
          )}
        </div>
      </div>
    </>
  );

  const rowClass = [
    'flex gap-3 px-3 py-3 transition-colors duration-fast ease-out',
    item.is_read ? '' : 'bg-brand-green/5',
  ]
    .filter(Boolean)
    .join(' ');

  // Уведомление без цели перехода (или с удалённой сущностью) остаётся
  // обычной строкой: ссылка в никуда хуже её отсутствия.
  if (!href) {
    return (
      <li>
        <div className={rowClass}>{content}</div>
      </li>
    );
  }

  return (
    <li>
      <Link href={href} className={`${rowClass} hover:bg-surface-hover`}>
        {content}
      </Link>
    </li>
  );
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
  if (!item.action_id) return null;

  switch (item.type) {
    case 'chat_message':
      return localeHref(locale, `/my/messages/${item.action_id}`);
    case 'car_approved':
      return localeHref(locale, `/car/${item.action_id}`);
    case 'car_rejected':
      return localeHref(locale, `/my/listing/${item.action_id}/edit`);
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
