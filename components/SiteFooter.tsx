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
    <footer className="mt-12 border-t border-neutral-10 bg-surface-subtle">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {brands.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 text-caption font-semibold">{t('home_brands')}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-caption text-neutral-60">
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

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-caption">
          <Link href={localeHref(locale, '/cars')} className="hover:underline">
            {t('nav_catalog_menu')}
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

          {/* Кабинет продавца. Ссылка нужна людям — она даёт вход в
              «Мои объявления» с любой страницы, включая те, где шапка
              прокручена далеко вверх.
              rel="nofollow" обязателен: /my закрыт noindex и в
              robots.txt, поэтому обходить его краулеру незачем, а
              обычная ссылка сливала бы туда вес страницы. */}
          <Link
            href={localeHref(locale, '/my')}
            rel="nofollow"
            className="hover:underline"
          >
            {t('nav_my')}
          </Link>
        </div>

        {/* Справочные страницы отдельной строкой: они отвечают на
            вопросы «что это за площадка» и «как это работает», но не
            должны конкурировать с разделами каталога выше.
            Блока соцсетей здесь нет намеренно — аккаунтов пока не
            существует, а ссылки в никуда хуже их отсутствия. */}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-caption">
          <Link href={localeHref(locale, '/about')} className="hover:underline">
            {t('nav_about')}
          </Link>
          <Link
            href={localeHref(locale, '/how-it-works')}
            className="hover:underline"
          >
            {t('nav_how')}
          </Link>
          <Link href={localeHref(locale, '/faq')} className="hover:underline">
            {t('nav_faq')}
          </Link>
        </div>

        {/* Юридические документы. Отдельной строкой и приглушённо: они
            обязаны быть доступны с любой страницы (на них ссылается
            согласие при входе по SMS), но конкурировать с разделами
            каталога им незачем. */}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-caption text-neutral-50">
          {/* Контакты стоят рядом с документами не случайно: именно
              документы на них ссылаются, и путь должен быть доступен
              с любой страницы сайта. */}
          <Link
            href={localeHref(locale, '/contact')}
            className="hover:underline"
          >
            {t('nav_contact')}
          </Link>
          <Link href={localeHref(locale, '/terms')} className="hover:underline">
            {t('legal_terms_title')}
          </Link>
          <Link
            href={localeHref(locale, '/privacy')}
            className="hover:underline"
          >
            {t('legal_privacy_title')}
          </Link>
        </div>

        <div className="mt-6 text-small text-neutral-60">
          © {year} {brand.name}. {t('site_tagline')}.
        </div>
      </div>
    </footer>
  );
}
