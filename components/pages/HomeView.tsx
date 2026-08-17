// ============================================================
// RS AUTO — Содержимое главной страницы, параметризованное локалью.
// ============================================================
// Один компонент обслуживает и / (sr), и /ru. Страницы в app/ остаются
// тонкими обёртками, которые только передают locale: иначе русская версия
// была бы копией сербской, и любая правка требовала бы двух одинаковых
// изменений в разных файлах.
// ============================================================

import Link from 'next/link';

import CarCard from '@/components/CarCard';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { fetchCatalog, fetchSiteBrands, fetchSiteStats } from '@/lib/queries';

export default async function HomeView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  const [fresh, rent, brands, stats] = await Promise.all([
    // Дефолтная сортировка 'fresh' — новые объявления первыми.
    fetchCatalog({ perPage: 8 }),
    // Витрина аренды на главной: раздел новый, и без неё пользователь
    // о нём не узнает.
    fetchCatalog({ perPage: 4, listingType: 'rent' }),
    fetchSiteBrands(),
    fetchSiteStats(),
  ]);

  return (
    <>
      <SmartBanner locale={locale} />
      <SiteHeader locale={locale} pathname="/" />

      <main>
        {/* Оффер продавцу — главный экран и единственный акцентный CTA. */}
        <section className="border-b border-black/10 bg-black/[0.02]">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
            <h1 className="max-w-2xl text-3xl font-bold sm:text-4xl">
              {t('home_hero_title')}
            </h1>
            <p className="mt-3 max-w-xl text-lg text-black/60">
              {t('home_hero_text')}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={localeHref(locale, '/sell')}
                className="rounded-control bg-brand-green px-6 py-3 font-semibold text-white"
              >
                {t('home_hero_cta')}
              </Link>
              <Link
                href={localeHref(locale, '/cars')}
                className="rounded-control border border-black/15 bg-white px-6 py-3 font-semibold"
              >
                {t('home_all_cars')}
              </Link>
            </div>

            {stats.cars_total > 0 && (
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm text-black/60">
                <span>
                  <strong className="text-brand-dark">{stats.cars_total}</strong>{' '}
                  {t('nav_catalog').toLowerCase()}
                </span>
                <span>
                  <strong className="text-brand-dark">{stats.brands_total}</strong>{' '}
                  {t('home_brands').toLowerCase()}
                </span>
                <span>
                  <strong className="text-brand-dark">{stats.cities_total}</strong>{' '}
                  {t('filter_city').toLowerCase()}
                </span>
              </div>
            )}
          </div>
        </section>

        {fresh.cars.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">{t('home_fresh')}</h2>
              <Link
                href={localeHref(locale, '/cars')}
                className="text-sm font-semibold text-brand-primary hover:underline"
              >
                {t('home_all_cars')} →
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {fresh.cars.map((car, i) => (
                <CarCard
                  key={car.id}
                  locale={locale}
                  car={car}
                  priority={i < 4}
                />
              ))}
            </div>
          </section>
        )}

        {rent.cars.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 pb-10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">{t('rent_title')}</h2>
              <Link
                href={localeHref(locale, '/rent')}
                className="text-sm font-semibold text-brand-primary hover:underline"
              >
                {t('nav_rent')} →
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {rent.cars.map((car) => (
                <CarCard
                  key={car.id}
                  locale={locale}
                  car={car}
                  mode="rent"
                />
              ))}
            </div>
          </section>
        )}

        {brands.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 pb-10">
            <h2 className="mb-4 text-xl font-semibold">{t('home_brands')}</h2>
            <div className="flex flex-wrap gap-2">
              {brands.slice(0, 24).map((b) => (
                <Link
                  key={b.brand_slug}
                  href={localeHref(locale, `/cars/${b.brand_slug}`)}
                  className="rounded-control border border-black/15 px-3 py-2 text-sm hover:bg-black/[0.03]"
                >
                  {b.brand}{' '}
                  <span className="text-black/40">({b.cars_count})</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Оффер дилерам — вторая аудитория продавцов. */}
        <section className="border-t border-black/10 bg-black/[0.02]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-10">
            <div>
              <h2 className="text-xl font-semibold">{t('dealers_title')}</h2>
              <p className="mt-1 text-black/60">{t('dealers_offer')}</p>
            </div>
            <Link
              href={localeHref(locale, '/dealers')}
              className="rounded-control bg-brand-dark px-5 py-3 font-semibold text-white"
            >
              {t('dealers_cta')}
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter locale={locale} brands={brands.slice(0, 12)} />
    </>
  );
}
