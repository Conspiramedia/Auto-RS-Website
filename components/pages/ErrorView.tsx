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
import Button from '@/components/ui/Button';
import Logo from '@/components/ui/Logo';
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
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4">
          <Link href={localeHref(locale, '/')} className="shrink-0">
            <Logo className="text-body sm:text-h4" />
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
            {/* pathname корневой: у страницы ошибки нет собственного
                адреса, и переключатель обязан вести на существующую
                страницу, а не на копию упавшей. */}
            <LocaleSwitch locale={locale} pathname="/" />

            <Button
              size="xs"
              href={localeHref(locale, '/cars')}
              className="whitespace-nowrap"
            >
              {t('nf_catalog')}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-12 text-center sm:py-16">
        <p className="text-hero font-bold text-neutral-15">500</p>
        <h1 className="mt-4 text-h2 font-bold sm:text-h1">{t('err_title')}</h1>
        <p className="mt-3 max-w-md text-neutral-60">{t('err_text')}</p>

        {/* СТОЛБИК НА МОБИЛЬНОМ, РЯД НА ШИРОКОМ ЭКРАНЕ.
            Раньше здесь стоял flex-wrap: три кнопки разной ширины
            переносились по мере заполнения строки, и на 360px выходило
            «одна сверху, две внизу» — вразнобой, с разной шириной у
            каждой. Читается как случайный набор, а не как список
            действий.
            inline-grid с одной колонкой решает и порядок, и ширину:
            grid делает все ячейки равными самой широкой из них, то есть
            ширина берётся ПО САМОМУ ДЛИННОМУ ТЕКСТУ автоматически —
            без фиксированного значения, которое пришлось бы подбирать
            заново под каждый перевод (сербские подписи длиннее русских).
            inline-, а не обычный grid: блок остаётся по содержимому и
            центрируется родителем, иначе кнопки растянулись бы на всю
            ширину экрана.
            С sm: возвращается горизонтальный ряд — на планшете и
            десктопе три кнопки в строку помещаются свободно, и столбик
            там выглядел бы неоправданно тяжёлым. */}
        <div className="mt-8 inline-grid grid-cols-1 gap-3 sm:flex sm:flex-row sm:items-center sm:justify-center">
          {/* Основное действие — повторить. Ошибки этого класса чаще
              всего сетевые и снимаются повторным рендером. */}
          <Button size="lg" onClick={reset}>
            {t('err_retry')}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            href={localeHref(locale, '/cars')}
          >
            {t('nf_catalog')}
          </Button>
          <Button variant="secondary" size="lg" href={localeHref(locale, '/')}>
            {t('nf_home')}
          </Button>
        </div>
      </main>
    </>
  );
}
