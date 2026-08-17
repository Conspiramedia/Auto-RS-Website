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
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { OPERATOR, OPERATOR_VERIFIED } from '@/lib/legal';

export default function ContactPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  return (
    <>
      <SiteHeader locale={locale} pathname="/contact" />

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('contact_title')}</h1>
        <p className="mt-2 max-w-xl text-neutral-60">{t('contact_subtitle')}</p>

        {/* Реквизиты и способы связи. Идут ПЕРЕД формой: человеку,
            которому нужен просто адрес почты, не следует пролистывать
            ради него всю форму. */}
        <section className="mt-8 rounded-card border border-neutral-10 p-4 sm:p-6">
          <h2 className="text-lg font-semibold">{t('contact_details')}</h2>

          <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-neutral-50">{t('contact_details')}</dt>
              <dd className="font-medium">{OPERATOR.legalName}</dd>
            </div>

            <div>
              <dt className="text-sm text-neutral-50">{t('contact_email')}</dt>
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
                <dt className="text-sm text-neutral-50">{t('contact_phone')}</dt>
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
              <dt className="text-sm text-neutral-50">{t('contact_hours')}</dt>
              <dd className="font-medium">{t('contact_hours_value')}</dd>
            </div>

            {/* Регистрационные данные — единым блоком и только после
                заполнения (см. OPERATOR_VERIFIED в lib/legal). */}
            {OPERATOR_VERIFIED && (
              <>
                <div>
                  <dt className="text-sm text-neutral-50">
                    {t('contact_address')}
                  </dt>
                  <dd className="font-medium">{OPERATOR.address}</dd>
                </div>
                <div>
                  <dt className="text-sm text-neutral-50">MB / PIB</dt>
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
          <p className="mt-5 border-t border-neutral-10 pt-4 text-sm text-neutral-60">
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
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-50">
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
