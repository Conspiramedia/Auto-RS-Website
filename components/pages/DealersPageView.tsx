// ============================================================
// RS AUTO — Содержимое страницы /dealers, общее для sr и ru.
// ============================================================

import DealerForm from '@/components/DealerForm';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

// Выгоды для салона. Держим здесь: они специфичны для оффера и в общий
// словарь интерфейса не просятся.
const BENEFITS: Record<Locale, { title: string; text: string }[]> = {
  sr: [
    {
      title: 'Prva 3 meseca besplatno',
      text: 'Objavite ceo vozni park bez naknade i procenite rezultat.',
    },
    {
      title: 'Stranica autosalona',
      text: 'Svi vaši automobili na jednom mestu, sa logotipom i nazivom salona.',
    },
    {
      title: 'Kupci iz cele Srbije',
      text: 'Oglasi su vidljivi i na sajtu i u mobilnoj aplikaciji.',
    },
  ],
  ru: [
    {
      title: 'Первые 3 месяца бесплатно',
      text: 'Разместите весь автопарк без оплаты и оцените результат.',
    },
    {
      title: 'Страница автосалона',
      text: 'Все ваши автомобили в одном месте, с логотипом и названием салона.',
    },
    {
      title: 'Покупатели со всей Сербии',
      text: 'Объявления видны и на сайте, и в мобильном приложении.',
    },
  ],
};

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
          {BENEFITS[locale].map((b) => (
            <div key={b.title} className="rounded-card border border-black/10 p-4">
              <h2 className="font-semibold">{b.title}</h2>
              <p className="mt-1 text-sm text-black/60">{b.text}</p>
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
