// ============================================================
// RS AUTO — 404 сербского зеркала.
// ============================================================
// Ловит notFound() со всех корневых страниц: /car/{id}, /cars/{brand},
// /cars/{brand}/{model}, /rent/*, а также несуществующие адреса.
// ============================================================

import type { Metadata } from 'next';

import NotFoundView from '@/components/pages/NotFoundView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

const locale: Locale = 'sr';

export const metadata: Metadata = {
  title: getT(locale)('nf_title'),
  // 404 в индексе не нужна: она не несёт контента и только размывает
  // выдачу. Follow оставляем — ссылки на каталог должны обходиться.
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return <NotFoundView locale={locale} />;
}
