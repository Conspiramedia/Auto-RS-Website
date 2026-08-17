'use client';

// ============================================================
// RS AUTO — Кнопка «Поделиться». Client Component.
// ============================================================
// Виральность — одна из бизнес-целей сайта, поэтому кнопка использует
// системное меню шаринга (Web Share API) там, где оно есть: на мобильных
// это отправка в WhatsApp/Viber/Telegram в один тап.
//
// Запасной путь — копирование ссылки в буфер: Web Share недоступен в
// десктопных браузерах, и без запасного варианта кнопка была бы там мёртвой.
// ============================================================

import { useState } from 'react';

import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

type Props = {
  locale: Locale;
  url: string;
  title: string;
};

export default function ShareButton({ locale, url, title }: Props) {
  const t = getT(locale);
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    // navigator.share существует не везде, поэтому проверяем перед вызовом.
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Пользователь закрыл системное меню — это не ошибка,
        // просто ничего не делаем.
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      // Подпись «скопировано» держится 2 секунды и возвращается к исходной.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер недоступен (например, страница открыта не по https) —
      // молча игнорируем: показывать ошибку за неудачное копирование избыточно.
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="rounded-control border border-neutral-15 px-4 py-2.5 text-sm font-semibold hover:bg-surface-hover"
    >
      {copied ? t('car_share_copied') : t('car_share')}
    </button>
  );
}
