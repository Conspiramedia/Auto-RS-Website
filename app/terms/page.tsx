// ============================================================
// RS AUTO — Условия использования /terms, сербская версия.
// ============================================================
// Страница обязательна: на неё ссылается чекбокс согласия в форме
// подачи объявления перед отправкой SMS-кода. Ссылка на документ,
// который негде прочитать, согласием не является.
// ============================================================

import type { Metadata } from 'next';

import LegalPageView from '@/components/pages/LegalPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { TERMS_OF_USE } from '@/lib/legal';
import { buildMetadata } from '@/lib/seo';

const locale: Locale = 'sr';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/terms',
    title: t('legal_terms_title'),
    description: t('meta_terms_desc'),
  });
}

export default function TermsPage() {
  return (
    <LegalPageView
      locale={locale}
      path="/terms"
      title={getT(locale)('legal_terms_title')}
      sections={TERMS_OF_USE[locale]}
    />
  );
}
