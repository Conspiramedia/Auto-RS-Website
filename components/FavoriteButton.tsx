'use client';

// ============================================================
// RS AUTO — Значок «в избранное» на странице объявления.
// ============================================================
// Стоит справа от заголовка карточки. Раньше здесь была кнопка
// «Сохранить» во всю ширину в блоке контактов — третья подряд после
// «Показать номер» и «Написать продавцу», то есть равная им по весу,
// хотя закладка несоизмеримо легче звонка. Значок и знаком совпадает
// с карточкой в каталоге, и веса кнопки-действия не занимает.
//
// ЗНАК ТОТ ЖЕ, ЧТО В СПИСКЕ И В ПРИЛОЖЕНИИ: контурное сердце —
// не сохранено, закрашенное красное — сохранено.
//
// СОСТОЯНИЕ ОБЩЕЕ С КАРТОЧКАМИ СПИСКА (CardActionsProvider): на этой
// же странице ниже стоит блок «похожие» с обычными карточками, и, будь
// у страницы своё состояние, сердце у заголовка и сердце на карточке
// того же объявления могли бы разойтись.
//
// ТРИ СОСТОЯНИЯ:
//   * гость — ссылка на вход с возвратом на эту же карточку;
//   * владелец объявления — значка нет: своя машина в избранном
//     бессмысленна, а метрика «в избранном» в кабинете считала бы
//     самого продавца;
//   * покупатель — переключатель закладки.
//
// Размер области нажатия — 40px против 32px на карточке списка:
// здесь рядом заголовок в text-h1, и значок 32px выглядел бы при нём
// потерянным, а места на странице объявления достаточно.
// ============================================================

import { useState } from 'react';

import { useCardActions } from './CardActionsProvider';
import FavoriteBurst from './FavoriteBurst';
import { HeartIcon } from './ui/NavIcons';
import { trackEvent } from '@/lib/analytics';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

type Props = {
  locale: Locale;
  carId: string;
  // Владелец объявления: сравнивается с текущим пользователем.
  sellerId: string;
};

const HIT_AREA =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full ' +
  'transition-colors hover:bg-surface-muted';

export default function FavoriteButton({ locale, carId, sellerId }: Props) {
  const t = getT(locale);
  const { signedIn, userId, isFavorite, toggleFavorite } = useCardActions();

  // Ключ перезапуска всплеска — тот же приём, что на карточке списка
  // (см. FavoriteBurst и CardActions). Объявлен ДО ранних выходов
  // ниже: порядок хуков обязан быть одинаковым на каждом рендере.
  const [burstKey, setBurstKey] = useState(0);

  // Сессия ещё проверяется: пустое сердце, мелькнувшее у того, кто
  // объявление сохранил, читается как потеря закладки.
  if (signedIn === undefined) return null;

  // Своё объявление — значка нет.
  if (userId === sellerId) return null;

  // Гость: вход с возвратом на эту же карточку.
  if (!signedIn) {
    return (
      <a
        href={`${localeHref(locale, '/login')}?redirect=${encodeURIComponent(
          localeHref(locale, `/car/${carId}`),
        )}`}
        className={`${HIT_AREA} text-neutral-60`}
        aria-label={t('car_favorite_aria_add')}
        title={t('car_favorite_aria_add')}
        // Клик гостя тоже событие: интерес проявлен, а дойдёт ли он до
        // входа — как раз то, что показывает разница с событиями
        // вошедших.
        onClick={() => trackEvent('favorite_added', { guest: true })}
      >
        <HeartIcon className="h-6 w-6" />
      </a>
    );
  }

  const saved = isFavorite(carId);

  return (
    <button
      type="button"
      // Переключатель: без aria-pressed смена значка для скринридера
      // не существует вовсе.
      aria-pressed={saved}
      aria-label={
        saved ? t('car_favorite_aria_remove') : t('car_favorite_aria_add')
      }
      title={saved ? t('car_favorite_aria_remove') : t('car_favorite_aria_add')}
      className={`${HIT_AREA} ${saved ? 'text-brand-red' : 'text-neutral-60'}`}
      onClick={() => {
        // Только на сохранение: снятие закладки анимации не получает.
        if (!saved) setBurstKey((n) => n + 1);
        void toggleFavorite(carId);
      }}
    >
      <FavoriteBurst burstKey={burstKey}>
        <HeartIcon className="h-6 w-6" filled={saved} />
      </FavoriteBurst>
    </button>
  );
}
