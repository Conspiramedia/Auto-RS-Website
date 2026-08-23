// ============================================================
// RS AUTO — Страница /install: установка сайта на телефон (PWA).
// ============================================================
// Server Component: страница целиком статична — текст инструкции не
// зависит ни от сессии, ни от данных. Разметка общая для sr и ru.
//
// ЗАЧЕМ СТРАНИЦА. Приложения в сторах ещё нет (см. /app), но сайт
// ставится на домашний экран как приложение: manifest с
// display: standalone и иконками уже отдаётся (app/manifest.ts).
// Механизм рабочий, а найти его самому нельзя — он спрятан в меню
// браузера. Отсюда пошаговая инструкция.
//
// ПОЧЕМУ ИНСТРУКЦИЯ, А НЕ КНОПКА «УСТАНОВИТЬ». Программная установка
// возможна только в Chrome и только через событие beforeinstallprompt,
// которого нет ни в Safari, ни в браузерах iOS вообще. Кнопка,
// работающая на половине устройств, хуже текста, работающего на всех.
//
// noindex: страница служебная и содержит инструкцию к нашему сайту,
// а не ответ на поисковый запрос. В выдаче она только оттягивала бы
// клики с каталога.
// ============================================================

import Card from '@/components/ui/Card';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

// Платформы и их шаги. Массивом, а не разметкой по месту: два блока
// отличаются только текстом, и копия разметки разъехалась бы при
// первой же правке — ровно так разъезжались карточки до StateCard.
const PLATFORMS: { title: DictKey; steps: DictKey[] }[] = [
  {
    title: 'install_android_title',
    steps: [
      'install_android_1',
      'install_android_2',
      'install_android_3',
      'install_android_4',
    ],
  },
  {
    title: 'install_ios_title',
    steps: ['install_ios_1', 'install_ios_2', 'install_ios_3', 'install_ios_4'],
  },
];

export default function InstallPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  return (
    <>
      <SiteHeader locale={locale} pathname="/install" />

      {/* max-w-3xl — та же колонка, что у /how-it-works: страница
          читается сверху вниз, и широкая строка на десктопе утомляет. */}
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <h1 className="text-h2 font-bold sm:text-h1">{t('install_title')}</h1>
        <p className="mt-3 text-h4 text-neutral-60">{t('install_lead')}</p>

        {/* Две карточки. На узком экране — одна под другой, с 768px
            рядом: инструкции независимы, и человек читает только свою,
            а на десктопе видно сразу обе — так проще понять, что твоя
            платформа не забыта. */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {PLATFORMS.map((platform) => (
            <Card key={platform.title}>
              <h2 className="text-h4 font-semibold">{t(platform.title)}</h2>

              <ol className="mt-4 space-y-4">
                {platform.steps.map((step, i) => (
                  <li key={step} className="flex gap-3">
                    {/* Номер шага в круге — тот же приём, что на
                        /how-it-works. shrink-0 обязателен: без него
                        круг сжимается в овал, когда текст длинный. */}
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-brand-dark text-caption font-semibold text-white"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    {/* Номер продублирован текстом для скринридера:
                        визуальный кружок от него скрыт (aria-hidden). */}
                    <p className="pt-1 leading-relaxed text-neutral-75">
                      <span className="sr-only">
                        {t('install_step')} {i + 1}:{' '}
                      </span>
                      {t(step)}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
