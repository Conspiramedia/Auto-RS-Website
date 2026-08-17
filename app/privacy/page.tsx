// ============================================================
// RS AUTO — Политика конфиденциальности /privacy, сербская версия.
// ============================================================

import type { Metadata } from 'next';

import LegalPageView from '@/components/pages/LegalPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { PRIVACY_POLICY } from '@/lib/legal';
import { buildMetadata } from '@/lib/seo';

const locale: Locale = 'sr';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/privacy',
    title: t('legal_privacy_title'),
    description: t('meta_privacy_desc'),
  });
}

export default function PrivacyPage() {
  return (
    <LegalPageView
      locale={locale}
      path="/privacy"
      title={getT(locale)('legal_privacy_title')}
      sections={PRIVACY_POLICY[locale]}
    />
  );
}
