// ============================================================
// RS AUTO — Витрина продавца /dealer/{id}, общая для sr и ru.
// ============================================================
// Server Component: страница обязана быть в индексе — салон приводит
// десятки объявлений, и его витрина сама по себе целевая посадочная
// страница по запросу «<название салона> Beograd».
//
// Одна страница обслуживает и АВТОСАЛОН, и ЧАСТНОГО продавца: RPC
// get_dealer_profile возвращает для них одинаковую структуру, отличаясь
// только display_name (название компании либо имя) и logo_url. Заводить
// два роута ради разной подписи было бы дублированием.
//
// JSON-LD AutoDealer отдаётся ТОЛЬКО для салонов: у частного лица
// разметка организации была бы неверной — он не компания.
// ============================================================

import { notFound } from 'next/navigation';
import Image from 'next/image';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import CarCard from '@/components/CarCard';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import { formatDate } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { fetchDealerProfile, fetchSellerListings } from '@/lib/queries';
import { buildBreadcrumbJsonLd } from '@/lib/seo';
import { siteBaseUrl } from '@/lib/supabase';

export default async function DealerPageView({
  locale,
  id,
}: {
  locale: Locale;
  id: string;
}) {
  const t = getT(locale);

  const profile = await fetchDealerProfile(id);
  // Профиля нет — продавец удалён или адрес неверен. 404, а не пустая
  // страница: несуществующая витрина не должна попадать в индекс.
  if (!profile) notFound();

  // Активные объявления и недавно проданные грузятся параллельно.
  const [active, sold] = await Promise.all([
    fetchSellerListings(id, 'active', 24),
    fetchSellerListings(id, 'sold', 8),
  ]);

  const isDealer = profile.seller_kind === 'dealer';
  const pageUrl = `${siteBaseUrl}${localeHref(locale, `/dealer/${id}`)}`;

  // Разметка организации — только для салона (см. шапку файла).
  const dealerJsonLd = isDealer
    ? {
        '@context': 'https://schema.org',
        '@type': 'AutoDealer',
        name: profile.display_name,
        url: pageUrl,
        ...(profile.logo_url ? { logo: profile.logo_url } : {}),
        // Страна обслуживания: площадка работает по Сербии.
        areaServed: 'RS',
        // Число активных объявлений — честный признак масштаба салона.
        makesOffer: active.slice(0, 10).map((car) => ({
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Car',
            name: `${car.brand} ${car.model}, ${car.year}`,
          },
          url: car.site_url,
        })),
      }
    : null;

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    {
      name: t('nav_catalog'),
      url: `${siteBaseUrl}${localeHref(locale, '/cars')}`,
    },
    { name: profile.display_name, url: pageUrl },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            dealerJsonLd ? [dealerJsonLd, breadcrumbJsonLd] : [breadcrumbJsonLd],
          ),
        }}
      />

      <SmartBanner locale={locale} />
      <SiteHeader locale={locale} pathname={`/dealer/${id}`} />

      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* Шапка витрины: логотип/аватар, имя и счётчики. */}
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* Логотип салона. Когда его нет — инициал в круге: пустой
              квадрат выглядел бы как незагрузившаяся картинка. */}
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-card bg-surface-muted">
            {profile.logo_url || profile.avatar_url ? (
              <Image
                src={(profile.logo_url || profile.avatar_url) as string}
                alt={profile.display_name}
                fill
                sizes="80px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-2xl font-bold text-neutral-30">
                {profile.display_name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{profile.display_name}</h1>
            <p className="mt-1 text-caption text-neutral-50">
              {isDealer ? t('car_seller_dealer') : t('car_seller_private')}
              {' · '}
              {t('dealer_page_since')} {formatDate(profile.member_since, locale)}
            </p>

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-caption text-neutral-60">
              <span>
                <strong className="text-brand-dark">
                  {profile.active_cars}
                </strong>{' '}
                {t('dealer_page_active')}
              </span>
              {profile.sold_cars > 0 && (
                <span>
                  <strong className="text-brand-dark">
                    {profile.sold_cars}
                  </strong>{' '}
                  {t('dealer_page_sold')}
                </span>
              )}
            </div>
          </div>
        </Card>

        {/* Витрина. Пустая — не тупик: даём выход в общий каталог. */}
        {active.length === 0 ? (
          <Card padding="none" className="mt-6 px-6 py-12 text-center">
            <h2 className="text-xl font-semibold">
              {t('dealer_page_empty_title')}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-neutral-60">
              {t('dealer_page_empty_text')}
            </p>
            <div className="mt-6">
              <Button
                variant="secondary"
                size="sm"
                href={localeHref(locale, '/cars')}
              >
                {t('nf_catalog')}
              </Button>
            </div>
          </Card>
        ) : (
          <section className="mt-8">
            <h2 className="text-xl font-semibold">
              {t('dealer_page_listings')}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {active.map((car, i) => (
                <CarCard
                  key={car.id}
                  locale={locale}
                  car={car}
                  mode="both"
                  priority={i < 4}
                />
              ))}
            </div>
          </section>
        )}

        {/* Недавно проданное. Социальное доказательство: салон, у
            которого покупают, вызывает больше доверия, чем просто
            список объявлений. */}
        {sold.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold">
              {t('dealer_page_sold_title')}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {sold.map((car) => (
                <CarCard key={car.id} locale={locale} car={car} mode="both" />
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
