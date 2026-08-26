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
// СТРОКА ЛЕНТЫ — клиентская (components/NotificationRow): переход по
// уведомлению помечает его прочитанным, а это требует обработчика.
// Всё остальное на экране, включая саму выборку под RLS, остаётся
// серверным.
//
// ЯЗЫК СОДЕРЖИМОГО. title и body написаны по-русски — их пишут триггеры,
// общие с приложением. Переводить их на сербский пришлось бы правкой
// самих триггеров, а это задевает приложение и делается отдельной
// задачей. Каркас экрана при этом локализован полностью.
// ============================================================

import MarkAllReadButton from '@/components/MarkAllReadButton';
import NotificationRow from '@/components/NotificationRow';
import Card from '@/components/ui/Card';
import StateCard from '@/components/ui/StateCard';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
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
      {/* Строка действия над лентой. На 360px кнопка переносится под
          счётчик (flex-wrap), на остальных стоит справа.

          ПОКАЗЫВАЕТСЯ ВСЕГДА, а не только при unreadCount > 0. Раньше
          блок скрывался при нуле непрочитанных, и это было незаметно:
          уведомления гасились лишь этой самой кнопкой, поэтому ноль
          означал «только что нажали». С пометкой по переходу
          (NotificationRow) непрочитанные кончаются сами собой, и
          исчезающая кнопка читалась как пропавшая — человек не знал,
          вернётся ли она, когда накопится новое.

          При нуле кнопка остаётся на месте, но неактивна: место в
          раскладке не прыгает, а недоступность объясняет сама себя. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-caption text-neutral-60">
          {t('notif_unread')}: {unreadCount}
        </span>
        <MarkAllReadButton locale={locale} disabled={unreadCount === 0} />
      </div>

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
