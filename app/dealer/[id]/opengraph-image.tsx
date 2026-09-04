// ============================================================
// RS AUTO — OG-превью витрины продавца, сербская версия.
// ============================================================
// Тонкая обёртка: композиция живёт в lib/ogDealer.tsx, общем с русским
// зеркалом (app/ru/dealer/[id]/opengraph-image.tsx).
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
  return renderOgDealer('sr', id);
}
