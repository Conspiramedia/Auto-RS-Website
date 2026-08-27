// ============================================================
// RS AUTO — Витрина салона (/my/showcase), сербская версия.
// ============================================================
// Разметка живёт в components/pages/ShowcasePageView — общая с
// /ru/my/showcase. Метаданные (noindex) и проверку сессии задаёт
// layout кабинета.
// ============================================================

import ShowcasePageView from '@/components/pages/ShowcasePageView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'sr';

export default function MyShowcasePage() {
  return <ShowcasePageView locale={locale} />;
}
