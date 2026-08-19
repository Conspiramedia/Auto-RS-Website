// ============================================================
// RS AUTO — Правка объявления /my/listing/[id]/edit, сербская версия.
// ============================================================
// Разметка и проверка прав живут в components/pages/EditListingView —
// общие с /ru/my/listing/[id]/edit. Метаданные (noindex) задаёт layout кабинета,
// в него же вложена эта страница.
// ============================================================

import EditListingView from '@/components/pages/EditListingView';
import type { Locale } from '@/lib/i18n';

const locale: Locale = 'sr';

type Params = { id: string };

export default async function EditListingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  return <EditListingView locale={locale} carId={id} />;
}
