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
// НОМЕР НЕ ПРИХОДИТ С СЕРВЕРНЫМ РЕНДЕРОМ, а запрашивается по нажатию.
// Причина не в осторожности, а в устройстве страницы: карточку рисует
// серверный клиент под анонимным ключом (lib/supabase.ts), поэтому при
// рендере auth.uid() пуст даже у вошедшего, и get_car_details отдаёт
// contact_phone пустым всем без исключения (миграция 0116). Отдавать
// же номер в серверный рендер нельзя — он попал бы в HTML, который
// отдают и краулеру.
//
// Поэтому телефон берётся отдельной узкой RPC get_car_phone (0117) из
// браузера, где сессия есть. Побочные выгоды: номер не лежит в
// разметке вообще — перекупу нечего собирать обходом каталога, — и
// нажатие даёт метрику намерения позвонить, которой у площадки не
// было: до этого статистика существовала только по переписке
// (seller_contact_click), и сравнить каналы было не с чем.
//
// ТРИ СОСТОЯНИЯ, симметрично кнопке переписки:
//   * гость — ведём на /login с адресом возврата: RPC ему всё равно
//     откажет (права выданы только authenticated);
//   * владелец объявления — кнопки нет. Звонить самому себе незачем,
//     ровно как и писать (ContactSellerButton скрывается там же);
//   * покупатель — «Показать номер», после ответа RPC номер
//     становится ссылкой tel:.
//
// До проверки сессии кнопка НЕ рисуется: мелькнувшее «Войдите» у
// вошедшего выглядит как разлогин.
// ============================================================

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import Alert from './ui/Alert';
import Button from './ui/Button';
import { trackEvent } from '@/lib/analytics';
import { formatSerbianPhone } from '@/lib/inputFormat';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref, stripLocale } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';

type Props = {
  locale: Locale;
  carId: string;
  // Владелец объявления: сравнивается с текущим пользователем.
  sellerId: string;
};

export default function CallSellerButton({ locale, carId, sellerId }: Props) {
  const t = getT(locale);
  const pathname = usePathname();

  // undefined — проверка ещё идёт, null — гость.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  // Полученный номер. null — ещё не запрашивали.
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  // Своё объявление: звонить самому себе незачем.
  if (userId === sellerId) return null;

  // Гость: вход с возвратом на эту же карточку.
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

  // Номер получен: он же и есть ссылка. tel: работает на телефоне, на
  // десктопе передаёт номер в звонилку по умолчанию или показывает его
  // текстом — в обоих случаях человек видит цифры и может набрать их
  // вручную.
  if (phone) {
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
    <>
      <Button
        variant="secondary"
        fullWidth
        className="mt-2"
        disabled={loading}
        onClick={async () => {
          setError(null);
          setLoading(true);

          // Событие шлём в момент нажатия, а не после ответа: намерение
          // позвонить человек проявил здесь, и сбой запроса не должен
          // выглядеть в статистике как отсутствие интереса.
          trackEvent('seller_call_click', { guest: false });

          const { data, error: rpcError } = await getBrowserClient().rpc(
            'get_car_phone',
            { p_car_id: carId },
          );

          setLoading(false);

          // Пустой ответ без ошибки — объявление уже снято с публикации
          // за время, пока страница лежала в кэше. Текст тот же, что у
          // сбоя: для покупателя разница между «номер недоступен» и
          // «не удалось получить» практическая одна.
          if (rpcError || typeof data !== 'string' || data === '') {
            setError(t('car_call_failed'));
            return;
          }

          setPhone(data);
        }}
      >
        {loading ? t('car_call_loading') : t('car_call_show')}
      </Button>

      {error && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}
    </>
  );
}
