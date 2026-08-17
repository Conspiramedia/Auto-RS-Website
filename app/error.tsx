'use client';

// ============================================================
// RS AUTO — Ошибка рендера, сербское зеркало.
// ============================================================
// Ловит исключения всех корневых страниц: каталога, карточки, SEO-
// страниц марок и моделей. Практический источник таких ошибок —
// lib/queries: fetchCatalog и fetchCarDetails намеренно бросают при
// сбое RPC, потому что отдать пустой каталог вместо ошибки означало бы
// показать посетителю «объявлений нет» при работающей площадке.
//
// error.tsx ОБЯЗАН быть клиентским компонентом — это требование Next.
// ============================================================

import { useEffect } from 'react';

import ErrorView from '@/components/pages/ErrorView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'sr';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Диагностика — в консоль, а не в интерфейс. digest — идентификатор,
  // по которому та же ошибка находится в логах сервера: на проде текст
  // серверного исключения клиенту не передаётся, и без digest связать
  // жалобу пользователя с записью в логе невозможно.
  useEffect(() => {
    console.error('[RS Auto] Ошибка рендера страницы', {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return <ErrorView locale={locale} reset={reset} />;
}
