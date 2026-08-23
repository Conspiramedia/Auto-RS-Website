// ============================================================
// RS AUTO — Содержимое карточки объявления, общее для sr и ru.
// ============================================================

import Link from 'next/link';
import { notFound } from 'next/navigation';

import AppQr from '@/components/AppQr';
import CarCard from '@/components/CarCard';
import CarGoneView from '@/components/pages/CarGoneView';
import RecentlyViewed from '@/components/RecentlyViewed';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import CarGallery from '@/components/CarGallery';
import GalleryCloseButton from '@/components/GalleryCloseButton';
import ContactSellerButton from '@/components/ContactSellerButton';
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
  // RPC вернула пусто — объявления с таким id не существует вовсе.
  // Только это теперь 404: снятые с публикации RPC отдаёт (0072).
  if (!car) notFound();

  // ---------- Снятое с публикации ----------
  // Объявление в архиве, отклонённое или ушедшее на перепроверку после
  // правки. Раньше RPC не отдавала такие посторонним и страница
  // уходила в 404 — а ссылка из выдачи Google живёт ещё недели после
  // снятия, и человек попадал в пустоту.
  //
  // Теперь отдаётся урезанная карточка (без цен, описания, контактов и
  // витрины продавца — их обнуляет сама RPC), и мы показываем экран
  // «объявление снято» с подборкой похожих.
  //
  // ВЛАДЕЛЬЦА И АДМИНА сюда НЕ уводим: им RPC возвращает объявление
  // целиком, и они должны видеть обычную карточку — иначе продавец не
  // смог бы посмотреть, как выглядит его объявление на проверке.
  // Признак полноты — наличие витрины продавца: посторонним
  // seller_name приходит пустым.
  const withdrawn =
    car.status !== 'active' && car.status !== 'sold' && !car.seller_name;

  if (withdrawn) {
    return <CarGoneView locale={locale} car={car} />;
  }

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

      {/* Отметка просмотра: событие аналитики и запись в историю.
          Ничего не рендерит. */}
      <TrackCardView
        car={{
          id: car.id,
          brand: car.brand,
          model: car.model,
          year: car.year,
          mileage: car.mileage,
          currency: car.currency,
          sale_price: car.sale_price,
          rent_price_daily: car.rent_price_daily,
          is_for_sale: car.is_for_sale,
          is_for_rent: car.is_for_rent,
          city: car.city,
          photo_url: images[0]?.image_url ?? null,
        }}
        listingType={mode}
      />

      {/* На мобильных ведём в приложение по каноническому адресу: при
          установленном приложении App Link перехватит ссылку. */}
      <SmartBanner locale={locale} deepLink={canonicalUrl} />
      <SiteHeader locale={locale} pathname={`/car/${id}`} />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <nav className="mb-4 text-caption text-neutral-50">
          <Link
            href={localeHref(locale, catalogPath)}
            className="hover:underline"
          >
            {catalogLabel}
          </Link>
          <span className="mx-1">/</span>
          <span>{title}</span>
        </nav>

        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div>
            {/* Обёртка нужна ради позиционирования крестика: сама
                галерея прокручивает миниатюры и не должна отвечать
                за слой поверх кадра. */}
            <div className="relative">
              <CarGallery images={images} alt={title} />
              <GalleryCloseButton locale={locale} fallbackPath={catalogPath} />
            </div>

            <h1 className="mt-5 text-h2 font-bold sm:text-h1">{title}</h1>

            {car.status === 'sold' && (
              // Бейдж на карточке крупнее, чем на плитке каталога:
              // здесь это ключевой факт об объявлении, а не пометка
              // поверх фотографии.
              <Badge tone="sold" size="md" className="mt-2">
                {t('car_sold')}
              </Badge>
            )}

            <section className="mt-6">
              <h2 className="mb-3 text-h3 font-semibold">{t('car_specs')}</h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {specs.map((s) => (
                  <div key={s.label}>
                    <dt className="text-caption text-neutral-50">{s.label}</dt>
                    <dd className="font-medium">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* Условия аренды — только у арендных объявлений. Отвечает на
                вопросы, которые иначе ушли бы в переписку: залог, срок,
                что входит. */}
            {car.is_for_rent && (
              <Card padding="lg" className="mt-6">
                <h2 className="mb-3 text-h3 font-semibold">{t('rent_terms')}</h2>

                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-caption text-neutral-50">{t('rent_price')}</dt>
                    <dd className="font-medium">
                      {formatRentPrice(
                        car.rent_price_daily,
                        car.currency,
                        locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-caption text-neutral-50">
                      {t('rent_deposit')}
                    </dt>
                    <dd className="font-medium">
                      {formatDeposit(car.deposit_amount, car.currency, locale)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-caption text-neutral-50">
                      {t('rent_min_period')}
                    </dt>
                    <dd className="font-medium">
                      {t('rent_min_period_value')}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-caption text-neutral-60">
                  {t('rent_terms_text')}
                </p>
              </Card>
            )}

            {car.description && (
              <section className="mt-6">
                <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-h3 font-semibold">
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

            <div className="mt-6 text-caption text-neutral-60">
              {t('car_published')}: {formatDate(car.created_at, locale)}
            </div>
          </div>

          {/* Правая колонка: цена и воронка в приложение. */}
          <aside className="md:sticky md:top-20 md:self-start">
            <Card padding="lg">
              {/* Блок цен. У объявления может быть две цены сразу
                  (продажа и аренда) — тогда показываем обе, потому что
                  выбрать сделку должен пользователь, а не мы за него. */}
              {car.is_for_sale && (
                <div className="text-h1 font-bold text-brand-primary">
                  {formatPrice(car.sale_price, car.currency, locale)}
                </div>
              )}

              {car.is_for_rent && (
                <div className={car.is_for_sale ? 'mt-2' : ''}>
                  <div
                    className={
                      car.is_for_sale
                        ? 'text-h3 font-semibold text-brand-blue'
                        : 'text-h1 font-bold text-brand-primary'
                    }
                  >
                    {formatRentPrice(
                      car.rent_price_daily,
                      car.currency,
                      locale,
                    )}
                  </div>
                  <div className="mt-1 text-caption text-neutral-60">
                    {t('rent_deposit')}:{' '}
                    {formatDeposit(car.deposit_amount, car.currency, locale)}
                  </div>
                </div>
              )}

              <div className="mt-4 border-t border-neutral-10 pt-4">
                <div className="text-caption text-neutral-50">{t('car_seller')}</div>
                {/* Имя продавца ведёт на его витрину: у салона там весь
                    автопарк, и это заметно увеличивает глубину просмотра.
                    Ссылка нужна и краулеру — иначе страницы /dealer/{id}
                    не имели бы ни одной входящей ссылки с сайта. */}
                <Link
                  href={localeHref(locale, `/dealer/${car.user_id}`)}
                  className="font-semibold hover:text-brand-primary hover:underline"
                >
                  {car.seller_name}
                </Link>
                <div className="text-caption text-neutral-50">
                  {car.seller_kind === 'dealer'
                    ? t('car_seller_dealer')
                    : t('car_seller_private')}
                </div>
              </div>

              {/* Связь с продавцом. Переписка работает НА САЙТЕ: это
                  требование web-first — сценарий не должен упираться в
                  установку приложения. Раньше здесь стояла кнопка
                  «Продолжить в приложении», и покупатель без него не мог
                  написать вовсе.
                  Кнопка клиентская: сама решает, показать вход гостю,
                  открыть диалог покупателю или скрыться у владельца. */}
              <div className="mt-4 border-t border-neutral-10 pt-4">
                <div className="font-semibold">{t('car_contact_title')}</div>

                <ContactSellerButton
                  locale={locale}
                  carId={car.id}
                  sellerId={car.user_id}
                />

                <div className="mt-3">
                  <ShareButton locale={locale} url={canonicalUrl} title={title} />
                </div>
              </div>

              {/* QR — путь в приложение с десктопа, где смарт-баннера нет. */}
              <div className="mt-4 hidden border-t border-neutral-10 pt-4 lg:block">
                <AppQr url={canonicalUrl} />
                <p className="mt-2 text-small text-neutral-50">{t('car_qr_hint')}</p>
              </div>
            </Card>
          </aside>
        </div>

        {similar.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-h3 font-semibold">{t('car_similar')}</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {similar.map((s) => (
                <CarCard key={s.id} locale={locale} car={s} mode={mode} />
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Недавно просмотренные. Текущее объявление исключается: ссылка
          на страницу, где человек находится, бесполезна. Блок вне
          <main> — он не часть содержимого этой страницы, а навигация
          по личной истории. */}
      <RecentlyViewed locale={locale} excludeId={car.id} />

      <SiteFooter locale={locale} />
    </>
  );
}
