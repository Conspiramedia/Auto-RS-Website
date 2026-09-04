'use client';

// ============================================================
// RS AUTO — «Отметить все прочитанными». Client Component.
// ============================================================
// Клиентский ровно ради одного — состояния ожидания на кнопке. Само
// действие серверное (markAllNotificationsRead): оно и обновляет флаг,
// и сбрасывает кэш маршрута, поэтому лента перерисовывается сама, без
// router.refresh() отсюда.
//
// useTransition, а не useState с флагом: он же гасит кнопку на время
// перерисовки ленты сервером, а не только на время самого запроса.
// С обычным флагом кнопка успевала бы стать активной до того, как
// список обновится, и второе нажатие уходило бы вхолостую.
// ============================================================

import { useTransition } from 'react';

import { markAllNotificationsRead } from '@/app/my/actions';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

type Props = {
  locale: Locale;
  // Непрочитанных нет — гасить нечего. Кнопка при этом НЕ скрывается
  // (см. комментарий в NotificationsPageView): она остаётся на месте
  // неактивной, чтобы не пропадать из раскладки и не заставлять
  // человека гадать, куда делась.
  disabled?: boolean;
};

export default function MarkAllReadButton({ locale, disabled = false }: Props) {
  const t = getT(locale);
  const [pending, startTransition] = useTransition();

  return (
    // Кнопка Button здесь НЕ используется намеренно: это
    // третьестепенное действие над лентой, и полноценная кнопка
    // (пусть даже ghost) спорила бы с содержимым списка. Тот же приём,
    // что у «Выйти» в шапке кабинета, — ссылка-действие.
    <button
      type="button"
      disabled={pending || disabled}
      // Результат действия сознательно игнорируется, и фигурные скобки
      // здесь обязательны: startTransition ожидает функцию без
      // возвращаемого значения, а стрелка без блока вернула бы Promise
      // с ActionResult. Показывать ошибку тут нечему — если пометка не
      // прошла, лента просто останется прежней, и человек нажмёт ещё
      // раз; ронять ради этого экран уведомлений незачем.
      onClick={() => {
        startTransition(async () => {
          await markAllNotificationsRead();
        });
      }}
      className="shrink-0 text-caption font-semibold text-brand-blue-ink transition-colors duration-fast ease-out hover:underline disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? t('notif_marking') : t('notif_mark_all')}
    </button>
  );
}
