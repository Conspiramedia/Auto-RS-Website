// ============================================================
// RS AUTO — OG-превью витрины продавца, русская версия.
// ============================================================
// Композиция общая с сербским зеркалом: lib/ogDealer.tsx. Отдельный
// файл нужен потому, что файловые роуты метаданных привязаны к
// сегменту: без него /ru/dealer/{id} наследовал бы корневую брендовую
// картинку вместо превью с именем салона.
// ============================================================

import { renderOgDealer, OG_SIZE } from '@/lib/ogDealer';

import { brand } from '@/lib/brand';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = brand.name;

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return renderOgDealer('ru', id);
}
