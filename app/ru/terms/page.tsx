// ============================================================
// RS AUTO — Условия использования /ru/terms, русская версия.
// ============================================================

import type { Metadata } from 'next';

import LegalPageView from '@/components/pages/LegalPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { TERMS_OF_USE } from '@/lib/legal';
import { buildMetadata } from '@/lib/seo';

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/terms',
    title: t('legal_terms_title'),
    description:
      'Условия использования площадки RS Auto — объявления о продаже и аренде автомобилей в Сербии.',
  });
}

export default function RuTermsPage() {
  return (
    <LegalPageView
      locale={locale}
      path="/terms"
      title={getT(locale)('legal_terms_title')}
      sections={TERMS_OF_USE[locale]}
    />
  );
}
