// ============================================================
// RS AUTO — Содержимое страницы /faq, общее для sr и ru.
// ============================================================
// Вопросы сгруппированы по ролям (общее / покупателям / продавцам /
// автосалонам): человек ищет свой раздел, а не читает 12 пунктов подряд.
//
// Разметка на <details>, а НЕ на React-состоянии. Причины две:
//   1. работает без JS — важно и для краулера, и для медленной сети;
//   2. текст ответа присутствует в HTML всегда, даже когда пункт
//      свёрнут, поэтому попадает в индекс. Аккордеон, подгружающий
//      ответ по клику, для SEO бесполезен.
// ============================================================

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import BackCloseButton from '@/components/BackCloseButton';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import { FAQ, FAQ_GROUPS, buildFaqJsonLd, type FaqGroup } from '@/lib/faq';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

// Подпись группы в словаре.
const GROUP_LABEL: Record<FaqGroup, DictKey> = {
  general: 'faq_group_general',
  buyer: 'faq_group_buyer',
  seller: 'faq_group_seller',
  dealer: 'faq_group_dealer',
};

export default function FaqPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const items = FAQ[locale];

  // Разметка строится из ТОГО ЖЕ массива, что и видимый текст, —
  // требование Google: содержимое FAQPage обязано совпадать с тем,
  // что видит посетитель.
  const jsonLd = buildFaqJsonLd(items);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <SiteHeader locale={locale} pathname="/faq" />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {/* Заголовок и крестик в одну строку. Крестик уводит назад -
            на эти страницы приходят из бургер-меню с любого раздела,
            и возврат по истории точнее любого фиксированного адреса.
            items-start: заголовок на узком экране занимает две строки,
            и крестик обязан остаться у верхнего края.
            -mr-2 втягивает область 40px в поле бокового отступа. */}
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-h2 font-bold sm:text-h1">{t('faq_title')}</h1>
          <BackCloseButton locale={locale} className="-mr-2 shrink-0" />
        </div>
        <p className="mt-3 text-neutral-60">{t('faq_lead')}</p>

        {FAQ_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;

          return (
            <section key={group} className="mt-10">
              <h2 className="text-h3 font-semibold">{t(GROUP_LABEL[group])}</h2>

              <div className="mt-4 divide-y divide-neutral-10 border-y border-neutral-10">
                {groupItems.map((item) => (
                  <details key={item.question} className="group py-4">
                    <summary className="flex cursor-pointer items-start justify-between gap-4 font-medium marker:content-['']">
                      {item.question}
                      {/* Указатель раскрытия. Поворачивается через
                          group-open — состояние <details> без скрипта. */}
                      <span
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-neutral-40 transition-transform duration-fast ease-out group-open:rotate-180"
                      >
                        ▾
                      </span>
                    </summary>
                    <p className="mt-3 leading-relaxed text-neutral-75">
                      {item.answer}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          );
        })}

        <Card className="mt-10 text-center">
          <h2 className="text-h3 font-semibold">{t('faq_more_title')}</h2>
          <p className="mt-2 text-neutral-60">{t('faq_more_text')}</p>
          <div className="mt-5">
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
