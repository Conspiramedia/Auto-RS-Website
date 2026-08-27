// ============================================================
// RS AUTO — Витрина салона (/ru/my/showcase), русская версия.
// ============================================================
// Разметка живёт в components/pages/ShowcasePageView — общая с
// /my/showcase. Метаданные (noindex) и проверку сессии задаёт layout
// кабинета.
// ============================================================

import ShowcasePageView from '@/components/pages/ShowcasePageView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'ru';

export default function RuMyShowcasePage() {
  return <ShowcasePageView locale={locale} />;
}
