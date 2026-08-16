// ============================================================
// RS AUTO — Страница приложения /ru/app, русская версия.
// ============================================================

import type { Metadata } from 'next';

import AppPageView from '@/components/pages/AppPageView';
import { brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 86400;

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    locale,
    path: '/app',
    title: `${brand.name} — мобильное приложение`,
    description:
      'Сообщения, звонки и уведомления о новых автомобилях — в приложении RS Auto.',
  });
}

export default function RuAppPage() {
  return <AppPageView locale={locale} />;
}
