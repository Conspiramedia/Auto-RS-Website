// ============================================================
// RS AUTO — Мои объявления (/ru/my), русская версия.
// ============================================================
// Пакет 1 — фундамент: маршрут существует, содержимое приходит в
// Пакете 2. Метаданные и noindex задаёт layout кабинета.
// ============================================================

import MyPlaceholderView from '@/components/pages/MyPlaceholderView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'ru';

export default function RuMyListingsPage() {
  return <MyPlaceholderView locale={locale} titleKey="my_tab_listings" />;
}
