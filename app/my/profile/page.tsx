// ============================================================
// RS AUTO — Профиль (/my/profile), сербская версия.
// ============================================================
// Разметка живёт в components/pages/ProfilePageView — общая с /ru/my/profile.
// Метаданные (noindex) и проверку сессии задаёт layout кабинета.
// ============================================================

import ProfilePageView from '@/components/pages/ProfilePageView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'sr';

export default function MyProfilePage() {
  return <ProfilePageView locale={locale} />;
}
