'use client';

// ============================================================
// RS AUTO — Галерея фотографий на карточке модерации. Client Component.
// ============================================================
// Модератор обязан посмотреть КАЖДЫЙ снимок, а не только обложку:
// подмену машины, чужой номер или скриншот с другой площадки прячут
// как раз в третьем-четвёртом кадре. Раньше крупно показывалось
// только первое фото, остальные — миниатюрами по 4:3, где разглядеть
// что-либо невозможно. Теперь клик по миниатюре меняет большой кадр.
//
// ПОЧЕМУ КАДР — ДВА СЛОЯ ОДНОГО ФОТО. То же решение, что в галерее
// сайта (components/CarGallery.tsx) и в приложении (_GalleryItem):
//   • нижний слой — то же фото, растянутое (cover) и размытое на 20px;
//   • плёнка чёрного 15%, чтобы фон не спорил со снимком;
//   • верхний слой — фото ЦЕЛИКОМ (contain), по центру.
// Для модерации это принципиальнее, чем для каталога: object-cover
// срезал у вертикального снимка около 44% высоты, и нарушение могло
// оказаться ровно в отрезанной части.
//
// Обычные <img>, а не next/image: снимки лежат в Supabase Storage с
// динамическими адресами, а карточку открывает один модератор
// несколько раз в день — оптимизатор здесь только добавляет звено.
//
// ГОРЯЧИЕ КЛАВИШИ ← → — продолжение той же логики, что A/R в панели
// решений: очередь разбирается без мыши. Стрелки не пересекаются с
// A/R и, как и там, молчат, когда фокус в поле ввода.
// ============================================================

import { useEffect, useState } from 'react';

import type { AdminCarPhoto } from '@/lib/types';

export default function ModerationGallery({
  photos,
}: {
  photos: AdminCarPhoto[];
}) {
  const [active, setActive] = useState(0);

  // Объявление без единого снимка — почти всегда отказ, и сказать об
  // этом надо прямо, а не пустым местом.
  const empty = photos.length === 0;

  // ---------- Стрелки ← → ----------
  useEffect(() => {
    if (photos.length < 2) return;

    function onKey(e: KeyboardEvent) {
      // Модификаторы не наши: Alt+← — это «назад» в браузере.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Фокус в поле ввода (например, в причине отклонения) — стрелки
      // принадлежат полю: ими двигают каретку.
      const el = document.activeElement;
      const tag = el?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        // По кругу: на последнем кадре «вперёд» возвращает к первому.
        // Модератор перебирает набор туда-обратно, и упор в край
        // заставлял бы его считать нажатия.
        setActive((i) => (i - 1 + photos.length) % photos.length);
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActive((i) => (i + 1) % photos.length);
      }
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [photos.length]);

  if (empty) {
    return (
      <div className="rounded-card border border-error/30 bg-status-error px-6 py-12 text-center">
        <p className="font-semibold text-error">Фотографий нет</p>
        <p className="mt-1 text-caption text-neutral-70">
          Объявление без снимков публиковать нельзя.
        </p>
      </div>
    );
  }

  // Защита от рассинхронизации: если набор фотографий обновился после
  // router.refresh() и стал короче, индекс мог остаться за пределами.
  const current = photos[active] ?? photos[0];

  return (
    <div>
      {/* ---------- Большой кадр ---------- */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-card border border-neutral-10 bg-surface-muted">
        {/* Фон: та же фотография, растянутая и размытая. Заполняет
            поля вокруг вертикального снимка цветом самого кадра.
            scale-110 обязателен — CSS-фильтр blur размывает и границу
            элемента, без запаса по периметру появляется светлая кайма. */}
        <img
          src={current.image_url}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-[20px]"
        />
        <div className="absolute inset-0 bg-black/15" />

        {/* Само фото — целиком, без обрезки. */}
        <img
          src={current.image_url}
          alt={`Фотография ${active + 1}`}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {photos.length > 1 && (
          // Счётчик поверх кадра: модератор должен видеть, сколько
          // снимков осталось посмотреть, не отводя взгляд к подписи.
          <span className="absolute bottom-2 right-2 rounded-control bg-black/60 px-2 py-1 text-micro font-medium text-white">
            {active + 1} / {photos.length}
          </span>
        )}
      </div>

      {photos.length > 1 && (
        <>
          {/* ---------- Миниатюры ---------- */}
          {/* Сеткой во всю ширину, а не лентой с прокруткой: весь
              набор должен попадать в поле зрения сразу — так виден
              разнобой (разные машины, разные номера, разный фон). */}
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
            {photos.map((photo, i) => (
              <button
                key={photo.order_index}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Показать фотографию ${i + 1}`}
                aria-current={i === active}
                className={[
                  'relative aspect-[4/3] w-full overflow-hidden rounded-control border transition',
                  i === active
                    ? 'border-brand-primary ring-2 ring-brand-primary'
                    : 'border-neutral-10 opacity-70 hover:opacity-100',
                ].join(' ')}
              >
                <img
                  src={photo.image_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>

          <p className="mt-2 text-micro text-neutral-50">
            Фотографий: {photos.length} · ← → — переключение кадра
          </p>
        </>
      )}

      {photos.length === 1 && (
        <p className="mt-2 text-micro text-neutral-50">Фотографий: 1</p>
      )}
    </div>
  );
}
