// ============================================================
// RS AUTO — Все объявления. Server Component.
// ============================================================
// В отличие от очереди (M4), здесь видны ВСЕ статусы и работает
// поиск. Очередь — конвейер с одним порядком; этот раздел про
// разбор по запросу: «найти объявление, на которое жалуется
// покупатель», «показать всё этого продавца».
//
// ФИЛЬТРЫ ЖИВУТ В URL (см. AdminFilters): адрес с фильтрами можно
// переслать коллеге и сохранить в закладку, а список остаётся
// серверным целиком — ни строчки клиентского кода на саму выборку.
//
// Клиентское здесь только одно: кнопка «Снять» с диалогом причины.
// Она и обязана быть клиентской — нужен ввод и запрос.
// ============================================================

import Link from 'next/link';

import AdminFilters, {
  CONTROL_CLASS,
  FilterField,
} from '@/components/admin/AdminFilters';
import AdminPagination from '@/components/admin/AdminPagination';
import CarStatusButton from '@/components/admin/CarStatusButton';
import StatusChip from '@/components/admin/StatusChip';
import Table, { type Column } from '@/components/ui/Table';
import { getServerClient } from '@/lib/supabaseServer';
import type { AdminCarRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const SUBMITTED = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});

// Статусы для фильтра. draft не показываем: черновик не публиковался
// и модератору не адресован — он даже в счётчики объявлений продавца
// не идёт (см. 0080).
const STATUSES = [
  { value: 'active', label: 'Опубликовано' },
  { value: 'moderation', label: 'На проверке' },
  { value: 'rejected', label: 'Отклонено' },
  { value: 'archived', label: 'В архиве' },
  { value: 'sold', label: 'Продано' },
];

const SORTS = [
  { value: 'created_desc', label: 'Сначала новые' },
  { value: 'created_asc', label: 'Сначала старые' },
  { value: 'updated_desc', label: 'По изменению' },
];

const columns: Column<AdminCarRow>[] = [
  {
    key: 'car',
    header: 'Объявление',
    render: (row) => (
      <Link
        href={`/admin/queue/${row.car_id}`}
        className="font-medium hover:underline"
      >
        {row.brand} {row.model}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Статус',
    width: '124px',
    render: (row) => <StatusChip status={row.status} />,
  },
  {
    key: 'year',
    header: 'Год',
    width: '64px',
    align: 'right',
    hideBelow: 'sm',
    render: (row) => row.year,
  },
  {
    key: 'city',
    header: 'Город',
    width: '128px',
    hideBelow: 'lg',
    render: (row) => row.city,
  },
  {
    key: 'owner',
    header: 'Продавец',
    width: '180px',
    hideBelow: 'md',
    // Ссылка на карточку пользователя (M6): от объявления к продавцу
    // и обратно — самый частый переход при разборе жалобы.
    render: (row) => (
      <Link
        href={`/admin/users/${row.owner_id}`}
        className="block truncate hover:underline"
      >
        {row.owner_name ?? 'без имени'}
      </Link>
    ),
  },
  {
    key: 'created_at',
    header: 'Подано',
    width: '104px',
    align: 'right',
    hideBelow: 'md',
    render: (row) => SUBMITTED.format(new Date(row.created_at)),
  },
  {
    key: 'actions',
    header: '',
    width: '96px',
    align: 'right',
    // Действие прямо из строки: снять опубликованное или вернуть из
    // архива. Для остальных статусов кнопка не рисуется вовсе — она
    // сама решает это по статусу.
    render: (row) => <CarStatusButton carId={row.car_id} status={row.status} />,
  },
];

type SearchParams = {
  status?: string;
  q?: string;
  city?: string;
  user?: string;
  sort?: string;
  offset?: string;
};

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const offset = Math.max(Number(sp.offset ?? 0) || 0, 0);
  const status = sp.status || undefined;
  const query = sp.q || undefined;
  const city = sp.city || undefined;
  const sort = sp.sort || 'created_desc';

  // Фильтр по продавцу приходит только ссылкой с карточки
  // пользователя, поэтому uuid проверяем, но поля в форме не даём:
  // вводить его руками никто не станет.
  const userId =
    sp.user &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sp.user,
    )
      ? sp.user
      : undefined;

  const hasFilters = Boolean(
    status || query || city || userId || (sp.sort && sp.sort !== 'created_desc'),
  );

  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('admin_list_cars', {
    p_status: status ?? null,
    p_query: query ?? null,
    p_city: city ?? null,
    p_user_id: userId ?? null,
    p_sort: sort,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });

  const rows = (error ? [] : ((data ?? []) as AdminCarRow[]));
  const total = rows[0]?.total_count ?? 0;

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-h2 font-bold">Объявления</h1>
        {!error && (
          <p className="shrink-0 text-caption text-neutral-60">
            Найдено: {total}
          </p>
        )}
      </div>

      <AdminFilters action="/admin/listings" active={hasFilters}>
        <FilterField label="Поиск" className="basis-full sm:basis-64">
          <input
            type="search"
            name="q"
            defaultValue={query ?? ''}
            placeholder="Марка, модель, город или id"
            className={CONTROL_CLASS}
          />
        </FilterField>

        <FilterField label="Статус">
          <select name="status" defaultValue={status ?? ''} className={CONTROL_CLASS}>
            <option value="">Любой</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Город">
          <input
            type="text"
            name="city"
            defaultValue={city ?? ''}
            placeholder="Любой"
            className={CONTROL_CLASS}
          />
        </FilterField>

        <FilterField label="Сортировка">
          <select name="sort" defaultValue={sort} className={CONTROL_CLASS}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </FilterField>

        {/* Фильтр по продавцу переносим через скрытое поле: он
            выставляется ссылкой с карточки пользователя и должен
            пережить смену остальных фильтров. */}
        {userId && <input type="hidden" name="user" value={userId} />}
      </AdminFilters>

      {userId && (
        <p className="mt-2 text-caption text-neutral-60">
          Показаны объявления одного продавца.{' '}
          <Link href="/admin/listings" className="text-brand-blue hover:underline">
            Показать все
          </Link>
        </p>
      )}

      {error ? (
        <div className="mt-4 rounded-card border border-error/30 bg-status-error p-4">
          <p className="font-semibold text-error">Список не загрузился</p>
          <p className="mt-1 text-caption text-neutral-70">
            Попробуйте обновить страницу.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <Table
              columns={columns}
              rows={rows}
              rowKey={(row) => row.car_id}
              empty={
                hasFilters
                  ? 'Ничего не найдено — измените фильтры'
                  : 'Объявлений пока нет'
              }
              stickyHeader
            />
          </div>

          <AdminPagination
            path="/admin/listings"
            params={sp}
            offset={offset}
            limit={PAGE_SIZE}
            total={total}
          />
        </>
      )}
    </>
  );
}
