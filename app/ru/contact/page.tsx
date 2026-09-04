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
    title: t('meta_contact_title'),
    description: t('meta_contact_desc'),
  });
}

export default function RuContactPage() {
  return <ContactPageView locale={locale} />;
}
