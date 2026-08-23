// ============================================================
// RS AUTO — Профиль (/ru/my/profile), русская версия.
// ============================================================
// Разметка живёт в components/pages/ProfilePageView — общая с /my/profile.
// Метаданные (noindex) и проверку сессии задаёт layout кабинета.
// ============================================================

import ProfilePageView from '@/components/pages/ProfilePageView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'ru';

export default function RuMyProfilePage() {
  return <ProfilePageView locale={locale} />;
}
