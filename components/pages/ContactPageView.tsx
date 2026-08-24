// ============================================================
// RS AUTO — Содержимое страницы /contact, общее для sr и ru.
// ============================================================
// Страница обязательная, а не витринная: на неё ссылаются разделы
// «Контакты» в условиях использования и политике конфиденциальности.
// Юридический документ, отсылающий к странице, которой нет, — дефект
// самого документа, а не сайта.
//
// Реквизиты берутся из lib/legal (OPERATOR) — того же источника, что и
// тексты документов. Незаполненные регистрационные данные НЕ печатаются
// заглушками: посетитель не должен видеть «PIB: [номер]».
// ============================================================

import Link from 'next/link';

import ContactForm from '@/components/ContactForm';
import BackCloseButton from '@/components/BackCloseButton';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { OPERATOR, OPERATOR_VERIFIED } from '@/lib/legal';
import { buildOrganizationJsonLd, buildPageJsonLd } from '@/lib/seo';

export default function ContactPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  // ContactPage со способами связи. contactPoint дописывается к базовой
  // разметке страницы: именно он даёт поисковику почту и телефон
  // поддержки в машиночитаемом виде.
  //
  // Телефон и адрес подставляются, только если заполнены в lib/legal:
  // пустая строка в разметке означала бы, что контакта не существует.
  const pageJsonLd = {
    ...buildPageJsonLd({
      type: 'ContactPage',
      locale,
      path: '/contact',
      name: t('contact_title'),
      description: t('meta_contact_desc'),
    }),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: OPERATOR.email,
      ...(OPERATOR.phone ? { telephone: OPERATOR.phone } : {}),
      areaServed: 'RS',
      availableLanguage: ['sr', 'ru'],
    },
  };

  // Organization рядом с ContactPage. Раньше её здесь не было, и
  // получалось противоречие: страница контактов — главный машиночитаемый
  // источник реквизитов на сайте, но само юридическое лицо с логотипом
  // и наименованием разметка называла только на главной и на /about.
  // Поисковик, пришедший на /contact по запросу «RS Auto контакти»,
  // видел контактные данные, не связанные ни с какой организацией.
  //
  // Дубля с /about не возникает: Organization описывает одну и ту же
  // сущность с одинаковым url — так поисковик и склеивает упоминания в
  // одну карточку компании, а не плодит несколько.
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

      <SiteHeader locale={locale} pathname="/contact" />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {/* Заголовок и крестик в одну строку. Крестик уводит назад -
            на эти страницы приходят из бургер-меню с любого раздела,
            и возврат по истории точнее любого фиксированного адреса.
            items-start: заголовок на узком экране занимает две строки,
            и крестик обязан остаться у верхнего края.
            -mr-2 втягивает область 40px в поле бокового отступа. */}
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-h2 font-bold sm:text-h1">{t('contact_title')}</h1>
          <BackCloseButton locale={locale} className="-mr-2 shrink-0" />
        </div>
        <p className="mt-2 max-w-xl text-neutral-60">{t('contact_subtitle')}</p>

        {/* Реквизиты и способы связи. Идут ПЕРЕД формой: человеку,
            которому нужен просто адрес почты, не следует пролистывать
            ради него всю форму. */}
        <section className="mt-8 rounded-card border border-neutral-10 p-4 sm:p-6">
          <h2 className="text-h3 font-semibold">{t('contact_details')}</h2>

          <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-caption text-neutral-50">{t('contact_details')}</dt>
              <dd className="font-medium">{OPERATOR.legalName}</dd>
            </div>

            <div>
              <dt className="text-caption text-neutral-50">{t('contact_email')}</dt>
              <dd className="font-medium">
                <a
                  href={`mailto:${OPERATOR.email}`}
                  className="text-brand-blue hover:underline"
                >
                  {OPERATOR.email}
                </a>
              </dd>
            </div>

            {/* Телефон выводится только когда задан: пустая строка
                «Телефон поддержки: —» выглядит как неработающий сервис. */}
            {OPERATOR.phone && (
              <div>
                <dt className="text-caption text-neutral-50">{t('contact_phone')}</dt>
                <dd className="font-medium">
                  <a
                    href={`tel:${OPERATOR.phone.replace(/\s/g, '')}`}
                    className="text-brand-blue hover:underline"
                  >
                    {OPERATOR.phone}
                  </a>
                </dd>
              </div>
            )}

            <div>
              <dt className="text-caption text-neutral-50">{t('contact_hours')}</dt>
              <dd className="font-medium">{t('contact_hours_value')}</dd>
            </div>

            {/* Регистрационные данные — единым блоком и только после
                заполнения (см. OPERATOR_VERIFIED в lib/legal). */}
            {OPERATOR_VERIFIED && (
              <>
                <div>
                  <dt className="text-caption text-neutral-50">
                    {t('contact_address')}
                  </dt>
                  <dd className="font-medium">{OPERATOR.address}</dd>
                </div>
                <div>
                  <dt className="text-caption text-neutral-50">MB / PIB</dt>
                  <dd className="font-medium">
                    {OPERATOR.registrationNumber} / {OPERATOR.taxNumber}
                  </dd>
                </div>
              </>
            )}
          </dl>

          {/* Автосалоны уводим на свою страницу: там оффер и форма,
              рассчитанная на их сценарий, — иначе заявки салонов
              попадут в общую поддержку и потеряются. */}
          <p className="mt-5 border-t border-neutral-10 pt-4 text-caption text-neutral-60">
            {t('contact_dealers_hint')}{' '}
            <Link
              href={localeHref(locale, '/dealers')}
              className="font-semibold text-brand-blue hover:underline"
            >
              {t('nav_dealers')}
            </Link>
          </p>
        </section>

        <div className="mt-6">
          <ContactForm locale={locale} />
        </div>

        {/* Ссылки на документы: раздел «Контакты» в них ведёт сюда,
            обратный путь тоже должен существовать. */}
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-caption text-neutral-50">
          <Link href={localeHref(locale, '/terms')} className="hover:underline">
            {t('legal_terms_title')}
          </Link>
          <Link
            href={localeHref(locale, '/privacy')}
            className="hover:underline"
          >
            {t('legal_privacy_title')}
          </Link>
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
