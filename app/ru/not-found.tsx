// ============================================================
// RS AUTO — 404 русского зеркала.
// ============================================================
// Отдельный файл обязателен: not-found.tsx работает по сегментам, и без
// него notFound() из /ru/car/{id} поднялся бы до корневого 404 —
// пользователь получил бы сербскую страницу и все ссылки без префикса,
// то есть ровно потерю языка, которую чиним.
// ============================================================

import type { Metadata } from 'next';

import NotFoundView from '@/components/pages/NotFoundView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

const locale: Locale = 'ru';

export const metadata: Metadata = {
  title: getT(locale)('nf_title'),
  // Описание сайта здесь гасится: без null страница «не найдено»
  // наследовала бы от корневого layout текст про покупку и продажу
  // автомобилей — и показывала бы его в превью при пересылке ссылки.
  description: null,
  robots: { index: false, follow: true },
};

export default function RuNotFound() {
  return <NotFoundView locale={locale} />;
}
