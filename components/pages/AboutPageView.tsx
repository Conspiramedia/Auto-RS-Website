// ============================================================
// RS AUTO — Содержимое страницы /about, общее для sr и ru.
// ============================================================
// Страница доверия: объясняет, кто стоит за площадкой и почему ей
// можно пользоваться. Выгоды разложены по трём ролям — покупатель,
// продавец, автосалон, — потому что у каждой из них свой вопрос
// «а мне это зачем».
// ============================================================

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

// Три блока «как устроена площадка». Ключи, а не готовый текст:
// строки живут в dict и переводятся вместе со всем интерфейсом.
const HOW_BLOCKS: { title: DictKey; text: DictKey }[] = [
  { title: 'about_how_1_title', text: 'about_how_1_text' },
  { title: 'about_how_2_title', text: 'about_how_2_text' },
  { title: 'about_how_3_title', text: 'about_how_3_text' },
];

// Выгоды по ролям.
const AUDIENCES: { title: DictKey; items: DictKey[] }[] = [
  {
    title: 'about_buyer_title',
    items: ['about_buyer_1', 'about_buyer_2', 'about_buyer_3', 'about_buyer_4'],
  },
  {
    title: 'about_seller_title',
    items: [
      'about_seller_1',
      'about_seller_2',
      'about_seller_3',
      'about_seller_4',
    ],
  },
  {
    title: 'about_dealer_title',
    items: [
      'about_dealer_1',
      'about_dealer_2',
      'about_dealer_3',
      'about_dealer_4',
    ],
  },
];

export default function AboutPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  return (
    <>
      <SiteHeader locale={locale} pathname="/about" />

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('about_title')}</h1>
        <p className="mt-3 text-lg text-neutral-60">{t('about_lead')}</p>

        {/* Задача площадки. Отдельным блоком и первым: это ответ на
            вопрос «зачем вы вообще нужны», а не список функций. */}
        <section className="mt-10">
          <h2 className="text-xl font-semibold">{t('about_mission_title')}</h2>
          <p className="mt-3 leading-relaxed text-neutral-75">
            {t('about_mission_text')}
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">{t('about_how_title')}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {HOW_BLOCKS.map((block) => (
              <Card key={block.title} padding="sm">
                <h3 className="font-semibold">{t(block.title)}</h3>
                <p className="mt-1 text-caption text-neutral-60">
                  {t(block.text)}
                </p>
              </Card>
            ))}
          </div>
        </section>

        {/* Выгоды по ролям. */}
        {AUDIENCES.map((audience) => (
          <section key={audience.title} className="mt-10">
            <h2 className="text-xl font-semibold">{t(audience.title)}</h2>
            <ul className="mt-3 space-y-2">
              {audience.items.map((item) => (
                <li key={item} className="flex gap-2 text-neutral-75">
                  {/* Маркер — не list-style, а отдельный элемент:
                      так он выравнивается по первой строке при переносе
                      длинного пункта. */}
                  <span aria-hidden="true" className="text-brand-green">
                    •
                  </span>
                  <span>{t(item)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <Card className="mt-10 text-center">
          <h2 className="text-xl font-semibold">{t('about_cta_title')}</h2>
          <p className="mt-2 text-neutral-60">{t('about_cta_text')}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" href={localeHref(locale, '/sell')}>
              {t('home_hero_cta')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              href={localeHref(locale, '/how-it-works')}
            >
              {t('nav_how')}
            </Button>
          </div>
        </Card>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
