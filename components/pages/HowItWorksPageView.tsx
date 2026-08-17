// ============================================================
// RS AUTO — Содержимое страницы /how-it-works, общее для sr и ru.
// ============================================================
// Три сценария по ролям, каждый — три пронумерованных шага.
// Нумерация здесь смысловая, а не декоративная: посетитель должен
// понять, что произойдёт ПОСЛЕ его действия (подал → модерация →
// сообщения), иначе ожидание проверки выглядит как «объявление
// пропало».
// ============================================================

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

type Scenario = {
  title: DictKey;
  steps: { title: DictKey; text: DictKey }[];
  // Действие в конце сценария: куда ведём человека дальше.
  ctaLabel: DictKey;
  ctaPath: string;
  // Акцентная кнопка только у сценария продавца: подача объявления —
  // главная бизнес-цель сайта, и второго яркого CTA на экране быть
  // не должно (правило бренда).
  ctaPrimary?: boolean;
};

const SCENARIOS: Scenario[] = [
  {
    title: 'how_buyer_title',
    steps: [
      { title: 'how_buyer_1_title', text: 'how_buyer_1_text' },
      { title: 'how_buyer_2_title', text: 'how_buyer_2_text' },
      { title: 'how_buyer_3_title', text: 'how_buyer_3_text' },
    ],
    ctaLabel: 'home_all_cars',
    ctaPath: '/cars',
  },
  {
    title: 'how_seller_title',
    steps: [
      { title: 'how_seller_1_title', text: 'how_seller_1_text' },
      { title: 'how_seller_2_title', text: 'how_seller_2_text' },
      { title: 'how_seller_3_title', text: 'how_seller_3_text' },
    ],
    ctaLabel: 'home_hero_cta',
    ctaPath: '/sell',
    ctaPrimary: true,
  },
  {
    title: 'how_dealer_title',
    steps: [
      { title: 'how_dealer_1_title', text: 'how_dealer_1_text' },
      { title: 'how_dealer_2_title', text: 'how_dealer_2_text' },
      { title: 'how_dealer_3_title', text: 'how_dealer_3_text' },
    ],
    ctaLabel: 'dealers_cta',
    ctaPath: '/dealers',
  },
];

export default function HowItWorksPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  return (
    <>
      <SiteHeader locale={locale} pathname="/how-it-works" />

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('how_title')}</h1>
        <p className="mt-3 text-lg text-neutral-60">{t('how_lead')}</p>

        {SCENARIOS.map((scenario) => (
          <section key={scenario.title} className="mt-12">
            <h2 className="text-xl font-semibold">{t(scenario.title)}</h2>

            <ol className="mt-4 space-y-4">
              {scenario.steps.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  {/* Номер шага в круге. shrink-0 обязателен: без него
                      круг сжимается в овал, когда текст шага длинный. */}
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-brand-dark text-caption font-semibold text-white"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div>
                    {/* Номер дублируется текстом для скринридера:
                        визуальный кружок от него скрыт (aria-hidden). */}
                    <h3 className="font-semibold">
                      <span className="sr-only">
                        {t('how_step')} {i + 1}:{' '}
                      </span>
                      {t(step.title)}
                    </h3>
                    <p className="mt-1 leading-relaxed text-neutral-75">
                      {t(step.text)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-5">
              <Button
                variant={scenario.ctaPrimary ? 'primary' : 'secondary'}
                href={localeHref(locale, scenario.ctaPath)}
              >
                {t(scenario.ctaLabel)}
              </Button>
            </div>
          </section>
        ))}

        <Card className="mt-12 text-center">
          <h2 className="text-lg font-semibold">{t('faq_more_title')}</h2>
          <p className="mt-2 text-neutral-60">{t('faq_more_text')}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Button variant="secondary" href={localeHref(locale, '/faq')}>
              {t('nav_faq')}
            </Button>
            <Button variant="secondary" href={localeHref(locale, '/contact')}>
              {t('nav_contact')}
            </Button>
          </div>
        </Card>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
