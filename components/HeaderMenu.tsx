'use client';

// ============================================================
// RS AUTO — Меню шапки. Client Component.
// ============================================================
// Единственный вход в ЛИЧНЫЕ страницы на всех ширинах. Раньше меню
// было мобильным (sm:hidden), а на десктопе кабинет открывался
// иконкой человечка в шапке. Иконка убрана: безымянный знак, за
// которым пряталась половина личных разделов, — плохой указатель, и
// счётчик непрочитанного на нём висел без объяснения, к чему он
// относится. Теперь всё в одном месте: и вход, и разделы кабинета,
// и цифры.
//
// РАЗДЕЛЫ САЙТА при этом остаются продублированными: на десктопе они
// стоят прямо в шапке (nav в SiteHeader), а здесь повторяются. Это
// сознательный дубль — меню обязано быть полным само по себе, иначе
// на десктопе оно выглядело бы как «огрызок» из четырёх личных
// ссылок.
//
// БЕЙДЖ НА КНОПКЕ — общее число непрочитанного (сообщения плюс
// уведомления). Внутри меню та же цифра разложена по своим пунктам.
// Оба числа приходят из одной RPC (lib/useBadgeCounts), поэтому
// кружок на кнопке и цифры под ней не могут разойтись.
//
// Слой — z-filter-sheet, та же ступень, что у шторки фильтров: оба
// перекрывают залипающую шапку (z-header) и никогда не открыты
// одновременно.
//
// ============================================================
// ЭТАЛОННЫЙ ВИД МЕНЮ. Утверждён заказчиком — менять порядок пунктов,
// значки и начертание можно только по прямой просьбе.
// ============================================================
// Полный список в порядке сверху вниз. Слева — значок (20px,
// neutral-60), справа — подпись. НАЧЕРТАНИЕ У ВСЕХ ОДНО —
// font-semibold: список читается как единый набор, и разделы сайта не
// должны выглядеть бледнее личных страниц.
//
// У активного пункта значок и подпись красятся brand-primary и слева
// появляется полоса 4px; у остальных та же полоса стоит прозрачной,
// иначе активный сдвигал бы текст на 4px. Начертанием активный НЕ
// выделяется — выделяться не от чего, все пункты уже полужирные.
//
//   ── блок аккаунта ───────────────────────────────
//   LogIn          Войти            только гостю
//   CarFront       Мои объявления   только вошедшему
//   MessageSquare  Сообщения        + счётчик справа
//   Bell           Уведомления      + счётчик справа
//   CircleUser     Профиль
//   ── действие над сайтом ─────────────────────────
//   Download       Быстрый доступ
//   ── разделы сайта ───────────────────────────────
//   Car            Все авто
//   Tag            Продажа
//   KeyRound       Аренда
//   Building2      Автосалоны
//   Smartphone     Приложение
//   Info           О площадке
//   Lightbulb      Как это работает
//   CircleHelp     Вопросы
//   Mail           Контакты
//   ── выход ───────────────────────────────────────
//   LogOut         Выйти            только вошедшему, brand-red
//
// ЛИНИЙ МЕЖДУ ПУНКТАМИ НЕТ — ни одной. Единственная горизонтальная
// линия в меню отделяет шапку («Меню» с крестиком) от списка. Список
// из пятнадцати строк, расчерченный на части, читался бы как таблица,
// а не как навигация.
//
// РАССТОЯНИЕ МЕЖДУ ВСЕМИ ПУНКТАМИ ОДИНАКОВОЕ и задано единственным
// способом — py-3 у самой строки. Обёртки групп своих отступов НЕ
// добавляют: пока у них стояли mb-2/pb-2, зазор на стыке групп был
// на 16px больше, чем между соседними разделами, и список выглядел
// сбитым в неровные кучки. Не возвращать.
//
// Порядок групп при этом осмыслен и менять его нельзя: личный блок
// сверху — это страницы аккаунта, а не разделы сайта; «Быстрый
// доступ» за ними — действие над сайтом, а не раздел; выход снизу —
// действие над аккаунтом. Его отличает цвет, а не начертание.
//
// Значки — ui/NavIcons.tsx, кроме «Быстрого доступа»: там общий
// InstallIcon из ui/InstallIcons, тот же, что у шага инструкции на
// /install.
// ============================================================

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { brand } from '@/lib/brand';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref, stripLocale } from '@/lib/i18n';
import { isParentSectionActive, isSectionActive } from '@/lib/navigation';
import { useBadgeCounts } from '@/lib/useBadgeCounts';
import { useDismissableLayer } from '@/lib/useDismissableLayer';
import SignOutButton from './SignOutButton';
import CloseButton from './ui/CloseButton';
import CountBadge from './ui/CountBadge';
import { InstallIcon } from './ui/InstallIcons';
import {
  BellIcon,
  Building2Icon,
  CarFrontIcon,
  CarIcon,
  CircleHelpIcon,
  CircleUserIcon,
  InfoIcon,
  KeyRoundIcon,
  LightbulbIcon,
  LogInIcon,
  MailIcon,
  MessageSquareIcon,
  ShareIcon,
  TagIcon,
} from './ui/NavIcons';

// Значок пункта меню. Все иконки набора имеют одну сигнатуру, и тип
// нужен, чтобы массивы ссылок ниже принимали любую из них.
type NavIcon = (p: { className?: string }) => ReactNode;

// Классы значка — одной строкой, а не россыпью по трём местам разметки.
// 20px и neutral-60; цвет активного пункта наследуется от ссылки через
// currentColor, поэтому здесь его нет.
const ICON_CLASS = 'h-5 w-5 shrink-0';

// Разделы сайта. Порядок осмысленный: сначала витрины (за ними приходят),
// потом продавцам, затем справочные страницы и контакты.
// nofollow — для служебных витрин, закрытых от индексации: краулеру
// незачем идти по ссылке, которая всё равно отдаёт noindex.
const LINKS: {
  path: string;
  label: DictKey;
  icon: NavIcon;
  nofollow?: boolean;
}[] = [
  // nav_catalog_menu, а не nav_catalog: в меню пункт стоит рядом с
  // «Арендой», и там это выбор вида сделки, а не название раздела.
  // «Все авто» — смешанная витрина /all, первой в группе: она шире
  // двух следующих и ведёт человека, который ещё не выбрал между
  // покупкой и арендой. В десктопную шапку пункт НЕ выносится: там
  // ряд короткий и нужен выбор вида сделки, а не третья ссылка.
  { path: '/all', label: 'nav_all_cars', icon: CarIcon, nofollow: true },
  { path: '/cars', label: 'nav_catalog_menu', icon: TagIcon },
  { path: '/rent', label: 'nav_rent', icon: KeyRoundIcon },
  { path: '/dealers', label: 'nav_dealers', icon: Building2Icon },
  { path: '/about', label: 'nav_about', icon: InfoIcon },
  { path: '/how-it-works', label: 'nav_how', icon: LightbulbIcon },
  { path: '/faq', label: 'nav_faq', icon: CircleHelpIcon },
  { path: '/contact', label: 'nav_contact', icon: MailIcon },
];

// Личные страницы вошедшего. Каждая — ОТДЕЛЬНЫЙ пункт со своим
// адресом: раньше в меню была одна ссылка «Мои объявления», и попасть
// в сообщения или профиль можно было только через вкладки внутри
// кабинета — лишний переход на каждое действие.
//
// Порядок повторяет вкладки кабинета (components/MyTabs.tsx) и нижнюю
// навигацию приложения: объявления, сообщения, уведомления, профиль.
// Расхождение порядка между меню и вкладками читалось бы как разные
// разделы.
//
// badge указывает, какой счётчик показывать рядом с пунктом.
const MY_LINKS: {
  path: string;
  label: DictKey;
  icon: NavIcon;
  badge?: 'messages' | 'notifications';
}[] = [
  { path: '/my', label: 'my_tab_listings', icon: CarFrontIcon },
  {
    path: '/my/messages',
    label: 'my_tab_messages',
    icon: MessageSquareIcon,
    badge: 'messages',
  },
  {
    path: '/my/notifications',
    label: 'my_tab_notifications',
    icon: BellIcon,
    badge: 'notifications',
  },
  { path: '/my/profile', label: 'my_tab_profile', icon: CircleUserIcon },
];

export default function HeaderMenu({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Подтверждение «ссылка скопирована» — запасной путь шаринга там,
  // где системного меню нет. Гаснет само: подтверждение, которое надо
  // закрывать руками, само становится работой.
  const [copied, setCopied] = useState(false);

  // Сессия и счётчики. Запрашиваются НЕ при открытии меню, а сразу:
  // бейдж на кнопке обязан быть виден до того, как меню откроют, —
  // в этом весь его смысл. Гостю запрос к базе при этом не уходит
  // (см. lib/useBadgeCounts).
  const { signedIn, counts } = useBadgeCounts();

  // Escape, блокировка прокрутки под слоем и возврат фокуса на кнопку
  // меню — общее поведение закрываемых слоёв (lib/useDismissableLayer).
  useDismissableLayer({ open, onClose: () => setOpen(false) });

  // Текущий путь без префикса локали: на /ru/my/messages сравнивать
  // нужно '/my/messages', иначе на русской версии не подсветится
  // ни один пункт.
  const { path: currentPath } = stripLocale(pathname);

  // Ссылка на вход с адресом возврата. Путь передаётся БЕЗ префикса
  // локали — /login добавит его сам, иначе на русской версии
  // получился бы /ru/ru/….
  const loginHref = (() => {
    const back =
      currentPath === '/login'
        ? ''
        : `?redirect=${encodeURIComponent(currentPath)}`;
    return `${localeHref(locale, '/login')}${back}`;
  })();

  // Активен ли пункт меню. Правило живёт в lib/navigation и оттуда же
  // применяется во вкладках кабинета (components/MyTabs.tsx): на одной
  // странице подсветиться обязан один и тот же раздел, а два описания
  // одного правила уже однажды разошлись.
  //
  // '/my' — особый случай (isParentSectionActive): его адрес является
  // началом адресов соседних личных разделов.
  //
  // Остальные пункты — обычный раздел: '/cars' остаётся подсвеченным
  // на странице марки '/cars/bmw'. Пересечься здесь не с чем — среди
  // прочих пунктов нет вложенных друг в друга.
  const isActive = (linkPath: string) => {
    if (linkPath === '/my') {
      return isParentSectionActive(
        currentPath,
        linkPath,
        MY_LINKS.map((other) => other.path),
      );
    }

    return isSectionActive(currentPath, linkPath);
  };

  // ------------------------------------------------------------
  // «Поделиться сайтом».
  // ------------------------------------------------------------
  // Делимся ТЕКУЩИМ адресом, а не главной: человек, открывший
  // каталог BMW или конкретное объявление, хочет переслать именно
  // то, что смотрит. Локаль при этом уезжает вместе с адресом — со
  // страницы /ru уйдёт русская ссылка, и получатель увидит русское
  // превью (app/ru/opengraph-image.tsx).
  //
  // navigator.share есть на телефонах и открывает системное меню со
  // всеми мессенджерами сразу. На десктопе его чаще нет — тогда
  // копируем ссылку в буфер: это худший, но рабочий исход, и он
  // лучше отключённой кнопки.
  //
  // AbortError — не ошибка: так браузер сообщает, что человек закрыл
  // системное меню, не выбрав приложение. Показывать ему что-либо в
  // этот момент незачем.
  async function onShare() {
    const url = window.location.href;
    const payload = { title: brand.name, text: t('share_text'), url };

    if (navigator.share) {
      try {
        await navigator.share(payload);
        setOpen(false);
      } catch {
        // Отмена шаринга или отказ платформы — молча остаёмся в меню.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер недоступен (нет HTTPS или запрет в настройках) —
      // сделать здесь нечего, и ложное «скопировано» было бы враньём.
    }
  }

  return (
    <>
      {/* relative — точка привязки для бейджа: кружок позиционируется
          от угла самой кнопки. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          // Скринридеру мало «Меню», когда на кнопке висит счётчик:
          // цифру он не озвучит, а она и есть причина открыть меню.
          counts.total > 0
            ? `${t('nav_menu')} (${counts.total})`
            : t('nav_menu')
        }
        aria-expanded={open}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-neutral-60 transition-colors duration-fast ease-out hover:bg-surface-hover"
      >
        {/* Иконка бургера собрана из трёх полос: отдельного набора
            иконок в проекте пока нет, а тянуть библиотеку ради трёх
            прямоугольников избыточно. */}
        <span className="flex w-5 flex-col gap-1" aria-hidden="true">
          <span className="h-0.5 w-full rounded-pill bg-current" />
          <span className="h-0.5 w-full rounded-pill bg-current" />
          <span className="h-0.5 w-full rounded-pill bg-current" />
        </span>

        {/* Общее число непрочитанного. Гостю и до проверки сессии не
            показывается вовсе: CountBadge не рисует нулевой счётчик. */}
        <CountBadge count={counts.total} floating />
      </button>

      {open && (
        <div className="fixed inset-0 z-filter-sheet">
          {/* Затемнение. Клик по нему закрывает меню. */}
          <div
            className="absolute inset-0 bg-surface-overlay"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Панель. Занимает не весь экран, а правые 80%: видимый край
              затемнения подсказывает, что под меню осталась страница
              и её можно вернуть касанием. max-w-xs держит ширину в
              разумных пределах на десктопе, где 80% экрана были бы
              нелепо широкой колонкой из восьми ссылок. */}
          <nav
            className="absolute right-0 top-0 flex h-full w-4/5 max-w-xs flex-col bg-white shadow-modal"
            aria-label={t('nav_menu')}
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-10 px-4">
              <span className="font-semibold">{t('nav_menu')}</span>
              {/* Подпись остаётся своей («Закрыть меню»), а не общей:
                  в шапке рядом нет другого слоя, и уточнение помогает
                  тому, кто слушает страницу скринридером. */}
              <CloseButton
                onClick={() => setOpen(false)}
                label={t('nav_menu_close')}
              />
            </div>

            {/* Список прокручивается сам: двенадцать пунктов у вошедшего
                не помещаются на низком экране в альбомной ориентации. */}
            <div className="flex-1 overflow-y-auto py-2">
              {/* ЛИЧНЫЙ БЛОК — первым: это страницы аккаунта, а не
                  разделы сайта. Ни линии, ни отдельного отступа у него
                  нет — порядок и есть единственный признак группы.
                  signedIn === null — проверка ещё идёт, не показываем
                  ничего: мелькнувшее «Войти» у вошедшего читается как
                  разлогин. */}
              {signedIn === true && (
                <div>
                  {MY_LINKS.map((link) => {
                    const count =
                      link.badge === 'messages'
                        ? counts.messages
                        : link.badge === 'notifications'
                          ? counts.notifications
                          : 0;

                    const active = isActive(link.path);

                    return (
                      <Link
                        key={link.path}
                        href={localeHref(locale, link.path)}
                        onClick={() => setOpen(false)}
                        // aria-current — единственный признак текущего
                        // раздела для скринридера: ни заливку, ни
                        // полосу слева он не читает.
                        aria-current={active ? 'page' : undefined}
                        className={[
                          'flex items-center justify-between gap-2 py-3 pr-4 font-semibold transition-colors duration-fast ease-out',
                          // Полоса слева + подложка вместо сплошной
                          // тёмной заливки, как у вкладок кабинета:
                          // в списке из двенадцати пунктов чёрный
                          // прямоугольник во всю ширину читался бы
                          // как выбранный элемент формы, а не как
                          // «вы находитесь здесь».
                          // border-l-4 задан ВСЕМ пунктам прозрачным:
                          // иначе активный пункт сдвигал бы текст на
                          // 4px относительно соседей.
                          active
                            ? 'border-l-4 border-brand-primary bg-surface-hover pl-3 text-brand-primary'
                            : 'border-l-4 border-transparent pl-3 hover:bg-surface-hover',
                        ].join(' ')}
                      >
                        {/* Значок и подпись — одной группой: строка
                            разложена justify-between, и без обёртки
                            значок улетел бы к левому краю, а подпись
                            повисла бы посередине. */}
                        <span className="flex items-center gap-2.5">
                          <link.icon
                            className={`${ICON_CLASS} ${active ? '' : 'text-neutral-60'}`}
                          />
                          <span>{t(link.label)}</span>
                        </span>
                        {/* Счётчик у своего раздела: сумма на кнопке
                            меню отвечает на вопрос «есть ли что-то»,
                            а эти цифры — «где именно». */}
                        <CountBadge count={count} />
                      </Link>
                    );
                  })}
                </div>
              )}

              {signedIn === false && (
                <Link
                  href={loginHref}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-3 font-semibold transition-colors duration-fast ease-out hover:bg-surface-hover"
                >
                  <LogInIcon className={`${ICON_CLASS} text-neutral-60`} />
                  {t('nav_login')}
                </Link>
              )}

              {/* БЫСТРЫЙ ДОСТУП — установка сайта на домашний экран.
                  Отдельной строкой после блока входа/кабинета и до
                  разделов сайта: это не раздел, а действие над самим
                  сайтом, и в ряду «Каталог / Аренда / Контакты» оно
                  читалось бы как ещё одна страница.

                  Только в меню, в десктопной шапке пункта нет: ставят
                  на домашний экран с телефона, и на десктопе строка
                  занимала бы место, ничего не предлагая.

                  Ни линии, ни дополнительного отступа вокруг него нет:
                  шаг между всеми пунктами одинаковый, см. эталон
                  в шапке файла. */}
              <div>
                <Link
                  href={localeHref(locale, '/install')}
                  onClick={() => setOpen(false)}
                  aria-current={isActive('/install') ? 'page' : undefined}
                  className={[
                    'flex items-center gap-2.5 py-3 pr-4 font-semibold transition-colors duration-fast ease-out',
                    isActive('/install')
                      ? 'border-l-4 border-brand-primary bg-surface-hover pl-3 text-brand-primary'
                      : 'border-l-4 border-transparent pl-3 hover:bg-surface-hover',
                  ].join(' ')}
                >
                  {/* Стрелка в подставку — общий InstallIcon, тот же
                      значок, что у шага «Установить приложение» на
                      /install. Пункт меню и шаг инструкции обязаны
                      опознаваться как одно действие, а копия путей
                      здесь разъехалась бы с оригиналом при первой
                      правке — что и произошло до этой замены. */}
                  <InstallIcon
                    className={`${ICON_CLASS} ${isActive('/install') ? '' : 'text-neutral-60'}`}
                  />
                  <span>{t('nav_install')}</span>
                </Link>
              </div>

              {/* «Поделиться» — соседом «Быстрого доступа» и по той же
                  причине: это действие над самим сайтом, а не раздел.
                  Оба стоят до списка разделов, потому что в ряду
                  «Каталог / Аренда / Контакты» читались бы как ещё
                  одна страница.

                  Кнопка, а не ссылка: перехода никуда нет, и <a> без
                  href был бы враньём для скринридера и для
                  клавиатуры. Разметка при этом повторяет соседний
                  пункт один в один — в меню они обязаны выглядеть
                  одинаково.

                  Строку «Ссылка скопирована» показываем на месте
                  подписи, не сдвигая пункт: смена текста внутри той же
                  строки не двигает соседей, а отдельная плашка
                  толкала бы вниз половину меню. */}
              <div>
                <button
                  type="button"
                  onClick={onShare}
                  className="flex w-full items-center gap-2.5 border-l-4 border-transparent py-3 pl-3 pr-4 text-left font-semibold transition-colors duration-fast ease-out hover:bg-surface-hover"
                >
                  <ShareIcon className={`${ICON_CLASS} text-neutral-60`} />
                  <span>{copied ? t('share_copied') : t('nav_share')}</span>
                </button>
              </div>

              {LINKS.map((link) => {
                const active = isActive(link.path);

                return (
                  <Link
                    key={link.path}
                    href={localeHref(locale, link.path)}
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    rel={link.nofollow ? 'nofollow' : undefined}
                    className={[
                      // flex вместо block — под значок. Отступы (py-3,
                      // pr-4, pl-3) и полоса слева не менялись: строка
                      // осталась той же высоты, значок встал в неё.
                      // font-semibold у ВСЕХ пунктов, включая неактивные:
                      // список читается как единый набор, и разделы
                      // сайта не должны выглядеть бледнее личных.
                      // Активный отличается цветом и полосой слева —
                      // начертанием он уже не выделяется, потому что
                      // выделяться не от чего.
                      'flex items-center gap-2.5 py-3 pr-4 pl-3 font-semibold transition-colors duration-fast ease-out',
                      active
                        ? 'border-l-4 border-brand-primary bg-surface-hover text-brand-primary'
                        : 'border-l-4 border-transparent hover:bg-surface-hover',
                    ].join(' ')}
                  >
                    <link.icon
                      className={`${ICON_CLASS} ${active ? '' : 'text-neutral-60'}`}
                    />
                    <span>{t(link.label)}</span>
                  </Link>
                );
              })}

              {/* ВЫХОД — последним пунктом и отделён линией сверху:
                  это действие над аккаунтом, а не раздел сайта, и
                  соседство с «Контактами» без разделителя читалось бы
                  как ещё одна страница.
                  Показывается только вошедшему: гостю здесь стоит
                  «Войти» — в самом верху, где он его и ищет.

                  Меню НЕ закрывается по нажатию: SignOutButton
                  открывает диалог подтверждения поверх (z-modal выше
                  z-filter-sheet), и закрывать меню под ним нельзя —
                  при отмене человек обязан вернуться туда, откуда
                  нажал, а не на голую страницу.

                  pl-3 + border-l-4 прозрачной — те же отступы, что у
                  остальных пунктов: без них подпись съехала бы на 4px
                  относительно списка выше. */}
              {signedIn === true && (
                <div>
                  <div className="border-l-4 border-transparent pr-4 pl-3">
                    <SignOutButton locale={locale} variant="menu" />
                  </div>
                </div>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
