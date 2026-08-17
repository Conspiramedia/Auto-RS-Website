// ============================================================
// RS AUTO — Страница для автосалонов /dealers, сербская версия.
// ============================================================
// Вторая аудитория продавцов: салон приводит десятки объявлений сразу,
// поэтому у него отдельный оффер и отдельная форма заявки.
//
// Разметка живёт в components/pages/DealersPageView — общая с /ru/dealers.
// ============================================================

import type { Metadata } from 'next';

import DealersPageView from '@/components/pages/DealersPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 86400;

const locale: Locale = 'sr';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/dealers',
    title: t('dealers_title'),
    description: t('meta_dealers_desc'),
  });
}

export default function DealersPage() {
  return <DealersPageView locale={locale} />;
}
