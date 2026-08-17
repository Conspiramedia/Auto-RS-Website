// ============================================================
// RS AUTO — Экран 404, общий для sr и ru.
// ============================================================
// До этого not-found.tsx в проекте не было вообще: notFound() из
// карточки, страницы марки и модели отдавал стандартный экран Next —
// без шапки, без языка и без единой ссылки обратно. Для русского
// зеркала это означало гарантированную потерю локали: любой выход с
// такой страницы вёл на сербский корень.
//
// Все ссылки здесь собираются через localeHref — как и везде на сайте.
// ============================================================

import Button from '@/components/ui/Button';

import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

export default function NotFoundView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  return (
    <>
      {/* pathname корневой: конкретного адреса у 404 нет, а переключатель
          языка должен вести на существующую страницу, а не на копию
          несуществующей. */}
      <SiteHeader locale={locale} pathname="/" />

      <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-16 text-center">
        <p className="text-5xl font-bold text-brand-dark/20">404</p>
        <h1 className="mt-4 text-2xl font-bold">{t('nf_title')}</h1>
        <p className="mt-3 max-w-md text-neutral-60">{t('nf_text')}</p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" href={localeHref(locale, '/cars')}>
            {t('nf_catalog')}
          </Button>
          <Button variant="secondary" size="lg" href={localeHref(locale, '/')}>
            {t('nf_home')}
          </Button>
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
