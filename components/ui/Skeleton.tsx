// ============================================================
// RS AUTO — Скелетоны загрузки.
// ============================================================
// ГЛАВНОЕ ТРЕБОВАНИЕ: нулевой layout shift. Скелетон обязан занимать
// РОВНО те же габариты, что и реальный контент, иначе при подмене
// страница дёргается — а это хуже пустого экрана, потому что человек
// уже начал целиться в элемент.
//
// Отсюда два правила в коде ниже:
//   * пропорции картинок задаются той же aspect-[4/3], что в CarCard;
//   * высоты текстовых строк равны высоте строки соответствующего
//     размера шрифта (h-5 ≈ body, h-4 ≈ caption).
//
// Анимация — animate-pulse Tailwind: она не двигает элементы, только
// меняет прозрачность, поэтому не создаёт ощущения «прыгающего» UI.
// ============================================================

// Базовый прямоугольник-заглушка.
export function SkeletonBox({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-control bg-surface-muted ${className}`}
      aria-hidden="true"
    />
  );
}

// ------------------------------------------------------------
// Карточка объявления в сетке.
// ------------------------------------------------------------
// Повторяет структуру CarCard: изображение 4:3, затем название,
// цена, год с пробегом и город.
export function SkeletonCarCard() {
  return (
    <div className="overflow-hidden rounded-card border border-neutral-10">
      {/* aspect-[4/3] — та же пропорция, что у изображения в CarCard.
          Именно она держит высоту карточки до загрузки фотографии. */}
      <div className="aspect-[4/3] animate-pulse bg-surface-muted" />

      <div className="p-3">
        <SkeletonBox className="h-5 w-3/4" />
        <SkeletonBox className="mt-2 h-6 w-1/2" />
        <SkeletonBox className="mt-2 h-4 w-2/3" />
        <SkeletonBox className="mt-1.5 h-4 w-1/3" />
      </div>
    </div>
  );
}

// Сетка карточек. Колонки те же, что в каталоге (2/3/4).
export function SkeletonCarGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCarCard key={i} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// Панель управления каталогом: кнопка фильтров + сортировка.
// ------------------------------------------------------------
export function SkeletonCatalogControls() {
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none sm:gap-3">
          {/* Габариты кнопки «Фильтры»: h-10 = px-4 py-2.5 + text-caption. */}
          <SkeletonBox className="h-10 w-28" />
          <SkeletonBox className="hidden h-5 w-24 sm:block" />
        </div>
        <SkeletonBox className="h-10 w-40" />
      </div>

      {/* Счётчик результатов на мобильном — отдельной строкой. */}
      <SkeletonBox className="mt-2 h-5 w-32 sm:hidden" />
    </>
  );
}

// ------------------------------------------------------------
// Карточка объявления целиком (страница /car/{id}).
// ------------------------------------------------------------
export function SkeletonCarPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Хлебные крошки. */}
      <SkeletonBox className="mb-4 h-5 w-48" />

      <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div>
          {/* Галерея: та же пропорция 4:3, что у CarGallery. */}
          <div className="aspect-[4/3] animate-pulse rounded-card bg-surface-muted" />

          {/* Лента миниатюр под галереей. */}
          <div className="mt-2 flex gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonBox key={i} className="h-16 w-20 shrink-0" />
            ))}
          </div>

          {/* Заголовок h1: text-h2 → высота строки 32px. */}
          <SkeletonBox className="mt-5 h-8 w-2/3" />

          {/* Блок характеристик: 6 пар «подпись + значение». */}
          <div className="mt-6">
            <SkeletonBox className="h-6 w-40" />
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i}>
                  <SkeletonBox className="h-4 w-20" />
                  <SkeletonBox className="mt-1 h-5 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Правая колонка: цена и действия. */}
        <aside>
          <div className="rounded-card border border-neutral-10 p-4">
            <SkeletonBox className="h-9 w-40" />
            <div className="mt-4 border-t border-neutral-10 pt-4">
              <SkeletonBox className="h-4 w-24" />
              <SkeletonBox className="mt-1 h-5 w-32" />
            </div>
            <div className="mt-4 border-t border-neutral-10 pt-4">
              <SkeletonBox className="h-5 w-36" />
              <SkeletonBox className="mt-2 h-10 w-full" />
              {/* Две кнопки: «Продолжить в приложении» и «Поделиться».
                  Обе h-12 — размер md компонента Button (py-3). */}
              <SkeletonBox className="mt-3 h-12 w-full" />
              <SkeletonBox className="mt-3 h-12 w-full" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
