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
import { useEffect, useState } from 'react';

import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

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
  const [open, setOpen] = useState(false);

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
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('nav_menu_close')}
                className="px-2 text-2xl leading-none text-neutral-40"
              >
                ×
              </button>
            </div>

            {/* Список прокручивается сам: восемь пунктов не помещаются
                на низком экране в альбомной ориентации. */}
            <div className="flex-1 overflow-y-auto py-2">
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
