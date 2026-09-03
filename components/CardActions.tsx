'use client';

// ============================================================
// RS AUTO — Значки на карточке объявления: сердце и «три точки».
// ============================================================
// ПЕРЕНОС ИЗ ПРИЛОЖЕНИЯ. Раскладка повторяет car_card.dart один в
// один: сердце — в строке названия справа, «три точки» — в строке
// цены справа. Человек, пришедший на сайт с телефона после
// приложения, обязан найти те же значки на тех же местах.
//
// ПОЧЕМУ ОДИН КОМПОНЕНТ НА ДВА ЗНАЧКА. Оба нуждаются в одном и том же:
// знать, вошёл ли посетитель, и уметь убрать карточку из списка. Два
// компонента читали бы сессию двумя запросами на каждую карточку —
// при 24 карточках в выдаче это 48 обращений вместо 24.
//
// СЕССИЯ ЧИТАЕТСЯ НЕ ЗДЕСЬ. Карточек на странице два десятка, и
// getSession() в каждой означал бы столько же одинаковых вызовов.
// Состояние приходит сверху, из CardActionsProvider: один запрос на
// всю страницу.
//
// ПОЧЕМУ КЛИЕНТСКИЙ. Каталог кэшируется и рендерится БЕЗ сессии — на
// этом держится SEO. Значки поэтому дорисовываются в браузере, а
// сервер отдаёт карточку одинаковой всем.
//
// ССЫЛКА ВНУТРИ ССЫЛКИ. Карточка целиком — <a> на объявление, и
// вложить в неё <button> валидно, но клик по кнопке всплыл бы до
// ссылки и увёл человека на страницу объявления вместо переключения
// закладки. Поэтому у обоих обработчиков stopPropagation +
// preventDefault.
//
// МЕНЮ «ТРИ ТОЧКИ» РИСУЕТСЯ ПОРТАЛОМ В <body>. Карточка (Card)
// обязана нести overflow-hidden — им обрезается фотография по
// скруглённым углам, — и выпадающий внутри неё список упирался в
// нижнюю кромку карточки: первый пункт был виден наполовину, второй
// не виден вовсе. Ни z-index, ни порядок элементов этого не лечат:
// overflow обрезает потомков независимо от слоя, а снять его нельзя,
// не отпустив углы фотографии.
//
// Портал выносит список из потока карточки целиком — обрезать его
// больше нечему. document.body здесь безопасен без проверки на
// сервер: портал существует только когда menuAt не null, а это
// состояние возникает исключительно по клику, то есть в браузере.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useCardActions } from './CardActionsProvider';
import { HeartIcon, MoreHorizontalIcon } from './ui/NavIcons';
import { trackEvent } from '@/lib/analytics';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

type Props = {
  locale: Locale;
  carId: string;
  city: string;
  // Какой из двух значков рисуем: они стоят в РАЗНЫХ строках карточки
  // (сердце у названия, точки у цены) и общего контейнера иметь не
  // могут.
  kind: 'favorite' | 'menu';
};

// Общий вид значка: 32×32 область нажатия вокруг иконки 20×20.
// Меньше нельзя — 24px не дотягивает до минимума в 44px по
// рекомендациям, а на карточке шириной 156px (360px, две колонки)
// большее съело бы название машины.
const HIT_AREA =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full ' +
  'transition-colors hover:bg-surface-muted';

export default function CardActions({ locale, carId, city, kind }: Props) {
  const t = getT(locale);
  const { signedIn, isFavorite, toggleFavorite, hideCar, hideCity } =
    useCardActions();

  // Меню рисуется ПОРТАЛОМ в <body> по координатам кнопки, а не
  // absolute внутри карточки. Причина — overflow-hidden у Card
  // (components/ui/Card.tsx): он обязателен, потому что обрезает
  // фотографию по скруглённым углам карточки, но заодно обрезал и
  // выпадающий список — тот упирался в нижний край карточки и
  // показывал первый пункт наполовину.
  //
  // Портал выносит меню из потока карточки целиком: обрезать его
  // больше нечему. Расплата — позицию приходится считать самому
  // (position: fixed от края окна), зато список одинаково цел и в
  // сетке каталога, и в блоке «похожие», и в избранном.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ top: number; right: number } | null>(
    null,
  );
  const menuOpen = menuAt !== null;

  // Координаты считаются от кнопки в момент открытия. При прокрутке и
  // изменении размера окна меню закрывается, а не едет следом:
  // пересчитывать позицию на каждый кадр прокрутки ради всплывашки,
  // которую всё равно закрывают первым же действием, — лишняя работа
  // в самом горячем месте (прокрутка ленты карточек).
  useEffect(() => {
    if (!menuOpen) return;

    const close = () => setMenuAt(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);

    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menuOpen]);

  // Сессия ещё проверяется — значков нет. Мелькнувшее пустое сердце у
  // того, кто объявление сохранил, читается как потеря закладки.
  if (signedIn === undefined) return null;

  // ---------- Сердце ----------
  if (kind === 'favorite') {
    const saved = isFavorite(carId);

    // Гость: значок ведёт на вход с возвратом в каталог. Не прячем —
    // иначе функция для незалогиненного просто не существует, и он не
    // узнает, что она есть.
    if (!signedIn) {
      return (
        <a
          href={`${localeHref(locale, '/login')}?redirect=${encodeURIComponent(
            localeHref(locale, `/car/${carId}`),
          )}`}
          className={`${HIT_AREA} text-neutral-60`}
          aria-label={t('car_favorite_aria_add')}
          title={t('car_favorite_aria_add')}
          onClick={(e) => {
            // Не даём всплыть до ссылки-карточки (см. шапку файла).
            e.stopPropagation();
            trackEvent('favorite_added', { guest: true });
          }}
        >
          <HeartIcon className="h-5 w-5" />
        </a>
      );
    }

    return (
      <button
        type="button"
        // Переключатель: состояние объявляется скринридеру, иначе смена
        // значка для него не существует вовсе.
        aria-pressed={saved}
        aria-label={
          saved ? t('car_favorite_aria_remove') : t('car_favorite_aria_add')
        }
        title={saved ? t('car_favorite_aria_remove') : t('car_favorite_aria_add')}
        // Красный у сохранённого — как в приложении (AppBrandColors.red).
        className={`${HIT_AREA} ${saved ? 'text-brand-red' : 'text-neutral-60'}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void toggleFavorite(carId);
        }}
      >
        <HeartIcon className="h-5 w-5" filled={saved} />
      </button>
    );
  }

  // ---------- «Три точки»: скрыть рекомендацию ----------
  // Гостю не показываем вовсе: скрытие пишется в БД по auth.uid(), и
  // сохранить выбор гостя негде. В приложении та же логика —
  // _requireAuth перед вызовом.
  if (!signedIn) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('catalog_hide_aria')}
        title={t('catalog_hide_aria')}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={`${HIT_AREA} text-neutral-60`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();

          if (menuOpen) {
            setMenuAt(null);
            return;
          }

          const box = buttonRef.current?.getBoundingClientRect();
          if (!box) return;

          // Правый край меню равняется по правому краю кнопки, отсчёт
          // идёт от ПРАВОГО края окна — потому меню и раскрывается
          // влево. Выпадающий вправо список уехал бы за границу
          // экрана: значок стоит у правого края карточки, а на
          // мобильном карточка сама прижата к краю.
          setMenuAt({
            top: box.bottom + 4,
            right: window.innerWidth - box.right,
          });
        }}
      >
        <MoreHorizontalIcon className="h-5 w-5" />
      </button>

      {menuAt &&
        createPortal(
          <>
            {/* Слой z-modal: меню вынесено в <body> и перекрывает
                собой всё, включая залипающую шапку. Раньше здесь
                стоял z-header в расчёте на то, что всплывашка шапку
                перекрывать НЕ должна, — но это было верно, пока меню
                жило внутри карточки и вместе с ней уезжало под шапку
                при прокрутке. Портал отменяет прокрутку как способ
                убрать меню с дороги (оно закрывается по первому же
                скроллу), и ступень ниже шапки означала бы список,
                наполовину заехавший под неё.

                Подложка на весь экран: клик мимо меню закрывает его.
                Обязателен именно элемент, а не обработчик на
                document, — он же перехватывает клик, который иначе
                прошёл бы по ссылке-карточке под меню. */}
            <div
              className="fixed inset-0 z-modal"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setMenuAt(null);
              }}
            />

            <div
              role="menu"
              // Ширина ограничена ещё и шириной окна: на 360px меню в
              // 224px помещается, но с отступом от края в 8px — иначе
              // оно липнет к самой кромке экрана.
              className="fixed z-modal max-w-[calc(100vw-1rem)] w-56 rounded-card border border-neutral-10 bg-white p-1 shadow-dropdown"
              style={{ top: menuAt.top, right: menuAt.right }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <div className="px-3 py-2 text-caption font-semibold text-neutral-60">
                {t('catalog_hide_title')}
              </div>

              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-control px-3 py-2 text-left text-small hover:bg-surface-muted"
                onClick={() => {
                  setMenuAt(null);
                  void hideCar(carId);
                }}
              >
                {t('catalog_hide_car')}
              </button>

              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-control px-3 py-2 text-left text-small hover:bg-surface-muted"
                onClick={() => {
                  setMenuAt(null);
                  void hideCity(city);
                }}
              >
                {t('catalog_hide_city')}
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
