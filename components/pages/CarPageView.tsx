// ============================================================
// RS AUTO — Содержимое карточки объявления, общее для sr и ru.
// ============================================================

import Link from 'next/link';
import { notFound } from 'next/navigation';

import AppQr from '@/components/AppQr';
import CarCard from '@/components/CarCard';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import CarGallery from '@/components/CarGallery';
import ShareButton from '@/components/ShareButton';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import SmartBanner from '@/components/SmartBanner';
import TrackCardView from '@/components/TrackCardView';
import {
  carTitle,
  formatDate,
  formatDeposit,
  formatMileage,
  formatPrice,
  formatRentPrice,
  labelBodyType,
  labelFuel,
  labelTransmission,
} from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import {
  fetchCarDetails,
  fetchCarImages,
  fetchSimilarCars,
} from '@/lib/queries';
import { buildBreadcrumbJsonLd, buildVehicleJsonLd } from '@/lib/seo';
import { siteBaseUrl } from '@/lib/supabase';

export default async function CarPageView({
  locale,
  id,
}: {
  locale: Locale;
  id: string;
}) {
  const t = getT(locale);

  const car = await fetchCarDetails(id);
  // RPC вернула пусто — объявление не существует либо недоступно публично
  // (модерация, отклонено, архив). В обоих случаях это 404.
  if (!car) notFound();

  // Фото и похожие грузятся параллельно: последовательные запросы удвоили
  // бы время ответа страницы.
  const [images, similar] = await Promise.all([
    fetchCarImages(id),
    fetchSimilarCars(id),
  ]);

  const title = carTitle(car);
  // Канонический адрес берём из БД (site_url) — это единая точка сборки
  // ссылки, совпадающая с тем, что отдаёт приложение при шаринге.
  const canonicalUrl = car.site_url || `${siteBaseUrl}/car/${id}`;

  const jsonLd = buildVehicleJsonLd({
    car,
    url: canonicalUrl,
    images: images.map((i) => i.image_url),
  });

  // Витрина, к которой относится объявление. Машина, выставленная только
  // в аренду, принадлежит разделу /rent — туда же ведут крошки и
  // переключатель в шапке. Для «и то и другое» считаем основной продажу.
  const mode: 'sale' | 'rent' = car.is_for_sale ? 'sale' : 'rent';
  const catalogPath = mode === 'rent' ? '/rent' : '/cars';
  const catalogLabel = mode === 'rent' ? t('rent_title') : t('nav_catalog');

  // Хлебные крошки для поиска. Повторяют ВИДИМУЮ навигацию страницы
  // (каталог → название объявления) — это требование Google: разметка
  // должна соответствовать тому, что видит посетитель.
  // Последний элемент — сама страница, поэтому его url канонический.
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    {
      name: catalogLabel,
      url: `${siteBaseUrl}${localeHref(locale, catalogPath)}`,
    },
    { name: title, url: canonicalUrl },
  ]);

  const specs = [
    { label: t('car_year'), value: String(car.year) },
    { label: t('car_mileage'), value: formatMileage(car.mileage, locale) },
    { label: t('car_body'), value: labelBodyType(car.body_type, locale) },
    {
      label: t('car_transmission'),
      value: labelTransmission(car.transmission, locale),
    },
    { label: t('car_fuel'), value: labelFuel(car.fuel, locale) },
    { label: t('car_city'), value: car.city },
  ];

  return (
    <>
      {/* JSON-LD: Vehicle + Offer (расширенный сниппет с ценой и
          пробегом) и BreadcrumbList (путь в выдаче вместо голого URL). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([jsonLd, breadcrumbJsonLd]),
        }}
      />

      {/* Отметка просмотра. Ничего не рендерит — только событие. */}
      <TrackCardView
        brand={car.brand}
        model={car.model}
        listingType={mode}
      />

      {/* На мобильных ведём в приложение по каноническому адресу: при
          установленном приложении App Link перехватит ссылку. */}
      <SmartBanner locale={locale} deepLink={canonicalUrl} />
      <SiteHeader locale={locale} pathname={`/car/${id}`} />

      <main className="mx-auto max-w-6xl px-4 py-6">
        <nav className="mb-4 text-sm text-neutral-50">
          <Link
            href={localeHref(locale, catalogPath)}
            className="hover:underline"
          >
            {catalogLabel}
          </Link>
          <span className="mx-1">/</span>
          <span>{title}</span>
        </nav>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div>
            <CarGallery images={images} alt={title} />

            <h1 className="mt-5 text-2xl font-bold">{title}</h1>

            {car.status === 'sold' && (
              // Бейдж на карточке крупнее, чем на плитке каталога:
              // здесь это ключевой факт об объявлении, а не пометка
              // поверх фотографии.
              <Badge
                tone="sold"
                className="mt-2 rounded-control px-3 py-1 text-sm"
              >
                {t('car_sold')}
              </Badge>
            )}

            <section className="mt-6">
              <h2 className="mb-3 text-lg font-semibold">{t('car_specs')}</h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {specs.map((s) => (
                  <div key={s.label}>
                    <dt className="text-sm text-neutral-50">{s.label}</dt>
                    <dd className="font-medium">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* Условия аренды — только у арендных объявлений. Отвечает на
                вопросы, которые иначе ушли бы в переписку: залог, срок,
                что входит. */}
            {car.is_for_rent && (
              <Card padding="none" className="mt-6 p-4">
                <h2 className="mb-3 text-lg font-semibold">{t('rent_terms')}</h2>

                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-sm text-neutral-50">{t('rent_price')}</dt>
                    <dd className="font-medium">
                      {formatRentPrice(
                        car.rent_price_daily,
                        car.currency,
                        locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-neutral-50">
                      {t('rent_deposit')}
                    </dt>
                    <dd className="font-medium">
                      {formatDeposit(car.deposit_amount, car.currency, locale)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-neutral-50">
                      {t('rent_min_period')}
                    </dt>
                    <dd className="font-medium">
                      {t('rent_min_period_value')}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-sm text-neutral-60">
                  {t('rent_terms_text')}
                </p>
              </Card>
            )}

            {car.description && (
              <section className="mt-6">
                <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold">
                  {t('car_description')}
                  {/* Описание — текст ПРОДАВЦА, а не строка интерфейса:
                      оно хранится в cars.description одним полем и на
                      сербском рынке пишется по-сербски. Машинно переводить
                      его нельзя (цена, состояние и условия сделки — не то,
                      что стоит доверять автопереводу), поэтому в русской
                      локали честно помечаем язык. В сербской пометка не
                      нужна: там текст и так на языке площадки. */}
                  {locale !== 'sr' && (
                    <span className="text-caption font-normal text-neutral-50">
                      · {t('car_description_original')}
                    </span>
                  )}
                </h2>
                {/* whitespace-pre-line сохраняет переносы строк, которые
                    продавец сделал при вводе описания. */}
                <p className="whitespace-pre-line text-neutral-80">
                  {car.description}
                </p>
              </section>
            )}

            <div className="mt-6 text-sm text-neutral-40">
              {t('car_published')}: {formatDate(car.created_at, locale)}
            </div>
          </div>

          {/* Правая колонка: цена и воронка в приложение. */}
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <Card padding="none" className="p-4">
              {/* Блок цен. У объявления может быть две цены сразу
                  (продажа и аренда) — тогда показываем обе, потому что
                  выбрать сделку должен пользователь, а не мы за него. */}
              {car.is_for_sale && (
                <div className="text-3xl font-bold text-brand-primary">
                  {formatPrice(car.sale_price, car.currency, locale)}
                </div>
              )}

              {car.is_for_rent && (
                <div className={car.is_for_sale ? 'mt-2' : ''}>
                  <div
                    className={
                      car.is_for_sale
                        ? 'text-xl font-semibold text-brand-blue'
                        : 'text-3xl font-bold text-brand-primary'
                    }
                  >
                    {formatRentPrice(
                      car.rent_price_daily,
                      car.currency,
                      locale,
                    )}
                  </div>
                  <div className="mt-1 text-sm text-neutral-60">
                    {t('rent_deposit')}:{' '}
                    {formatDeposit(car.deposit_amount, car.currency, locale)}
                  </div>
                </div>
              )}

              <div className="mt-4 border-t border-neutral-10 pt-4">
                <div className="text-sm text-neutral-50">{t('car_seller')}</div>
                <div className="font-semibold">{car.seller_name}</div>
                <div className="text-sm text-neutral-50">
                  {car.seller_kind === 'dealer'
                    ? t('car_seller_dealer')
                    : t('car_seller_private')}
                </div>
              </div>

              {/* Контакты продавца — только в приложении. Это осознанное
                  продуктовое решение: чат и звонки живут в приложении,
                  сайт работает как воронка в него. */}
              <div className="mt-4 border-t border-neutral-10 pt-4">
                <div className="font-semibold">{t('car_contact_title')}</div>
                <p className="mt-1 text-sm text-neutral-60">
                  {t('car_contact_text')}
                </p>

                {/* Внешняя ссылка (external): канонический адрес
                    перехватывается App Link на телефоне с установленным
                    приложением. Через next/link это не сработает —
                    клиентская навигация не отдаёт переход системе. */}
                <Button
                  href={canonicalUrl}
                  external
                  fullWidth
                  className="mt-3"
                >
                  {t('car_open_in_app')}
                </Button>

                <div className="mt-3">
                  <ShareButton locale={locale} url={canonicalUrl} title={title} />
                </div>
              </div>

              {/* QR — путь в приложение с десктопа, где смарт-баннера нет. */}
              <div className="mt-4 hidden border-t border-neutral-10 pt-4 lg:block">
                <AppQr url={canonicalUrl} />
                <p className="mt-2 text-xs text-neutral-50">{t('car_qr_hint')}</p>
              </div>
            </Card>
          </aside>
        </div>

        {similar.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-xl font-semibold">{t('car_similar')}</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {similar.map((s) => (
                <CarCard key={s.id} locale={locale} car={s} mode={mode} />
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
