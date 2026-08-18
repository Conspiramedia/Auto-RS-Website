'use client';

// ============================================================
// RS AUTO — Крестик возврата поверх галереи объявления.
// ============================================================
// Client Component: страница объявления рендерится на сервере (SEO),
// а история браузера доступна только в браузере.
//
// Поведение согласовано с приложением (car_detail_screen): клик —
// возврат назад. Фолбэк на каталог обязателен, потому что на карточку
// приходят по прямой ссылке из поиска и из мессенджера — история
// в этом случае пустая, и history.back() увёл бы человека с сайта
// вместо возврата к выдаче.
//
// Кнопка живёт ПОВЕРХ галереи, а не рядом с хлебными крошками:
// на мобильном фотография занимает первый экран целиком, и выход
// обязан быть виден без прокрутки.
// ============================================================

import { useRouter } from 'next/navigation';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import CloseButton from './ui/CloseButton';

type Props = {
  locale: Locale;
  // Куда уходить, если возвращаться некуда: /cars или /rent —
  // тот же раздел, из которого объявление открыли бы обычным путём.
  fallbackPath: string;
};

export default function GalleryCloseButton({ locale, fallbackPath }: Props) {
  const t = getT(locale);
  const router = useRouter();

  function goBack() {
    // history.length > 1 означает, что в этой вкладке была предыдущая
    // страница. У вкладки, открытой по ссылке, длина равна единице.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(localeHref(locale, fallbackPath));
  }

  return (
    <CloseButton
      onClick={goBack}
      label={t('common_back')}
      variant="overlay"
      // z-10 — над изображением галереи; само изображение лежит
      // в контейнере с overflow-hidden, поэтому кнопка вынесена
      // на уровень выше и позиционируется от общей обёртки.
      className="absolute right-3 top-3 z-10"
    />
  );
}
