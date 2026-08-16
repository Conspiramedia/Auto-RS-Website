'use client';

// ============================================================
// RS AUTO — Галерея фотографий объявления.
// ============================================================
// Client Component: переключение кадров — интерактив.
//
// Важно для SEO: ВСЕ изображения присутствуют в разметке (скрытые получают
// hidden), а не подгружаются скриптом по клику. Краулер видит их сразу,
// и они попадают в поиск по картинкам.
// ============================================================

import Image from 'next/image';
import { useState } from 'react';

import type { CarImage } from '@/lib/types';

type Props = {
  images: CarImage[];
  alt: string;
};

export default function CarGallery({ images, alt }: Props) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-card bg-black/5 text-black/30">
        {alt}
      </div>
    );
  }

  return (
    <div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-black/5">
        {images.map((img, i) => (
          <Image
            key={img.id}
            src={img.image_url}
            alt={`${alt} — ${i + 1}`}
            fill
            sizes="(max-width: 1024px) 100vw, 66vw"
            className={i === active ? 'object-cover' : 'hidden object-cover'}
            // Первый кадр — главное изображение страницы и её LCP-элемент.
            priority={i === 0}
          />
        ))}
      </div>

      {images.length > 1 && (
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              className={
                i === active
                  ? 'relative h-16 w-20 shrink-0 overflow-hidden rounded-control ring-2 ring-brand-primary'
                  : 'relative h-16 w-20 shrink-0 overflow-hidden rounded-control opacity-70'
              }
              aria-label={`${alt} — ${i + 1}`}
            >
              <Image
                src={img.image_url}
                alt=""
                fill
                sizes="80px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
