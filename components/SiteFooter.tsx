// ============================================================
// RS AUTO — Подвал сайта. Server Component.
// ============================================================
// Помимо навигации несёт SEO-функцию: даёт краулеру постоянные ссылки на
// разделы каталога с любой страницы сайта.
// ============================================================

import Link from 'next/link';

import { brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

type Props = {
  locale: Locale;
  // Популярные марки для перелинковки. Передаются страницей, которая уже
  // сходила за ними в БД, — подвал сам в базу не ходит, иначе каждый рендер
  // любой страницы делал бы лишний запрос.
  brands?: { brand: string; brand_slug: string }[];
  // Раздел, в который ведут ссылки на марки: продажа или аренда.
  mode?: 'sale' | 'rent';
};

export default function SiteFooter({
  locale,
  brands = [],
  mode = 'sale',
}: Props) {
  const t = getT(locale);
  const year = new Date().getFullYear();
  const brandRoot = mode === 'rent' ? '/rent' : '/cars';

  return (
    <footer className="mt-12 border-t border-black/10 bg-black/[0.02]">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {brands.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 text-sm font-semibold">{t('home_brands')}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-black/60">
              {brands.map((b) => (
                <Link
                  key={b.brand_slug}
                  href={localeHref(locale, `${brandRoot}/${b.brand_slug}`)}
                  className="hover:text-brand-primary hover:underline"
                >
                  {b.brand}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link href={localeHref(locale, '/cars')} className="hover:underline">
            {t('nav_catalog')}
          </Link>
          <Link href={localeHref(locale, '/rent')} className="hover:underline">
            {t('nav_rent')}
          </Link>
          <Link href={localeHref(locale, '/sell')} className="hover:underline">
            {t('nav_sell')}
          </Link>
          <Link href={localeHref(locale, '/dealers')} className="hover:underline">
            {t('nav_dealers')}
          </Link>
          <Link href={localeHref(locale, '/app')} className="hover:underline">
            {t('nav_app')}
          </Link>
        </div>

        <div className="mt-6 text-xs text-black/40">
          © {year} {brand.name}. {t('site_tagline')}.
        </div>
      </div>
    </footer>
  );
}
