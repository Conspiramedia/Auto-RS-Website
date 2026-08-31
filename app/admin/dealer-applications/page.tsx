// ============================================================
// RS AUTO — Заявки на статус автосалона. Server Component.
// ============================================================
// НЕ ПУТАТЬ С /admin/leads. Там маркетинговые лиды с формы
// «Автосалонам»: их оставляет кто угодно, не входя на сайт, и ведут
// они к звонку менеджера. Здесь — заявки вошедших пользователей с
// реквизитами компании, и одобрение каждой ВЫДАЁТ СТАТУС АВТОСАЛОНА:
// витрину в каталоге, страницу /dealer/{id} и отметку «Автосалон» на
// объявлениях. Разделы соседние по виду и разные по последствиям,
// поэтому и живут порознь.
//
// ПОЧЕМУ RPC, А НЕ ПРЯМОЙ SELECT — в отличие от списка лидов. Заявка
// показывается вместе с контактами аккаунта заявителя из profiles, а
// политика profiles_select_own отдаёт клиенту только собственный
// профиль. Собрать это обычным join нельзя; admin_dealer_applications
// (0100) — security definer с is_admin() первой строкой.
//
// КАРТОЧКИ, А НЕ ТАБЛИЦА — тоже в отличие от лидов. У заявки восемь
// полей реквизитов, комментарий заявителя и причина отказа: в строке
// таблицы они либо обрезаются до нечитаемости, либо требуют
// горизонтальной прокрутки. А главное — по этим данным принимают
// решение, а не отмечают стадию, и данные должны быть видны целиком,
// без раскрытия строки.
//
// ПЕРСОНАЛЬНЫЕ ДАННЫЕ. В заявке телефон, почта и реквизиты компании.
// Раздел закрыт от индексации метаданными layout'а и force-dynamic:
// кэшированная страница с контактами, отданная не тому, опаснее
// лишнего запроса к базе.
// ============================================================

import AdminBackBar from '@/components/admin/AdminBackBar';
import AdminFilters, {
  CONTROL_CLASS,
  FilterField,
} from '@/components/admin/AdminFilters';
import AdminPagination from '@/components/admin/AdminPagination';
import DealerApplicationCard from '@/components/admin/DealerApplicationCard';
import StateCard from '@/components/ui/StateCard';
import { getServerClient } from '@/lib/supabaseServer';
import type { AdminDealerApplication } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Меньше, чем в списке лидов (50): карточка заявки высокая, и полсотни
// таких — страница на несколько экранов прокрутки.
const PAGE_SIZE = 20;

const STATUSES = [
  { value: 'pending', label: 'Ждут решения' },
  { value: 'approved', label: 'Одобренные' },
  { value: 'rejected', label: 'Отклонённые' },
];

type SearchParams = {
  status?: string;
  offset?: string;
};

export default async function AdminDealerApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const offset = Math.max(Number(sp.offset ?? 0) || 0, 0);
  // Неизвестное значение в адресе игнорируем, а не отдаём в запрос:
  // RPC на него ответила бы исключением, и ошибка в адресной строке
  // уронила бы весь экран.
  const status = STATUSES.some((s) => s.value === sp.status)
    ? sp.status
    : undefined;

  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('admin_dealer_applications', {
    p_status: status ?? null,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });

  const rows = (error ? [] : (data ?? [])) as AdminDealerApplication[];

  // Общее число строк приходит в каждой строке окном count(*) over ().
  // На пустой странице его нет — значит, и показывать нечего.
  // Number() обязателен: bigint supabase-js отдаёт строкой, и без
  // приведения пагинация сравнивала бы строку с числом.
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return (
    <>
      <AdminBackBar current="Заявки на статус салона" />

      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-h2 font-bold">Заявки на статус автосалона</h1>
        {!error && (
          <p className="shrink-0 text-caption text-neutral-60">
            Найдено: {total}
          </p>
        )}
      </div>

      <p className="mt-1 text-caption text-neutral-60">
        Одобрение выдаёт аккаунту статус салона: карточку в каталоге,
        страницу витрины и отметку «Автосалон» на объявлениях. Проверяйте
        PIB и матични број по реестру APR.
      </p>

      <AdminFilters
        action="/admin/dealer-applications"
        active={Boolean(status)}
      >
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
        // «Заявок нет» и «список не загрузился» — разные новости, и
        // вторая требует действий, а не ожидания.
        <div className="mt-4 rounded-card border border-error/30 bg-status-error p-4">
          <p className="font-semibold text-error">Заявки не загрузились</p>
          <p className="mt-1 text-caption text-neutral-70">
            Обновите страницу. Если не помогает — проблема на стороне базы.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <StateCard
            locale="ru"
            title={status ? 'Заявок в этой стадии нет' : 'Заявок пока нет'}
            text="Заявка появится здесь, как только продавец отправит её из своего профиля."
          />
        </div>
      ) : (
        <>
          {/* Одна колонка на всех брейкпоинтах: карточка содержит
              реквизиты в две колонки внутри себя, и вторая колонка
              снаружи сузила бы их до переносов посреди номера.
              max-w-3xl — та же ширина, что у формы салона в кабинете:
              строка реквизита не должна тянуться через весь монитор. */}
          <div className="mt-4 max-w-3xl space-y-3">
            {rows.map((application) => (
              <DealerApplicationCard
                key={application.id}
                application={application}
              />
            ))}
          </div>

          <AdminPagination
            path="/admin/dealer-applications"
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
