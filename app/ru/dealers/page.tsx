// ============================================================
// RS AUTO — Страница для автосалонов /ru/dealers, русская версия.
// ============================================================

import type { Metadata } from 'next';

import DealersPageView from '@/components/pages/DealersPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 86400;

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/dealers',
    title: t('meta_dealers_title'),
    description: t('meta_dealers_desc'),
  });
}

export default function RuDealersPage() {
  return <DealersPageView locale={locale} />;
}
