// ============================================================
// RS AUTO — Журнал согласий на куки. Server Component.
// ============================================================
// ЗАЧЕМ ЭКРАН. Таблица cookie_consents (0094) существует ради одного —
// предъявить доказательство: кто, когда, с какого адреса и с какой
// редакцией документов согласился. Доказательство, лежащее только в
// базе, требует доступа к SQL Editor и знания схемы; при запросе
// регулятора или споре с пользователем это лишний барьер. Здесь то
// же самое читается глазами и выгружается в CSV одной кнопкой.
//
// ПОЧЕМУ ОБЫЧНЫЙ SELECT, А НЕ RPC. Политика cookie_consents_select_admin
// (0094) уже отдаёт таблицу только админу, а сортировка «сначала
// новые» и фильтр по версии — параметры выборки, а не бизнес-правило.
// Функция вокруг них ничего бы не проверяла. Так же читаются заявки
// салонов (/admin/leads) и голова очереди модерации на дашборде.
//
// ИНДЕКС ПОД ЭТОТ ЭКРАН УЖЕ ЕСТЬ: idx_cookie_consents_at (0094)
// заведён под «сначала новые» — порядок выбран не по вкусу, а по
// тому, подо что построен индекс.
//
// ПЕРСОНАЛЬНЫЕ ДАННЫЕ. IP и User-Agent — персональные данные, и раздел
// закрыт от индексации метаданными layout'а (noindex, nocache,
// noimageindex) плюс force-dynamic: кэшированная страница с адресами
// посетителей, отданная не тому, опаснее лишнего запроса к базе.
// ============================================================

import Link from 'next/link';

import AdminBackBar from '@/components/admin/AdminBackBar';
import AdminFilters, {
  CONTROL_CLASS,
  FilterField,
} from '@/components/admin/AdminFilters';
import AdminPagination from '@/components/admin/AdminPagination';
import Table, { type Column } from '@/components/ui/Table';
import { POLICY_VERSION } from '@/lib/legal';
import { getServerClient } from '@/lib/supabaseServer';
import type { CookieConsent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

// ДАТА С СЕКУНДАМИ И ЧАСОВЫМ ПОЯСОМ — требование задачи, и оно не
// косметическое. Согласие фиксирует момент, а «27 авг, 14:30» без
// секунд и зоны момент не определяет: при споре о том, было ли
// согласие дано до или после конкретного события, разница в минуту
// решает дело. Зона задана явно (Europe/Belgrade), а не берётся из
// браузера модератора: доказательство обязано читаться одинаково с
// любого компьютера, а не зависеть от настроек того, кто смотрит.
const CONSENT_TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Belgrade',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});

const columns: Column<CookieConsent>[] = [
  {
    key: 'consent_at',
    header: 'Когда (Белград)',
    width: '210px',
    render: (row) => (
      // tabular-nums: столбец дат сравнивается взглядом по разрядам,
      // и пропорциональные цифры сбивают выравнивание.
      <span className="tabular-nums">
        {CONSENT_TIME.format(new Date(row.consent_at))}
      </span>
    ),
  },
  {
    key: 'user_id',
    header: 'Кто',
    width: '260px',
    render: (row) =>
      row.user_id ? (
        // Ссылка в карточку пользователя: доказательство почти всегда
        // нужно применительно к конкретному человеку, и отсюда до его
        // профиля один переход, а не копирование uuid в поиск.
        <Link
          href={`/admin/users/${row.user_id}`}
          className="block truncate font-mono text-micro text-brand-blue hover:underline"
        >
          {row.user_id}
        </Link>
      ) : (
        // Гость — не пропуск данных, а нормальный и самый частый
        // случай: куки ставятся до всякого входа. Пишем словом, а не
        // прочерком: прочерк читается как «не заполнено».
        <span className="text-neutral-50">Гость</span>
      ),
  },
  {
    key: 'ip',
    header: 'IP',
    width: '150px',
    hideBelow: 'sm',
    render: (row) =>
      row.ip ? (
        <span className="font-mono text-micro">{row.ip}</span>
      ) : (
        <span className="text-neutral-30">—</span>
      ),
  },
  {
    key: 'policy_version',
    header: 'Версия политики',
    width: '150px',
    render: (row) => (
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-micro">{row.policy_version}</span>
        {/* Метка «не актуальна» у согласий на прежнюю редакцию. Это
            не ошибка и не повод для действий: баннер такому человеку
            уже показан заново (сравнение версий в lib/consent), и
            новое согласие появится отдельной строкой. Метка нужна,
            чтобы при выгрузке за период не принять старую редакцию
            за текущую. */}
        {row.policy_version !== POLICY_VERSION && (
          <span
            className="shrink-0 rounded-sm bg-surface-subtle px-1 text-micro text-neutral-50"
            title="Согласие дано на прежнюю редакцию документов"
          >
            стар.
          </span>
        )}
      </div>
    ),
  },
  {
    key: 'consents',
    header: 'Принято',
    width: '130px',
    hideBelow: 'lg',
    render: (row) => {
      // Показываем ключи со значением true. Сейчас он всегда один
      // (cookies), но перечисление, а не жёсткое «Куки», — потому что
      // категории добавляются без миграции (jsonb в 0094), и экран не
      // должен молча скрывать появившуюся.
      const accepted = Object.entries(row.consents ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k);

      return accepted.length > 0 ? (
        <span className="text-micro text-neutral-60">{accepted.join(', ')}</span>
      ) : (
        <span className="text-neutral-30">—</span>
      );
    },
  },
  {
    key: 'user_agent',
    header: 'Браузер',
    hideBelow: 'lg',
    render: (row) =>
      row.user_agent ? (
        // truncate с полной строкой в title: User-Agent длиной в 150
        // символов разорвал бы таблицу, но при разборе спора нужен
        // целиком — наведением мыши он доступен.
        <span
          className="block truncate text-micro text-neutral-50"
          title={row.user_agent}
        >
          {row.user_agent}
        </span>
      ) : (
        <span className="text-neutral-30">—</span>
      ),
  },
];

type SearchParams = {
  version?: string;
  who?: string;
  offset?: string;
};

export default async function AdminConsentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const offset = Math.max(Number(sp.offset ?? 0) || 0, 0);

  // Версия политики фильтруется свободной строкой, а не выбором из
  // списка: перечень редакций живёт в истории lib/legal.ts, в базе
  // его нет, и собирать select запросом distinct по всей таблице
  // ради выпадающего списка — лишнее сканирование на каждый показ.
  const version = (sp.version ?? '').trim() || undefined;

  // Кто: гости / вошедшие / все. Именно этот срез спрашивают первым —
  // «покажи согласия зарегистрированных», — и делать его через
  // текстовый поиск по uuid неудобно.
  const who = sp.who === 'users' || sp.who === 'guests' ? sp.who : undefined;

  const supabase = await getServerClient();

  // count: 'exact' в том же запросе — иначе понадобился бы второй ради
  // числа строк.
  let query = supabase
    .from('cookie_consents')
    .select(
      'id, user_id, consent_at, ip, user_agent, policy_version, consents',
      { count: 'exact' },
    )
    .order('consent_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (version) query = query.eq('policy_version', version);
  if (who === 'users') query = query.not('user_id', 'is', null);
  if (who === 'guests') query = query.is('user_id', null);

  const { data, error, count } = await query;

  const rows = error ? [] : ((data ?? []) as CookieConsent[]);
  const total = count ?? 0;

  // Ссылка на выгрузку несёт ТЕ ЖЕ фильтры, что и экран: модератор
  // видит выборку и выгружает именно её, а не всю таблицу целиком.
  const exportQuery = new URLSearchParams();
  if (version) exportQuery.set('version', version);
  if (who) exportQuery.set('who', who);
  const exportHref = `/admin/consents/export${
    exportQuery.size > 0 ? `?${exportQuery.toString()}` : ''
  }`;

  return (
    <>
      <AdminBackBar current="Согласия на куки" />

      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-h2 font-bold">Согласия на куки</h1>
        {!error && (
          <p className="shrink-0 text-caption text-neutral-60">
            Найдено: {total}
          </p>
        )}
      </div>

      <p className="mt-1 text-caption text-neutral-60">
        Журнал нажатий «Хорошо» в баннере. Каждое согласие — отдельная
        строка: история не перезаписывается. Актуальная редакция
        документов —{' '}
        <span className="font-mono text-micro">{POLICY_VERSION}</span>.
      </p>

      <AdminFilters
        action="/admin/consents"
        active={Boolean(version || who)}
      >
        <FilterField label="Версия политики">
          <input
            type="text"
            name="version"
            defaultValue={version ?? ''}
            placeholder={POLICY_VERSION}
            className={`${CONTROL_CLASS} w-40`}
          />
        </FilterField>

        <FilterField label="Кто">
          <select name="who" defaultValue={who ?? ''} className={CONTROL_CLASS}>
            <option value="">Все</option>
            <option value="users">Вошедшие</option>
            <option value="guests">Гости</option>
          </select>
        </FilterField>
      </AdminFilters>

      {error ? (
        // Ошибку показываем текстом, а не пустым списком: «согласий
        // нет» и «журнал не загрузился» — разные новости, и вторая
        // требует действий, а не ожидания.
        <div className="mt-4 rounded-card border border-error/30 bg-status-error p-4">
          <p className="font-semibold text-error">Журнал не загрузился</p>
          <p className="mt-1 text-caption text-neutral-70">
            Обновите страницу. Если не помогает — проблема на стороне базы.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-end">
            {/* Обычная ссылка, а не кнопка: выгрузка — переход по
                адресу, который отдаёт файл. Ссылку можно открыть в
                новой вкладке и скопировать; кнопка с JS ни того, ни
                другого не позволяет и потребовала бы клиентского
                компонента ради одного действия. */}
            <a
              href={exportHref}
              className="rounded-control border border-neutral-15 px-3 py-2 text-caption font-semibold text-brand-blue transition-colors duration-fast hover:bg-surface-hover"
            >
              Выгрузить CSV
            </a>
          </div>

          <Table
            className="mt-3"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            stickyHeader
            empty={
              version || who
                ? 'Согласий по этому фильтру нет'
                : 'Согласий пока нет'
            }
          />

          <AdminPagination
            path="/admin/consents"
            params={{ version, who }}
            offset={offset}
            limit={PAGE_SIZE}
            total={total}
          />
        </>
      )}
    </>
  );
}
