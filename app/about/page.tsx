// ============================================================
// RS AUTO — Страница /about, sr-версия.
// ============================================================
// Разметка живёт в components/pages/AboutPageView — она общая
// для обеих локалей. Здесь только метаданные и передача locale.
// ============================================================

import type { Metadata } from 'next';

import AboutPageView from '@/components/pages/AboutPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

// Контентная страница меняется редко — суточной ревалидации достаточно.
export const revalidate = 86400;

const locale: Locale = 'sr';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/about',
    title: t('about_title'),
    description: t('about_meta_desc'),
  });
}

export default function Page() {
  return <AboutPageView locale={locale} />;
}
