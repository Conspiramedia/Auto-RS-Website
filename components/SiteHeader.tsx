// ============================================================
// RS AUTO — Шапка сайта. Server Component (интерактива нет).
// ============================================================
// Логотипа в векторе нет, поэтому знак собирается из текста в брендовых
// цветах. Когда появится SVG — меняется только этот компонент.
// ============================================================

import Link from 'next/link';

import { brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import LocaleSwitch from './LocaleSwitch';

type Props = {
  locale: Locale;
  // Путь текущей страницы без префикса локали — нужен переключателю языка,
  // чтобы остаться на том же месте при смене языка.
  pathname: string;
};

export default function SiteHeader({ locale, pathname }: Props) {
  const t = getT(locale);

  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link
          href={localeHref(locale, '/')}
          className="shrink-0 text-lg font-bold"
          style={{ color: brand.colors.primary }}
        >
          {brand.name}
        </Link>

        <nav className="hidden flex-1 items-center gap-5 text-sm sm:flex">
          <Link href={localeHref(locale, '/cars')} className="hover:underline">
            {t('nav_catalog')}
          </Link>
          <Link href={localeHref(locale, '/dealers')} className="hover:underline">
            {t('nav_dealers')}
          </Link>
          <Link href={localeHref(locale, '/app')} className="hover:underline">
            {t('nav_app')}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <LocaleSwitch locale={locale} pathname={pathname} />

          {/* Сильный CTA продавцу — главная бизнес-цель сайта, поэтому он
              единственный акцентный элемент в шапке. */}
          <Link
            href={localeHref(locale, '/sell')}
            className="rounded-control bg-brand-green px-3 py-2 text-sm font-semibold text-white"
          >
            {t('nav_sell')}
          </Link>
        </div>
      </div>
    </header>
  );
}
