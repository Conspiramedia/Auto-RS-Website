// ============================================================
// RS AUTO — Мои объявления (/my), сербская версия.
// ============================================================
// Разметка живёт в components/pages/MyListingsView — общая с /ru/my.
// Метаданные (noindex) и проверку сессии задаёт layout кабинета.
// ============================================================

import MyListingsView from '@/components/pages/MyListingsView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'sr';

export default function MyListingsPage() {
  return <MyListingsView locale={locale} />;
}
