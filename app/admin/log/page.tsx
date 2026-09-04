// ============================================================
// RS AUTO — Журнал действий администраторов. Server Component.
// ============================================================
// Единственное окно в admin_action_log: таблица закрыта наглухо
// (0078 — RLS без политик плюс revoke всех грантов), и читается
// только через admin_action_list.
//
// РАСКРЫТИЕ PAYLOAD БЕЗ JAVASCRIPT. Подробности записи (причина,
// прежний статус, марка и модель) прячутся в <details> — нативный
// элемент, который открывается и с клавиатуры, и на телефоне, и
// работает до загрузки любого скрипта. Клиентский компонент ради
// «развернуть строку» сделал бы весь журнал гидрируемым списком на
// пятьдесят записей.
//
// Table здесь НЕ используется, и это осознанно: у таблицы одна
// строка = один <tr>, а раскрывающаяся запись требует второй строки
// под первой. Городить colSpan-строку внутри примитива значило бы
// протащить в общий ui вёрстку, нужную ровно одному разделу.
// Список из <details> даёт то же самое проще.
//
// ПАГИНАЦИЯ ЗДЕСЬ ОБЯЗАТЕЛЬНА, в отличие от очереди: журнал растёт
// всегда и по определению — это его назначение.
// ============================================================

import Link from 'next/link';

import AdminBackBar from '@/components/admin/AdminBackBar';
import ActionLabel from '@/components/admin/ActionLabel';
import AdminFilters, {
  CONTROL_CLASS,
  FilterField,
} from '@/components/admin/AdminFilters';
import AdminPagination from '@/components/admin/AdminPagination';
import { getServerClient } from '@/lib/supabaseServer';
import type { AdminActor, AdminLogRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const ACTIONS = [
  { value: 'car_approved', label: 'Объявление одобрено' },
  { value: 'car_rejected', label: 'Объявление отклонено' },
  { value: 'car_archived', label: 'Снято с публикации' },
  { value: 'car_restored', label: 'Возвращено в выдачу' },
  // Возврат владельцем (0089). Отдельной строкой, а не вместе с
  // car_restored: вопрос «кто вернул объявление в выдачу — мы или
  // продавец» и есть то, ради чего этот фильтр открывают.
  { value: 'car_restored_by_owner', label: 'Владелец вернул из архива' },
  // Действия над салонами (0085). Право публиковать без модерации
  // выдаётся и отзывается людьми, и через месяц нужно уметь ответить,
  // кто и когда его дал, — поэтому оба перехода отдельными строками,
  // а не одним «изменён флаг».
  { value: 'dealer_trusted_on', label: 'Салон: без модерации включено' },
  { value: 'dealer_trusted_off', label: 'Салон: без модерации выключено' },
  { value: 'dealer_blocked', label: 'Салон заблокирован' },
  // Автопубликация (0086). Actor в этих записях — сам салон, а не
  // администратор: действие выполнено системой по выданному салону
  // праву, и приписывать его человеку, которого в транзакции нет,
  // было бы неверно.
  { value: 'car_auto_approved', label: 'Опубликовано автоматически' },
  {
    value: 'car_autopublish_skipped',
    label: 'Автопубликация не прошла — в очередь',
  },
];

// Подписи полей payload. Неизвестный ключ выводится как есть:
// перечень открытый, и новое поле в журнале должно быть видно, даже
// если этот файл о нём не знает.
const PAYLOAD_LABELS: Record<string, string> = {
  reason: 'Причина',
  prev_status: 'Прежний статус',
  brand: 'Марка',
  model: 'Модель',
  user_id: 'Владелец',
  // Поля действий над салонами (0085).
  company: 'Салон',
  from: 'Было',
  to: 'Стало',
  hidden: 'Скрыто объявлений',
  // Поля матрицы статусов (0089).
  // via = 'dealer_blocked' у записей car_archived, сделанных массовой
  // блокировкой салона: причина там одна на все объявления и относится
  // к салону, а не к конкретной машине.
  via: 'В составе действия',
  // Кто снял объявление, которое владелец вернул из архива. У записи
  // car_restored_by_owner это ключевое поле: 'owner' — обычное дело,
  // 'admin' здесь появиться не должен вовсе (Р2 такой возврат
  // запрещает), и такая строка означала бы обход правила.
  prev_archived_by: 'Снял до возврата',
};

// Служебные поля, которые не показываем: они дублируют колонки или
// не читаются человеком.
const PAYLOAD_HIDDEN = new Set(['user_id']);

type SearchParams = {
  action?: string;
  actor?: string;
  target?: string;
  from?: string;
  to?: string;
  offset?: string;
};

// Дата из формы приходит как YYYY-MM-DD. Превращаем в границу суток
// по времени сервера; невалидную строку молча игнорируем — фильтр по
// периоду не тот случай, ради которого стоит показывать ошибку.
function toBoundary(value: string | undefined, endOfDay: boolean): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Верхняя граница полуоткрытая: [from, to) со сдвигом на сутки не
  // теряет события последней секунды дня.
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

export default async function AdminLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const offset = Math.max(Number(sp.offset ?? 0) || 0, 0);
  const action = sp.action || undefined;
  const from = toBoundary(sp.from, false);
  const to = toBoundary(sp.to, true);

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const actor = sp.actor && uuidRe.test(sp.actor) ? sp.actor : undefined;
  const target = sp.target && uuidRe.test(sp.target) ? sp.target : undefined;

  const hasFilters = Boolean(action || actor || target || from || to);

  const supabase = await getServerClient();

  // Список администраторов для фильтра идёт параллельно записям: он
  // независим, и последовательное ожидание удвоило бы задержку.
  const [logResult, actorsResult] = await Promise.all([
    supabase.rpc('admin_action_list', {
      p_action: action ?? null,
      p_actor: actor ?? null,
      p_target_id: target ?? null,
      p_from: from,
      p_to: to,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    }),
    supabase.rpc('admin_actors'),
  ]);

  const rows = logResult.error
    ? []
    : ((logResult.data ?? []) as AdminLogRow[]);
  const total = rows[0]?.total_count ?? 0;
  const actors = actorsResult.error
    ? []
    : ((actorsResult.data ?? []) as AdminActor[]);

  return (
    <>
      <AdminBackBar current="Журнал" />

      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-h2 font-bold">Журнал</h1>
        {!logResult.error && (
          <p className="shrink-0 text-caption text-neutral-60">
            Записей: {total}
          </p>
        )}
      </div>

      <AdminFilters action="/admin/log" active={hasFilters}>
        <FilterField label="Действие">
          <select
            name="action"
            defaultValue={action ?? ''}
            className={CONTROL_CLASS}
          >
            <option value="">Любое</option>
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Администратор">
          <select
            name="actor"
            defaultValue={actor ?? ''}
            className={CONTROL_CLASS}
          >
            <option value="">Любой</option>
            {actors.map((a) => (
              <option key={a.actor_id} value={a.actor_id}>
                {a.actor_name} ({a.actions})
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="С даты">
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ''}
            className={CONTROL_CLASS}
          />
        </FilterField>

        <FilterField label="По дату">
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ''}
            className={CONTROL_CLASS}
          />
        </FilterField>

        {/* Фильтр по объекту выставляется ссылкой (например, из
            карточки объявления) и переносится скрытым полем. */}
        {target && <input type="hidden" name="target" value={target} />}
      </AdminFilters>

      {target && (
        <p className="mt-2 text-caption text-neutral-60">
          Показаны действия по одному объекту.{' '}
          <Link href="/admin/log" className="text-brand-blue-ink hover:underline">
            Показать все
          </Link>
        </p>
      )}

      {logResult.error ? (
        <div className="mt-4 rounded-card border border-error/30 bg-status-error p-4">
          <p className="font-semibold text-error">Журнал не загрузился</p>
          <p className="mt-1 text-caption text-neutral-70">
            Попробуйте обновить страницу.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4 rounded-card border border-neutral-10 px-6 py-12 text-center">
          <h2 className="text-h3 font-semibold">
            {hasFilters ? 'Ничего не найдено' : 'Журнал пуст'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-neutral-60">
            {hasFilters
              ? 'Измените фильтры или сбросьте их.'
              : 'Записи появятся после первого решения модерации.'}
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-neutral-10 rounded-card border border-neutral-10">
            {rows.map((row) => {
              // Показываем только осмысленные поля payload: служебные
              // дублируют колонки, пустые не несут ничего.
              const entries = Object.entries(row.payload ?? {}).filter(
                ([key, value]) =>
                  !PAYLOAD_HIDDEN.has(key) &&
                  value !== null &&
                  value !== '',
              );

              return (
                <li key={row.id}>
                  {/* <details> вместо клиентского состояния: нативное
                      раскрытие работает с клавиатуры, на телефоне и
                      без единой строчки JavaScript. */}
                  <details className="group">
                    <summary
                      className="
                        flex cursor-pointer list-none flex-col gap-1 px-3 py-2
                        text-caption transition-colors duration-fast
                        hover:bg-surface-hover
                        sm:flex-row sm:items-center sm:justify-between sm:gap-3
                      "
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {/* Треугольник рисуем сами: нативный маркер
                            list-none убран, чтобы строка выглядела
                            одинаково во всех браузерах. */}
                        <span className="shrink-0 text-neutral-40 transition-transform duration-fast group-open:rotate-90">
                          ▸
                        </span>
                        <ActionLabel action={row.action} />
                      </span>

                      <span className="flex shrink-0 items-center gap-3 text-neutral-60">
                        <span className="truncate">{row.actor_name}</span>
                        <span className="tabular-nums text-neutral-50">
                          {DATE_TIME.format(new Date(row.created_at))}
                        </span>
                      </span>
                    </summary>

                    <div className="border-t border-neutral-10 bg-surface-subtle px-3 py-3">
                      {entries.length === 0 ? (
                        <p className="text-caption text-neutral-50">
                          Дополнительных данных нет.
                        </p>
                      ) : (
                        <dl className="grid gap-2 sm:grid-cols-2">
                          {entries.map(([key, value]) => (
                            <div key={key} className="min-w-0">
                              <dt className="text-micro text-neutral-50">
                                {PAYLOAD_LABELS[key] ?? key}
                              </dt>
                              <dd className="mt-0.5 whitespace-pre-wrap break-words text-caption">
                                {typeof value === 'string' ||
                                typeof value === 'number'
                                  ? String(value)
                                  : JSON.stringify(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}

                      {/* Переход к объекту действия. Для объявлений
                          ведём на карточку модерации: она открывается
                          и для уже разобранных. */}
                      {row.target_table === 'cars' && row.target_id && (
                        <div className="mt-3 flex flex-wrap gap-3">
                          <Link
                            href={`/admin/queue/${row.target_id}`}
                            className="text-caption text-brand-blue-ink hover:underline"
                          >
                            Открыть объявление →
                          </Link>
                          <Link
                            href={`/admin/log?target=${row.target_id}`}
                            className="text-caption text-brand-blue-ink hover:underline"
                          >
                            Все действия по нему →
                          </Link>
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>

          <AdminPagination
            path="/admin/log"
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
