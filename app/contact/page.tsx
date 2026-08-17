// ============================================================
// RS AUTO — Страница «Контакты» /contact, сербская версия.
// ============================================================
// Обязательна: на неё ссылаются разделы «Контакты» условий
// использования и политики конфиденциальности.
// ============================================================

import type { Metadata } from 'next';

import ContactPageView from '@/components/pages/ContactPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

// Контакты меняются редко: суточной перегенерации достаточно.
export const revalidate = 86400;

const locale: Locale = 'sr';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/contact',
    title: t('contact_title'),
    description: t('meta_contact_desc'),
  });
}

export default function ContactPage() {
  return <ContactPageView locale={locale} />;
}
