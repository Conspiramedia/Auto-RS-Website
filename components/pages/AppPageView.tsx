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
import type { DictKey } from '@/lib/i18n';
import { siteBaseUrl } from '@/lib/supabase';

// Преимущества приложения. Ключи словаря — по той же причине, что и
// выгоды на /dealers: тексты интерфейса живут в одном месте.
const FEATURES: { title: DictKey; text: DictKey }[] = [
  { title: 'app_feature_1_title', text: 'app_feature_1_text' },
  { title: 'app_feature_2_title', text: 'app_feature_2_text' },
  { title: 'app_feature_3_title', text: 'app_feature_3_text' },
];

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
            {FEATURES.map((f) => (
              <div key={f.title}>
                <h2 className="font-semibold">{t(f.title)}</h2>
                <p className="text-neutral-60">{t(f.text)}</p>
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
