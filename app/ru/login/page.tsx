// ============================================================
// RS AUTO — Вход /ru/login, русская версия.
// ============================================================
// Разметка живёт в components/pages/LoginPageView — общая с /login.
//
// noindex: страница входа не несёт содержимого для поиска, а её попадание
// в выдачу по запросу с названием площадки только уводило бы людей с
// каталога. force-dynamic обязателен — страница читает cookie сессии,
// и закэшированная версия показала бы форму уже вошедшему.
// ============================================================

import type { Metadata } from 'next';

import LoginPageView from '@/components/pages/LoginPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

const locale: Locale = 'ru';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getT(locale);

  return {
    title: t('login_title'),
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function RuLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect: redirectParam } = await searchParams;
  return <LoginPageView locale={locale} redirectParam={redirectParam} />;
}
