// ============================================================
// RS AUTO — Подача объявления /ru/sell, русская версия.
// ============================================================

import type { Metadata } from 'next';

import SellPageView from '@/components/pages/SellPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 3600;

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/sell',
    title: t('sell_title'),
    description: t('meta_sell_desc'),
  });
}

export default async function RuSellPage() {
  return <SellPageView locale={locale} />;
}
