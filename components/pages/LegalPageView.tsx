// ============================================================
// RS AUTO — Страница юридического документа (условия / политика).
// ============================================================
// Один компонент на оба документа и обе локали: отличаются только
// заголовок и массив разделов, а разметка, шапка и подвал общие.
//
// Документ рендерится структурой (h2 + p), а не одной строкой: текст
// длинный, и с телефона «простыня» нечитаема. Разделы приходят из
// lib/legal — там же лежат исходные формулировки приложения.
// ============================================================

import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { LegalSection } from '@/lib/legal';
import { POLICY_UPDATED, POLICY_VERSION } from '@/lib/legal';
import { buildPageJsonLd } from '@/lib/seo';

type Props = {
  locale: Locale;
  // Путь БЕЗ префикса локали: нужен шапке для переключателя языка.
  path: string;
  title: string;
  // Описание документа для разметки. То же значение, что уходит в
  // <meta name="description"> страницы: разметка и сниппет обязаны
  // описывать документ одинаково.
  description: string;
  sections: LegalSection[];
};

export default function LegalPageView({
  locale,
  path,
  title,
  description,
  sections,
}: Props) {
  const t = getT(locale);

  // Разметка WebPage. Тот же хелпер, что на /about, /dealers и
  // /how-it-works: publisher связывает документ с оператором площадки,
  // без него поисковик не знает, чьи это условия.
  //
  // WebPage, а не более узкий тип: у schema.org нет подходящей схемы
  // для пользовательского соглашения, а натягивать Article на
  // юридический документ значило бы объявить его публикацией с автором
  // и датой выхода.
  const jsonLd = buildPageJsonLd({
    type: 'WebPage',
    locale,
    path,
    name: title,
    description,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <SiteHeader locale={locale} pathname={path} />

      {/* max-w-3xl: длина строки для сплошного текста. На каталожной
          ширине (6xl) юридический документ читать невозможно. */}
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <h1 className="text-h2 font-bold sm:text-h1">{title}</h1>

        <p className="mt-2 text-caption text-neutral-50">
          {t('legal_updated')}: {POLICY_UPDATED[locale]} • {POLICY_VERSION}
        </p>

        <div className="mt-6 space-y-6">
          {sections.map((section, i) => (
            <section key={section.heading ?? `intro-${i}`}>
              {section.heading && (
                <h2 className="mb-3 text-h3 font-semibold">
                  {section.heading}
                </h2>
              )}
              <div className="space-y-3">
                {section.paragraphs.map((p, j) => (
                  <p key={j} className="leading-relaxed text-neutral-75">
                    {p}
                  </p>
                ))}

                {/* Почта — отдельным абзацем ссылкой, а не строкой в
                    paragraphs: документ читают преимущественно с
                    телефона, и по неактивному адресу оттуда написать
                    нельзя. Подпись локализуется, сам адрес — нет. */}
                {section.email && (
                  <p className="leading-relaxed text-neutral-75">
                    {t('contact_email')}:{' '}
                    <a
                      href={`mailto:${section.email}`}
                      className="text-brand-blue hover:underline"
                    >
                      {section.email}
                    </a>
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
