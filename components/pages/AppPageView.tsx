// ============================================================
// RS AUTO — Содержимое страницы /app, общее для sr и ru.
// ============================================================

import AppQr from '@/components/AppQr';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import { appIds, brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { siteBaseUrl } from '@/lib/supabase';

// Преимущества приложения. Тексты специфичны для этой страницы.
const FEATURES: Record<Locale, { title: string; text: string }[]> = {
  sr: [
    {
      title: 'Poruke i pozivi',
      text: 'Kontaktirajte prodavca direktno — bez deljenja ličnog broja.',
    },
    {
      title: 'Obaveštenja',
      text: 'Sačuvajte pretragu i saznajte prvi kada se pojavi odgovarajući automobil.',
    },
    {
      title: 'Sniženja cena',
      text: 'Obavestićemo vas kada prodavac snizi cenu automobila koji pratite.',
    },
  ],
  ru: [
    {
      title: 'Сообщения и звонки',
      text: 'Свяжитесь с продавцом напрямую — не раскрывая личный номер.',
    },
    {
      title: 'Уведомления',
      text: 'Сохраните поиск и узнайте первым, когда появится подходящий автомобиль.',
    },
    {
      title: 'Снижение цены',
      text: 'Сообщим, когда продавец снизит цену на отслеживаемый автомобиль.',
    },
  ],
};

export default function AppPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  return (
    <>
      <SmartBanner locale={locale} />
      <SiteHeader locale={locale} pathname="/app" />

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-bold">{brand.name}</h1>
        <p className="mt-2 max-w-xl text-lg text-neutral-60">
          {t('site_tagline')}
        </p>

        <div className="mt-8 grid gap-8 sm:grid-cols-[1fr_auto]">
          <div className="space-y-5">
            {FEATURES[locale].map((f) => (
              <div key={f.title}>
                <h2 className="font-semibold">{f.title}</h2>
                <p className="text-neutral-60">{f.text}</p>
              </div>
            ))}

            {/* Бейджи сторов. Приложение ещё не опубликовано: пока числового
                ID нет, ссылка ведёт на поиск по названию — битых ссылок
                на сайте быть не должно. */}
            <div className="flex flex-wrap gap-3 pt-2">
              <a
                href={`https://play.google.com/store/apps/details?id=${appIds.android.packageName}`}
                className="rounded-control bg-brand-dark px-5 py-3 font-semibold text-white"
                rel="nofollow"
              >
                Google Play
              </a>
              <a
                href={
                  appIds.ios.appStoreId
                    ? `https://apps.apple.com/app/id${appIds.ios.appStoreId}`
                    : 'https://apps.apple.com/search?term=RS%20Auto'
                }
                className="rounded-control bg-brand-dark px-5 py-3 font-semibold text-white"
                rel="nofollow"
              >
                App Store
              </a>
            </div>
          </div>

          <div className="hidden text-center sm:block">
            <AppQr url={siteBaseUrl} size={160} />
            <p className="mt-2 max-w-[180px] text-xs text-neutral-50">
              {t('car_qr_hint')}
            </p>
          </div>
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
