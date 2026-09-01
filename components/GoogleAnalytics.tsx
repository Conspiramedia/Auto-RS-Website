'use client';

// ============================================================
// RS AUTO — Подключение GA4. Client Component.
// ============================================================
// Скрипт GA4 подключается при ДВУХ выполненных условиях:
//   1. задан Measurement ID (NEXT_PUBLIC_GA_ID) — иначе слоя нет
//      вовсе, как и у Plausible без домена;
//   2. пользователь дал согласие в баннере куки.
//
// ПОЧЕМУ КЛИЕНТСКИЙ, В ОТЛИЧИЕ ОТ Analytics (Plausible). Решение по
// куки живёт в localStorage, а он недоступен на сервере: серверный
// компонент не может знать, согласился человек или нет. Plausible
// такой проверки не требует и остаётся серверным.
//
// ПОЧЕМУ СЛУШАЕМ СОБЫТИЕ, А НЕ ЧИТАЕМ ХРАНИЛИЩЕ ОДИН РАЗ. Согласие
// даётся ПОСРЕДИ сессии: человек заходит, видит баннер, нажимает
// «Принять». Прочитай мы решение только при монтировании — скрипт бы
// не появился до перезагрузки страницы, и первый (самый ценный) визит
// остался бы без данных. Баннер шлёт cookie-consent-change, и по нему
// компонент перерисовывается уже со скриптом.
//
// GoogleAnalytics из @next/third-parties сам ставит gtag.js со
// стратегией afterInteractive и объявляет window.gtag — именно эту
// функцию потом зовёт trackEvent (lib/analytics).
// ============================================================

import { GoogleAnalytics } from '@next/third-parties/google';
import { useEffect, useState } from 'react';

import { GA_MEASUREMENT_ID, gaConfigured } from '@/lib/analytics';
import { CONSENT_CHANGE_EVENT, hasCookieConsent } from '@/lib/consent';

export default function GoogleAnalyticsGate() {
  // Первый проход НИЧЕГО не решает по хранилищу: на сервере его нет, и
  // отрисуй мы скрипт сразу, серверная разметка разошлась бы с
  // клиентской. Поэтому стартовое значение всегда false, а настоящее
  // выясняется после монтирования — тот же приём, что в CookieBanner.
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const sync = () => setAllowed(hasCookieConsent());

    sync();

    // Ответ на баннер в этой же вкладке.
    window.addEventListener(CONSENT_CHANGE_EVENT, sync);
    // Ответ в СОСЕДНЕЙ вкладке: storage срабатывает только в других
    // вкладках того же сайта. Без него открытые вкладки остались бы
    // без аналитики до перезагрузки.
    window.addEventListener('storage', sync);

    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (!gaConfigured || !allowed) return null;

  return <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />;
}
