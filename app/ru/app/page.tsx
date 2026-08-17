// ============================================================
// RS AUTO — Страница приложения /ru/app, русская версия.
// ============================================================

import type { Metadata } from 'next';

import AppPageView from '@/components/pages/AppPageView';
import { brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 86400;

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/app',
    title: `${brand.name} — мобильное приложение`,
    description: t('meta_app_desc'),
  });
}

export default function RuAppPage() {
  return <AppPageView locale={locale} />;
}
