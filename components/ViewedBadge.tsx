'use client';

// ============================================================
// RS AUTO — Метка «Просмотрено» на карточке объявления.
// ============================================================
// Показывает, что объявление уже открывали. В приложении такая метка
// есть с самого начала, и без неё лента на сайте ощущается иначе:
// в длинной выдаче человек повторно открывает то же объявление.
//
// ПОЧЕМУ КЛИЕНТСКИЙ КОМПОНЕНТ. История просмотров живёт в localStorage
// браузера (RecentlyViewed) — сервер её не видит и увидеть не может.
// CarCard при этом остаётся Server Component: метка дорисовывается
// поверх фотографии уже после гидратации, разметка карточки и её
// серверный рендер не меняются, SEO не затрагивается.
//
// До гидратации метки нет — это осознанно. Мигание «пусто → метка»
// заметно меньше, чем блокировка рендера ради второстепенной пометки.
// ============================================================

import { useEffect, useState } from 'react';

import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { isCarViewed } from './RecentlyViewed';

export default function ViewedBadge({
  locale,
  carId,
}: {
  locale: Locale;
  carId: string;
}) {
  const t = getT(locale);
  const [viewed, setViewed] = useState(false);

  useEffect(() => {
    setViewed(isCarViewed(carId));
  }, [carId]);

  if (!viewed) return null;

  return (
    // Левый верхний угол: там же, где метка стоит в приложении.
    // Тёмная нейтральная плашка — это констатация, а не акцент, поэтому
    // она не спорит с бейджами промо и аренды.
    <span className="absolute left-2 top-2 rounded-sm bg-neutral-60 px-2 py-1 text-xs font-semibold text-white">
      {t('car_viewed')}
    </span>
  );
}
