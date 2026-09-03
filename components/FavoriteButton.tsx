'use client';

// ============================================================
// RS AUTO — Кнопка «Сохранить» (избранное). Client Component.
// ============================================================
// ЗАЧЕМ. Таблица favorites и RPC toggle_favorite существуют с миграции
// 0023, но на сайте закладку поставить было НЕГДЕ: покупатель мог
// только позвонить или написать. Между «понравилось» и «готов
// связаться» лежит целый шаг выбора — человек отбирает три-четыре
// машины, сравнивает и возвращается через день. Без закладок он
// возвращался в поиск и набирал фильтры заново, а часть просто не
// возвращалась.
//
// ПОЧЕМУ КЛИЕНТСКИЙ И БЕЗ SERVER ACTION. Карточка объявления
// кэшируется (revalidate 300) — на этом держится SEO. Чтение сессии на
// сервере перевело бы страницу в динамический рендер, а Server Action
// с revalidatePath сбрасывал бы кэш карточки на КАЖДОЕ нажатие
// закладки, то есть чужой интерес обнулял бы кэш чужой страницы.
// Поэтому кнопка решает всё в браузере: сервер отдаёт её одинаковой
// всем, а состояние она выясняет сама. Тот же приём, что в
// ContactSellerButton.
//
// ТРИ СОСТОЯНИЯ:
//   * гость — ведём на /login с адресом возврата, как «Написать
//     продавцу»: сохранить закладку без учётной записи некуда, но и
//     терять намерение нельзя;
//   * владелец объявления — кнопки нет. Своя машина в избранном
//     бессмысленна, а метрика «в избранном» в кабинете считала бы
//     самого продавца;
//   * покупатель — toggle_favorite переключает закладку.
//
// ОПТИМИСТИЧНОЕ ПЕРЕКЛЮЧЕНИЕ. Состояние меняется ДО ответа сервера и
// откатывается при ошибке: закладка — действие на один тап, и ждать
// ответа сети, глядя на неизменившуюся кнопку, человек не станет —
// нажмёт второй раз и снимет то, что только что поставил.
//
// До проверки сессии кнопка НЕ рисуется: мелькнувшее пустое сердце у
// того, кто уже сохранил объявление, читается как потеря закладки.
// ============================================================

import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

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

export default function FavoriteButton({ locale, carId, sellerId }: Props) {
  const t = getT(locale);
  const pathname = usePathname();

  // undefined — проверка сессии ещё идёт, null — гость.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = getBrowserClient();
      const { data } = await supabase.auth.getSession();
      const id = data.session?.user.id ?? null;
      if (cancelled) return;
      setUserId(id);

      // Гостю и владельцу закладку не показываем — и запрос за ней не
      // делаем: лишний поход в базу ради кнопки, которой не будет.
      if (id === null || id === sellerId) return;

      // Есть ли уже закладка. Читаем таблицу напрямую: политика
      // favorites_select_own (0023, ужесточена в 0063) отдаёт строки
      // только их владельцу, поэтому отдельная RPC ничего бы не
      // проверила сверх неё. head + count вместо выборки строки:
      // нужен факт наличия, а не содержимое.
      const { count } = await supabase
        .from('favorites')
        .select('car_id', { count: 'exact', head: true })
        .eq('car_id', carId);

      if (!cancelled) setSaved((count ?? 0) > 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [carId, sellerId]);

  // Проверка не завершена — не показываем ничего.
  if (userId === undefined) return null;

  // Своё объявление: класть в избранное себя же незачем.
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
        // Клик гостя тоже событие: интерес он проявил, а дойдёт ли до
        // входа — как раз то, что показывает разница с favorite_added
        // от вошедших.
        onClick={() => trackEvent('favorite_added', { guest: true })}
      >
        {t('car_favorite_add')}
      </Button>
    );
  }

  return (
    <Button
      variant="secondary"
      fullWidth
      className="mt-2"
      disabled={pending}
      // Кнопка-переключатель: состояние сообщается скринридеру, иначе
      // смена подписи для него — просто другой текст без объяснения.
      aria-pressed={saved}
      onClick={() =>
        startTransition(async () => {
          const next = !saved;

          // Оптимистично: показываем результат сразу (см. шапку файла).
          setSaved(next);
          setFailed(false);

          const { data, error } = await getBrowserClient().rpc(
            'toggle_favorite',
            { p_car_id: carId },
          );

          if (error) {
            // Откат: закладки на сервере нет, и кнопка не должна
            // утверждать обратное.
            setSaved(!next);
            setFailed(true);
            return;
          }

          // RPC возвращает фактическое состояние (true — добавлено).
          // Доверяем ему, а не своему предположению: при гонке двух
          // вкладок расходится именно оно.
          if (typeof data === 'boolean') setSaved(data);

          // Считаем только добавление — снятие закладки интереса не
          // выражает (см. lib/analytics, favorite_added).
          if (data === true) trackEvent('favorite_added', { guest: false });
        })
      }
    >
      {failed
        ? t('car_favorite_failed')
        : saved
          ? t('car_favorite_remove')
          : t('car_favorite_add')}
    </Button>
  );
}
