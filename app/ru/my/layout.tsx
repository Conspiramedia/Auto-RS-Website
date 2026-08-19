// ============================================================
// RS AUTO — Layout кабинета /ru/my, русская версия.
// ============================================================
// Разметка общая с сербской версией (components/pages/MyLayoutView),
// отличается только locale. Причины force-dynamic и noindex — см.
// комментарий в app/my/layout.tsx.
// ============================================================

import type { Metadata } from 'next';

import MyLayoutView from '@/components/pages/MyLayoutView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

const locale: Locale = 'ru';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getT(locale);

  return {
    title: t('my_title'),
    robots: {
      index: false,
      follow: false,
      nocache: true,
      noimageindex: true,
    },
  };
}

export default function RuMyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MyLayoutView locale={locale}>{children}</MyLayoutView>;
}
