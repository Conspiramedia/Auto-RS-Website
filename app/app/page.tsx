// ============================================================
// RS AUTO — Страница приложения /app, сербская версия.
// ============================================================
// Точка воронки: сюда ведут кнопки «Сообщить, когда появится» из пустого
// состояния и ссылки из подвала.
//
// Разметка живёт в components/pages/AppPageView — общая с /ru/app.
// ============================================================

import type { Metadata } from 'next';

import AppPageView from '@/components/pages/AppPageView';
import { brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 86400;

const locale: Locale = 'sr';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/app',
    title: `${brand.name} — mobilna aplikacija`,
    description: t('meta_app_desc'),
  });
}

export default function AppPage() {
  return <AppPageView locale={locale} />;
}
