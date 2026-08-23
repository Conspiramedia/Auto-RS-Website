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

import { appIds } from '@/lib/brand';
import CloseButton from './ui/CloseButton';
import Logo from './ui/Logo';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

const DISMISS_KEY = 'rsauto_banner_dismissed';

// ------------------------------------------------------------
// РУБИЛЬНИК ПОКАЗА БАННЕРА.
// ------------------------------------------------------------
// Стратегия проекта: сайт — полноценный продукт, приложение — опциональный
// слой удобства. Пока приложение не догнало сайт по сценариям (кабинет,
// чат, уведомления), звать посетителя в него с каждой страницы значит
// уводить его из работающего продукта в менее полный.
//
// Выключено ИМЕННО ЗДЕСЬ, а не снятием <SmartBanner /> из девяти
// представлений: сам компонент, его вёрстка и ключи словаря
// (banner_title, banner_text, banner_open, banner_close) остаются
// рабочими и не протухают.
//
// ЧТОБЫ ВЕРНУТЬ БАННЕР — поставить true в этой строке. Больше ничего
// менять не нужно.
const BANNER_ENABLED = false;

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
    // Баннер выключен стратегически (см. BANNER_ENABLED выше) — ни
    // localStorage, ни navigator не трогаем вовсе.
    if (!BANNER_ENABLED) return;

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
      <Logo variant="mark" />

      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-caption font-semibold">{t('banner_title')}</div>
        <div className="truncate text-small text-on-dark-70">{t('banner_text')}</div>
      </div>

      <a
        href={href}
        className="shrink-0 rounded-control bg-brand-green px-3 py-1.5 text-caption font-semibold text-white"
      >
        {t('banner_open')}
      </a>

      {/* Крестик — общий CloseButton (вариант onDark), а не свой знак:
          текстовый «×» здесь смещался относительно центра, потому что
          его метрики зависят от шрифта, и подпись расходилась с
          остальными слоями. Область нажатия выросла с ~20px до 40px —
          баннер мобильный, и в прежний символ приходилось целиться.
          -mr-2 втягивает её в боковой отступ полосы, чтобы знак
          остался у края, а не отступил от него на пустое поле кнопки. */}
      <CloseButton
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setVisible(false);
        }}
        label={t('banner_close')}
        variant="onDark"
        className="-mr-2 shrink-0"
      />
    </div>
  );
}
