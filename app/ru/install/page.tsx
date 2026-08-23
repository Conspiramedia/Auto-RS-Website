// ============================================================
// RS AUTO — Страница /install, ru-версия.
// ============================================================
// Разметка живёт в components/pages/InstallPageView — она общая
// для обеих локалей. Здесь только метаданные и передача locale.
//
// noindex: инструкция по установке нашего же сайта не отвечает ни на
// один поисковый запрос и в выдаче только оттягивала бы клики с
// каталога. follow при этом остаётся — ссылки со страницы обходить
// можно (см. buildMetadata).
//
// force-dynamic не нужен: страница не читает ни сессию, ни базу.
// Текст инструкции меняется только вместе с кодом, поэтому суточная
// ревалидация — как у остальных контентных страниц.
// ============================================================

import type { Metadata } from 'next';

import InstallPageView from '@/components/pages/InstallPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 86400;

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  return buildMetadata({
    locale,
    path: '/install',
    title: t('install_title'),
    description: t('install_lead'),
    noindex: true,
  });
}

export default function RuPage() {
  return <InstallPageView locale={locale} />;
}
