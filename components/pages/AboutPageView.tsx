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
import BackCloseButton from '@/components/BackCloseButton';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { OPERATOR, OPERATOR_VERIFIED } from '@/lib/legal';
import { buildOrganizationJsonLd, buildPageJsonLd } from '@/lib/seo';

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

  // AboutPage + Organization. Страница отвечает на вопрос «кто стоит за
  // площадкой», и разметка обязана отвечать на него машиночитаемо:
  // без Organization поисковик не связывает сайт с юридическим лицом.
  //
  // Реквизиты — из lib/legal, того же источника, что тексты документов
  // и страница /contact. Незаполненный адрес не подставляется: разметка
  // с пустым полем хуже разметки без него (см. buildOrganizationJsonLd).
  const pageJsonLd = buildPageJsonLd({
    type: 'AboutPage',
    locale,
    path: '/about',
    name: t('about_title'),
    description: t('about_meta_desc'),
  });

  const orgJsonLd = buildOrganizationJsonLd({
    legalName: OPERATOR.legalName,
    email: OPERATOR.email,
    phone: OPERATOR.phone || undefined,
    address: OPERATOR_VERIFIED ? OPERATOR.address : undefined,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([pageJsonLd, orgJsonLd]),
        }}
      />

      <SiteHeader locale={locale} pathname="/about" />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {/* Заголовок и крестик в одну строку. Крестик уводит назад -
            на эти страницы приходят из бургер-меню с любого раздела,
            и возврат по истории точнее любого фиксированного адреса.
            items-start: заголовок на узком экране занимает две строки,
            и крестик обязан остаться у верхнего края.
            -mr-2 втягивает область 40px в поле бокового отступа. */}
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-h2 font-bold sm:text-h1">{t('about_title')}</h1>
          <BackCloseButton locale={locale} className="-mr-2 shrink-0" />
        </div>
        <p className="mt-3 text-h4 text-neutral-60">{t('about_lead')}</p>

        {/* Задача площадки. Отдельным блоком и первым: это ответ на
            вопрос «зачем вы вообще нужны», а не список функций. */}
        <section className="mt-10">
          <h2 className="text-h3 font-semibold">{t('about_mission_title')}</h2>
          <p className="mt-3 leading-relaxed text-neutral-75">
            {t('about_mission_text')}
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-h3 font-semibold">{t('about_how_title')}</h2>
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
            <h2 className="text-h3 font-semibold">{t(audience.title)}</h2>
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
          <h2 className="text-h3 font-semibold">{t('about_cta_title')}</h2>
          <p className="mt-2 text-neutral-60">{t('about_cta_text')}</p>
          {/* grid, а НЕ inline-grid. С inline-grid контейнер сжимался
              по содержимому, и [&>*]:w-full растягивал кнопки лишь до
              ширины самой длинной подписи — на узком экране они стояли
              двумя узкими прямоугольниками посреди карточки, разной
              длины с текстом внутри. Блочный grid занимает всю ширину
              карточки, и кнопки растягиваются вместе с ним.

              С sm раскладка прежняя: ряд по содержимому, по центру.
              Растянутая на 48rem кнопка читалась бы как поле ввода, а
              не как действие. */}
          <div className="mt-5 grid grid-cols-1 gap-3 [&>*]:w-full sm:[&>*]:w-auto sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
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
