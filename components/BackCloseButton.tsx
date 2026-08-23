'use client';

// ============================================================
// RS AUTO — Крестик «уйти со страницы» в потоке разметки.
// ============================================================
// Client Component: серверная страница не имеет доступа ни к истории
// браузера, ни к обработчику клика.
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ GalleryCloseButton. Тот живёт ПОВЕРХ фотографии:
// у него variant="overlay" (тёмный знак на белом круге с тенью) и
// абсолютное позиционирование от обёртки галереи. Здесь крестик стоит
// в общей строке с заголовком, на белом фоне страницы, и ему нужен
// вариант plain без подложки. Объединять их в один компонент значило
// бы держать проп на каждое расхождение вёрстки ради экономии десяти
// строк — и трогать рабочую карточку объявления.
//
// ПОВЕДЕНИЕ — возврат назад, а не переход по фиксированному адресу.
// На служебную страницу приходят из меню, с разных разделов сайта, и
// «назад» возвращает человека ровно туда, откуда он пришёл. Фолбэк
// нужен для вкладки, открытой по прямой ссылке: там истории нет, и
// history.back() увёл бы за пределы сайта.
// ============================================================

import { useRouter } from 'next/navigation';

import CloseButton from './ui/CloseButton';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

type Props = {
  locale: Locale;
  // Куда уходить, если возвращаться некуда. Путь БЕЗ префикса локали:
  // префикс добавляет localeHref, иначе русский посетитель попал бы
  // на сербское зеркало.
  fallbackPath?: string;
  className?: string;
};

export default function BackCloseButton({
  locale,
  fallbackPath = '/',
  className = '',
}: Props) {
  const t = getT(locale);
  const router = useRouter();

  function goBack() {
    // history.length > 1 означает, что в этой вкладке была предыдущая
    // страница. У вкладки, открытой по ссылке, длина равна единице.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(localeHref(locale, fallbackPath));
  }

  return (
    <CloseButton onClick={goBack} label={t('common_close')} className={className} />
  );
}
