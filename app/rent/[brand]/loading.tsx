// ============================================================
// RS AUTO — Состояние загрузки каталога.
// ============================================================
// Показывается, пока сервер собирает выдачу: RPC search_cars_public
// с фильтрами, счётчиками марок и городов. Раньше на это время
// оставался белый экран.
//
// Скелетон повторяет габариты реального каталога (заголовок, панель
// управления, сетка 2/3/4), поэтому подмена контентом не сдвигает
// вёрстку — см. components/ui/Skeleton.
// ============================================================

import {
  SkeletonBox,
  SkeletonCarGrid,
  SkeletonCatalogControls,
} from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      {/* Заголовок h1: text-2xl → 32px строки. */}
      <SkeletonBox className="h-8 w-64" />
      <SkeletonCatalogControls />
      <SkeletonCarGrid />
    </main>
  );
}
