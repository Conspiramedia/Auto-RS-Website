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

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useCardActions } from './CardActionsProvider';
import FavoriteBurst from './FavoriteBurst';
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
  const router = useRouter();
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

  // Счётчик добавлений в избранное — ключ перезапуска всплеска
  // (FavoriteBurst). Растёт только при СОХРАНЕНИИ: снятие закладки
  // анимации не получает, праздновать отказ незачем.
  //
  // Ноль означает «всплеска ещё не было», и это важно при загрузке
  // страницы избранного: там все карточки сохранены, и без такого
  // начального значения искры разлетелись бы разом у каждой.
  const [burstKey, setBurstKey] = useState(0);

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
    //
    // ПОЧЕМУ КНОПКА, А НЕ ССЫЛКА. Карточка целиком — это <a> (Card с
    // href), и вложенная в неё вторая ссылка невалидна по стандарту
    // HTML. Браузер такую вложенность не прощает: разбирая документ,
    // он ВЫНОСИТ внутренний <a> за пределы внешнего, дерево в браузере
    // перестаёт совпадать с серверным, и React падает с ошибкой
    // гидратации «<a> cannot be a descendant of <a>».
    //
    // Соседний значок «три точки» в этом же файле кнопкой был всегда —
    // здесь то же самое место и то же ограничение.
    //
    // ЧТО ТЕРЯЕТСЯ. Средний клик и «открыть в новой вкладке» на самом
    // значке. Потеря невелика: это переключатель закладки, а не
    // навигационная ссылка, и открывать вход во второй вкладке никто
    // не идёт. Адрес входа при этом не потерян — он в aria-label и в
    // переходе ниже.
    if (!signedIn) {
      const loginHref = `${localeHref(
        locale,
        '/login',
      )}?redirect=${encodeURIComponent(localeHref(locale, `/car/${carId}`))}`;

      return (
        <button
          type="button"
          className={`${HIT_AREA} text-neutral-60`}
          aria-label={t('car_favorite_aria_add')}
          title={t('car_favorite_aria_add')}
          onClick={(e) => {
            // Не даём всплыть до ссылки-карточки (см. шапку файла).
            // preventDefault добавлен к stopPropagation: кнопка стоит
            // внутри <a>, и без него клик по ней увёл бы на страницу
            // объявления вместо входа.
            e.stopPropagation();
            e.preventDefault();
            // Клик гостя тоже событие: интерес проявлен, а дойдёт ли
            // он до входа — как раз то, что показывает разница с
            // событиями вошедших.
            trackEvent('favorite_added', { guest: true });
            router.push(loginHref);
          }}
        >
          <HeartIcon className="h-5 w-5" />
        </button>
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
          // Всплеск запускается ДО ответа сервера, по текущему
          // состоянию: закладка в CardActionsProvider обновляется
          // оптимистично, и ждать сети значило бы показать искры
          // через полсекунды после нажатия — то есть уже не в ответ
          // на него.
          if (!saved) setBurstKey((n) => n + 1);
          void toggleFavorite(carId);
        }}
      >
        <FavoriteBurst burstKey={burstKey}>
          <HeartIcon className="h-5 w-5" filled={saved} />
        </FavoriteBurst>
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
          // влево: значок стоит у правого края карточки, и список,
          // выпадающий вправо, ушёл бы за границу экрана.
          //
          // НО ВЛЕВО ОН ТОЖЕ МОЖЕТ НЕ ПОМЕСТИТЬСЯ. В сетке каталога
          // на мобильном две колонки, и у ЛЕВОЙ карточки кнопка стоит
          // примерно на середине экрана: 224px меню, отложенные от неё
          // влево, упирались в левый край окна и вылезали за него —
          // пункты обрезались по живому тексту. У правой карточки той
          // же страницы всё выглядело правильно, поэтому баг и не
          // виден, пока не нажать именно левую.
          //
          // Поэтому отступ зажимается в границах окна: меню либо
          // висит под кнопкой, либо прижимается к краю, но за экран не
          // выходит никогда. GUTTER — воздух до кромки, чтобы список
          // не выглядел приклеенным.
          const GUTTER = 8;
          // Ширина w-56 из класса ниже. Дублируется числом, потому что
          // считать позицию нужно ДО отрисовки меню — измерить его
          // нечем. В окне уже 232px формула упёрлась бы в правый край,
          // но там вступает max-w-[calc(100vw-1rem)] на самом
          // элементе: меню сужается и всё равно помещается.
          const MENU_WIDTH = 224; // w-56

          // Сколько остаётся справа, если равнять по кнопке.
          const preferred = window.innerWidth - box.right;

          // Правее этого значения меню вылезло бы за левый край:
          // ширина окна минус ширина меню и отступ.
          const maxRight = window.innerWidth - MENU_WIDTH - GUTTER;

          setMenuAt({
            top: box.bottom + 4,
            // Нижняя граница GUTTER держит меню и от правого края —
            // она срабатывает у карточек, прижатых к правой кромке.
            right: Math.max(GUTTER, Math.min(preferred, maxRight)),
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
