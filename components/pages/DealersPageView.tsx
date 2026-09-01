// ============================================================
// RS AUTO — Содержимое страницы /dealers, общее для sr и ru.
// ============================================================

import DealerForm from '@/components/DealerForm';
import BackCloseButton from '@/components/BackCloseButton';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import Card from '@/components/ui/Card';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { DictKey } from '@/lib/i18n';
import { buildPageJsonLd } from '@/lib/seo';

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

  // Тип — WebPage, а НЕ CollectionPage с ItemList салонов, хотя в
  // задаче значился он. Причина в содержимом: /dealers — предложение
  // автосалонам с формой заявки, списка салонов на ней нет. ItemList
  // описывал бы то, чего на странице не существует, и Google
  // отклоняет разметку, не совпадающую с видимым содержимым.
  //
  // Витрины отдельных салонов размечены на своих страницах
  // (/dealer/{id} → AutoDealer, см. DealerPageView) и попадают в
  // sitemap оттуда.
  const jsonLd = buildPageJsonLd({
    type: 'WebPage',
    locale,
    path: '/dealers',
    name: t('dealers_title'),
    description: t('meta_dealers_desc'),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <SiteHeader locale={locale} pathname="/dealers" />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        {/* Заголовок и крестик в одну строку. Крестик уводит назад -
            на эти страницы приходят из бургер-меню с любого раздела,
            и возврат по истории точнее любого фиксированного адреса.
            items-start: заголовок на узком экране занимает две строки,
            и крестик обязан остаться у верхнего края.
            -mr-2 втягивает область 40px в поле бокового отступа. */}
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-h2 font-bold sm:text-h1">{t('dealers_title')}</h1>
          <BackCloseButton locale={locale} className="-mr-2 shrink-0" />
        </div>
        {/* Оффер в две строки: первая называет ценность, вторая
            снимает вопрос цены. Ценность выделена весом, а не
            цветом: зелёный на странице принадлежит кнопке заявки,
            и второе зелёное пятно спорило бы с ней за клик. */}
        <p className="mt-2 text-h3 font-semibold">
          {t('dealers_offer')}
        </p>
        <p className="mt-1 text-neutral-60">{t('dealers_offer_note')}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {BENEFITS.map((b) => (
            <Card key={b.title} padding="lg">
              <h2 className="font-semibold">{t(b.title)}</h2>
              <p className="mt-1 text-caption text-neutral-60">{t(b.text)}</p>
            </Card>
          ))}
        </div>

        {/* Форма ограничена по ширине отдельно от контейнера страницы:
            блоки преимуществ выигрывают от широкой сетки, а поля ввода
            во всю ширину 1152px читаются плохо — глаз теряет начало
            следующей строки. */}
        <div className="mt-8 max-w-2xl">
          <DealerForm locale={locale} />
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
