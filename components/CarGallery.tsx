'use client';

// ============================================================
// RS AUTO — Галерея фотографий объявления.
// ============================================================
// Client Component: переключение кадров — интерактив.
//
// Важно для SEO: ВСЕ изображения присутствуют в разметке (скрытые получают
// hidden), а не подгружаются скриптом по клику. Краулер видит их сразу,
// и они попадают в поиск по картинкам. Класс hidden переехал на обёртку
// кадра, но смысл тот же: теги <img> всех фотографий остаются в HTML.
//
// ------------------------------------------------------------
// ПОЧЕМУ КАДР СОСТОИТ ИЗ ДВУХ СЛОЁВ ОДНОГО ФОТО
// ------------------------------------------------------------
// Клиенты грузят снимки любых пропорций: вертикальные с телефона,
// квадратные, панорамы с камеры. Один слой с object-cover обрезал
// всё, что не 4:3: вертикальное фото теряло около 44% высоты,
// панорама — четверть ширины. object-contain без подложки даёт
// вместо этого пустые поля по бокам.
//
// Решение взято из приложения (_GalleryItem в car_detail_screen.dart),
// где оно работает давно, — сайт был единственным местом с кропом,
// и одна и та же машина выглядела в браузере и в аппе по-разному:
//
//   • нижний слой — ТО ЖЕ ФОТО, растянутое на весь кадр (cover)
//     и размытое на 20px;
//   • поверх — плёнка чёрного 15%;
//   • верхний слой — ТО ЖЕ ФОТО ЦЕЛИКОМ (contain), по центру.
//
// Фото видно полностью, а поля залиты размытым продолжением его
// самого — цвет всегда совпадает со снимком, и знать его пропорции
// не требуется.
//
// Сеть это не нагружает: миниатюры галереи ниже уже показывают
// кадр по-прежнему с cover — там обрезка уместна, это навигация,
// а не просмотр.
// ============================================================

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import type { CarImage } from '@/lib/types';

type Props = {
  images: CarImage[];
  alt: string;
};

export default function CarGallery({ images, alt }: Props) {
  const [active, setActive] = useState(0);

  // Лента миниатюр и сами кнопки в ней. При переключении кадра
  // активная миниатюра должна сама въехать в видимую часть: на
  // телефоне в полосу помещается три-четыре штуки из пятнадцати, и
  // без этого пользователь листает фото, а лента стоит на месте.
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const strip = stripRef.current;
    const thumb = thumbRefs.current[active];
    if (!strip || !thumb) return;

    // scrollIntoView прокрутил бы и саму страницу к галерее — здесь
    // это лишнее движение. Двигаем только ленту: считаем, на сколько
    // миниатюра выходит за видимую часть, и доводим её до края.
    const left = thumb.offsetLeft;
    const right = left + thumb.offsetWidth;
    const viewLeft = strip.scrollLeft;
    const viewRight = viewLeft + strip.clientWidth;

    if (left < viewLeft) {
      strip.scrollTo({ left: left - 8, behavior: 'smooth' });
    } else if (right > viewRight) {
      strip.scrollTo({ left: right - strip.clientWidth + 8, behavior: 'smooth' });
    }
  }, [active]);

  // Свайп по самому кадру. На телефоне это основной жест просмотра:
  // тыкать в мелкие миниатюры неудобно, а соседние кнопки-стрелки
  // заняли бы место поверх фотографии.
  const touchX = useRef<number | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0].clientX;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;

    // Порог в 40px отсекает дрожание пальца при обычном тапе и
    // вертикальной прокрутке страницы.
    if (Math.abs(dx) < 40) return;

    // По краям листание упирается, а не заворачивается: круговой
    // переход с последнего кадра на первый читается как сбой.
    setActive((i) =>
      dx < 0 ? Math.min(i + 1, images.length - 1) : Math.max(i - 1, 0),
    );
  }

  if (images.length === 0) {
    return (
      <div className="flex aspect-[3/2] items-center justify-center rounded-card bg-surface-muted text-neutral-30 sm:aspect-[4/3]">
        {alt}
      </div>
    );
  }

  return (
    <div>
      <div
        className="relative aspect-[3/2] overflow-hidden rounded-card bg-surface-muted sm:aspect-[4/3]"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {images.map((img, i) => (
          // Каждый кадр — ДВА СЛОЯ ОДНОГО ФАЙЛА, как _GalleryItem в приложении.
          // Второго запроса нет: src у слоёв одинаковый, и браузер берёт
          // вторую копию из кэша — добавляется только отрисовка.
          <div
            key={img.id}
            className={i === active ? 'absolute inset-0' : 'hidden'}
          >
            {/* ФОН: та же фотография, растянутая на весь кадр и размытая.
                Заполняет поля, которые остаются вокруг вертикального фото или
                панорамы, цветом самого снимка — без «чёрных полос».

                scale-110 ОБЯЗАТЕЛЕН. CSS-фильтр blur размывает и границу
                элемента, поэтому без увеличения по периметру появляется
                светлая кайма подложки. Лишние 10% уходят за overflow-hidden.

                aria-hidden и пустой alt: для читалки это дубль соседнего
                изображения, озвучивать один снимок дважды не нужно. */}
            <Image
              src={img.image_url}
              alt=""
              aria-hidden
              fill
              // Фон всё равно размывается на 20px, детали в нём не видны.
              // 64px хватает на любом экране, а вес такого файла — единицы КБ.
              sizes="64px"
              className="scale-110 object-cover blur-[20px]"
              priority={i === 0}
            />

            {/* Плёнка 15% — тот же Colors.black.withValues(alpha: 0.15)
                из приложения: гасит яркий фон, чтобы он не спорил
                с самой фотографией. */}
            <div className="absolute inset-0 bg-black/15" />

            {/* САМО ФОТО — ЦЕЛИКОМ, по центру, без обрезки.
                Раньше здесь стоял object-cover, и вертикальный снимок 3:4
                терял около 44% высоты — у машины уезжали за кадр крыша
                и колёса. В приложении (_GalleryItem) всегда был contain. */}
            <Image
              src={img.image_url}
              alt={`${alt} — ${i + 1}`}
              fill
              // До 1024px кадр занимает всю ширину контейнера, дальше —
              // левую колонку сетки (2fr из 3fr).
              sizes="(max-width: 1024px) 100vw, 66vw"
              className="object-contain"
              // Первый кадр — главное изображение страницы и её LCP-элемент.
              priority={i === 0}
            />
          </div>
        ))}

        {/* Счётчик кадров. На телефоне полоса прокрутки у ленты скрыта
            (no-scrollbar), и понять, что снимков пятнадцать, а не
            четыре видимых, было неоткуда. Позиция левая: справа над
            кадром висит крестик выхода из GalleryCloseButton.

            Показываем только когда фото больше одного — на единственном
            снимке «1 / 1» лишний шум. */}
        {images.length > 1 && (
          <div className="absolute bottom-3 left-3 rounded-control bg-black/55 px-2 py-1 text-caption font-medium text-white">
            {active + 1} / {images.length}
          </div>
        )}
      </div>

      {images.length > 1 && (
        <div ref={stripRef} className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <button
              key={img.id}
              ref={(el) => {
                thumbRefs.current[i] = el;
              }}
              type="button"
              onClick={() => setActive(i)}
              aria-current={i === active}
              className={
                i === active
                  ? 'relative h-12 w-16 shrink-0 overflow-hidden rounded-control ring-2 ring-brand-primary sm:h-16 sm:w-20'
                  : 'relative h-12 w-16 shrink-0 overflow-hidden rounded-control opacity-70 sm:h-16 sm:w-20'
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
