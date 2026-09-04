// ============================================================
// RS AUTO — Содержимое карточки объявления, общее для sr и ru.
// ============================================================

import Link from 'next/link';
import { notFound } from 'next/navigation';

import AppQr from '@/components/AppQr';
import FavoriteButton from '@/components/FavoriteButton';
import CarCard from '@/components/CarCard';
import CarGoneView from '@/components/pages/CarGoneView';
import RecentlyViewed from '@/components/RecentlyViewed';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import CarGallery from '@/components/CarGallery';
import GalleryCloseButton from '@/components/GalleryCloseButton';
import CallSellerButton from '@/components/CallSellerButton';
import ContactBlockTitle from '@/components/ContactBlockTitle';
import ContactSellerButton from '@/components/ContactSellerButton';
import ShareButton from '@/components/ShareButton';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import TrackCardView from '@/components/TrackCardView';
import {
  carTitle,
  formatDate,
  formatDeposit,
  formatEngineVolume,
  formatMileage,
  formatPrice,
  formatRentPrice,
  formatYear,
  labelBodyType,
  labelFuel,
  labelTransmission,
} from '@/lib/format';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { conditionStyle } from '@/lib/types';
import ConditionBadge from '@/components/ui/ConditionBadge';
import { ConditionIcon } from '@/components/ui/ConditionIcons';
import {
  fetchCarDetails,
  fetchCarImages,
  fetchSimilarCars,
} from '@/lib/queries';
import {
  buildBreadcrumbJsonLd,
  buildItemListJsonLd,
  buildVehicleJsonLd,
} from '@/lib/seo';
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
  // Адрес страницы для разметки — ТЕКУЩЕЙ ЛОКАЛИ, а не из БД.
  //
  // Раньше здесь стоял car.site_url. Он собран базой (f_car_site_url) и
  // всегда сербский: на /ru/car/{id} разметка Vehicle, Offer и
  // последняя крошка BreadcrumbList объявляли объект по адресу
  // https://rsauto.rs/car/{id} — то есть русская страница описывала
  // сама себя чужим адресом, расходясь с собственным canonical в
  // <head> (тот self-canonical, см. lib/seo.ts).
  //
  // Для сербского зеркала значение то же самое, что и раньше, — это
  // ровно тот адрес, который отдаёт f_car_site_url.
  const canonicalUrl = `${siteBaseUrl}${localeHref(locale, `/car/${id}`)}`;

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

  // ПОЯСНЕНИЕ К СОСТОЯНИЮ (0138). Считается здесь, а не в разметке:
  // ниже оно нужно одним условием, и городить в JSX два вызова подряд
  // (стиль и текст) незачем.
  //
  // null у обычной машины, у неизвестного значения и у проданного:
  // у последнего состояние уже ни на что не влияет — та же логика,
  // что у бейджей доступности и состояния возле цены.
  const conditionNoteStyle =
    car.status !== 'sold' ? conditionStyle(car.condition) : null;
  const conditionNote = conditionNoteStyle
    ? {
        surface: conditionNoteStyle.surface,
        // Ключ собирается по имени состояния; набор закрыт
        // (condition_note_damaged … condition_note_for_export), и
        // conditionStyle выше уже отсеял всё, чего в нём нет.
        text: t(`condition_note_${car.condition}` as DictKey),
      }
    : null;

  // Хлебные крошки для поиска. Повторяют ВИДИМУЮ навигацию страницы
  // (каталог → название объявления) — это требование Google: разметка
  // должна соответствовать тому, что видит посетитель.
  // Последний элемент — сама страница, поэтому его url канонический.
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    // Корень цепочки — главная (см. пояснение в BrandPageView).
    { name: t('nav_home'), url: `${siteBaseUrl}${localeHref(locale, '/')}` },
    {
      name: catalogLabel,
      url: `${siteBaseUrl}${localeHref(locale, catalogPath)}`,
    },
    { name: title, url: canonicalUrl },
  ]);

  // Похожие объявления как ItemList: тот же механизм, что на витринах
  // каталога (CatalogView). Блок — полноценный список товаров, и без
  // разметки поисковик видит в нём просто набор ссылок.
  const similarJsonLd =
    similar.length > 0
      ? buildItemListJsonLd({
          items: similar.map((s) => ({
            name: `${s.brand} ${s.model}, ${s.year}`,
            url: `${siteBaseUrl}${localeHref(locale, `/car/${s.id}`)}`,
          })),
        })
      : null;

  const specs = [
    { label: t('car_year'), value: formatYear(car.year) },
    { label: t('car_mileage'), value: formatMileage(car.mileage, locale) },
    { label: t('car_body'), value: labelBodyType(car.body_type, locale) },
    {
      label: t('car_transmission'),
      value: labelTransmission(car.transmission, locale),
    },
    { label: t('car_fuel'), value: labelFuel(car.fuel, locale) },
    // Объём показываем ТОЛЬКО когда он есть: у электромобиля ДВС
    // нет, и прочерк в этой строке выглядел бы как недозаполненное
    // объявление, а не как «двигателя не существует».
    ...(car.engine_volume != null
      ? [
          {
            label: t('car_engine'),
            value: formatEngineVolume(car.engine_volume, locale),
          },
        ]
      : []),
    { label: t('car_city'), value: car.city },
  ];

  return (
    <>
      {/* JSON-LD: Vehicle + Offer (расширенный сниппет с ценой и
          пробегом) и BreadcrumbList (путь в выдаче вместо голого URL). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            similarJsonLd
              ? [jsonLd, breadcrumbJsonLd, similarJsonLd]
              : [jsonLd, breadcrumbJsonLd],
          ),
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

      <SiteHeader locale={locale} pathname={`/car/${id}`} />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {/* Крошки — именованная навигация: на странице есть ещё
            <nav> шапки и подвала, и без имени они неразличимы. */}
        <nav
          className="mb-4 text-caption text-neutral-50"
          aria-label={t('nav_aria_breadcrumbs')}
        >
          <Link
            href={localeHref(locale, catalogPath)}
            className="hover:underline"
          >
            {catalogLabel}
          </Link>
          <span className="mx-1">/</span>
          <span>{title}</span>
        </nav>

        {/* min-w-0 на колонках — не украшение. У grid-элемента
            min-width по умолчанию auto, поэтому широкий потомок
            (длинная ссылка в описании, таблица характеристик)
            растягивает колонку сверх заданной доли и выносит
            страницу за пределы вьюпорта. minmax(0,…) закрывает то же
            самое, но только начиная с md, где сетка включается. */}
        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="min-w-0">
            {/* Обёртка нужна ради позиционирования крестика: сама
                галерея прокручивает миниатюры и не должна отвечать
                за слой поверх кадра. */}
            <div className="relative">
              <CarGallery images={images} alt={title} locale={locale} />
              <GalleryCloseButton locale={locale} fallbackPath={catalogPath} />
            </div>

            {/* ПОЯСНЕНИЕ К СОСТОЯНИЮ (0138) — СРАЗУ ПОД ФОТОГРАФИЯМИ.
                Место выбрано намеренно: человек только что рассмотрел
                кадры, и именно здесь у него возникает вопрос «почему
                так дёшево» или «а что с ней не так». Бейдж у цены
                называет состояние одним словом, эта плашка объясняет,
                что оно означает и что делать дальше — проверить
                возможность регистрации, уточнить у продавца.

                Цвет — тот же, что у бейджа, но заливкой 10% с цветным
                текстом (пара из lib/brand.ts, как у Alert и Badge
                тона success-soft): плашка занимает всю ширину
                колонки, и сплошная заливка на таком поле кричала бы
                громче самой фотографии.

                Компонент Alert здесь не подходит: его три тона
                (error / success / warning) описывают ИСХОД ДЕЙСТВИЯ
                пользователя, а тут — свойство товара, и красный
                «ошибка» на объявлении без документов читался бы как
                поломка сайта.

                role не задаём: это не сообщение о результате
                действия, а часть описания объявления, и перебивать
                чтение страницы ей незачем — скринридер прочтёт её в
                общем потоке. */}
            {conditionNote && (
              <div
                className={`mt-4 flex items-start gap-2 rounded-control px-3 py-2.5 text-caption font-medium ${conditionNote.surface}`}
              >
                <ConditionIcon
                  condition={car.condition}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>{conditionNote.text}</span>
              </div>
            )}

            {/* ЗАГОЛОВОК И СЕРДЦЕ В ОДНОЙ СТРОКЕ — как на карточке в
                списке и как в приложении. Раньше избранное жило
                кнопкой «Сохранить» во всю ширину в блоке контактов:
                она была третьей подряд после «Показать номер» и
                «Написать продавцу», то есть равной им по весу, хотя
                закладка — действие несоизмеримо более лёгкое. Значок
                у названия и знаком тот же, что в каталоге, и веса
                кнопки-действия не занимает.

                items-start, а не center: заголовок на узком экране
                занимает две-три строки, и центрирование увело бы
                значок к их середине, оторвав от первой строки. */}
            <div className="mt-5 flex items-start gap-2">
              <h1 className="min-w-0 flex-1 text-h2 font-bold sm:text-h1">
                {title}
              </h1>

              <FavoriteButton
                locale={locale}
                carId={car.id}
                sellerId={car.user_id}
              />
            </div>

            {/* Бейджи состояния. На карточке они крупнее, чем на плитке
                каталога: здесь это ключевой факт об объявлении, а не
                пометка поверх фотографии.

                Продвижение показывается и здесь, а не только в каталоге:
                покупатель, пришедший по прямой ссылке (из поиска, из
                чата, по QR), плитки не видел вовсе — и признак,
                объясняющий позицию объявления в выдаче, обязан быть на
                самой странице тоже.

                Продано и продвигается одновременно не бывает: переход в
                sold гасит продвижение триггером (миграция 0089). */}
            {car.status === 'sold' && (
              <Badge tone="sold" size="md" className="mt-2">
                {t('car_sold')}
              </Badge>
            )}

            {car.is_promoted && car.status !== 'sold' && (
              <Badge tone="promoted" size="md" className="mt-2">
                {t('car_promoted')}
              </Badge>
            )}

            {/* ДОСТУПНОСТЬ (0119). Плашка стоит рядом с ценой, а не в
                характеристиках: это первое, что покупатель обязан
                узнать о предложении — машины сейчас нет на площадке.
                Узнав об этом после звонка, человек чувствует себя
                обманутым, даже если салон честен.

                Тон info-soft: сообщение о факте, а не оценка. Зелёный
                и золотой читались бы как достоинство, красный — как
                проблема, тогда как это просто условие сделки.

                «В наличии» плашки не получает: состояние по умолчанию,
                и объявлять о нём незачем.

                У проданного не показываем: сделка закрыта, и условия
                поставки уже ни на что не влияют. */}
            {car.availability === 'on_order' && car.status !== 'sold' && (
              <Badge tone="info-soft" size="md" className="mt-2">
                {t('availability_on_order')}
              </Badge>
            )}

            {car.availability === 'in_transit' && car.status !== 'sold' && (
              <Badge tone="info-soft" size="md" className="mt-2">
                {t('availability_in_transit')}
              </Badge>
            )}

            {/* СОСТОЯНИЕ (0138) — ВТОРАЯ, НЕЗАВИСИМАЯ ОСЬ. Стоит сразу
                за доступностью и по тем же причинам: это то, что
                покупатель обязан узнать до звонка, а не после.

                У проданного не показываем — как и доступность выше:
                сделка закрыта, и состояние машины уже ни на что не
                влияет.

                Ниже, под фотографиями, то же состояние объясняется
                плашкой целой фразой. Здесь — короткий бейдж у цены:
                бейдж ловит взгляд, плашка отвечает «и что это значит
                для меня». */}
            {car.status !== 'sold' && (
              <ConditionBadge
                locale={locale}
                condition={car.condition}
                size="md"
                className="mt-2"
              />
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
                    продавец сделал при вводе описания.

                    [tab-size:2] обязателен рядом с ним. Описания часто копируют
                    с других площадок вместе с табличной разметкой: в
                    первом же реальном объявлении 19 табуляций вида
                    «Pogon:	4x4 (stalni pogon na sva četiri točka)».
                    Табуляция по умолчанию равна восьми символам, такая
                    строка не влезает в ширину телефона и распирает
                    страницу — фотография уезжала за правый край экрана.

                    break-words — на будущее: ссылки, ники и артикулы
                    без пробелов ломали бы вёрстку так же, а описание
                    пишет пользователь, и рассчитывать на его аккуратность
                    нельзя. */}
                <p className="whitespace-pre-line break-words [tab-size:2] text-neutral-80">
                  {car.description}
                </p>
              </section>
            )}

            <div className="mt-6 text-caption text-neutral-60">
              {t('car_published')}: {formatDate(car.created_at, locale)}
            </div>
          </div>

          {/* Правая колонка: цена и связь с продавцом. */}
          <aside className="min-w-0 md:sticky md:top-20 md:self-start">
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

                {/* Блок продавца — только текст. Логотип салона отсюда
                    убран вместе с логотипами по всему сайту: компанию
                    опознают по названию, а картинка рядом с ним
                    повторяла то же самое вторым способом. */}
                <Link
                  href={localeHref(locale, `/dealer/${car.user_id}`)}
                  className="group mt-1 flex items-center gap-2.5"
                >
                  <span className="min-w-0">
                    {/* Имя продавца ведёт на его витрину: у салона там
                        весь автопарк, и это заметно увеличивает глубину
                        просмотра. Ссылка нужна и краулеру — иначе
                        страницы /dealer/{id} не имели бы ни одной
                        входящей ссылки с сайта. */}
                    <span className="block truncate font-semibold group-hover:text-brand-primary group-hover:underline">
                      {car.seller_name}
                    </span>
                    <span className="block text-caption text-neutral-50">
                      {car.seller_kind === 'dealer'
                        ? t('car_seller_dealer')
                        : t('car_seller_private')}
                    </span>
                  </span>
                </Link>
              </div>

              {/* Связь с продавцом. Переписка работает на сайте целиком.
                  Кнопка клиентская: сама решает, показать вход гостю,
                  открыть диалог покупателю или скрыться у владельца.

                  ЗАГОЛОВОК ТОЖЕ КЛИЕНТСКИЙ и по той же причине: у
                  владельца обе кнопки скрываются, и серверная подпись
                  висела бы над пустым местом — читалось это как
                  поломка. «Поделиться» ниже при этом остаётся: свою
                  ссылку владелец отправляет покупателю чаще всего. */}
              <div className="mt-4 border-t border-neutral-10 pt-4">
                <ContactBlockTitle locale={locale} sellerId={car.user_id} />

                {/* ЗВОНОК ПЕРВЫМ И ЗЕЛЁНЫМ. На авторынке Сербии
                    звонок — более частый способ связи, чем переписка,
                    поэтому он стоит выше и держит акцент блока.

                    Номер сюда НЕ передаётся: страница рендерится под
                    анонимным ключом ради кэша, и телефон в серверных
                    данных пуст у всех (0116). Кнопка запрашивает его
                    сама из браузера, где есть сессия (0117), — заодно
                    он не попадает в HTML, который читает краулер. */}
                <CallSellerButton
                  locale={locale}
                  carId={car.id}
                  sellerId={car.user_id}
                />

                <ContactSellerButton
                  locale={locale}
                  carId={car.id}
                  sellerId={car.user_id}
                />

                {/* Избранного здесь НЕТ намеренно: оно переехало
                    значком-сердцем к заголовку объявления. В этом
                    блоке остаются только действия связи с продавцом —
                    звонок, переписка — и шаринг. */}
                <div className="mt-3">
                  <ShareButton locale={locale} url={canonicalUrl} title={title} />
                </div>
              </div>

              {/* QR — способ перенести объявление на телефон с десктопа:
                  человек смотрит каталог за компьютером, а звонит и
                  переписывается с телефона. Код ведёт на тот же
                  канонический адрес страницы. */}
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
