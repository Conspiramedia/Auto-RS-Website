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

import PhotoLightbox from './PhotoLightbox';
import type { CarImage } from '@/lib/types';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

type Props = {
  images: CarImage[];
  alt: string;
  // Нужна лайтбоксу: у стрелок и крестика нет текста, только
  // aria-label, и он обязан быть на языке страницы.
  locale: Locale;
};

export default function CarGallery({ images, alt, locale }: Props) {
  const t = getT(locale);
  const [active, setActive] = useState(0);
  // Открыт ли полноэкранный просмотр. Индекс кадра лайтбокс берёт из
  // active — открывается ровно та фотография, по которой тапнули.
  const [zoomed, setZoomed] = useState(false);

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

    // Запас в 16px, а не прежние 8: активная миниатюра увеличена
    // трансформацией, а offsetLeft/offsetWidth считаются по габариту
    // ДО неё — без запаса выехавший за свой прямоугольник край круга
    // с кольцом упирался бы в границу видимой части ленты.
    if (left < viewLeft) {
      strip.scrollTo({ left: left - 16, behavior: 'smooth' });
    } else if (right > viewRight) {
      strip.scrollTo({ left: right - strip.clientWidth + 16, behavior: 'smooth' });
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
    // вертикальной прокрутке страницы. Ниже порога это не свайп, а
    // тап — открываем полноэкранный просмотр.
    //
    // Обе роли на одном элементе намеренно: палец лежит на
    // фотографии, и требовать для увеличения отдельную кнопку значило
    // бы придумывать жест там, где очевиден тап по самому снимку.
    // onClick для этого не годится — после свайпа браузер шлёт и его
    // тоже, и просмотр открывался бы при каждом листании.
    if (Math.abs(dx) < 40) {
      setZoomed(true);
      return;
    }

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
      {/* Кадр — кнопка, а не div: открытие просмотра обязано работать
          мышью и с клавиатуры, а не только пальцем. type="button"
          нужен всегда — внутри формы кнопка по умолчанию сабмитит.

          onClick срабатывает и после свайпа (браузер шлёт его следом
          за touchend), поэтому от лишнего открытия защищает та же
          проверка смещения: onTouchEnd успевает выставить zoomed сам,
          а здесь мы просто открываем — повторный setState на уже
          открытом слое ничего не меняет. */}
      <button
        type="button"
        aria-label={t('gallery_open')}
        className="relative block w-full cursor-zoom-in overflow-hidden rounded-card bg-surface-muted aspect-[3/2] sm:aspect-[4/3]"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={() => setZoomed(true)}
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
      </button>

      {/* Полноэкранный просмотр. Монтируется только открытым: пока
          слой не нужен, в дереве его нет — не тратим ни разметку, ни
          обработчики клавиатуры. */}
      {zoomed && (
        <PhotoLightbox
          images={images}
          alt={alt}
          locale={locale}
          startIndex={active}
          onClose={() => setZoomed(false)}
        />
      )}

      {images.length > 1 && (
        /* Запас по краям — место для увеличенной активной миниатюры.
           Она вырастает на 35% ЧЕРЕЗ transform, то есть выходит за
           свой габарит примерно на 9px по вертикали и столько же по
           горизонтали, а overflow-x-auto срезал бы всё, что вышло:
           сверху, снизу и у первой/последней миниатюры.

           Поэтому у ленты появились px-3 py-3, скомпенсированные
           -mx-3 по горизонтали, — визуально лента стоит там же, где
           стояла, а mt сокращён на съеденный вертикальный отступ.

           items-center обязателен: увеличенная кнопка растёт от
           своего центра, и без выравнивания по центру она уезжала бы
           вниз относительно соседей. */
        <div
          ref={stripRef}
          className="no-scrollbar -mx-3 flex items-center gap-2 overflow-x-auto px-3 py-3"
        >
          {images.map((img, i) => (
            /* Активный кадр — КРУГ, крупнее соседей, в толстом кольце;
               соседние остаются прямоугольниками со скруглением 12px.
               Разница формы читается мгновенно, ещё до того как глаз
               заметит разницу яркости, — это и делает выделение
               заметным в ленте из пятнадцати одинаковых кадров.

               Ни один размер В ПОТОКЕ не меняется: кнопка всегда
               h-12 w-12 (sm:h-16 w-16), а увеличение даёт transform
               scale-[1.35]. Трансформация раскладку не пересчитывает,
               поэтому соседи стоят на месте, лента не «дышит» при
               каждом переключении кадра и CLS остаётся нулевым.
               Увеличенный круг при этом слегка накрывает соседей —
               ровно как в макете; z-10 держит его поверх них.

               Квадрат в потоке, а не 4:3 как раньше: у прямоугольной
               кнопки rounded-full дал бы эллипс, а не круг.

               ring-4 + ring-offset-4 = box-shadow из двух колец:
               сначала зазор в 4px цветом фона, за ним синий контур
               ещё в 4px. Светлая полоса отделяет контур от снимка —
               приём паспарту у картины: без зазора синий ложится
               встык к пикселям фотографии и читается как обводка
               изображения, а не как отметка выбора.

               В тёмной теме зазор берёт цвет тёмной подложки
               (brand.colors.dark): белая полоса на тёмном фоне
               светилась бы сама по себе. */
            <button
              key={img.id}
              ref={(el) => {
                thumbRefs.current[i] = el;
              }}
              type="button"
              onClick={() => setActive(i)}
              aria-current={i === active}
              className={[
                'relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden sm:h-16 sm:w-16',
                'transition-[opacity,box-shadow,border-radius,transform] duration-150 ease-out',
                i === active
                  ? 'z-10 scale-[1.35] rounded-full opacity-100 ring-4 ring-brand-primary ring-offset-4 ring-offset-white dark:ring-offset-brand-dark'
                  : 'rounded-control opacity-[0.65] hover:opacity-100',
              ].join(' ')}
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
