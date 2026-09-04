// ============================================================
// RS AUTO — Подача объявления /sell, сербская версия.
// ============================================================
// Привлечение продавцов — приоритет №1 по бизнес-целям: объявление можно
// подать с сайта, не устанавливая приложение.
//
// Разметка живёт в components/pages/SellPageView — общая с /ru/sell.
// ============================================================

import type { Metadata } from 'next';

import SellPageView from '@/components/pages/SellPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 3600;

const locale: Locale = 'sr';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/sell',
    title: t('meta_sell_title'),
    description: t('meta_sell_desc'),
  });
}

export default async function SellPage() {
  return <SellPageView locale={locale} />;
}
