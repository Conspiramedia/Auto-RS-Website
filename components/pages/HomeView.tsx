// ============================================================
// RS AUTO — Содержимое главной страницы, параметризованное локалью.
// ============================================================
// Один компонент обслуживает и / (sr), и /ru. Страницы в app/ остаются
// тонкими обёртками, которые только передают locale: иначе русская версия
// была бы копией сербской, и любая правка требовала бы двух одинаковых
// изменений в разных файлах.
//
// СОСТАВ СТРАНИЦЫ И ПОРЯДОК БЛОКОВ:
//   1. Герой — оффер продавцу, единственный акцентный CTA.
//   2. «Как это работает» — три шага.
//   3. Свежие объявления — витрина, а на пустом каталоге приглашение
//      стать первым продавцом.
//   4. «Почему RS Auto» — четыре причины.
//   5. Аренда — витрина, появляется при наличии объявлений.
//   6. Популярные марки — ссылки-чипсы.
//   7. Недавно просмотренные — только у вернувшегося посетителя.
//   8. Города — SEO-блок над футером.
//   9. Оффер автосалонам.
//
// ПЛОЩАДКА ЗАПУСКАЕТСЯ, ОБЪЯВЛЕНИЙ ПОКА НЕТ. Это штатное состояние,
// а не сбой, и страница построена так, чтобы на пустом каталоге она не
// выглядела заготовкой: блоки, которым нечего показать (аренда, марки,
// просмотренное), не рендерятся вовсе, а витрина свежих объявлений
// подменяется приглашением подать первое. Появятся объявления — блоки
// оживут сами, без правок разметки.
// ============================================================

import Image from 'next/image';
import Link from 'next/link';

import CarCard from '@/components/CarCard';
import RecentlyViewed from '@/components/RecentlyViewed';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import {
  IconAudience,
  IconDirectContact,
  IconFree,
  IconGrowth,
} from '@/components/ui/HomeIcons';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { nounFor } from '@/lib/plural';
import { fetchCatalog, fetchSiteBrands, fetchSiteStats } from '@/lib/queries';
import { OPERATOR, OPERATOR_VERIFIED } from '@/lib/legal';
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from '@/lib/seo';
import { slugify } from '@/lib/format';

// ------------------------------------------------------------
// Популярные марки для чипсов.
// ------------------------------------------------------------
// Список фиксированный, а не из fetchSiteBrands: тот отдаёт марки,
// у которых УЖЕ есть объявления, и на пустом каталоге блок исчез бы
// целиком. Здесь же он нужен как навигация и SEO-вход с первого дня.
//
// КУДА ВЕДЁТ ЧИПС — ЗАВИСИТ ОТ НАЛИЧИЯ ОБЪЯВЛЕНИЙ.
//
// Постоянная SEO-страница марки /cars/{slug} существует ТОЛЬКО пока у
// марки есть активные объявления: BrandPageView отдаёт notFound(), если
// resolveBrand не нашёл её среди марок витрины (и это правильно —
// пустая страница марки в индексе вредит сайту, см. миграцию 0052).
// На пустом каталоге все восемь чипсов вели бы на 404.
//
// Поэтому адрес выбирается по факту: марка с объявлениями получает
// свою SEO-страницу, марка без них — отфильтрованный каталог
// /cars?brand=…, который открывается всегда и честно показывает пустую
// выдачу с формой сброса. Такие адреса закрыты от обхода в robots.txt
// (правило /*?*brand=), поэтому им проставляется rel=nofollow: звать
// краулера туда, куда ему закрыт вход, незачем. По мере наполнения
// каталога чипсы сами переключаются на SEO-страницы.
//
// Слаг считается тем же slugify, что и в sitemap.
const POPULAR_BRANDS = [
  'Volkswagen',
  'BMW',
  'Audi',
  'Mercedes-Benz',
  'Škoda',
  'Opel',
  'Renault',
  'Fiat',
] as const;

// ------------------------------------------------------------
// Города для нижнего SEO-блока.
// ------------------------------------------------------------
// Названия совпадают со списком CITIES (lib/referenceData) — тем же,
// что показывает фильтр каталога: значение параметра city сравнивается
// с городом объявления, и любая иная форма записи дала бы пустую
// выдачу.
//
// Здесь параметр в адресе неизбежен: отдельного маршрута /cars/city/…
// в проекте нет. Такие ссылки закрыты от обхода правилом /*?*city=
// в robots.txt, поэтому им проставлен rel=nofollow — не звать краулера
// туда, куда ему всё равно закрыт вход.
const HOME_CITIES = [
  'Beograd',
  'Novi Sad',
  'Niš',
  'Kragujevac',
  'Pančevo',
] as const;

// Причины блока «Почему RS Auto».
const WHY_CARDS: {
  icon: (props: { className?: string }) => React.ReactElement;
  title: DictKey;
  text: DictKey;
}[] = [
  { icon: IconFree, title: 'home_why_free_title', text: 'home_why_free_text' },
  {
    icon: IconAudience,
    title: 'home_why_audience_title',
    text: 'home_why_audience_text',
  },
  {
    icon: IconDirectContact,
    title: 'home_why_direct_title',
    text: 'home_why_direct_text',
  },
  {
    icon: IconGrowth,
    title: 'home_why_growth_title',
    text: 'home_why_growth_text',
  },
];

export default async function HomeView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  // ------------------------------------------------------------
  // ГЛАВНАЯ НЕ ПАДАЕТ ИЗ-ЗА ВИТРИН.
  // ------------------------------------------------------------
  // fetchCatalog бросает исключение при недоступной базе — и это
  // верно для /cars, где без объявлений показывать нечего. Но главная
  // устроена иначе: витрины свежих объявлений и аренды здесь лишь
  // ОДИН из блоков, рядом с оффером продавцу, списком марок и
  // навигацией. Ронять всю страницу (а вместе с ней и сборку сайта,
  // ведь главная генерируется статически) из-за пустого блока —
  // несоразмерно.
  //
  // Пустая витрина отрисуется как отсутствие блока: разметка ниже уже
  // проверяет длину массива, потому что новый сайт с нулём объявлений
  // — штатное состояние на старте.
  const emptyFeed = {
    cars: [],
    total: 0,
    page: 1,
    perPage: 0,
    totalPages: 1,
    seed: null,
  };

  const [fresh, rent, brands, stats] = await Promise.all([
    // Дефолтная сортировка 'fresh' — новые объявления первыми.
    fetchCatalog({ perPage: 8 }).catch(() => emptyFeed),
    // Витрина аренды на главной: раздел новый, и без неё пользователь
    // о нём не узнает.
    fetchCatalog({ perPage: 4, listingType: 'rent' }).catch(() => emptyFeed),
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

      <SiteHeader locale={locale} pathname="/" />

      <main>
        {/* Оффер продавцу — главный экран и единственный акцентный CTA. */}
        <section className="border-b border-neutral-10 bg-surface-subtle">
          {/* Две колонки с брейкпоинта lg: текст слева, изображение
              справа. До него — одна колонка, изображение уходит ПОД
              текст (порядок в разметке уже правильный, менять order не
              требуется): на узком экране первым обязан идти оффер, а не
              картинка. */}
          <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:py-16 lg:grid-cols-2 lg:gap-12">
            <div>
              {/* РАЗМЕР ЗАГОЛОВКА НА УЗКОМ ЭКРАНЕ ЗАДАН ЯВНО.
                  Ступень text-h1 (30px) укладывала «Продажа и аренда
                  автомобилей в Сербии» в ТРИ строки на телефоне: 38
                  символов не помещаются в ~328px доступной ширины
                  (360px экрана минус поля контейнера). Три строки
                  заголовка съедали первый экран и отодвигали кнопку
                  подачи к сгибу.

                  clamp вместо ступени шкалы: между 320px и 640px размер
                  плавно растёт от 25px до 32px, и заголовок держится в
                  двух строках на всех ходовых ширинах, а не только на
                  той, под которую подобран. Ступенью это не выразить —
                  здесь размер функция от ширины, а не роль в иерархии.

                  Верхняя граница упирается в 320px — самый узкий
                  экран в обиходе: при 26px заголовок там срывается на
                  третью строку, поэтому нижнее значение поднимать
                  дальше нельзя.

                  С sm (640px) места хватает, и заголовок возвращается на
                  свою ступень; с lg — на display, как было. */}
              <h1 className="max-w-2xl text-[clamp(1.5625rem,6.4vw,2rem)] font-bold leading-tight sm:text-h1 lg:text-display">
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

            {/* ИЗОБРАЖЕНИЕ ГЕРОЯ.
                Видно на всех ширинах. До lg сетка одноколоночная, и
                картинка встаёт ПОД текстом — порядок в разметке уже
                правильный, менять order не требуется. Это принципиально:
                выше сгиба обязаны остаться заголовок, подзаголовок и
                кнопка подачи, а изображение работает точкой ниже них.

                БЕЗ СДВИГА ВЁРСТКИ (CLS). Область зарезервирована
                заранее: контейнер держит соотношение сторон 16/10 через
                aspect-[16/10], а Image с fill растягивается внутри него.
                Поэтому высота блока известна ДО загрузки файла и не
                меняется в момент его появления.

                priority — картинка в первом экране: она участвует в LCP,
                и откладывать её загрузку нельзя.

                sizes описывает РЕАЛЬНУЮ ширину картинки в вёрстке: до lg
                это вся ширина колонки за вычетом полей (100vw минус
                отступы контейнера), с lg — половина сетки. Без этого
                браузер на телефоне тянул бы файл под десктопную ширину.

                Пустой alt намеренно: изображение декоративное, весь смысл
                несёт заголовок рядом, и озвучивать его скринридеру значит
                мешать. */}
            <div className="relative aspect-[16/10] overflow-hidden rounded-card">
              <Image
                src="/images/hero-car.webp"
                alt=""
                fill
                priority
                sizes="(max-width: 1023px) calc(100vw - 2rem), 50vw"
                className="object-cover"
              />
            </div>
          </div>
        </section>

        {/* ---------- Свежие объявления ---------- */}
        {/* Есть объявления — витрина; нет — приглашение стать первым
            продавцом. Второй вариант временный по своей природе: он
            исчезнет сам, как только появится первое объявление. */}
        {/* Верхний отступ py-12 — тот же, что у секции «Почему RS Auto»
            ниже: блок идёт сразу за героем, и без него заголовок
            прилипал к границе серой подложки. Раньше сверху стоял
            блок «Как это работает» со своим отступом, и хватало pb-10. */}
        <section className="mx-auto max-w-6xl px-4 py-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-h3 font-semibold">{t('home_fresh')}</h2>
            {/* Ссылка «все автомобили» нужна только когда есть куда
                вести: на пустом каталоге она обещала бы выдачу, в
                которой ничего нет. */}
            {fresh.cars.length > 0 && (
              // Тот же адрес, что у кнопки в герое: одна подпись —
              // одно назначение.
              <Link
                href={localeHref(locale, '/all')}
                rel="nofollow"
                className="text-caption font-semibold text-brand-primary hover:underline"
              >
                {t('home_all_cars')} →
              </Link>
            )}
          </div>

          {fresh.cars.length > 0 ? (
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
          ) : (
            // StateCard здесь не подходит: он несёт роль «пусто/ошибка»
            // внутри раздела, а тут блок продающий — приглашение с
            // акцентной кнопкой подачи.
            <Card className="text-center">
              <div className="mx-auto max-w-lg py-6">
                <h3 className="text-h4 font-semibold">
                  {t('home_fresh_empty_title')}
                </h3>
                <p className="mt-2 text-neutral-60">
                  {t('home_fresh_empty_text')}
                </p>
                {/* Изображение между текстом и кнопкой.
                    Порядок тот же, что в блоке «Почему RS Auto» ниже:
                    содержание → картинка → действие. Кнопка закрывает
                    карточку, и отделять её от края должен воздух, а не
                    фотография.

                    Область зарезервирована через aspect-[16/10] + fill,
                    поэтому загрузка файла не сдвигает вёрстку. priority
                    здесь НЕ ставится, в отличие от героя: блок лежит
                    ниже первого экрана и в LCP не участвует — ранняя
                    загрузка отняла бы полосу у картинки героя.

                    sizes описывает реальную ширину: карточка ограничена
                    max-w-lg (32rem), а на узком экране занимает ширину
                    окна за вычетом полей секции и внутренних отступов
                    карточки.

                    Пустой alt: изображение декоративное, весь смысл несут
                    заголовок и кнопка рядом. */}
                <div className="relative mt-6 aspect-[16/10] overflow-hidden rounded-card">
                  <Image
                    src="/images/sell-cta-car.webp"
                    alt=""
                    fill
                    sizes="(max-width: 543px) calc(100vw - 4rem), 32rem"
                    className="object-cover"
                  />
                </div>

                <div className="mt-6 flex justify-center">
                  <Button size="lg" href={localeHref(locale, '/sell')}>
                    {t('home_sell_free_cta')}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </section>

        {/* ---------- Почему RS Auto ---------- */}
        {/* Четыре причины выбрать площадку. Блок статический: он
            отвечает на вопрос «почему здесь, а не на другой доске»,
            и на пустом каталоге он нужнее, чем на полном. */}
        <section className="border-y border-neutral-10 bg-surface-subtle">
          <div className="mx-auto max-w-6xl px-4 py-12">
            <h2 className="text-h3 font-semibold">{t('home_why_title')}</h2>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {WHY_CARDS.map((card) => {
                const Icon = card.icon;

                return (
                  // Карточки лежат на серой подложке, поэтому им задан
                  // белый фон: без него граница на bg-surface-subtle
                  // читается как пустая рамка.
                  <Card key={card.title} className="bg-surface">
                    <span className="flex h-10 w-10 items-center justify-center rounded-control bg-brand-primary/10 text-brand-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-3 font-semibold">{t(card.title)}</h3>
                    <p className="mt-1 text-caption text-neutral-60">
                      {t(card.text)}
                    </p>
                  </Card>
                );
              })}
            </div>

            {/* ИЗОБРАЖЕНИЕ И ПРИЗЫВ ПОД КАРТОЧКАМИ.
                Блок объясняет, почему стоит выбрать площадку, — и
                заканчиваться он обязан действием, иначе прочитавший
                четыре довода упирается в следующий раздел и уходит
                дальше листать.

                Порядок тот же, что в герое и в блоке первого продавца:
                сначала содержание, потом картинка, потом кнопка. Кнопка
                ПОСЛЕ изображения, а не до: она закрывает секцию, и
                отделять её от следующего блока должен воздух, а не
                фотография.

                priority не ставится: секция лежит ниже первого экрана и
                в LCP не участвует, ранняя загрузка отняла бы полосу у
                картинки героя. Область зарезервирована через
                aspect-[16/10] + fill — подгрузка не сдвигает вёрстку.

                sizes: до lg картинка занимает ширину окна за вычетом
                полей секции (px-4 с двух сторон), с lg упирается в
                max-w-3xl (48rem) — она уже сетки карточек намеренно,
                во всю ширину она перетягивала бы на себя весь блок.

                Пустой alt: изображение декоративное, смысл несут
                карточки выше и подпись кнопки. */}
            <div className="mx-auto mt-8 max-w-3xl">
              <div className="relative aspect-[16/10] overflow-hidden rounded-card">
                <Image
                  src="/images/why-car.webp"
                  alt=""
                  fill
                  sizes="(max-width: 1023px) calc(100vw - 2rem), 48rem"
                  className="object-cover"
                />
              </div>

              <div className="mt-6 flex justify-center">
                <Button size="lg" href={localeHref(locale, '/sell')}>
                  {t('home_why_cta')}
                </Button>
              </div>
            </div>
          </div>
        </section>

        {rent.cars.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-10">
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

        {/* ---------- Популярные марки ---------- */}
        {/* Список фиксированный (POPULAR_BRANDS), поэтому блок стоит и
            на пустом каталоге — это навигация, а не витрина. Счётчик
            объявлений рядом с маркой показывается только там, где он
            есть: на старте у всех марок ноль, и «BMW (0)» выглядело бы
            как поломка. */}
        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="mb-4 text-h3 font-semibold">{t('home_brands')}</h2>
          <div className="flex flex-wrap gap-2">
            {POPULAR_BRANDS.map((name) => {
              const slug = slugify(name);
              const count = brands.find((b) => b.brand_slug === slug)?.cars_count;
              // Есть объявления — постоянная SEO-страница марки;
              // нет — каталог с фильтром (см. пояснение к POPULAR_BRANDS).
              const hasPage = count !== undefined && count > 0;

              return (
                <Chip
                  key={slug}
                  href={
                    hasPage
                      ? localeHref(locale, `/cars/${slug}`)
                      : localeHref(
                          locale,
                          `/cars?brand=${encodeURIComponent(name)}`,
                        )
                  }
                  nofollow={!hasPage}
                >
                  {name}
                  {count ? (
                    <span className="text-neutral-40">({count})</span>
                  ) : null}
                </Chip>
              );
            })}
          </div>
        </section>

        {/* Недавно просмотренные. Рендерится только у тех, кто уже
            открывал объявления, — у нового посетителя блок пуст и
            не появляется вовсе. */}
        <RecentlyViewed locale={locale} />

        {/* ---------- Города ---------- */}
        {/* SEO-блок над футером: вход в каталог по городу. Ссылки несут
            параметр city, закрытый от обхода в robots.txt, поэтому
            каждой проставлен rel=nofollow — см. комментарий к
            HOME_CITIES. Для человека они работают в полную силу. */}
        <section className="mx-auto max-w-6xl px-4 pb-10">
          <h2 className="mb-4 text-h3 font-semibold">
            {t('home_cities_title')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {HOME_CITIES.map((city) => (
              <Chip
                key={city}
                href={localeHref(
                  locale,
                  `/cars?city=${encodeURIComponent(city)}`,
                )}
                nofollow
              >
                {city}
              </Chip>
            ))}
          </div>
        </section>

        {/* Оффер дилерам — вторая аудитория продавцов. */}
        {/* РАСКЛАДКА РАЗНАЯ НА ДВУХ ШИРИНАХ:
              мобильный: текст со списком → картинка → кнопка с
                         микрокопией;
              десктоп:   слева текст, список, кнопка и микрокопия,
                         справа картинка.

            Порядок на мобильном тот же, что во всех блоках страницы:
            сначала оффер, потом изображение, потом действие. Кнопка
            выше картинки читалась бы как «жми, не досмотрев».

            КАК ЭТО СДЕЛАНО. Кнопка — отдельный элемент сетки, а не
            часть текстового блока. Только так работает order: он
            переставляет прямых детей контейнера, и кнопка, вложенная
            в текст, никакими классами вниз не уехала бы.

            ПОЧЕМУ 5 ДОЛЕЙ, А НЕ 2. Тексту теперь отданы две доли из
            пяти, картинке три. Список из четырёх пунктов в узкой
            колонке рвался бы на слишком короткие строки, но и равных
            половин здесь не нужно: изображение работает фоном оффера,
            а не иллюстрацией к каждому пункту.

            items-start, а не center: со списком текстовая колонка стала
            выше, и центрирование увело бы заголовок от верхнего края
            картинки. */}
        <section className="border-t border-neutral-10 bg-surface-subtle">
          <div className="mx-auto grid max-w-6xl items-start gap-x-12 gap-y-6 px-4 py-12 lg:grid-cols-5">
            {/* ТЕКСТОВАЯ КОЛОНКА ВЫРОВНЕНА ВЛЕВО НА ВСЕХ ШИРИНАХ.
                Центрировать здесь нечего: лид занимает четыре строки, а
                под ним список с маркерами — центрированные абзацы дают
                рваный левый край, и глазу не за что зацепиться при
                переходе на следующую строку. Заголовок выровнен вместе
                с ними: одиночный центрированный заголовок над левым
                текстом выглядел бы случайностью.

                По центру на мобильном стоит только кнопка с
                микрокопией — она замыкает блок и к тексту не
                примыкает. */}
            <div className="order-1 lg:col-span-2">
              {/* Заголовок и лид на десктопе крупнее: блок стоит рядом
                  с большой картинкой, и на прежних ступенях текст
                  выглядел подписью к ней, а не самостоятельным
                  оффером. До lg ступени прежние — там текст и так во
                  всю ширину экрана. */}
              <h2 className="text-h3 font-semibold lg:text-h2">
                {t('home_dealers_title')}
              </h2>
              <p className="mt-2 text-neutral-60 lg:text-h4">
                {t('home_dealers_lead')}
              </p>

              {/* Настоящий список, а не абзацы с тире: четыре
                  независимых довода, и скринридер обязан объявить их
                  количество. Маркеры свои (точка через ::before была бы
                  лишней зависимостью от псевдоэлемента) — простые
                  кружки в отдельном span, чтобы текст пункта переносился
                  с ровным отступом, а не подлезал под маркер. */}
              <ul className="mt-4 space-y-2">
                {(
                  [
                    'home_dealers_b1',
                    'home_dealers_b2',
                    'home_dealers_b3',
                    'home_dealers_b4',
                  ] as const
                ).map((key) => (
                  <li key={key} className="flex gap-2.5 text-caption text-neutral-70">
                    <span
                      aria-hidden
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill bg-brand-blue"
                    />
                    <span>{t(key)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Автомобили в шоуруме: изображение отвечает смыслу блока,
                а не просто заполняет место.

                order-2 — между текстом и кнопкой на мобильном.
                lg:row-span-2 — на десктопе картинка занимает обе строки
                правой колонки, иначе кнопка из левой растянула бы сетку
                и изображение встало бы только напротив текста.

                priority не ставится: секция стоит у самого низа
                страницы и в LCP не участвует. Область зарезервирована
                через aspect-[16/10] + fill, подгрузка вёрстку не
                двигает.

                sizes: до lg картинка занимает ширину окна за вычетом
                полей секции, с lg — три пятых сетки шириной 72rem,
                то есть около 43rem.

                Пустой alt: изображение декоративное, смысл несут
                заголовок, список и кнопка рядом. */}
            <div className="relative order-2 aspect-[16/10] overflow-hidden rounded-card lg:col-span-3 lg:col-start-3 lg:row-span-2 lg:row-start-1">
              <Image
                src="/images/dealers/lineup-4.webp"
                alt=""
                fill
                sizes="(max-width: 1023px) calc(100vw - 2rem), 43rem"
                className="object-cover"
              />
            </div>

            {/* Синяя кнопка (variant info), а не тёмная.
                Зелёный на сайте закреплён за главным действием —
                подачей объявления, и второй зелёной кнопкой этот блок
                спорил бы с ним за внимание. Синий по токенам бренда
                означает связь и второстепенные действия: заявка салона
                — обращение к площадке, а не публикация.

                Микрокопия под кнопкой снимает главный вопрос перед
                нажатием — «что будет дальше»: обещает ответ по почте и
                помощь, а не молчание после отправки формы. */}
            {/* text-center до lg: кнопка и микрокопия под ней стоят
                посреди колонки, как в остальных блоках страницы на
                мобильном. Центрируется именно ТЕКСТ, а не flex —
                микрокопия под кнопкой обязана быть отцентрована вместе
                с ней, а flex-контейнер выровнял бы только кнопку и
                оставил подпись прижатой к краю.

                На десктопе выравнивание сбрасывается: там колонка
                узкая и текст в ней читается слева. */}
            <div className="order-3 text-center lg:col-span-2 lg:col-start-1 lg:text-left">
              <Button
                variant="info"
                size="lg"
                href={localeHref(locale, '/dealers')}
              >
                {t('home_dealers_cta')}
              </Button>
              <p className="mt-2 text-small text-neutral-50">
                {t('home_dealers_note')}
              </p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter locale={locale} brands={brands.slice(0, 12)} />
    </>
  );
}
