// ============================================================
// RS AUTO — Заявки автосалонов. Server Component.
// ============================================================
// Таблица dealer_leads (0053) заполнялась формой на /dealers с самого
// её появления, а прочитать её было НЕГДЕ: ни страницы, ни ссылки, ни
// упоминания в админке. Заявка салона уходила в базу, отправитель
// видел «Свяжемся в ближайшее время» — и на этом всё. Канал
// привлечения салонов работал в один конец.
//
// ПОЧЕМУ ОБЫЧНЫЙ SELECT, А НЕ RPC. Политика dealer_leads_select_admin
// (0053) уже отдаёт таблицу только админу, а сортировка «сначала
// новые» и фильтр по стадии — не бизнес-правило, а параметры выборки.
// Функция вокруг них ничего бы не проверяла; ровно так же читается
// голова очереди модерации на дашборде.
//
// ИНДЕКС ПОД ЭТОТ ЭКРАН УЖЕ ЕСТЬ: idx_dealer_leads_created (0053)
// заведён под «сначала новые» — то есть порядок здесь выбран не по
// вкусу, а по тому, подо что построен индекс.
//
// ПЕРСОНАЛЬНЫЕ ДАННЫЕ. В заявке телефон, имя и почта живого человека.
// Раздел закрыт от индексации метаданными layout'а (noindex, nocache,
// noimageindex) и force-dynamic — кэшированная страница с контактами,
// отданная не тому, здесь опаснее лишнего запроса к базе.
// ============================================================

import AdminBackBar from '@/components/admin/AdminBackBar';
import AdminFilters, {
  CONTROL_CLASS,
  FilterField,
} from '@/components/admin/AdminFilters';
import AdminPagination from '@/components/admin/AdminPagination';
import LeadStatusSelect from '@/components/admin/LeadStatusSelect';
import Table, { type Column } from '@/components/ui/Table';
import { getServerClient } from '@/lib/supabaseServer';
import type { DealerLead } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

// Дата с временем: по заявке звонят, и «вчера в 19:40» объясняет, что
// человек написал вечером и ждёт звонка утром. В списке пользователей
// время не нужно, поэтому формат свой, а не общий DATE.
const DATE = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUSES = [
  { value: 'new', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'done', label: 'Обработанные' },
  { value: 'rejected', label: 'Отклонённые' },
];

const columns: Column<DealerLead>[] = [
  {
    key: 'company_name',
    header: 'Автосалон',
    render: (row) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.company_name}</p>
        {/* Город под названием, а не отдельной колонкой: он есть не у
            всех заявок (поле необязательное в 0053), и колонка с
            прочерками в половине строк заняла бы ширину впустую. */}
        {row.city && (
          <p className="truncate text-micro text-neutral-50">{row.city}</p>
        )}
        {/* Реквизиты (0102) — здесь же, а не отдельными колонками: по
            ним админ проверяет компанию в APR, то есть читает их
            вместе с названием. Поля необязательные, и в отдельных
            колонках были бы прочерки в большинстве строк.
            tabular-nums выравнивает цифры по разрядам — сверять номер
            с выпиской так заметно легче. */}
        {(row.tax_id || row.registration_number) && (
          <p className="truncate text-micro tabular-nums text-neutral-50">
            {row.tax_id && <>PIB {row.tax_id}</>}
            {row.tax_id && row.registration_number && ' · '}
            {row.registration_number && <>МБ {row.registration_number}</>}
          </p>
        )}
        {row.website && (
          <a
            href={row.website}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="block truncate text-micro text-brand-blue hover:underline"
          >
            {row.website}
          </a>
        )}
      </div>
    ),
  },
  {
    key: 'contact',
    header: 'Контакт',
    width: '200px',
    render: (row) => (
      <div className="min-w-0">
        <p className="truncate">{row.contact_name}</p>
        {/* Телефон — ссылка tel:. Заявку обрабатывают звонком, и на
            телефоне админа это один тап вместо выделения и
            копирования. Направление письма ltr: номер начинается с
            «+», и в потоке текста он иначе съезжает. */}
        <a
          href={`tel:${row.phone}`}
          dir="ltr"
          className="block truncate text-micro text-brand-blue hover:underline"
        >
          {row.phone}
        </a>
      </div>
    ),
  },
  {
    key: 'email',
    header: 'Почта',
    width: '190px',
    hideBelow: 'lg',
    render: (row) =>
      row.email ? (
        <a
          href={`mailto:${row.email}`}
          className="block truncate text-brand-blue hover:underline"
        >
          {row.email}
        </a>
      ) : (
        <span className="text-neutral-30">—</span>
      ),
  },
  {
    key: 'comment',
    header: 'Комментарий',
    hideBelow: 'lg',
    render: (row) =>
      row.comment ? (
        // line-clamp-2, а не truncate: комментарий — единственное
        // место, где салон пишет своими словами, и одна строка чаще
        // всего обрывается на середине мысли.
        <p className="line-clamp-2 text-neutral-60">{row.comment}</p>
      ) : (
        <span className="text-neutral-30">—</span>
      ),
  },
  {
    key: 'created_at',
    header: 'Поступила',
    width: '116px',
    align: 'right',
    hideBelow: 'sm',
    render: (row) => DATE.format(new Date(row.created_at)),
  },
  {
    key: 'status',
    header: 'Стадия',
    width: '132px',
    render: (row) => <LeadStatusSelect leadId={row.id} initial={row.status} />,
  },
];

type SearchParams = {
  status?: string;
  offset?: string;
};

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const offset = Math.max(Number(sp.offset ?? 0) || 0, 0);
  // Неизвестное значение в адресе игнорируем, а не отдаём в запрос:
  // ?status=abc иначе дал бы пустой список, и админ решил бы, что
  // заявок нет вовсе.
  const status = STATUSES.some((s) => s.value === sp.status)
    ? sp.status
    : undefined;

  const supabase = await getServerClient();

  // count: 'exact' в том же запросе — иначе пришлось бы делать второй
  // ради числа строк. head не ставим: строки нужны и они же считаются.
  let query = supabase
    .from('dealer_leads')
    .select(
      'id, company_name, contact_name, phone, email, city, comment, tax_id, registration_number, website, status, created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;

  const rows = error ? [] : ((data ?? []) as DealerLead[]);
  const total = count ?? 0;

  return (
    <>
      <AdminBackBar current="Заявки салонов" />

      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-h2 font-bold">Заявки автосалонов</h1>
        {!error && (
          <p className="shrink-0 text-caption text-neutral-60">
            Найдено: {total}
          </p>
        )}
      </div>

      <p className="mt-1 text-caption text-neutral-60">
        Приходят с формы на странице «Автосалонам».
      </p>

      <AdminFilters action="/admin/leads" active={Boolean(status)}>
        <FilterField label="Стадия">
          <select
            name="status"
            defaultValue={status ?? ''}
            className={CONTROL_CLASS}
          >
            <option value="">Все</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </FilterField>
      </AdminFilters>

      {error ? (
        // Ошибку показываем текстом, а не пустым списком: «заявок нет»
        // и «список не загрузился» — разные новости, и вторая требует
        // действий, а не ожидания.
        <div className="mt-4 rounded-card border border-error/30 bg-status-error p-4">
          <p className="font-semibold text-error">Заявки не загрузились</p>
          <p className="mt-1 text-caption text-neutral-70">
            Обновите страницу. Если не помогает — проблема на стороне базы.
          </p>
        </div>
      ) : (
        <>
          <Table
            className="mt-4"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            stickyHeader
            empty={
              status
                ? 'Заявок в этой стадии нет'
                : 'Заявок пока нет'
            }
          />

          <AdminPagination
            path="/admin/leads"
            params={{ status }}
            offset={offset}
            limit={PAGE_SIZE}
            total={total}
          />
        </>
      )}
    </>
  );
}
