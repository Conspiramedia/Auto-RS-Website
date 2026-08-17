// ============================================================
// RS AUTO — Экран ошибки (500), общий для sr и ru.
// ============================================================
// До этого в проекте не было ни одного error.tsx: любое исключение в
// серверном рендере (упавшая RPC каталога, недоступная база) отдавало
// стандартный экран Next — без шапки, без языка и без единой ссылки
// обратно. Для русского зеркала это означало ещё и потерю локали.
//
// Что важно в этом компоненте:
//   * причина ошибки пользователю НЕ показывается. Текст исключения
//     может содержать имена RPC и структуру запроса — в интерфейсе им
//     не место. Диагностика уходит в консоль (см. error.tsx роутов);
//   * есть кнопка reset() — повтор рендера сегмента без перезагрузки
//     страницы. Большинство ошибок здесь сетевые и проходят со второй
//     попытки, поэтому это главное действие;
//   * шапка отдаётся урезанная. Полный SiteHeader ходит только за
//     словарём и ссылками, но подвал (SiteFooter) на странице ошибки
//     не нужен: он рассчитан на список марок и удлиняет экран, с
//     которого посетитель должен уйти в одно действие.
// ============================================================

'use client';

import Link from 'next/link';

import LocaleSwitch from '@/components/LocaleSwitch';
import { brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

type Props = {
  locale: Locale;
  // Повторный рендер сегмента. Передаётся Next в error.tsx.
  reset: () => void;
};

export default function ErrorView({ locale, reset }: Props) {
  const t = getT(locale);

  return (
    <>
      {/* Шапка собрана здесь, а не переиспользована из SiteHeader:
          на экране ошибки не должно быть ни CTA подачи, ни навигации
          по разделам — только выход в каталог и переключатель языка. */}
      <header className="border-b border-neutral-10 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:gap-4 sm:px-4">
          <Link
            href={localeHref(locale, '/')}
            className="shrink-0 text-base font-bold sm:text-lg"
            style={{ color: brand.colors.primary }}
          >
            {brand.name}
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
            {/* pathname корневой: у страницы ошибки нет собственного
                адреса, и переключатель обязан вести на существующую
                страницу, а не на копию упавшей. */}
            <LocaleSwitch locale={locale} pathname="/" />

            <Link
              href={localeHref(locale, '/cars')}
              className="whitespace-nowrap rounded-control bg-brand-green px-2.5 py-2 text-xs font-semibold text-white sm:px-3 sm:text-sm"
            >
              {t('nf_catalog')}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-16 text-center">
        <p className="text-5xl font-bold text-brand-dark/20">500</p>
        <h1 className="mt-4 text-2xl font-bold">{t('err_title')}</h1>
        <p className="mt-3 max-w-md text-neutral-60">{t('err_text')}</p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {/* Основное действие — повторить. Ошибки этого класса чаще
              всего сетевые и снимаются повторным рендером. */}
          <button
            type="button"
            onClick={reset}
            className="rounded-control bg-brand-green px-5 py-3 font-semibold text-white"
          >
            {t('err_retry')}
          </button>
          <Link
            href={localeHref(locale, '/cars')}
            className="rounded-control border border-neutral-15 px-5 py-3 font-semibold"
          >
            {t('nf_catalog')}
          </Link>
          <Link
            href={localeHref(locale, '/')}
            className="rounded-control border border-neutral-15 px-5 py-3 font-semibold"
          >
            {t('nf_home')}
          </Link>
        </div>
      </main>
    </>
  );
}
