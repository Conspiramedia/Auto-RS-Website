'use client';

// ============================================================
// RS AUTO — Бесконечная лента каталога. Client Component.
// ============================================================
// ПЕРЕНОС ПАТТЕРНА ИЗ App Baza (D:\Project\App Baza,
// lib/features/listings/presentation/providers/listings_feed_provider.dart).
// Там лента устроена так, и здесь повторено один в один:
//
//   1. КРУГИ. Лента никогда не «заканчивается». Когда сервер отдал все
//      объявления текущего круга, клиент незаметно начинает НОВЫЙ круг:
//      сбрасывает offset в 0, берёт новый seed (новая перетасовка на
//      сервере) и продолжает подгрузку — пользователь шва не видит.
//
//   2. ПЕРЕМЕШИВАЕТ СЕРВЕР, А НЕ КЛИЕНТ. Порядок внутри круга обязан
//      быть стабильным для offset-пагинации, иначе при скролле пойдут
//      дубли и пропуски. RPC сортирует по md5(id || seed): один seed —
//      один порядок на все страницы круга, новый seed — новый порядок.
//
//   3. КРУГИ 2+ ИДУТ С shuffleAll. Полная перетасовка без блока промо
//      сверху: иначе каждый круг начинался бы с одних и тех же
//      продвигаемых объявлений и повтор бросался бы в глаза.
//
//   4. АНТИ-ДУБЛЬ НА СТЫКЕ. Последний элемент старого круга может
//      совпасть с ранним элементом нового — такие убираем в пределах
//      добираемой страницы, чтобы две одинаковые карточки не встали рядом.
//
// ЧТО СДЕЛАНО ИНАЧЕ, ЧЕМ В ПРИЛОЖЕНИИ, И ПОЧЕМУ.
// Первая страница НЕ запрашивается клиентом: она приходит с сервера уже
// отрендеренной (SSR) и передаётся сюда пропом initialCars. Это
// принципиально для SEO — карточки обязаны быть в HTML, а не появляться
// после выполнения скрипта. Клиент подключается только со второй
// страницы, при скролле.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import CarCard from './CarCard';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';
import type { CatalogCar, ListingType } from '@/lib/types';

// Размер подгружаемой порции. Совпадает с размером серверной страницы:
// сетка каталога кратна 2/3/4 колонкам, 24 делится на все три.
const PAGE_SIZE = 24;

// Верхняя граница seed: меньше 2^31, чтобы значение влезало в integer
// на стороне Postgres (параметр p_seed объявлен как integer).
const MAX_SEED = 1 << 30;

// Фильтры выдачи, пришедшие со страницы. Совпадают с теми, по которым
// сервер отрисовал первую порцию, — иначе лента продолжилась бы другой
// выборкой.
export type FeedFilters = {
  q?: string;
  brand?: string;
  model?: string;
  city?: string;
  yearFrom?: number;
  yearTo?: number;
  mileageMax?: number;
  priceFrom?: number;
  priceTo?: number;
  bodyType?: string;
  transmission?: string;
  fuel?: string;
  listingType?: ListingType;
};

type Props = {
  locale: Locale;
  // Карточки, отрисованные сервером. Лента продолжает именно их.
  initialCars: CatalogCar[];
  filters: FeedFilters;
  mode: ListingType;
  // Соль первого круга. Приходит с сервера, чтобы продолжение ленты
  // шло в ТОМ ЖЕ порядке, в котором сервер отдал первую страницу.
  initialSeed: number | null;
  // Всего объявлений по фильтрам. Нужно ровно для одного решения:
  // включать ли бесконечную прокрутку вообще.
  total: number;
};

export default function InfiniteCarFeed({
  locale,
  initialCars,
  filters,
  mode,
  initialSeed,
  total,
}: Props) {
  const t = getT(locale);

  const [cars, setCars] = useState<CatalogCar[]>(initialCars);
  const [loading, setLoading] = useState(false);

  // ---------- Состояние текущего круга ----------
  // Seed круга. Фиксируется на весь круг: порядок должен быть одинаковым
  // для всех его страниц, иначе offset-пагинация «поплывёт».
  const lapSeed = useRef<number | null>(initialSeed);
  // Сколько объявлений уже взято В ТЕКУЩЕМ КРУГЕ (серверный offset).
  // Не равен длине списка на экране: после первого круга список растёт,
  // а offset нового круга стартует с нуля.
  const lapOffset = useRef(initialCars.length);
  // Мы на кругах 2+: сервер отдаёт полную перетасовку без промо сверху.
  const looping = useRef(false);
  // Защита от повторного входа: наблюдатель может сработать несколько
  // раз подряд, пока запрос ещё в полёте.
  const busy = useRef(false);

  // Элемент-«маяк» в конце списка: его появление в зоне видимости и
  // means «пора подгружать».
  const sentinel = useRef<HTMLDivElement>(null);

  // Прокрутка бесконечна, только когда объявлений больше одной страницы.
  // При 5 объявлениях крутить их по кругу — навязчиво и выглядит поломкой.
  const enabled = total > PAGE_SIZE;

  const loadMore = useCallback(async () => {
    if (busy.current || !enabled) return;
    busy.current = true;
    setLoading(true);

    try {
      const supabase = getBrowserClient();
      const collected: CatalogCar[] = [];
      let startedNewLap = false;

      // Добираем до полной страницы. Цикл нужен именно для стыка кругов:
      // если старый круг закончился на середине порции, остаток берём
      // уже из нового — пользователь не должен видеть «недостраницу».
      while (collected.length < PAGE_SIZE) {
        const want = PAGE_SIZE - collected.length;

        const { data, error } = await supabase.rpc('search_cars_public', {
          p_search_query: filters.q ?? null,
          p_brand: filters.brand ?? null,
          p_model: filters.model ?? null,
          p_city: filters.city ?? null,
          p_year_from: filters.yearFrom ?? null,
          p_year_to: filters.yearTo ?? null,
          p_mileage_max: filters.mileageMax ?? null,
          p_price_from: filters.priceFrom ?? null,
          p_price_to: filters.priceTo ?? null,
          p_body_type: filters.bodyType ?? null,
          p_transmission: filters.transmission ?? null,
          p_fuel: filters.fuel ?? null,
          p_sort: 'fresh',
          p_offset: lapOffset.current,
          p_limit: want,
          p_listing_type: filters.listingType ?? 'both',
          // Те же соображения, что в lib/queries: пока seed не понадобился
          // (первый круг), параметры не отправляем — так подгрузка
          // работает и на прежней версии RPC. Со второго круга они
          // обязательны, и там уже нужна применённая миграция 0059;
          // если её нет, RPC вернёт ошибку, а лента просто остановится
          // (see `if (error) break;` ниже) — страница не сломается.
          ...(lapSeed.current != null || looping.current
            ? {
                p_seed: lapSeed.current,
                p_shuffle_all: looping.current,
              }
            : {}),
        });

        // Ошибку не показываем: лента второстепенна по отношению к уже
        // отрисованным карточкам. Молча прекращаем подгрузку — на
        // странице остаётся то, что пришло с сервера.
        if (error) break;

        const page = (data ?? []) as CatalogCar[];

        // Серверный offset двигаем на РЕАЛЬНО отданное число строк
        // (до какой-либо клиентской фильтрации) — иначе пагинация
        // поплывёт и часть объявлений пропадёт.
        lapOffset.current += page.length;

        // Анти-дубль на стыке кругов.
        const seen = new Set(collected.map((c) => c.id));
        collected.push(...page.filter((c) => !seen.has(c.id)));

        // Сервер отдал меньше, чем просили, — круг исчерпан.
        if (page.length < want) {
          // Второй круг за один вызов не начинаем: иначе при пустой
          // выдаче цикл крутился бы бесконечно.
          if (startedNewLap) break;
          startedNewLap = true;
          looping.current = true;
          lapSeed.current = Math.floor(Math.random() * MAX_SEED);
          lapOffset.current = 0;
        }
      }

      if (collected.length > 0) {
        setCars((prev) => {
          // Второй барьер от дублей: карточка, уже показанная на экране,
          // не должна появиться снова при переходе на новый круг.
          const shown = new Set(prev.map((c) => c.id));
          const fresh = collected.filter((c) => !shown.has(c.id));
          // Если весь добор оказался повтором — не трогаем состояние,
          // чтобы не вызывать лишний рендер длинного списка.
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [enabled, filters]);

  // Наблюдатель за «маяком». rootMargin в 600px запускает подгрузку
  // заранее — до того, как пользователь упёрся в конец списка, поэтому
  // прокрутка не спотыкается об ожидание ответа.
  useEffect(() => {
    if (!enabled) return;

    const node = sentinel.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '600px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, loadMore]);

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {cars.map((car, i) => (
          <CarCard
            key={`${car.id}-${i}`}
            locale={locale}
            car={car}
            mode={mode}
            // Первые четыре карточки — над сгибом, грузим приоритетно.
            priority={i < 4}
          />
        ))}
      </div>

      {/* Маяк подгрузки. Живёт вне сетки, чтобы не занимать ячейку. */}
      {enabled && <div ref={sentinel} aria-hidden="true" className="h-px" />}

      {loading && (
        <p className="mt-6 text-center text-caption text-neutral-50">
          {t('feed_loading')}
        </p>
      )}
    </>
  );
}
