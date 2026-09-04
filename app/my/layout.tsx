// ============================================================
// RS AUTO — Layout кабинета /my, сербская версия.
// ============================================================
// Разметка живёт в components/pages/MyLayoutView — общая с /ru/my.
//
// ДИНАМИЧЕСКИЙ РЕНДЕР ОБЯЗАТЕЛЕН. Кабинет читает cookie сессии, а это
// request-time API: закэшированная страница показала бы одному
// пользователю данные другого. Кэширование здесь отключено явно, а не
// оставлено на вывод Next по содержимому, — цена ошибки слишком высока.
// ============================================================

import type { Metadata } from 'next';

import MyLayoutView from '@/components/pages/MyLayoutView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

const locale: Locale = 'sr';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getT(locale);

  // buildMetadata из lib/seo здесь НЕ используется намеренно: он
  // проставляет canonical и hreflang, а личные страницы не должны
  // попадать ни в индекс, ни в языковой граф сайта.
  return {
    title: t('my_title'),
    // description ГАСИТСЯ ЯВНО, значением null. Просто не указать его
    // мало: корневой layout задаёт общее описание сайта, и оно
    // наследуется всем поддеревом — на личные страницы приходил тег с
    // текстом про покупку и продажу автомобилей. null в Next означает
    // «убрать унаследованное», undefined — «не переопределять».
    // Раздел закрыт от индексации, описывать его поисковику не для кого.
    description: null,
    robots: {
      index: false,
      follow: false,
      // nocache и noimageindex закрывают сохранённые копии и картинки
      // объявлений из кабинета: без них страница остаётся вне выдачи,
      // но её содержимое может осесть в кэше поисковика.
      nocache: true,
      noimageindex: true,
    },
  };
}

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return <MyLayoutView locale={locale}>{children}</MyLayoutView>;
}
