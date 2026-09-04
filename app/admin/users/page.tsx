// ============================================================
// RS AUTO — Пользователи. Server Component.
// ============================================================
// Список профилей со статистикой объявлений. Из auth.users приходит
// ровно одно поле — last_sign_in_at, и приходит оно внутри
// definer-функции (см. 0080): в этой таблице лежат хеши паролей и
// токены восстановления, и выборка «звёздочкой» из неё рано или
// поздно утекла бы в ответ.
//
// ФЛАГ АДМИНИСТРАТОРА ПОКАЗЫВАЕТСЯ, НО НЕ РЕДАКТИРУЕТСЯ. Кнопки
// «сделать админом» нет ни здесь, ни на карточке: флаг ставится
// вручную в SQL Editor. Скомпрометированный аккаунт админа не должен
// уметь плодить админов, а интерфейс, который «просто показывает
// галочку», рано или поздно обзаводится кнопкой.
// ============================================================

import Link from 'next/link';

import AdminFilters, {
  CONTROL_CLASS,
  FilterField,
} from '@/components/admin/AdminFilters';
import AdminBackBar from '@/components/admin/AdminBackBar';
import AdminPagination from '@/components/admin/AdminPagination';
import Table, { type Column } from '@/components/ui/Table';
import { getServerClient } from '@/lib/supabaseServer';
import type { AdminUserRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const DATE = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});

// Время отдельным форматтером, а не одной строкой с датой: колонка
// узкая (104px), и «4 сент. 26 г., 11:24» в неё не помещается — дата
// переносилась бы по словам как попало. Поэтому время встаёт ВТОРОЙ
// СТРОКОЙ под датой и приглушённым цветом: сначала читается день,
// время уточняет его при необходимости.
//
// ГОД ОСТАЁТСЯ, в отличие от очереди модерации (app/admin/queue), где
// им пожертвовали ради времени в одной строке. Здесь он нужен:
// регистрация бывает и прошлогодней, а «4 сент.» без года в списке
// пользователей читается как «в этом году».
const TIME = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

// Дата над временем. Общая ячейка для обеих колонок — так формат
// правится в одном месте, а не в двух.
function DateTimeCell({ value }: { value: string }) {
  const d = new Date(value);
  return (
    <span className="block leading-tight">
      {DATE.format(d)}
      <span className="block text-micro text-neutral-40">{TIME.format(d)}</span>
    </span>
  );
}

const TYPES = [
  { value: 'admin', label: 'Администраторы' },
  { value: 'dealer', label: 'Автосалоны' },
  { value: 'client', label: 'Частные лица' },
  { value: 'verified', label: 'Документы подтверждены' },
  { value: 'pending', label: 'Документы на проверке' },
];

// Статус проверки документов. Отдельный от StatusChip: там статусы
// объявления, здесь — пользователя, и общий компонент на два разных
// набора значений путал бы больше, чем экономил.
function VerificationChip({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    verified: { label: 'Подтверждён', className: 'bg-status-success text-success' },
    pending: { label: 'На проверке', className: 'bg-status-warning text-warning' },
    rejected: { label: 'Отклонён', className: 'bg-status-error text-error' },
  };

  // unverified — обычное состояние большинства, и плашка «не
  // подтверждён» у всех подряд превратилась бы в фон.
  if (status === 'unverified') return <span className="text-neutral-30">—</span>;

  const known = map[status];
  return (
    <span
      className={[
        'inline-block whitespace-nowrap rounded-pill px-2 py-0.5 text-micro font-medium',
        known?.className ?? 'bg-surface-muted text-neutral-60',
      ].join(' ')}
    >
      {known?.label ?? status}
    </span>
  );
}

const columns: Column<AdminUserRow>[] = [
  {
    key: 'name',
    header: 'Пользователь',
    render: (row) => (
      <Link
        href={`/admin/users/${row.user_id}`}
        className="block min-w-0 truncate font-medium hover:underline"
      >
        {row.full_name ?? 'без имени'}
        {/* Флаг администратора — только показ. */}
        {row.is_admin && (
          <span className="ml-1.5 rounded-pill bg-brand-dark px-1.5 py-0.5 text-micro font-medium text-white">
            админ
          </span>
        )}
      </Link>
    ),
  },
  {
    key: 'email',
    header: 'Почта',
    width: '220px',
    hideBelow: 'md',
    render: (row) => <span className="block truncate">{row.email}</span>,
  },
  {
    key: 'listings',
    header: 'Объявлений',
    width: '110px',
    align: 'right',
    hideBelow: 'sm',
    // Активные из общего числа: «3 из 12» говорит больше, чем любое
    // из этих чисел по отдельности.
    render: (row) => (
      <span>
        {row.listings_active}
        <span className="text-neutral-40"> / {row.listings_total}</span>
      </span>
    ),
  },
  {
    key: 'verification',
    header: 'Документы',
    width: '128px',
    hideBelow: 'lg',
    render: (row) => <VerificationChip status={row.verification_status} />,
  },
  {
    key: 'created_at',
    header: 'Регистрация',
    width: '104px',
    align: 'right',
    hideBelow: 'lg',
    render: (row) => <DateTimeCell value={row.created_at} />,
  },
  {
    key: 'last_sign_in_at',
    header: 'Был(а)',
    width: '104px',
    align: 'right',
    hideBelow: 'lg',
    render: (row) =>
      row.last_sign_in_at ? (
        <DateTimeCell value={row.last_sign_in_at} />
      ) : (
        <span className="text-neutral-30">—</span>
      ),
  },
];

type SearchParams = {
  q?: string;
  type?: string;
  offset?: string;
  // Только зарегистрированные за N дней. Приходит с карточки «Новых за
  // 7 дней» на главной админки: без фильтра то число не на чем
  // проверить. Отдельного поля в форме фильтров нет — это не режим
  // работы со списком, а один конкретный переход.
  new_days?: string;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const offset = Math.max(Number(sp.offset ?? 0) || 0, 0);
  const query = sp.q || undefined;
  const type = sp.type || undefined;

  // Число дней разбираем строго: мусор в адресной строке не должен
  // превращаться в NaN, который RPC получит как null и молча покажет
  // весь список — админ решил бы, что новых пользователей столько же,
  // сколько всего.
  const newDaysRaw = Number(sp.new_days);
  const newDays =
    Number.isFinite(newDaysRaw) && newDaysRaw > 0
      ? Math.floor(newDaysRaw)
      : undefined;

  const hasFilters = Boolean(query || type || newDays);

  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('admin_list_users', {
    p_query: query ?? null,
    p_type: type ?? null,
    p_limit: PAGE_SIZE,
    p_offset: offset,
    p_new_days: newDays ?? null,
  });

  const rows = error ? [] : ((data ?? []) as AdminUserRow[]);
  const total = rows[0]?.total_count ?? 0;

  return (
    <>
      <AdminBackBar current="Пользователи" />

      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-h2 font-bold">Пользователи</h1>
        {!error && (
          <p className="shrink-0 text-caption text-neutral-60">
            Найдено: {total}
          </p>
        )}
      </div>

      <AdminFilters action="/admin/users" active={hasFilters}>
        <FilterField label="Поиск" className="basis-full sm:basis-72">
          <input
            type="search"
            name="q"
            defaultValue={query ?? ''}
            placeholder="Имя, почта или телефон"
            className={CONTROL_CLASS}
          />
        </FilterField>

        <FilterField label="Категория">
          <select name="type" defaultValue={type ?? ''} className={CONTROL_CLASS}>
            <option value="">Все</option>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </FilterField>

        {/* Фильтр по дате регистрации выставляется ссылкой с главной и
            переносится скрытым полем: без него «Сбросить» в форме
            снимал бы поиск и категорию, но список оставался бы
            урезанным по дате — и это выглядело бы как поломка. */}
        {newDays && (
          <input type="hidden" name="new_days" value={String(newDays)} />
        )}
      </AdminFilters>

      {/* Явная пометка, что список сокращён по дате. Без неё короткий
          список читается как «пользователей мало», а не «показаны
          только новые». Тот же приём, что у фильтра по объекту в
          журнале. */}
      {newDays && (
        <p className="mt-2 text-caption text-neutral-60">
          Показаны зарегистрированные за последние {newDays}{' '}
          {newDays === 1 ? 'день' : newDays < 5 ? 'дня' : 'дней'}.{' '}
          <Link href="/admin/users" className="text-brand-blue-ink hover:underline">
            Показать всех
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
              rowKey={(row) => row.user_id}
              empty={
                hasFilters
                  ? 'Никого не найдено — измените фильтры'
                  : 'Пользователей пока нет'
              }
              stickyHeader
            />
          </div>

          <AdminPagination
            path="/admin/users"
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
