// ============================================================
// RS AUTO — Главная страница, русская версия (/ru).
// ============================================================
// Разметка общая с сербской версией: components/pages/HomeView.
// ============================================================

import type { Metadata } from 'next';

import HomeView from '@/components/pages/HomeView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 300;

const locale: Locale = 'ru';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(locale);

  const meta = buildMetadata({
    locale,
    path: '/',
    title: t('meta_home_title'),
    description: t('meta_home_desc'),
  });

  // Заголовок главной — absolute: корневой layout добавляет всем
  // страницам суффикс «| RS Auto», и с ним title читался бы как
  // «RS Auto — … | RS Auto», с брендом дважды в одной строке.
  //
  // Заодно снимается расхождение между зеркалами: шаблон layout не
  // применяется к сербскому корню (это сам сегмент, где шаблон
  // объявлен), но применяется к вложенному /ru — и две главные
  // отдавали заголовки разной формы. Остальные страницы сайта
  // суффикс сохраняют: там бренд в заголовке не повторяется.
  //
  // Правится здесь, а не в buildMetadata: тот общий для всех
  // страниц, и менять его сигнатуру ради двух главных значило бы
  // трогать то, что задача просила не трогать.
  return { ...meta, title: { absolute: t('meta_home_title') } };
}

export default async function RuHomePage() {
  return <HomeView locale={locale} />;
}
