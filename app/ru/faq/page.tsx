// ============================================================
// RS AUTO — Страница /faq, ru-версия.
// ============================================================
// Разметка живёт в components/pages/FaqPageView — она общая
// для обеих локалей. Здесь только метаданные и передача locale.
// ============================================================

import type { Metadata } from 'next';

import FaqPageView from '@/components/pages/FaqPageView';
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
    path: '/faq',
    title: t('meta_faq_title'),
    description: t('faq_meta_desc'),
  });
}

export default function Page() {
  return <FaqPageView locale={locale} />;
}
