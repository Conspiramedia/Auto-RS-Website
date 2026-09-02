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

import Image from 'next/image';

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

        {/* ИЛЛЮСТРАЦИЯ ПОД ЛИДОМ — как на /about и /how-it-works.
            ------------------------------------------------------------
            Дальше идёт длинная лента вопросов в раскрывающихся
            строках: страница без единого изображения выглядит
            справочником, в который заходят по необходимости, а не
            разделом, который читают.

            Кадр про срок публикации: календарь со стрелкой обновления
            над машиной. Тема сквозная для всех четырёх групп вопросов
            — сколько объявление висит и как его продлить, — поэтому
            уместна над лентой целиком, а не внутри одной из групп.

            priority не ставится: выше стоят заголовок и лид, ранняя
            загрузка отняла бы полосу у них. Область зарезервирована
            через aspect + fill, подгрузка не сдвигает список вопросов.

            Пропорции 16/10 на узком экране и 21/9 с sm: страница
            max-w-3xl, и высокий кадр во всю ширину отодвинул бы первый
            вопрос за сгиб.

            Пустой alt: изображение декоративное, смысл несут заголовок
            и сами вопросы. */}
        <div className="relative mt-6 aspect-[16/10] overflow-hidden rounded-card sm:aspect-[21/9]">
          <Image
            src="/images/faq-listing-term.webp"
            alt=""
            fill
            sizes="(max-width: 639px) calc(100vw - 2rem), 48rem"
            className="object-cover"
          />
        </div>

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
          {/* КНОПКА ВО ВСЮ ШИРИНУ ДО sm — как в такой же карточке на
              /how-it-works и /about. На узком экране кнопка по
              содержимому висит коротким прямоугольником посреди
              карточки, и блок выглядит незаконченным.

              Здесь она одна, поэтому хватает w-full на самой кнопке:
              сетка с [&>*]:w-full нужна была там, где кнопок две и их
              требуется уравнять между собой.

              С sm ширина возвращается к содержимому: страница
              max-w-3xl, и растянутая кнопка читалась бы как поле
              ввода. По центру её держит text-center у карточки. */}
          <div className="mt-5">
            <Button
              variant="secondary"
              href={localeHref(locale, '/contact')}
              className="w-full sm:w-auto"
            >
              {t('nav_contact')}
            </Button>
          </div>
        </Card>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
