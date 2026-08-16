'use client';

// ============================================================
// RS AUTO — Смарт-баннер «Открыть в приложении».
// ============================================================
// Client Component: определяет платформу и хранит признак закрытия.
// Показывается ТОЛЬКО на мобильных — на десктопе вместо него работает QR-код
// на карточке объявления.
//
// Закрытие запоминается в localStorage: баннер, всплывающий на каждой
// странице после того, как его закрыли, — верный способ потерять
// посетителя, а не привести его в приложение.
// ============================================================

import { useEffect, useState } from 'react';

import { appIds, brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

const DISMISS_KEY = 'rsauto_banner_dismissed';

type Props = {
  locale: Locale;
  // Ссылка, которую нужно открыть в приложении. Для карточки объявления —
  // её канонический адрес (сработает App Link / Universal Link),
  // для остальных страниц — стор.
  deepLink?: string;
};

export default function SmartBanner({ locale, deepLink }: Props) {
  const t = getT(locale);
  const [visible, setVisible] = useState(false);
  const [storeUrl, setStoreUrl] = useState('');

  useEffect(() => {
    // Проверки только на клиенте: navigator и localStorage на сервере нет.
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    const ua = navigator.userAgent;
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);

    if (!isAndroid && !isIOS) return;

    if (isAndroid) {
      setStoreUrl(
        `https://play.google.com/store/apps/details?id=${appIds.android.packageName}`,
      );
    } else {
      // Пока приложение не опубликовано, числового ID нет — ведём на поиск
      // по названию, чтобы ссылка не была битой.
      setStoreUrl(
        appIds.ios.appStoreId
          ? `https://apps.apple.com/app/id${appIds.ios.appStoreId}`
          : 'https://apps.apple.com/search?term=RS%20Auto',
      );
    }

    setVisible(true);
  }, []);

  if (!visible) return null;

  // Если задан deepLink — ведём на него: при установленном приложении
  // ссылка перехватывается системой и открывает нужный экран, а без
  // приложения остаётся рабочей веб-страницей.
  const href = deepLink || storeUrl;

  return (
    <div className="flex items-center gap-3 bg-brand-dark px-4 py-2 text-white">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-sm font-bold"
        style={{ background: brand.colors.primary }}
        aria-hidden="true"
      >
        RS
      </div>

      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-semibold">{t('banner_title')}</div>
        <div className="truncate text-xs text-white/70">{t('banner_text')}</div>
      </div>

      <a
        href={href}
        className="shrink-0 rounded-control bg-brand-green px-3 py-1.5 text-sm font-semibold text-white"
      >
        {t('banner_open')}
      </a>

      <button
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setVisible(false);
        }}
        className="shrink-0 px-1 text-xl leading-none text-white/60"
        aria-label="Zatvori"
      >
        ×
      </button>
    </div>
  );
}
