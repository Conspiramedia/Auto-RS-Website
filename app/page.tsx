// ============================================================
// RS AUTO — Главная страница, сербская версия (корень сайта).
// ============================================================
// Разметка живёт в components/pages/HomeView — она общая с /ru.
// ============================================================

import type { Metadata } from 'next';

import HomeView from '@/components/pages/HomeView';
import { brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 300;

const locale: Locale = 'sr';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/',
    title: `${brand.name} — ${t('site_tagline')}`,
    description:
      'Prodajte ili kupite automobil u Srbiji. Besplatno objavljivanje oglasa, hiljade automobila iz cele zemlje.',
  });
}

export default async function HomePage() {
  return <HomeView locale={locale} />;
}
