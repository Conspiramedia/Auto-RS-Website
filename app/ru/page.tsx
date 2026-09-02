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
    // В <meta name="description"> уходит КОРОТКАЯ версия: Google режет
    // сниппет примерно на 160 символах и ставит многоточие, обрывая
    // фразу на полуслове. Длинная возвращается ниже в og/twitter.
    description: t('meta_home_desc_short'),
  });

  // Заголовок главной — absolute: корневой layout добавляет всем
  // страницам суффикс «| RS Auto», а этот же текст уходит в og:title,
  // рядом с которым соцсеть печатает og:site_name = «RS Auto»
  // отдельной строкой. С суффиксом бренд стоял бы в карточке дважды.
  // По той же причине из самого текста убрано имя в начале
  // (meta_home_title в lib/i18n.ts).
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

  // ОПИСАНИЕ ДЛЯ МЕССЕНДЖЕРОВ — ДЛИННОЕ, и это не рассогласование.
  // buildMetadata подставляет одну строку сразу в три тега, а нам
  // нужны разные: поиск обрезает сниппет жёстко, Telegram и прочие
  // показывают описание целиком. Возвращаем og:description и
  // twitter:description к полной версии — meta name="description"
  // остаётся короткой, той, что ушла в buildMetadata выше.
  //
  // Правится здесь, а не в buildMetadata, по той же причине, что и
  // заголовок: тот общий для всех страниц сайта.
  const ogDescription = t('meta_home_desc');

  return {
    ...meta,
    title: { absolute: t('meta_home_title') },
    openGraph: { ...meta.openGraph, description: ogDescription },
    twitter: { ...meta.twitter, description: ogDescription },
  };
}

export default async function RuHomePage() {
  return <HomeView locale={locale} />;
}
