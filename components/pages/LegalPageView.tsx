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

type Props = {
  locale: Locale;
  // Путь БЕЗ префикса локали: нужен шапке для переключателя языка.
  path: string;
  title: string;
  sections: LegalSection[];
};

export default function LegalPageView({
  locale,
  path,
  title,
  sections,
}: Props) {
  const t = getT(locale);

  return (
    <>
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
              </div>
            </section>
          ))}
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
