// ============================================================
// RS AUTO — Избранное /my/favorites. Server Component.
// ============================================================
// ЗАЧЕМ ЭКРАН. Закладки существовали в базе с миграции 0023, и с
// появлением сердца на карточке их стало можно ставить — но СПИСКА
// сохранённого не было: закладка работала как отметка, к которой
// невозможно вернуться. Ровно ради возврата её и ставят.
//
// ДАННЫЕ — RPC get_my_favorites (0130). Прямым SELECT здесь не
// обойтись: нужны поля карточки (фотография, цена, продвижение,
// доступность, тип продавца), а они лежат в четырёх таблицах.
// Функция отдаёт ту же форму, что get_seller_listings (0050), —
// поэтому список рисуется обычным CarCard, без своей вёрстки.
//
// ЧТО В СПИСКЕ. Только активные объявления: закладка на снятом или
// проданном не показывается, но и не стирается — объявление может
// вернуться в каталог продлением или возвратом из архива (0070).
// Поэтому счётчик может расходиться с числом строк в favorites, и это
// правильно: человеку показывают то, что он может открыть.
//
// СОРТИРОВКА — новые закладки сверху (по favorited_at, а не по дате
// объявления): человек ищет здесь то, что сохранил последним.
// ============================================================

import CarCard from '@/components/CarCard';
import HideableCard from '@/components/HideableCard';
import PagerLinks from '@/components/PagerLinks';
import Button from '@/components/ui/Button';
import StateCard from '@/components/ui/StateCard';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { getServerClient } from '@/lib/supabaseServer';
import type { FavoriteListing } from '@/lib/types';

// По 24 на страницу — как в каталоге: сетка из 2/3/4 колонок делится
// на 24 нацело на всех трёх брейкпоинтах, и последний ряд не остаётся
// щербатым.
const PAGE_SIZE = 24;

type Props = {
  locale: Locale;
  page: number;
};

export default async function FavoritesPageView({ locale, page }: Props) {
  const t = getT(locale);
  const supabase = await getServerClient();

  // Список и общее число — параллельно: последовательные запросы
  // сложили бы задержки, а друг от друга они не зависят.
  const [listResult, countResult] = await Promise.all([
    supabase.rpc('get_my_favorites', {
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    supabase.rpc('count_my_favorites'),
  ]);

  if (listResult.error) {
    return (
      <StateCard locale={locale} variant="error" retryPath="/my/favorites" />
    );
  }

  const items = (listResult.data ?? []) as FavoriteListing[];
  const total = (countResult.data as number | null) ?? 0;

  // ---------- Пусто ----------
  // Причина + путь наружу: пустой список избранного лечится не
  // настройкой, а походом в каталог, поэтому кнопка ведёт туда.
  // Формулировки — те же, что в приложении.
  if (items.length === 0) {
    return (
      <StateCard
        locale={locale}
        title={t('favorites_empty')}
        text={t('favorites_empty_body')}
        actions={
          <Button size="sm" href={localeHref(locale, '/cars')}>
            {t('favorites_go_to_catalog')}
          </Button>
        }
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* Сетка та же, что в каталоге: 2/3/4 колонки на 360/768/1280.
          Кабинет здесь не сужается до одной колонки — избранное это
          та же выдача объявлений, и мерить её глазами каталога
          человеку привычнее. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {items.map((car, i) => (
          // Обёртка нужна и здесь: сердце на карточке снимает закладку,
          // но карточка при этом остаётся на месте до перезагрузки —
          // и это правильно (случайный клик легко отменить), а вот
          // «Не интересует» из меню «три точки» обязано убрать
          // объявление сразу.
          <HideableCard key={car.id} carId={car.id} city={car.city}>
            <CarCard
              locale={locale}
              car={car}
              // Смешанный режим: в избранном рядом лежат и продажа, и
              // аренда, и цену каждой карточке выбирает она сама.
              mode="both"
              priority={i < 4}
            />
          </HideableCard>
        ))}
      </div>

      {totalPages > 1 && (
        <PagerLinks
          locale={locale}
          basePath="/my/favorites"
          page={page}
          totalPages={totalPages}
        />
      )}
    </div>
  );
}
