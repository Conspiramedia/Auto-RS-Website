'use client';

// ============================================================
// RS AUTO — Ошибка рендера, русское зеркало.
// ============================================================
// Отдельный файл нужен ровно ради локали: без него исключение на
// /ru/* поднялось бы до app/error.tsx и посетитель получил бы
// сербский текст ошибки и сербские ссылки.
// ============================================================

import { useEffect } from 'react';

import ErrorView from '@/components/pages/ErrorView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'ru';

export default function RuError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[RS Auto] Ошибка рендера страницы', {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return <ErrorView locale={locale} reset={reset} />;
}
