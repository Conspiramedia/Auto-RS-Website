// ============================================================
// RS AUTO — Главная страница, русская версия (/ru).
// ============================================================
// Разметка общая с сербской версией: components/pages/HomeView.
// ============================================================

import type { Metadata } from 'next';

import HomeView from '@/components/pages/HomeView';
import { brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 300;

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/',
    title: `${brand.name} — ${t('site_tagline')}`,
    description: t('meta_home_desc'),
  });
}

export default async function RuHomePage() {
  return <HomeView locale={locale} />;
}
