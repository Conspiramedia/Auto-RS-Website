// ============================================================
// RS AUTO — Отписка от писем (/unsubscribe), сербская версия.
// ============================================================
// Разметка живёт в components/pages/UnsubscribeView — общая
// с /ru/unsubscribe.
//
// NOINDEX. Страница служебная и открывается по личной ссылке из
// письма. В выдаче ей делать нечего, а токен в адресе не должен
// попасть ни в индекс, ни в отчёты поисковых систем.
// ============================================================

import type { Metadata } from 'next';

import UnsubscribeView from '@/components/pages/UnsubscribeView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

const locale: Locale = 'sr';

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
