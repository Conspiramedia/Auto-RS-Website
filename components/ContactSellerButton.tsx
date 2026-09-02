'use client';

// ============================================================
// RS AUTO — Кнопка «Написать продавцу». Client Component.
// ============================================================
// ПОЧЕМУ КЛИЕНТСКИЙ. Карточка объявления кэшируется (revalidate 300) —
// на ней держится SEO. Чтение сессии на сервере перевело бы страницу в
// динамический рендер и обнулило кэш. Поэтому кнопка решает, что
// показать, уже в браузере, а сервер отдаёт её одинаковой всем.
//
// ТРИ СОСТОЯНИЯ:
//   * гость — ведём на /login с адресом возврата: после входа человек
//     возвращается на ту же карточку и дописывает продавцу;
//   * владелец объявления — кнопки нет вовсе. Писать самому себе нельзя
//     (start_chat отклоняет такой вызов), и показывать кнопку, которая
//     заведомо не сработает, — худший вид интерфейса;
//   * покупатель — start_chat создаёт диалог или возвращает
//     существующий (идемпотентно, миграция 0016) и уводит в переписку.
//
// До проверки сессии кнопка НЕ рисуется: мелькнувшее «Войдите» у
// вошедшего выглядит как разлогин.
// ============================================================

import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { startChat } from '@/app/my/actions';
import Alert from './ui/Alert';
import Button from './ui/Button';
import { trackEvent } from '@/lib/analytics';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref, stripLocale } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';

type Props = {
  locale: Locale;
  carId: string;
  // Владелец объявления: сравнивается с текущим пользователем.
  sellerId: string;
};

export default function ContactSellerButton({
  locale,
  carId,
  sellerId,
}: Props) {
  const t = getT(locale);
  const router = useRouter();
  const pathname = usePathname();

  // null — проверка ещё идёт.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await getBrowserClient().auth.getSession();
      if (!cancelled) setUserId(data.session?.user.id ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Проверка не завершена — не показываем ничего.
  if (userId === undefined) return null;

  // Своё объявление: писать самому себе нельзя.
  if (userId === sellerId) return null;

  // Гость: вход с возвратом на эту же карточку.
  if (userId === null) {
    const { path } = stripLocale(pathname);

    return (
      <Button
        href={`${localeHref(locale, '/login')}?redirect=${encodeURIComponent(path)}`}
        variant="info"
        fullWidth
        className="mt-2"
        // Клик гостя тоже событие: намерение связаться он проявил, и
        // без этой отметки в воронке не видно, сколько покупателей
        // теряется на форме входа между кнопкой и созданием диалога.
        onClick={() => trackEvent('seller_contact_click', { guest: true })}
      >
        {t('chat_write')}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="info"
        fullWidth
        className="mt-2"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            // Намерение фиксируем ДО обращения к серверу: событие
            // должно уйти даже если start_chat откажет, иначе в
            // статистике сбой выглядел бы как отсутствие интереса.
            trackEvent('seller_contact_click', { guest: false });

            const result = await startChat(carId);

            if (result.ok && result.chatId) {
              // Диалог создан (или найден существующий — start_chat
              // идемпотентна). Разница между этим счётчиком и
              // предыдущим и есть потери на пути к переписке.
              trackEvent('chat_started');
              router.push(localeHref(locale, `/my/messages/${result.chatId}`));
            } else {
              setError(t('chat_send_failed'));
            }
          })
        }
      >
        {pending ? t('chat_sending') : t('chat_write')}
      </Button>

      {error && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}
    </>
  );
}
