// ============================================================
// RS AUTO — Содержимое страницы подачи /sell, общее для sr и ru.
// ============================================================
// Над формой стоит короткий список шагов подачи. Он здесь не ради
// украшения: страница несёт разметку HowTo, а Google требует, чтобы
// шаги в разметке совпадали с ВИДИМЫМ текстом страницы. Разметка без
// видимого списка — ошибка структурированных данных, и сниппет с
// шагами за неё не даётся.
//
// Шаги берутся из общего модуля (lib/scenarios), того же, что рендерит
// /how-it-works: второй копии формулировок в проекте нет.
// ============================================================

import SellForm from '@/components/SellForm';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { SELLER_SCENARIO } from '@/lib/scenarios';
import { buildHowToJsonLd } from '@/lib/seo';

export default function SellPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  const scenario = SELLER_SCENARIO;

  // Разметка пошаговой инструкции. Собирается из того же массива, что
  // отрисован ниже, — иначе она разошлась бы с видимым текстом.
  const howToJsonLd = scenario
    ? buildHowToJsonLd({
        locale,
        path: '/sell',
        name: t('sell_title'),
        description: t('meta_sell_desc'),
        steps: scenario.steps.map((step) => ({
          name: t(step.title),
          text: t(step.text),
        })),
      })
    : null;

  return (
    <>
      {howToJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
        />
      )}

      <SiteHeader locale={locale} pathname="/sell" />

      {/* max-w-3xl на десктопе вместо 2xl: форма подачи получила парные
          поля (марка+модель, цена+пробег), и на 672px две колонки
          становятся слишком узкими для пикеров со списком.
          Шире 768px не идём — поля ввода во всю ширину экрана читаются
          плохо, а форма остаётся линейным сценарием, а не панелью. */}
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-8 lg:max-w-3xl">
        <h1 className="text-h2 font-bold sm:text-h1">{t('sell_title')}</h1>
        <p className="mt-2 text-neutral-60">{t('sell_subtitle')}</p>

        {/* Шаги подачи — ОДНОЙ СТРОКОЙ НА ШАГ, без абзацев пояснений,
            которые стоят на /how-it-works. Здесь человек пришёл
            заполнять форму, и разворачивать перед ней инструкцию на
            пол-экрана значило бы отодвинуть само действие за сгиб:
            нужен ориентир «что дальше», а не пересказ страницы «как это
            работает».

            Разметка ol/li, а не набор div: это пронумерованная
            последовательность, и скринридер обязан прочитать её как
            список из трёх пунктов. */}
        {scenario && (
          <ol className="mt-6 space-y-2">
            {scenario.steps.map((step, i) => (
              <li key={step.title} className="flex items-center gap-3">
                {/* Тот же светлый круг с тёмной цифрой, что у шагов на
                    /how-it-works и /install: рисунок номера шага на
                    сайте один. Размер 24px — список здесь плотный.
                    shrink-0 обязателен, иначе круг сжимается в овал
                    рядом с длинной подписью. */}
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-surface-muted text-caption font-bold text-neutral-100"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="text-neutral-75">
                  {/* Номер дублируется текстом для скринридера:
                      визуальный кружок от него скрыт. */}
                  <span className="sr-only">
                    {t('how_step')} {i + 1}:{' '}
                  </span>
                  {t(step.title)}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-6">
          <SellForm locale={locale} />
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
