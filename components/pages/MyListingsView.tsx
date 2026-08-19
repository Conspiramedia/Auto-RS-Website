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

import MyListingCard from '@/components/MyListingCard';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { getServerClient } from '@/lib/supabaseServer';
import type { MyListing, MyStatsTotals } from '@/lib/types';

type Props = {
  locale: Locale;
};

export default async function MyListingsView({ locale }: Props) {
  const t = getT(locale);
  const supabase = await getServerClient();

  const [listingsResult, totalsResult] = await Promise.all([
    supabase.rpc('get_my_listings_stats'),
    supabase.rpc('get_my_stats_totals'),
  ]);

  if (listingsResult.error) {
    return (
      <Card padding="none" className="px-6 py-12 text-center">
        <p className="text-neutral-60">{t('my_action_error')}</p>
      </Card>
    );
  }

  const listings = (listingsResult.data ?? []) as MyListing[];

  // Сводка возвращается таблицей из одной строки. Если её нет (у нового
  // продавца ещё нет ни одного объявления), плашку не рисуем вовсе —
  // ряд нулей ничего не сообщает.
  const totals = (
    totalsResult.error ? null : ((totalsResult.data ?? [])[0] ?? null)
  ) as MyStatsTotals | null;

  // ---------- Пусто ----------
  // Не переиспользуем components/EmptyState: тот завязан на сброс
  // фильтров каталога и требует resetPath, которого здесь нет. Причина
  // и путь дальше те же самые — «почему пусто» + одно ясное действие.
  if (listings.length === 0) {
    return (
      <Card padding="none" className="px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">{t('my_empty_title')}</h2>
        <p className="mx-auto mt-2 max-w-md text-neutral-60">
          {t('my_empty_text')}
        </p>

        {/* Единственный на экране акцент — здесь он уместен: подача
            объявления и есть то, ради чего продавец сюда пришёл. */}
        <div className="mt-6">
          <Button size="sm" href={localeHref(locale, '/sell')}>
            {t('my_empty_cta')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {totals && (
        // Плашка итогов на приглушённой подложке — как в приложении
        // (surfaceMuted): сводка вторична по отношению к списку и не
        // должна спорить с карточками за внимание.
        <div className="grid grid-cols-2 gap-3 rounded-card bg-surface-muted p-4 sm:grid-cols-4">
          <Total label={t('my_totals_listings')} value={totals.listings_count} />
          <Total label={t('my_metric_views')} value={totals.views} />
          <Total label={t('my_metric_favorites')} value={totals.favorites} />
          <Total label={t('my_metric_contacts')} value={totals.contacts} />
        </div>
      )}

      <div className="space-y-3">
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
function Total({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-caption text-neutral-60">{label}</div>
    </div>
  );
}
