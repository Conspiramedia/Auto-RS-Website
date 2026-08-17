// ============================================================
// RS AUTO — Политика конфиденциальности /ru/privacy, русская версия.
// ============================================================

import type { Metadata } from 'next';

import LegalPageView from '@/components/pages/LegalPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { PRIVACY_POLICY } from '@/lib/legal';
import { buildMetadata } from '@/lib/seo';

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/privacy',
    title: t('legal_privacy_title'),
    description:
      'Политика конфиденциальности RS Auto — как мы обрабатываем и защищаем персональные данные пользователей.',
  });
}

export default function RuPrivacyPage() {
  return (
    <LegalPageView
      locale={locale}
      path="/privacy"
      title={getT(locale)('legal_privacy_title')}
      sections={PRIVACY_POLICY[locale]}
    />
  );
}
