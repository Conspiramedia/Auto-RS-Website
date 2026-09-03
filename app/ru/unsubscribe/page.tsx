// ============================================================
// RS AUTO — Отписка от писем (/ru/unsubscribe), русская версия.
// ============================================================
// Разметка живёт в components/pages/UnsubscribeView — общая
// с сербской /unsubscribe. Отличается только локаль.
// ============================================================

import type { Metadata } from 'next';

import UnsubscribeView from '@/components/pages/UnsubscribeView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/unsubscribe',
    title: t('unsub_title'),
    description: t('unsub_lead'),
    noindex: true,
  });
}

type Props = {
  searchParams: Promise<{ t?: string }>;
};

export default async function UnsubscribePage({ searchParams }: Props) {
  const params = await searchParams;

  return <UnsubscribeView locale={locale} token={params.t ?? ''} />;
}
