// ============================================================
// RS AUTO — Содержимое страницы /dealers, общее для sr и ru.
// ============================================================

import DealerForm from '@/components/DealerForm';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { DictKey } from '@/lib/i18n';

// Выгоды для салона. Ключи словаря, а не готовый текст: раньше здесь
// лежал объект с обеими локалями, и правка формулировки требовала
// открывать компонент вместо словаря — то есть строки жили в двух
// разных местах проекта.
const BENEFITS: { title: DictKey; text: DictKey }[] = [
  { title: 'dealers_benefit_1_title', text: 'dealers_benefit_1_text' },
  { title: 'dealers_benefit_2_title', text: 'dealers_benefit_2_text' },
  { title: 'dealers_benefit_3_title', text: 'dealers_benefit_3_text' },
];

export default function DealersPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  return (
    <>
      <SmartBanner locale={locale} />
      <SiteHeader locale={locale} pathname="/dealers" />

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-bold">{t('dealers_title')}</h1>
        <p className="mt-2 text-xl font-semibold text-brand-green">
          {t('dealers_offer')}
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {BENEFITS.map((b) => (
            <div key={b.title} className="rounded-card border border-neutral-10 p-4">
              <h2 className="font-semibold">{t(b.title)}</h2>
              <p className="mt-1 text-sm text-neutral-60">{t(b.text)}</p>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <DealerForm locale={locale} />
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
