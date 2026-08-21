'use client';

// ============================================================
// RS AUTO — Мобильное меню. Client Component.
// ============================================================
// До этого на мобильном в шапке были только лого, язык и CTA подачи:
// все разделы жили в подвале, и чтобы перейти в аренду или к дилерам,
// приходилось листать страницу до конца. С появлением контентных
// страниц (/about, /how-it-works, /faq) это стало окончательно
// неприемлемо.
//
// Меню показывается ТОЛЬКО на мобильном (sm:hidden): на десктопе
// разделы стоят в самой шапке, и дублировать их бургером незачем.
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
import { getBrowserClient } from '@/lib/supabaseClient';
import CloseButton from './ui/CloseButton';

// Разделы меню. Порядок осмысленный: сначала витрины (за ними приходят),
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

export default function MobileMenu({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Вошёл ли пользователь: от этого зависит первый пункт меню —
  // «Войти» или «Мои объявления». null — проверка ещё идёт, пункт
  // не показываем вовсе (мелькнувшее «Войти» у вошедшего читается
  // как разлогин).
  //
  // Проверка запускается ТОЛЬКО при открытии меню: держать её на
  // каждой странице незачем — закрытый бургер ничего не показывает.
  // Сессия читается локально из cookie, обращения к базе здесь нет.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    (async () => {
      const { data } = await getBrowserClient().auth.getSession();
      if (!cancelled) setSignedIn(data.session != null);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('nav_menu')}
        aria-expanded={open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-neutral-60 transition-colors duration-fast ease-out hover:bg-surface-hover sm:hidden"
      >
        {/* Иконка бургера собрана из трёх полос: отдельного набора
            иконок в проекте пока нет, а тянуть библиотеку ради трёх
            прямоугольников избыточно. */}
        <span className="flex w-5 flex-col gap-1" aria-hidden="true">
          <span className="h-0.5 w-full rounded-pill bg-current" />
          <span className="h-0.5 w-full rounded-pill bg-current" />
          <span className="h-0.5 w-full rounded-pill bg-current" />
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-filter-sheet sm:hidden">
          {/* Затемнение. Клик по нему закрывает меню. */}
          <div
            className="absolute inset-0 bg-surface-overlay"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Панель. Занимает не весь экран, а правые 80%: видимый край
              затемнения подсказывает, что под меню осталась страница
              и её можно вернуть касанием. */}
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

            {/* Список прокручивается сам: восемь пунктов не помещаются
                на низком экране в альбомной ориентации. */}
            <div className="flex-1 overflow-y-auto py-2">
              {/* Вход или кабинет — первым пунктом и отделён линией:
                  это действие над аккаунтом, а не раздел сайта. */}
              {signedIn !== null && (
                <Link
                  href={
                    signedIn
                      ? localeHref(locale, '/my')
                      : `${localeHref(locale, '/login')}?redirect=${encodeURIComponent(
                          stripLocale(pathname).path,
                        )}`
                  }
                  onClick={() => setOpen(false)}
                  className="mb-2 block border-b border-neutral-10 px-4 py-3 font-semibold transition-colors duration-fast ease-out hover:bg-surface-hover"
                >
                  {signedIn ? t('nav_my') : t('nav_login')}
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
