// ============================================================
// RS AUTO — Содержимое страницы /app, общее для sr и ru.
// ============================================================

import AppQr from '@/components/AppQr';
import AppWaitlist from '@/components/AppWaitlist';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import { brand } from '@/lib/brand';
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

      <main className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
        <h1 className="text-h2 font-bold sm:text-h1">{brand.name}</h1>
        <p className="mt-2 max-w-xl text-h4 text-neutral-60">
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

            {/* Вместо бейджей сторов — заглушка с подпиской на релиз.
                Кнопки вели в никуда: приложение не опубликовано, ссылка
                на Google Play отдавала 404, а ссылка на App Store —
                поиск по названию. Вернуть их нужно будет ровно здесь,
                когда appIds.ios.appStoreId перестанет быть пустым. */}
            <AppWaitlist locale={locale} />
          </div>

          <div className="hidden text-center sm:block">
            <AppQr url={siteBaseUrl} size={160} />
            {/* Подпись своя, а не car_qr_hint: тот обещает открыть
                объявление В ПРИЛОЖЕНИИ, и на странице, которая сообщает,
                что приложения пока нет, это противоречие. Код ведёт на
                сам сайт (siteBaseUrl) — так и написано. */}
            <p className="mt-2 max-w-[180px] text-small text-neutral-50">
              {t('app_soon_qr')}
            </p>
          </div>
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
