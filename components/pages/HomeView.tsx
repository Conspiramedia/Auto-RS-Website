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
import RecentlyViewed from '@/components/RecentlyViewed';
import Button from '@/components/ui/Button';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { nounFor } from '@/lib/plural';
import { fetchCatalog, fetchSiteBrands, fetchSiteStats } from '@/lib/queries';
import { OPERATOR, OPERATOR_VERIFIED } from '@/lib/legal';
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from '@/lib/seo';

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

  // Разметка организации и сайта. Реквизиты — из lib/legal, того же
  // источника, что и юридические документы со страницей /contact.
  const orgJsonLd = buildOrganizationJsonLd({
    legalName: OPERATOR.legalName,
    email: OPERATOR.email,
    phone: OPERATOR.phone || undefined,
    address: OPERATOR_VERIFIED ? OPERATOR.address : undefined,
  });

  const siteJsonLd = buildWebSiteJsonLd(locale);

  return (
    <>
      {/* Organization и WebSite отдаются одним блоком-массивом: это
          допустимая форма для JSON-LD и она короче двух отдельных
          <script>, которые пришлось бы держать синхронными. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([orgJsonLd, siteJsonLd]),
        }}
      />

      <SmartBanner locale={locale} />
      <SiteHeader locale={locale} pathname="/" />

      <main>
        {/* Оффер продавцу — главный экран и единственный акцентный CTA. */}
        <section className="border-b border-neutral-10 bg-surface-subtle">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
            <h1 className="max-w-2xl text-h1 font-bold sm:text-display">
              {t('home_hero_title')}
            </h1>
            <p className="mt-3 max-w-xl text-h4 text-neutral-60">
              {t('home_hero_text')}
            </p>

            {/* Парные CTA — одного размера и одинаковой ширины.
                На мобильном это вертикальный стек во всю ширину: две
                кнопки разной ширины друг под другом выглядят как ошибка
                вёрстки. На десктопе они встают в ряд, и ширину задаёт
                более длинная подпись (basis-0 + flex-1 внутри
                ограниченного контейнера), поэтому обе равны. */}
            <div className="mt-6 flex max-w-md flex-col gap-3 sm:flex-row">
              <Button
                size="xl"
                href={localeHref(locale, '/sell')}
                className="sm:flex-1"
                fullWidth
              >
                {t('home_hero_cta')}
              </Button>
              {/* Герой лежит на серой подложке, поэтому вторичная кнопка
                  здесь белая, а не прозрачная: на bg-surface-subtle
                  контурная кнопка без заливки теряется. */}
              {/* «Все автомобили» ведут на /all — смешанную витрину, а не
                  на /cars: там продажа, и подпись обещала бы больше, чем
                  показывает страница. Обе ссылки с этой подписью
                  (здесь и над свежими объявлениями) идут в одно место.
                  rel=nofollow — витрина служебная и закрыта от
                  индексации, краулеру идти по ссылке незачем. */}
              <Button
                variant="secondary"
                size="xl"
                href={localeHref(locale, '/all')}
                rel="nofollow"
                className="sm:flex-1"
                fullWidth
              >
                {t('home_all_cars')}
              </Button>
            </div>

            {/* Подписи склоняются по числу: «29 автомобилей», но
                «21 автомобиль» и «11 городов». Раньше сюда подставлялись
                названия разделов меню («Автомобили», «Город»), из-за чего
                получалось «11 город». */}
            {stats.cars_total > 0 && (
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-caption text-neutral-60">
                <span>
                  <strong className="text-brand-dark">{stats.cars_total}</strong>{' '}
                  {nounFor(stats.cars_total, 'car', locale)}
                </span>
                <span>
                  <strong className="text-brand-dark">{stats.brands_total}</strong>{' '}
                  {nounFor(stats.brands_total, 'brand', locale)}
                </span>
                <span>
                  <strong className="text-brand-dark">{stats.cities_total}</strong>{' '}
                  {nounFor(stats.cities_total, 'city', locale)}
                </span>
              </div>
            )}
          </div>
        </section>

        {fresh.cars.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-h3 font-semibold">{t('home_fresh')}</h2>
              {/* Тот же адрес, что у кнопки в герое: одна подпись —
                  одно назначение. */}
              <Link
                href={localeHref(locale, '/all')}
                rel="nofollow"
                className="text-caption font-semibold text-brand-primary hover:underline"
              >
                {t('home_all_cars')} →
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
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
              <h2 className="text-h3 font-semibold">{t('rent_title')}</h2>
              <Link
                href={localeHref(locale, '/rent')}
                className="text-caption font-semibold text-brand-primary hover:underline"
              >
                {t('nav_rent')} →
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
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
            <h2 className="mb-4 text-h3 font-semibold">{t('home_brands')}</h2>
            <div className="flex flex-wrap gap-2">
              {brands.slice(0, 24).map((b) => (
                // Ярлык марки остаётся обычной ссылкой, а не Chip:
                // у чипса свой вес (font-medium) и запрет переноса, а
                // здесь список из 24 названий должен переноситься и не
                // выделяться жирным. Подгонять Chip под этот случай
                // означало бы размыть сам паттерн.
                <Link
                  key={b.brand_slug}
                  href={localeHref(locale, `/cars/${b.brand_slug}`)}
                  className="rounded-control border border-neutral-15 px-3 py-2 text-caption hover:bg-surface-hover"
                >
                  {b.brand}{' '}
                  <span className="text-neutral-40">({b.cars_count})</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Недавно просмотренные. Рендерится только у тех, кто уже
            открывал объявления, — у нового посетителя блок пуст и
            не появляется вовсе. */}
        <RecentlyViewed locale={locale} />

        {/* Оффер дилерам — вторая аудитория продавцов. */}
        <section className="border-t border-neutral-10 bg-surface-subtle">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-10">
            <div>
              <h2 className="text-h3 font-semibold">{t('dealers_title')}</h2>
              <p className="mt-1 text-neutral-60">{t('dealers_offer')}</p>
            </div>
            <Button
              variant="dark"
              size="lg"
              href={localeHref(locale, '/dealers')}
            >
              {t('dealers_cta')}
            </Button>
          </div>
        </section>
      </main>

      <SiteFooter locale={locale} brands={brands.slice(0, 12)} />
    </>
  );
}
