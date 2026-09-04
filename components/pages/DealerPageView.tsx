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
//
// ------------------------------------------------------------
// ПАГИНАЦИЯ ВИТРИНЫ
// ------------------------------------------------------------
// Раньше здесь стоял жёсткий лимит 24 без всякой навигации, и
// двадцать пятая машина салона не показывалась НИГДЕ: ни на витрине,
// ни ссылкой из неё. При этом sitemap (get_site_dealers, 0072)
// специально сортирует салоны по числу активных объявлений — то есть
// система рассчитана на крупные автопарки и сама же их обрезала.
//
// Общее число страниц берётся из profile.active_cars, а НЕ из второго
// запроса с count: get_dealer_profile (0043) уже считает активные
// объявления подзапросом, и страница его уже получила. Просить у базы
// то же число второй раз значило бы платить за него дважды.
//
// «Недавно продано» остаётся без пагинации с лимитом 8 намеренно: это
// социальное доказательство («у этого салона покупают»), а не витрина.
// Восьми карточек для него достаточно, а вторая навигация на странице
// спорила бы с первой за смысл слова «страница».
// ============================================================

import { notFound } from 'next/navigation';
import Image from 'next/image';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import StateCard from '@/components/ui/StateCard';
import CarCard from '@/components/CarCard';
import DealerShowcaseTitleBar from '@/components/DealerShowcaseTitleBar';
import DealerShowcaseHero from '@/components/DealerShowcaseHero';
import PagerLinks, { PagerHeadLinks } from '@/components/PagerLinks';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import { formatDate } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { fetchDealerProfile, fetchSellerListings } from '@/lib/queries';
import { buildBreadcrumbJsonLd } from '@/lib/seo';
import { siteBaseUrl } from '@/lib/supabase';

// Объявлений на страницу витрины. 24 — прежний жёсткий лимит: он
// кратен всем трём сеткам (2/3/4 колонки), поэтому последний ряд
// заполнен на любом брейкпоинте.
const PER_PAGE = 24;

export default async function DealerPageView({
  locale,
  id,
  page = 1,
}: {
  locale: Locale;
  id: string;
  // Номер страницы витрины. Разбирается в роуте: мусор в адресе
  // (?page=abc) уже превращён в 1.
  page?: number;
}) {
  const t = getT(locale);

  const profile = await fetchDealerProfile(id);
  // Профиля нет — продавец удалён или адрес неверен. 404, а не пустая
  // страница: несуществующая витрина не должна попадать в индекс.
  if (!profile) notFound();

  const totalPages = Math.max(1, Math.ceil(profile.active_cars / PER_PAGE));
  // Запрошенную страницу прижимаем к существующим. Страница за
  // пределами набора отдала бы пустую витрину у салона, у которого
  // машины есть, — и такой адрес мог бы уйти в индекс.
  const safePage = Math.min(Math.max(page, 1), totalPages);

  // Активные объявления и недавно проданные грузятся параллельно.
  const [active, sold] = await Promise.all([
    fetchSellerListings(id, 'active', PER_PAGE, (safePage - 1) * PER_PAGE),
    fetchSellerListings(id, 'sold', 8),
  ]);

  const isDealer = profile.seller_kind === 'dealer';
  const basePath = `/dealer/${id}`;
  // Адрес САМОГО САЛОНА — всегда первая страница витрины, без ?page.
  // Организация одна на все страницы, и подставлять сюда адрес второй
  // означало бы объявить поисковику, что на /dealer/x?page=2 живёт
  // отдельная компания.
  const pageUrl = `${siteBaseUrl}${localeHref(locale, basePath)}`;

  // Разметка организации — только для салона (см. шапку файла).
  // Отдаётся ТОЛЬКО НА ПЕРВОЙ СТРАНИЦЕ: на второй тот же самый блок с
  // тем же url описывал бы организацию повторно, а makesOffer при
  // этом перечислял бы уже другие машины. Один салон — одна карточка
  // организации в разметке.
  const dealerJsonLd =
    isDealer && safePage === 1
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
            // Адрес текущей локали, а не car.site_url из БД: тот всегда
            // сербский, и на /ru/dealer/{id} витрина перечисляла бы
            // машины по сербским адресам (см. CarPageView).
            url: `${siteBaseUrl}${localeHref(locale, `/car/${car.id}`)}`,
          })),
        }
      : null;

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    // Корень цепочки — главная (см. пояснение в BrandPageView).
    { name: t('nav_home'), url: `${siteBaseUrl}${localeHref(locale, '/')}` },
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

      {/* rel=prev/next для страниц витрины. См. PagerLinks. */}
      <PagerHeadLinks
        locale={locale}
        basePath={basePath}
        page={safePage}
        totalPages={totalPages}
        baseUrl={siteBaseUrl}
      />

      <SiteHeader locale={locale} pathname={basePath} />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {/* Строка «Автосалон N» с крестиком. Видна ВСЕМ: текст
            нейтрален, личного в нём ничего нет, поэтому компонент
            серверный и спокойно кэшируется вместе со страницей.
            Разбор — в шапке DealerShowcaseTitleBar.

            Частному продавцу не показывается: «Автосалон Иван» было
            бы неправдой, а называть человека продавцом в шапке его же
            страницы незачем — имя стоит на карточке ниже. */}
        {isDealer && (
          <DealerShowcaseTitleBar
            locale={locale}
            name={profile.display_name}
          />
        )}

        {/* ШАПКА ВИТРИНЫ — баннер с обложкой, как плитка в каталоге.
            Покупатель попадает сюда кликом по этой самой плитке, и
            общая раскладка продолжает переход, а не заменяет его
            другим экраном. Разбор — в шапке DealerShowcaseHero.

            ЧАСТНОМУ ПРОДАВЦУ БАННЕР НЕ ПОКАЗЫВАЕМ. Обложка, слоган и
            часы работы — поля компании; у человека их нет и быть не
            должно, а пустой фирменный градиент с одним именем выглядел
            бы как страница салона без витрины. Для частника остаётся
            прежняя компактная карточка. */}
        {isDealer ? (
          <DealerShowcaseHero profile={profile} />
        ) : (
          <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {/* Аватар продавца. Когда его нет — инициал: пустой
                квадрат выглядел бы как незагрузившаяся картинка. */}
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-card bg-surface-muted">
              {profile.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt={profile.display_name}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-h2 font-bold text-neutral-30">
                  {profile.display_name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-h2 font-bold sm:text-h1">
                {profile.display_name}
              </h1>
              <p className="mt-1 text-caption text-neutral-50">
                {t('car_seller_private')}
                {' · '}
                {t('dealer_page_since')}{' '}
                {formatDate(profile.member_since, locale)}
              </p>
            </div>
          </Card>
        )}

        {/* Витрина. Пустая — не тупик: даём выход в общий каталог. */}
        {active.length === 0 ? (
          <StateCard
            locale={locale}
            className="mt-6"
            title={t('dealer_page_empty_title')}
            text={t('dealer_page_empty_text')}
            actions={
              <Button
                variant="secondary"
                size="sm"
                href={localeHref(locale, '/cars')}
              >
                {t('nf_catalog')}
              </Button>
            }
          />
        ) : (
          <section className="mt-8">
            <h2 className="text-h3 font-semibold">
              {t('dealer_page_listings')}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
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

            <PagerLinks
              locale={locale}
              basePath={basePath}
              page={safePage}
              totalPages={totalPages}
            />
          </section>
        )}

        {/* Недавно проданное. Социальное доказательство: салон, у
            которого покупают, вызывает больше доверия, чем просто
            список объявлений. Показывается на КАЖДОЙ странице витрины,
            а не только на первой: это не продолжение списка активных,
            а отдельный довод в пользу салона, и на второй странице он
            нужен ровно так же. */}
        {sold.length > 0 && (
          <section className="mt-10">
            <h2 className="text-h3 font-semibold">
              {t('dealer_page_sold_title')}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
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
