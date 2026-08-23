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

import InstallGuide from '@/components/InstallGuide';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

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

        {/* Карточки вынесены в клиентский InstallGuide: он подсвечивает
            платформу посетителя и поднимает её карточку наверх. Текст
            и порядок шагов живут там же — разметка одна на обе. */}
        <InstallGuide locale={locale} />
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
