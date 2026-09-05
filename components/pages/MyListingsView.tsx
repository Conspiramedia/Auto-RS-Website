// ============================================================
// RS AUTO — Список «Мои объявления». Server Component.
// ============================================================
// Общий для /my и /ru/my. Данные берутся ДВУМЯ RPC:
//   get_my_listings_stats() — объявления со статусом и метриками;
//   get_my_stats_totals()   — сводка для плашки над списком.
// Оба вызова идут параллельно (Promise.all): они независимы, и
// последовательное ожидание удвоило бы задержку отрисовки.
//
// Обе функции фильтруют по auth.uid() ВНУТРИ СЕБЯ — клиент не передаёт
// идентификатор пользователя и подставить чужой не может. Сессия
// приходит из cookie через серверный клиент (lib/supabaseServer.ts).
//
// Ошибку RPC показываем текстом, а не бросаем исключение: упавший
// список объявлений не должен ронять весь кабинет — вкладки и выход
// обязаны остаться рабочими.
// ============================================================

import Link from 'next/link';

import ExpiryBanner from '@/components/ExpiryBanner';
import MyListingCard from '@/components/MyListingCard';
import TierProgress from '@/components/TierProgress';
import Button from '@/components/ui/Button';
import StateCard from '@/components/ui/StateCard';
import {
  EyeIcon,
  FileTextIcon,
  HeartIcon,
  MessageCircleIcon,
} from '@/components/ui/MetricIcons';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { getServerClient } from '@/lib/supabaseServer';
import type {
  MyListing,
  MyStatsTotals,
  TierProgress as TierProgressData,
} from '@/lib/types';

type Props = {
  locale: Locale;
};

export default async function MyListingsView({ locale }: Props) {
  const t = getT(locale);
  const supabase = await getServerClient();

  const [listingsResult, totalsResult, tierResult] = await Promise.all([
    supabase.rpc('get_my_listings_stats'),
    supabase.rpc('get_my_stats_totals'),
    // Прогресс уровня (0144). В общем Promise.all, а не отдельным
    // запросом ниже: три RPC идут параллельно, и блок уровня не
    // добавляет странице ни одного последовательного похода в базу.
    supabase.rpc('get_my_tier_progress'),
  ]);

  if (listingsResult.error) {
    return <StateCard locale={locale} variant="error" />;
  }

  const listings = (listingsResult.data ?? []) as MyListing[];

  // Сводка возвращается таблицей из одной строки. Если её нет (у нового
  // продавца ещё нет ни одного объявления), плашку не рисуем вовсе —
  // ряд нулей ничего не сообщает.
  const totals = (
    totalsResult.error ? null : ((totalsResult.data ?? [])[0] ?? null)
  ) as MyStatsTotals | null;

  // Прогресс уровня. Как и сводка, возвращается таблицей из одной
  // строки; при ошибке блок просто не рисуется — список объявлений
  // рядом от этого не страдает.
  const tier = (
    tierResult.error ? null : ((tierResult.data ?? [])[0] ?? null)
  ) as TierProgressData | null;

  // Первое опубликованное объявление — цель ссылки в подсказке о нуле
  // просмотров. Именно 'active': объявление на модерации просмотров не
  // набирает по определению, и советовать там нечего.
  const firstActiveId =
    listings.find((l) => l.status === 'active')?.car_id ?? null;

  // ---------- Пусто ----------
  // Не переиспользуем components/EmptyState: тот завязан на сброс
  // фильтров каталога и требует resetPath, которого здесь нет. Причина
  // и путь дальше те же самые — «почему пусто» + одно ясное действие.
  if (listings.length === 0) {
    return (
      <StateCard
        locale={locale}
        title={t('my_empty_title')}
        text={t('my_empty_text')}
        actions={
          // Единственный на экране акцент — здесь он уместен: подача
          // объявления и есть то, ради чего продавец сюда пришёл.
          <Button size="sm" href={localeHref(locale, '/sell')}>
            {t('my_empty_cta')}
          </Button>
        }
      />
    );
  }

  // Сколько объявлений скрыто по сроку и сколько истекает на неделе.
  // Считаем здесь, на сервере: список уже загружен, и отдельный
  // запрос ради двух чисел был бы лишним. Порог 7 дней тот же, что у
  // серверного предупреждения и у пометки в карточке.
  const WARN_MS = 7 * 24 * 60 * 60 * 1000;
  const expiredCount = listings.filter((l) => l.status === 'expired').length;
  const expiringCount = listings.filter(
    (l) =>
      l.status === 'active' &&
      l.expires_at !== null &&
      new Date(l.expires_at).getTime() - Date.now() < WARN_MS,
  ).length;

  return (
    <div className="space-y-4">
      {/* Баннер о сроке — выше сводки и списка: для продавца без
          почты это единственный канал, и он должен попасть на глаза
          сразу при входе. Сам себя прячет, когда истекающих нет. */}
      <ExpiryBanner
        locale={locale}
        expiredCount={expiredCount}
        expiringCount={expiringCount}
      />

      {/* Уровень и прогресс до следующего — над сводкой метрик.
          Метрики отвечают на вопрос «как идут дела у объявлений», а
          уровень — «что даёт мне площадка и что нужно сделать
          дальше»; второе крупнее по смыслу и стоит выше.

          Продавцу с пустым списком блок не показывается: до него
          функция выходит по раннему return с приглашением подать
          первое объявление, и рассказывать там про ступени рано —
          сначала нужно объявление. */}
      <TierProgress locale={locale} data={tier} />

      {totals && (
        <div>
          {/* ЧЕТЫРЕ КАРТОЧКИ ВМЕСТО ОДНОЙ СЕРОЙ ПЛАШКИ.
              ------------------------------------------------------------
              Раньше метрики стояли сеткой 2×2 на приглушённой подложке
              и читались как один блок «всего понемногу». Разделённые
              карточки дают каждой метрике собственную границу, и взгляд
              находит нужную цифру сразу, а не пересчитывает четыре
              числа в общем поле.

              Раскладка: на мобильном 2×2, с sm — в ряд. Четыре
              карточки в строку на 360px дали бы по 80px, а внутри
              карточки значок и числа стоят ГОРИЗОНТАЛЬНО (см. Metric)
              и требуют ширины: круг 32px плюс двузначная цифра плюс
              подпись.

              items-stretch по умолчанию: до lg подпись стоит под
              цифрой и у длинных названий переносится на вторую строку,
              а без растяжения карточки ряда разъехались бы по
              высоте. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              tone="listings"
              icon={<FileTextIcon className="h-4 w-4" />}
              label={t('my_totals_listings')}
              value={totals.listings_count}
            />
            <Metric
              tone="views"
              icon={<EyeIcon className="h-4 w-4" />}
              label={t('my_metric_views')}
              value={totals.views}
            />
            <Metric
              tone="favorites"
              icon={<HeartIcon className="h-4 w-4" />}
              label={t('my_metric_favorites')}
              value={totals.favorites}
            />
            <Metric
              tone="contacts"
              icon={<MessageCircleIcon className="h-4 w-4" />}
              label={t('my_metric_contacts')}
              value={totals.contacts}
            />
          </div>

          {/* ПОДСКАЗКА ПРИ НУЛЕ ПРОСМОТРОВ.
              ------------------------------------------------------------
              Ноль просмотров при опубликованном объявлении — это не
              «мало», а «его не открывают вовсе», и самая частая причина
              — одна плохая фотография без описания. Подсказка ведёт
              прямо в правку конкретного объявления, а не в общий
              список: иначе продавцу пришлось бы искать нужное самому.

              Показывается ТОЛЬКО когда есть что чинить: у объявления на
              модерации просмотров нет по определению, и советовать
              там нечего — совет читался бы как упрёк за чужую
              задержку.

              Ссылка одна, на первое активное объявление: у продавца с
              нулём просмотров их обычно одно-два, а список ссылок
              превратил бы подсказку в ещё один блок навигации. */}
          {totals.views === 0 && firstActiveId && (
            <p className="mt-3 text-caption text-neutral-60">
              <Link
                href={localeHref(locale, `/my/listing/${firstActiveId}/edit`)}
                className="text-brand-primary underline underline-offset-2 hover:no-underline"
              >
                {t('my_totals_no_views_hint')}
              </Link>
            </p>
          )}
        </div>
      )}

      {/* Сетка карточек. На мобильном — один столбец (карточка
          горизонтальная: фото слева, данные справа), с 768px — две
          колонки, с 1280px — три.
          Две колонки начинаются именно с 768, а не с 1024: на планшете
          одна колонка растягивалась на все 736px, и метрики с кнопками
          расползались по полупустой строке. Две дают 362px на карточку —
          ровно та ширина, под которую она и спроектирована (см. шапку
          MyListingCard).
          Больше трёх не делаем: карточка владельца несёт метрики,
          бейджи и до четырёх кнопок действий, и в узкой колонке они
          начали бы переноситься по одной в строку. */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {listings.map((listing) => (
          <MyListingCard
            key={listing.car_id}
            locale={locale}
            listing={listing}
          />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Одна цифра сводки: крупное число + подпись под ним.
// ------------------------------------------------------------
// Цвет метрики. Классы перечислены ПОЛНОСТЬЮ, а не собраны
// конкатенацией (`bg-metric-${tone}-soft`): Tailwind сканирует
// исходники статически, и собранный из кусков класс в сборку не
// попадёт.
const METRIC_TONE = {
  listings: 'bg-metric-listings-soft text-metric-listings',
  views: 'bg-metric-views-soft text-metric-views',
  favorites: 'bg-metric-favorites-soft text-metric-favorites',
  contacts: 'bg-metric-contacts-soft text-metric-contacts',
} as const;

// Карточка одной метрики.
//
// НЕ КЛИКАБЕЛЬНА И НЕ РЕАГИРУЕТ НА НАВЕДЕНИЕ — это витрина чисел, а
// не навигация. Тень при наведении и курсор-палец обещали бы переход,
// которого нет: продавец нажал бы и ничего не произошло. Отсюда
// обычный div вместо ссылки и отсутствие hover-классов.
//
// aria-label собирает метрику в одну фразу («Просмотры: 340»): без
// него скринридер читает «340» и «Просмотры» как два несвязанных
// куска, а порядок обхода не гарантирует, что они окажутся рядом.
// Внутренности при этом скрыты от чтения (aria-hidden), иначе всё
// прозвучало бы дважды.
function Metric({
  tone,
  icon,
  label,
  value,
}: {
  tone: keyof typeof METRIC_TONE;
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div
      className="rounded-card border border-neutral-10 bg-white p-4"
      aria-label={`${label}: ${value}`}
    >
      {/* ГОРИЗОНТАЛЬНАЯ РАСКЛАДКА: значок слева, числа справа.
          ------------------------------------------------------------
          Вертикальная (значок над цифрой) делала карточку высокой, и
          блок из четырёх занимал заметную часть экрана над списком
          объявлений — а он здесь главное. В строку карточка выходит
          примерно вдвое ниже при той же читаемости.

          items-center, а не start: значок 32px выравнивается по
          середине пары «цифра + подпись», иначе он висел бы у верхнего
          края и строка выглядела бы сбитой.

          min-w-0 на текстовом блоке обязателен: без него flex-элемент
          не сжимается ниже содержимого, и длинная подпись
          («Объявления») вытолкнула бы значок за край карточки на
          360px. */}
      <div aria-hidden="true" className="flex items-center gap-3">
        {/* Круг 32px: значок в цветной подложке — единственное цветное
            пятно карточки. Цифра и подпись остаются нейтральными,
            иначе четыре карточки в ряд читались бы как светофор.
            shrink-0 — круг не должен сжиматься в овал рядом с длинной
            подписью. */}
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-pill ${METRIC_TONE[tone]}`}
        >
          {icon}
        </span>

        <div className="min-w-0">
          {/* ЦИФРА И ПОДПИСЬ В ОДНУ СТРОКУ — НО ТОЛЬКО С lg.
              ------------------------------------------------------------
              Подпись НЕ убрана намеренно: значок без неё неоднозначен
              (сердце — «избранное» или «лайки», конверт — «контакты»
              или «сообщения»), и продавцу пришлось бы угадывать, что
              означает число.

              ПОРОГ — lg, И ЭТО СЧИТАННОЕ ЗНАЧЕНИЕ, А НЕ ВКУСОВОЕ.
              Под цифру с подписью в карточке остаётся её ширина минус
              паддинги (32), круг (32) и зазор (12); трёхзначное число
              занимает ~50px, а «Просмотры» требует ~78px. Отсюда по
              брейкпоинтам:
                360px  — карточка 158px, подписи остаётся ~26px;
                640px  — карточка 143px (четыре в ряд!), ~11px;
                768px  — карточка 175px, ~43px;
                1024px+— карточки хватает с запасом.
              На 640px строка получается ХУЖЕ мобильной, потому что
              там четыре карточки уже стоят в ряд и каждая уже, чем
              половина мобильного экрана. Поэтому до lg подпись стоит
              ПОД цифрой и переносится целиком, а в строку встаёт
              только с lg.

              items-baseline: цифра 28px и подпись 14px выравниваются
              по общей базовой линии, иначе подпись «плавала» бы
              относительно цифры.

              leading-none у цифры: собственный межстрочный интервал
              text-h3 рассчитан на заголовок и добавлял бы карточке
              лишнюю высоту — ровно то, ради чего строка и собиралась.

              title дублирует подпись для случая, когда её всё же
              обрежет на узком десктопном окне. */}
          <div className="lg:flex lg:items-baseline lg:gap-1.5">
            <span className="block text-h3 font-bold leading-none text-neutral-100">
              {value}
            </span>
            <span
              className="block text-caption text-neutral-60 lg:truncate"
              title={label}
            >
              {label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
