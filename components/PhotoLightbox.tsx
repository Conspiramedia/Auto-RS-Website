'use client';

// ============================================================
// RS AUTO — Полноэкранный просмотр фотографий объявления.
// ============================================================
// ЗАЧЕМ. В карточке кадр занимает часть ширины колонки, и разглядеть
// на нём состояние кузова, салон или пробег на одометре нельзя.
// Покупатель подержанной машины смотрит именно на это, поэтому тап по
// фотографии должен открывать её во весь экран.
//
// ------------------------------------------------------------
// СТРЕЛКИ ЕСТЬ ТОЛЬКО НА ДЕСКТОПЕ
// ------------------------------------------------------------
// На телефоне листают свайпом, и кнопки поверх фотографии только
// закрывают её собой: палец и так лежит на снимке, а стрелка отнимает
// у него угол кадра. С sm (640px) появляется мышь, у которой жеста
// «смахнуть» нет, — там стрелки обязательны, иначе листать нечем.
// Свайп при этом работает на всех ширинах: у ноутбуков бывают
// сенсорные экраны, и отключать жест по брейкпоинту значило бы
// гадать об устройстве по ширине окна.
//
// ------------------------------------------------------------
// ПОДПИСИ УВЕДЕНЫ С КАДРА
// ------------------------------------------------------------
// Счётчик и заголовок объявления стоят В ПОЛОСАХ сверху и снизу, а не
// поверх фотографии. Просмотр во весь экран открывают ради самого
// снимка — любая надпись на нём мешает ровно тому, зачем его открыли.
// Полосы занимают место, которое кадру всё равно не достаётся:
// фотография вписывается целиком (object-contain), и при её
// пропорциях 4:3 на экране телефона сверху и снизу остаются поля.
//
// ------------------------------------------------------------
// ПОЧЕМУ НЕ ПОРТАЛ
// ------------------------------------------------------------
// Слой рисуется на месте, с position: fixed и z-modal — тем же
// приёмом, что диалоги и шторка фильтров сайта. Портал понадобился бы
// при родителе с overflow или transform; у карточки объявления такого
// нет, а лишний слой в дереве усложнил бы возврат фокуса, который
// делает useDismissableLayer.
// ============================================================

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import CloseButton from './ui/CloseButton';
import type { CarImage } from '@/lib/types';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { useDismissableLayer } from '@/lib/useDismissableLayer';

type Props = {
  images: CarImage[];
  // Заголовок объявления: «Volkswagen Tiguan, 2013». Показывается в
  // нижней полосе — во весь экран легко забыть, чью машину смотришь,
  // особенно придя по ссылке из мессенджера.
  alt: string;
  locale: Locale;
  // Индекс кадра, с которого открыли просмотр. Открывать всегда с
  // первого нельзя: тапнув по седьмой фотографии, человек ожидает
  // увидеть именно её.
  startIndex: number;
  onClose: () => void;
};

export default function PhotoLightbox({
  images,
  alt,
  locale,
  startIndex,
  onClose,
}: Props) {
  const t = getT(locale);
  const [active, setActive] = useState(startIndex);

  // Escape, блокировка прокрутки страницы под слоем и возврат фокуса
  // на фотографию, с которой просмотр открыли, — общий хук сайта.
  useDismissableLayer({ open: true, onClose });

  // Стрелки клавиатуры. В хук это не входит: он отвечает за закрытие
  // слоя, а листание — поведение конкретно этого просмотра.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        setActive((i) => Math.min(i + 1, images.length - 1));
      } else if (e.key === 'ArrowLeft') {
        setActive((i) => Math.max(i - 1, 0));
      }
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [images.length]);

  // Свайп. Порог 40px отсекает дрожание пальца при тапе и при
  // вертикальной прокрутке; по краям листание упирается, а не
  // заворачивается — круговой переход с последнего кадра на первый
  // читается как сбой, а не как удобство.
  const touchX = useRef<number | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0].clientX;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;

    if (Math.abs(dx) < 40) return;

    setActive((i) =>
      dx < 0 ? Math.min(i + 1, images.length - 1) : Math.max(i - 1, 0),
    );
  }

  const many = images.length > 1;

  return (
    <div
      className="fixed inset-0 z-modal flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* ВЕРХНЯЯ ПОЛОСА: счётчик и закрытие. Кадр начинается под ней,
          поэтому ни то, ни другое не лежит на фотографии. */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <span className="text-caption font-medium text-white/80">
          {many ? `${active + 1} / ${images.length}` : ''}
        </span>

        <CloseButton
          onClick={onClose}
          label={t('common_close')}
          variant="onDark"
        />
      </div>

      {/* КАДР. flex-1 отдаёт ему всю высоту между полосами, min-h-0
          обязателен: без него flex-элемент не сжимается ниже
          содержимого и картинка выдавливает нижнюю полосу за экран. */}
      <div className="relative min-h-0 flex-1">
        {images.map((img, i) => (
          <div
            key={img.id}
            className={i === active ? 'absolute inset-0' : 'hidden'}
          >
            <Image
              src={img.image_url}
              alt={`${alt} — ${i + 1}`}
              fill
              // Во весь экран — значит по длинной стороне устройства.
              sizes="100vw"
              className="object-contain"
              // Кадр, с которого открыли, нужен немедленно: он уже
              // загружен в карточке и придёт из кэша браузера.
              priority={i === startIndex}
            />
          </div>
        ))}

        {/* СТРЕЛКИ — с sm и только когда есть что листать.
            У крайних кадров кнопка не прячется, а гаснет и перестаёт
            нажиматься: исчезающая кнопка сдвигала бы соседнюю и
            заставляла ловить её взглядом заново. */}
        {many && (
          <>
            <button
              type="button"
              onClick={() => setActive((i) => Math.max(i - 1, 0))}
              disabled={active === 0}
              aria-label={t('gallery_prev')}
              className="absolute left-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-3 text-white transition hover:bg-black/70 disabled:opacity-30 sm:block"
            >
              <ArrowIcon direction="left" />
            </button>

            <button
              type="button"
              onClick={() =>
                setActive((i) => Math.min(i + 1, images.length - 1))
              }
              disabled={active === images.length - 1}
              aria-label={t('gallery_next')}
              className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-3 text-white transition hover:bg-black/70 disabled:opacity-30 sm:block"
            >
              <ArrowIcon direction="right" />
            </button>
          </>
        )}
      </div>

      {/* НИЖНЯЯ ПОЛОСА: заголовок и лента миниатюр. Миниатюры только
          на десктопе — на телефоне листают свайпом, а полоса отняла бы
          у кадра высоту ради навигации, которой там не пользуются. */}
      <div className="shrink-0 px-4 pb-4 pt-3">
        <div className="truncate text-caption text-white/70">{alt}</div>

        {many && (
          <div className="no-scrollbar mt-2 hidden gap-2 overflow-x-auto sm:flex">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setActive(i)}
                aria-current={i === active}
                aria-label={`${alt} — ${i + 1}`}
                className={
                  i === active
                    ? 'relative h-12 w-16 shrink-0 overflow-hidden rounded-control ring-2 ring-white'
                    : 'relative h-12 w-16 shrink-0 overflow-hidden rounded-control opacity-50 transition hover:opacity-80'
                }
              >
                <Image
                  src={img.image_url}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Стрелка листания. Инлайновый SVG, а не иконочный шрифт: две
// стрелки не стоят зависимости, а currentColor даёт им цвет кнопки.
function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={direction === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  );
}
