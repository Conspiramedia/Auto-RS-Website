// ============================================================
// RS AUTO — Содержимое страницы подачи /sell, общее для sr и ru.
// ============================================================

import SellForm from '@/components/SellForm';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

export default function SellPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  return (
    <>
      <SiteHeader locale={locale} pathname="/sell" />

      {/* max-w-3xl на десктопе вместо 2xl: форма подачи получила парные
          поля (марка+модель, цена+пробег), и на 672px две колонки
          становятся слишком узкими для пикеров со списком.
          Шире 768px не идём — поля ввода во всю ширину экрана читаются
          плохо, а форма остаётся линейным сценарием, а не панелью. */}
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-8 lg:max-w-3xl">
        <h1 className="text-h2 font-bold sm:text-h1">{t('sell_title')}</h1>
        <p className="mt-2 text-neutral-60">{t('sell_subtitle')}</p>

        <div className="mt-6">
          <SellForm locale={locale} />
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
