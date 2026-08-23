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
// ============================================================

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref, stripLocale } from '@/lib/i18n';
import { useBadgeCounts } from '@/lib/useBadgeCounts';
import CloseButton from './ui/CloseButton';
import CountBadge from './ui/CountBadge';

// Разделы сайта. Порядок осмысленный: сначала витрины (за ними приходят),
// потом продавцам, затем справочные страницы и контакты.
const LINKS: { path: string; label: DictKey }[] = [
  { path: '/cars', label: 'nav_catalog' },
  { path: '/rent', label: 'nav_rent' },
  { path: '/dealers', label: 'nav_dealers' },
  { path: '/app', label: 'nav_app' },
  { path: '/about', label: 'nav_about' },
  { path: '/how-it-works', label: 'nav_how' },
  { path: '/faq', label: 'nav_faq' },
  { path: '/contact', label: 'nav_contact' },
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
  badge?: 'messages' | 'notifications';
}[] = [
  { path: '/my', label: 'my_tab_listings' },
  { path: '/my/messages', label: 'my_tab_messages', badge: 'messages' },
  {
    path: '/my/notifications',
    label: 'my_tab_notifications',
    badge: 'notifications',
  },
  { path: '/my/profile', label: 'my_tab_profile' },
];

export default function HeaderMenu({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Сессия и счётчики. Запрашиваются НЕ при открытии меню, а сразу:
  // бейдж на кнопке обязан быть виден до того, как меню откроют, —
  // в этом весь его смысл. Гостю запрос к базе при этом не уходит
  // (см. lib/useBadgeCounts).
  const { signedIn, counts } = useBadgeCounts();

  // Блокировка прокрутки страницы под открытой шторкой. Без неё палец
  // прокручивает не меню, а страницу за ним, и при закрытии человек
  // оказывается в другом месте документа.
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Escape закрывает меню — привычное поведение модальных слоёв.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);

    return () => {
      // Возвращаем исходное значение, а не пустую строку: страница
      // могла иметь собственный overflow, и затирать его нельзя.
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Ссылка на вход с адресом возврата. Путь передаётся БЕЗ префикса
  // локали — /login добавит его сам, иначе на русской версии
  // получился бы /ru/ru/….
  const loginHref = (() => {
    const { path } = stripLocale(pathname);
    const back =
      path === '/login' ? '' : `?redirect=${encodeURIComponent(path)}`;
    return `${localeHref(locale, '/login')}${back}`;
  })();

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
              {/* ЛИЧНЫЙ БЛОК — первым и отделён линией: это страницы
                  аккаунта, а не разделы сайта.
                  signedIn === null — проверка ещё идёт, не показываем
                  ничего: мелькнувшее «Войти» у вошедшего читается как
                  разлогин. */}
              {signedIn === true && (
                <div className="mb-2 border-b border-neutral-10 pb-2">
                  {MY_LINKS.map((link) => {
                    const count =
                      link.badge === 'messages'
                        ? counts.messages
                        : link.badge === 'notifications'
                          ? counts.notifications
                          : 0;

                    return (
                      <Link
                        key={link.path}
                        href={localeHref(locale, link.path)}
                        onClick={() => setOpen(false)}
                        className="flex items-center justify-between gap-2 px-4 py-3 font-semibold transition-colors duration-fast ease-out hover:bg-surface-hover"
                      >
                        <span>{t(link.label)}</span>
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
                  className="mb-2 block border-b border-neutral-10 px-4 py-3 font-semibold transition-colors duration-fast ease-out hover:bg-surface-hover"
                >
                  {t('nav_login')}
                </Link>
              )}

              {LINKS.map((link) => (
                <Link
                  key={link.path}
                  href={localeHref(locale, link.path)}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-3 font-medium transition-colors duration-fast ease-out hover:bg-surface-hover"
                >
                  {t(link.label)}
                </Link>
              ))}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
