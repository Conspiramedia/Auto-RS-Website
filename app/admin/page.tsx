// ============================================================
// RS AUTO — Дашборд админ-комнаты. Server Component.
// ============================================================
// Отвечает на один вопрос, ради которого модератор открывает админку:
// «есть ли работа и всё ли в порядке». Отсюда состав экрана —
// плитки-счётчики и короткий список того, что ждёт дольше всех.
//
// Права проверил layout, и повторять проверку здесь не нужно: попасть
// сюда, минуя его, нельзя. Настоящая защита данных всё равно ниже —
// admin_dashboard_stats() падает с insufficient_privilege у любого, кто
// не админ, даже при прямом вызове из консоли браузера.
//
// Два запроса идут параллельно: они независимы, и последовательное
// ожидание удвоило бы задержку первого экрана.
//
// Список последних действий модераторов появится в M7 вместе со
// страницей журнала — таблица admin_action_log уже пишется (0078), но
// читающей RPC для неё пока нет, а лезть в неё select'ом мимо RPC
// нельзя: на журнале deny-all и revoke.
// ============================================================

import Link from 'next/link';

import StateCard from '@/components/ui/StateCard';
import type { AdminDashboardStats, AdminQueueItem } from '@/lib/types';
import { getServerClient } from '@/lib/supabaseServer';

// Дата и время постановки в очередь. Свой формат, а не formatDate из
// lib/format: тот намеренно опускает время («15 марта 2026»), а
// модератору важно именно оно — по нему видно, объявление лежит час
// или третьи сутки.
const QUEUE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

// ------------------------------------------------------------
// Плитка счётчика.
// ------------------------------------------------------------
// tone управляет только цветом ЦИФРЫ, не заливкой: восемь цветных
// прямоугольников превратили бы сводку в витрину. Заливка появляется
// единственный раз — у провалившихся писем, и именно поэтому её там
// замечают.
function StatTile({
  label,
  value,
  tone = 'plain',
  hint,
}: {
  label: string;
  value: number;
  tone?: 'plain' | 'accent' | 'alert';
  hint?: string;
}) {
  const valueClass =
    tone === 'alert'
      ? 'text-error'
      : tone === 'accent'
        ? 'text-brand-gold'
        : 'text-neutral-100';

  return (
    <div
      className={[
        'rounded-card border p-4',
        tone === 'alert' && value > 0
          ? 'border-error/30 bg-status-error'
          : 'border-neutral-10',
      ].join(' ')}
    >
      <p className="text-small text-neutral-60">{label}</p>
      <p className={`mt-1 text-h2 font-bold tabular-nums ${valueClass}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-micro text-neutral-50">{hint}</p>}
    </div>
  );
}

export default async function AdminDashboardPage() {
  const supabase = await getServerClient();

  const [statsResult, queueResult] = await Promise.all([
    supabase.rpc('admin_dashboard_stats'),

    // Очередь читается обычным select под админской политикой
    // cars_select_admin_moderation (0015) — она отдаёт админу
    // объявления в статусах moderation и rejected. Отдельная RPC ради
    // пяти строк не нужна: фильтр и сортировка тут не бизнес-правило.
    //
    // Сортировка по возрастанию даты: «последние 5 в очереди» — это те,
    // что ждут ДОЛЬШЕ ВСЕХ, а не поданные только что. Разбирать нужно с
    // головы очереди, иначе первое объявление продавца зависает, пока
    // сверху сыплются новые.
    supabase
      .from('cars')
      .select('id, brand, model, year, city, created_at, user_id')
      .eq('status', 'moderation')
      .order('created_at', { ascending: true })
      .limit(5),
  ]);

  // Сводка возвращается таблицей из одной строки.
  const stats = (
    statsResult.error ? null : ((statsResult.data ?? [])[0] ?? null)
  ) as AdminDashboardStats | null;

  const queue = (queueResult.error
    ? []
    : (queueResult.data ?? [])) as AdminQueueItem[];

  return (
    <>
      <h1 className="text-h2 font-bold">Дашборд</h1>

      {/* ---------- Счётчики ---------- */}
      {stats ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="В очереди"
              value={stats.queue_count}
              tone="accent"
            />
            <StatTile label="Одобрено сегодня" value={stats.approved_today} />
            <StatTile label="Отклонено сегодня" value={stats.rejected_today} />
            <StatTile label="Активных объявлений" value={stats.active_total} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Пользователей" value={stats.users_total} />
            <StatTile label="Новых за 7 дней" value={stats.users_new_7d} />
            <StatTile
              label="Писем в очереди"
              value={stats.email_pending}
              hint="Норма: уходят в течение минуты"
            />
            {/* Единственная плитка, которая умеет краснеть заливкой.
                Провалившиеся письма — не статистика, а инцидент:
                продавцы не получают решений модерации. */}
            <StatTile
              label="Письма не ушли"
              value={stats.email_failed}
              tone="alert"
              hint={
                stats.email_failed > 0
                  ? 'Разобрать: продавцы не получили решение'
                  : undefined
              }
            />
          </div>
        </>
      ) : (
        // Сводка не отдалась — показываем это и продолжаем рисовать
        // очередь: она читается другим запросом и, скорее всего, жива.
        // Ронять весь дашборд из-за счётчиков нельзя.
        //
        // StateCard variant="error" здесь НЕ ПОДХОДИТ, хотя выглядит
        // подходящим по смыслу: он прогоняет ссылки через localeHref и
        // при locale='ru' увёл бы на несуществующий /ru/admin, а вторая
        // его кнопка ведёт в каталог — выброс из рабочего инструмента
        // на витрину. Своя плашка на четыре строки дешевле, чем
        // параметр «не трогай локаль» в общем компоненте ради одного
        // одноязычного раздела.
        <div className="mt-6 rounded-card border border-error/30 bg-status-error p-4">
          <p className="font-semibold text-error">Сводка недоступна</p>
          <p className="mt-1 text-caption text-neutral-70">
            Счётчики не загрузились. Очередь ниже читается отдельным
            запросом и работает независимо.
          </p>
          <Link
            href="/admin"
            className="mt-2 inline-block text-caption text-brand-blue hover:underline"
          >
            Обновить
          </Link>
        </div>
      )}

      {/* ---------- Голова очереди ---------- */}
      <div className="mt-8 flex items-center justify-between gap-4">
        <h2 className="text-h3 font-semibold">Ждут проверки дольше всех</h2>
        {queue.length > 0 && (
          <Link
            href="/admin/queue"
            className="shrink-0 text-caption text-brand-blue hover:underline"
          >
            Вся очередь →
          </Link>
        )}
      </div>

      {queue.length === 0 ? (
        <div className="mt-3">
          <StateCard
            locale="ru"
            title="Очередь пуста"
            text="Новые объявления появятся здесь сразу после подачи."
          />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-10 rounded-card border border-neutral-10">
          {queue.map((car) => (
            <li key={car.id}>
              {/* Строка целиком — ссылка на карточку проверки: она
                  появилась в M4. Высота ~40px по плотности админки;
                  на мобильном текст переносится, а дата уходит под
                  название. */}
              <Link
                href={`/admin/queue/${car.id}`}
                className="
                  flex flex-col gap-1 px-4 py-2.5 text-caption
                  transition-colors duration-fast hover:bg-surface-hover
                  sm:flex-row sm:items-center sm:justify-between sm:gap-4
                "
              >
                <span className="min-w-0 truncate font-medium">
                  {car.brand} {car.model}
                  {car.year ? ` · ${car.year}` : ''}
                  {car.city ? ` · ${car.city}` : ''}
                </span>
                <span className="shrink-0 tabular-nums text-neutral-50">
                  {QUEUE_TIME.format(new Date(car.created_at))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
