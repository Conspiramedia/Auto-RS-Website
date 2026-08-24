// ============================================================
// RS AUTO — перечень страниц под проверку.
// ============================================================
// Один список на все сьюты: публичные проверки, SEO, a11y и Lighthouse
// берут адреса отсюда. Заведи страница свой роут — она добавляется в
// одном месте и сразу попадает во все проверки, а не забывается в трёх
// из четырёх.
// ============================================================

import { SEED_CARS } from './seed';

export type PageSpec = {
  // Путь БЕЗ префикса локали: префикс подставляет localePath ниже.
  path: string;
  // Человеческое имя для заголовка теста.
  name: string;
  // Страница индексируется? От этого зависят проверки canonical и
  // hreflang: у noindex-страниц их наличие не требуется.
  indexable: boolean;
  // Есть ли у страницы данные из БД. Без локального Supabase такие
  // страницы отдают пустую витрину, и часть проверок пропускается.
  needsData: boolean;
};

// ------------------------------------------------------------
// Публичные страницы, доступные без входа.
// ------------------------------------------------------------
export const PUBLIC_PAGES: PageSpec[] = [
  // Главная выдерживает отсутствие базы: витрины на ней —
  // необязательный блок, и HomeView подставляет пустую ленту вместо
  // падения. Поэтому needsData: false — страница обязана открываться
  // всегда, и это отдельная гарантия, а не поблажка.
  { path: '/', name: 'Главная', indexable: true, needsData: false },
  { path: '/cars', name: 'Каталог продажи', indexable: true, needsData: true },
  { path: '/rent', name: 'Каталог аренды', indexable: true, needsData: true },
  { path: '/sell', name: 'Подача объявления', indexable: true, needsData: false },
  { path: '/dealers', name: 'Салонам', indexable: true, needsData: false },
  { path: '/about', name: 'О платформе', indexable: true, needsData: false },
  { path: '/contact', name: 'Контакты', indexable: true, needsData: false },
  { path: '/faq', name: 'Вопросы и ответы', indexable: true, needsData: false },
  { path: '/how-it-works', name: 'Как это работает', indexable: true, needsData: false },
  { path: '/terms', name: 'Условия использования', indexable: true, needsData: false },
  { path: '/privacy', name: 'Политика конфиденциальности', indexable: true, needsData: false },
  { path: '/app', name: 'Приложение', indexable: true, needsData: false },
];

// Карточка объявления. Вынесена отдельно: адрес зависит от seed, и без
// локальной базы страницы просто нет.
export const CAR_PAGE: PageSpec = {
  path: `/car/${SEED_CARS.activeSale.id}`,
  name: 'Карточка объявления',
  indexable: true,
  needsData: true,
};

// Страницы под noindex: проверяются на доступность и отсутствие
// ошибок, но SEO-требования к ним другие.
export const NOINDEX_PAGES: PageSpec[] = [
  { path: '/login', name: 'Вход', indexable: false, needsData: false },
  { path: '/all', name: 'Смешанная витрина', indexable: false, needsData: true },
];

// ------------------------------------------------------------
// Ключевые страницы для тяжёлых проверок (a11y, Lighthouse).
// ------------------------------------------------------------
// Прогонять axe и Lighthouse по всем двадцати адресам в обеих локалях
// значило бы утроить время CI ради убывающей отдачи. Здесь — срез по
// РАЗНЫМ типам вёрстки: витрина-лендинг, сетка каталога, карточка
// товара, длинный текст, страница с формой.
export const KEY_PAGES: PageSpec[] = [
  PUBLIC_PAGES[0], // главная
  PUBLIC_PAGES[1], // каталог
  CAR_PAGE, // карточка
  PUBLIC_PAGES[6], // контакты (форма)
  PUBLIC_PAGES[9], // условия (длинный текст)
];

// ------------------------------------------------------------
// Сборка адреса с префиксом локали.
// ------------------------------------------------------------
// Повторяет lib/i18n.localeHref, но намеренно СВОЕЙ реализацией:
// тест, использующий ту же функцию, что и приложение, не заметит
// ошибки в ней самой — оба ошибутся одинаково.
export function localePath(locale: 'sr' | 'ru', path: string): string {
  if (locale === 'sr') return path;
  return path === '/' ? '/ru' : `/ru${path}`;
}

export const LOCALES = ['sr', 'ru'] as const;
export type TestLocale = (typeof LOCALES)[number];
