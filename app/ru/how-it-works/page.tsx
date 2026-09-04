// ============================================================
// RS AUTO — Страница /how-it-works, ru-версия.
// ============================================================
// Разметка живёт в components/pages/HowItWorksPageView — она общая
// для обеих локалей. Здесь только метаданные и передача locale.
// ============================================================

import type { Metadata } from 'next';

import HowItWorksPageView from '@/components/pages/HowItWorksPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

// Контентная страница меняется редко — суточной ревалидации достаточно.
export const revalidate = 86400;

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/how-it-works',
    title: t('meta_how_title'),
    description: t('how_meta_desc'),
  });
}

export default function Page() {
  return <HowItWorksPageView locale={locale} />;
}
