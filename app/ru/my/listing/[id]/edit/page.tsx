// ============================================================
// RS AUTO — Правка объявления /ru/my/listing/[id]/edit, русская версия.
// ============================================================
// Разметка и проверка прав живут в components/pages/EditListingView —
// общие с /my/listing/[id]/edit. Метаданные (noindex) задаёт layout кабинета,
// в него же вложена эта страница.
// ============================================================

import EditListingView from '@/components/pages/EditListingView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'ru';

type Params = { id: string };

export default async function RuEditListingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  return <EditListingView locale={locale} carId={id} />;
}
