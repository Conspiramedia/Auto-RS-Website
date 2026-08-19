// ============================================================
// RS AUTO — Мои объявления (/ru/my), русская версия.
// ============================================================
// Разметка живёт в components/pages/MyListingsView — общая с /my.
// Метаданные (noindex) и проверку сессии задаёт layout кабинета.
// ============================================================

import MyListingsView from '@/components/pages/MyListingsView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'ru';

export default function RuMyListingsPage() {
  return <MyListingsView locale={locale} />;
}
