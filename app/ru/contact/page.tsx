// ============================================================
// RS AUTO — Страница «Контакты» /ru/contact, русская версия.
// ============================================================

import type { Metadata } from 'next';

import ContactPageView from '@/components/pages/ContactPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 86400;

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/contact',
    title: t('contact_title'),
    description:
      'Свяжитесь с RS Auto: электронная почта, телефон поддержки и форма обращения.',
  });
}

export default function RuContactPage() {
  return <ContactPageView locale={locale} />;
}
