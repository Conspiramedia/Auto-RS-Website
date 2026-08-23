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

import BackCloseButton from '@/components/BackCloseButton';
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

      {/* Отступы 16px по бокам и сверху, 32px снизу — как
          EdgeInsets.fromLTRB(16, 16, 16, 32) у ListView в приложении.
          max-w-3xl ограничивает колонку на десктопе: экран приложения
          рассчитан на телефон, и растянутая на 1280px строка шага
          читалась бы иначе, чем задумано. */}
      <main className="mx-auto max-w-3xl px-4 pb-8 pt-4">
        {/* Заголовок и выход в одну строку — как AppBar в приложении,
            где эту роль играет стрелка «назад». Крестик прижат к
            правому краю колонки; -mr-2 втягивает его кликабельную
            область 40px в поле бокового отступа, иначе знак стоял бы
            заметно левее края. */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[17px] font-semibold text-neutral-100">
            {t('install_title')}
          </h1>

          <BackCloseButton locale={locale} className="-mr-2 shrink-0" />
        </div>

        {/* Карточки вынесены в клиентский InstallGuide: он подсвечивает
            платформу посетителя и поднимает её карточку наверх. Текст
            и порядок шагов живут там же — разметка одна на обе. */}
        <InstallGuide locale={locale} />
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
