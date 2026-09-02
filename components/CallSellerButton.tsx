'use client';

// ============================================================
// RS AUTO — Кнопка «Позвонить продавцу». Client Component.
// ============================================================
// ПОЧЕМУ КЛИЕНТСКИЙ — та же причина, что у ContactSellerButton рядом:
// карточка объявления кэшируется (revalidate 300), и чтение сессии на
// сервере перевело бы страницу в динамический рендер, обнулив кэш, на
// котором держится SEO. Сервер отдаёт кнопку одинаковой всем, решение
// принимается в браузере.
//
// НОМЕР НЕ ПОКАЗЫВАЕТСЯ СРАЗУ, а раскрывается по нажатию. Причина не
// косметическая: телефон на странице — это контакт, который собирают
// перекупы обходом каталога. Одно нажатие поднимает цену такого сбора
// и заодно даёт метрику намерения позвонить — до этого шага у площадки
// была статистика только по переписке (seller_contact_click), и
// сравнить каналы было не с чем.
//
// ТРИ СОСТОЯНИЯ, симметрично кнопке переписки:
//   * гость — ведём на /login с адресом возврата. Номер ему не
//     достанется и в обход: get_car_details отдаёт contact_phone
//     только вошедшему (миграция 0116), поэтому phone у гостя
//     приходит пустым, и прятать на клиенте нечего;
//   * владелец объявления — кнопки нет. Звонить самому себе незачем,
//     ровно как и писать (ContactSellerButton скрывается там же);
//   * покупатель — «Показать номер», после нажатия сам номер
//     становится ссылкой tel:.
//
// До проверки сессии кнопка НЕ рисуется: мелькнувшее «Войдите» у
// вошедшего выглядит как разлогин.
// ============================================================

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import Button from './ui/Button';
import { trackEvent } from '@/lib/analytics';
import { formatSerbianPhone } from '@/lib/inputFormat';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref, stripLocale } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';

type Props = {
  locale: Locale;
  // Владелец объявления: сравнивается с текущим пользователем.
  sellerId: string;
  // Контакт из объявления в виде E.164 («+381612345678»). У гостя
  // приходит null — RPC его не отдаёт (0116).
  phone: string | null;
};

export default function CallSellerButton({ locale, sellerId, phone }: Props) {
  const t = getT(locale);
  const pathname = usePathname();

  // undefined — проверка ещё идёт, null — гость.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);

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

  // Своё объявление: звонить самому себе незачем.
  if (userId === sellerId) return null;

  // Гость: вход с возвратом на эту же карточку. Кнопка показывается
  // ДАЖЕ без номера — она и есть приглашение войти, а телефон у
  // гостя не приходит по определению.
  if (userId === null) {
    const { path } = stripLocale(pathname);

    return (
      <Button
        href={`${localeHref(locale, '/login')}?redirect=${encodeURIComponent(path)}`}
        variant="secondary"
        fullWidth
        className="mt-2"
        // Намерение позвонить у гостя — такое же событие воронки, как
        // и намерение написать: без него не видно, сколько покупателей
        // теряется на форме входа.
        onClick={() => trackEvent('seller_call_click', { guest: true })}
      >
        {t('car_call_login')}
      </Button>
    );
  }

  // Вошедший, но номера нет. Такое бывает у снятого объявления: RPC
  // отдаёт contact_phone только для active и sold. Кнопку не рисуем —
  // она бы вела в никуда.
  if (!phone) return null;

  // Номер раскрыт: сам номер и есть ссылка. tel: работает на телефоне,
  // на десктопе передаёт номер в Skype или показывает его текстом —
  // в обоих случаях человек видит цифры и может их набрать вручную.
  if (revealed) {
    return (
      <Button
        href={`tel:${phone}`}
        variant="secondary"
        fullWidth
        className="mt-2"
      >
        {/* Маска «+381 61 234 567» вместо слитного E.164: номер
            показывается человеку, а не системе, и группы цифр он
            запоминает и набирает вручную заметно легче. */}
        {formatSerbianPhone(phone)}
      </Button>
    );
  }

  return (
    <Button
      variant="secondary"
      fullWidth
      className="mt-2"
      onClick={() => {
        setRevealed(true);
        // Событие шлём в момент раскрытия, а не на переходе по tel:
        // — до самого звонка браузер нас уже не уведомит.
        trackEvent('seller_call_click', { guest: false });
      }}
    >
      {t('car_call_show')}
    </Button>
  );
}
