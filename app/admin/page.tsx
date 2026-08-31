// ============================================================
// RS AUTO — Главный экран админ-комнаты. Server Component.
// ============================================================
// ЕДИНАЯ МОДЕЛЬ «ОКОН». Экран — сетка кликабельных карточек, одинаковая
// на телефоне и на мониторе. Меню нет ни в каком виде: раздел
// открывается карточкой, возврат — кнопкой «← На главную» на самом
// разделе.
//
// ЗАЧЕМ СЧЁТЧИК И ССЫЛКА СЛИЛИСЬ В ОДНО. Модератор открывает админку с
// одним вопросом: «есть работа?». Раньше ответ («в очереди 7») лежал
// плиткой в центре экрана, а переход в очередь — пунктом меню слева:
// два разных места для одного намерения. Теперь ответ и есть кнопка.
//
// СОСТАВ СЕТКИ — ПОЛНЫЙ, НИ ОДИН РАЗДЕЛ НЕ ПОТЕРЯН. Прежний сайдбар
// содержал: Дашборд, Очередь, Объявления, Пользователи, Журнал, ← На
// сайт. Дашборд — это сам этот экран; «На сайт» переехало в шапку;
// остальные четыре имеют здесь свою карточку. Плюс карточки салонов,
// которых в меню не было вовсе — раздел новый.
//
// Права проверил layout, повторять здесь не нужно. Настоящая защита
// данных всё равно ниже: admin_dashboard_stats() и admin_dealer_cards()
// падают с insufficient_privilege у любого, кто не админ, даже при
// прямом вызове из консоли браузера.
//
// Три запроса идут параллельно: они независимы, и последовательное
// ожидание утроило бы задержку первого экрана.
// ============================================================

import Link from 'next/link';

import AdminTile from '@/components/admin/AdminTile';
import DealerTile from '@/components/admin/DealerTile';
import StateCard from '@/components/ui/StateCard';
import type {
  AdminDashboardStats,
  AdminDealerCard,
  AdminQueueItem,
} from '@/lib/types';
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

// Сетка окон. Два столбца на телефоне (карточка шириной ~164px на
// 360px экрана — читается и попадает пальцем), три на планшете,
// четыре на мониторе. Больше четырёх не делаем: карточки стали бы
// уже подписи «Активных объявлений».
const GRID = 'grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4';

export default async function AdminHomePage() {
  const supabase = await getServerClient();

  const [
    statsResult,
    queueResult,
    dealersResult,
    leadsResult,
    applicationsResult,
  ] = await Promise.all([
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

      // Карточки салонов одним вызовом: счётчики считаются агрегатом
      // внутри RPC, отдельного запроса на каждый салон нет (0085).
      supabase.rpc('admin_dealer_cards'),

      // Необработанные заявки салонов — только ЧИСЛО, строки не нужны:
      // head: true отдаёт count без единой строки данных, а сами
      // заявки разбираются в своём разделе. Считаем 'new', а не все:
      // карточка отвечает на вопрос «есть ли работа», и общее число
      // заявок за всё время на него не отвечает.
      supabase
        .from('dealer_leads')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new'),

      // Заявки на СТАТУС салона, ждущие решения (0100). Не путать с
      // лидами выше: те ведут к звонку менеджера, а эти — к выдаче
      // прав. Читаются через RPC, потому что заявка показывается с
      // контактами заявителя из profiles, закрытых RLS; здесь нужен
      // только счётчик, поэтому берём одну страницу и смотрим на
      // total_count из окна.
      supabase.rpc('admin_dealer_applications', {
        p_status: 'pending',
        p_limit: 1,
        p_offset: 0,
      }),
    ]);

  // Сводка возвращается таблицей из одной строки.
  const stats = (
    statsResult.error ? null : ((statsResult.data ?? [])[0] ?? null)
  ) as AdminDashboardStats | null;

  const queue = (queueResult.error
    ? []
    : (queueResult.data ?? [])) as AdminQueueItem[];

  const dealers = (dealersResult.error
    ? []
    : (dealersResult.data ?? [])) as AdminDealerCard[];

  // Ошибка счётчика заявок не должна ронять экран: раздел открывается
  // и без числа на карточке.
  const newLeads = leadsResult.error ? 0 : (leadsResult.count ?? 0);

  // Число ждущих заявок на статус салона. Приходит окном count(*)
  // over () в единственной запрошенной строке; пустой ответ означает
  // пустую очередь. Number() обязателен: bigint supabase-js отдаёт
  // строкой, и без приведения карточка вывела бы «"3"».
  const pendingApplications = (() => {
    if (applicationsResult.error) return 0;
    const first = (applicationsResult.data ?? [])[0] as
      | { total_count: number | string }
      | undefined;
    return first ? Number(first.total_count) : 0;
  })();

  return (
    <>
      {/* Заголовок совпадает с подписью в шапке и с title вкладки:
          три разных названия одного экрана («Дашборд», «Админка»,
          «RS Auto») сбивали бы с толку. */}
      <h1 className="text-h2 font-bold">RS Auto · Админка</h1>

      {/* ============================================================
          РАБОТА — счётчики, ведущие туда, где их разбирают.
          ============================================================ */}
      {stats ? (
        <>
          <h2 className="sr-only">Сводка</h2>

          <div className={`mt-6 ${GRID}`}>
            <AdminTile
              href="/admin/queue"
              label="В очереди"
              value={stats.queue_count}
              tone="accent"
              hint="Ждут проверки"
            />
            {/* Одобренные и отклонённые за сегодня ведут в список
                объявлений с соответствующим статусом. Точного фильтра
                «за сегодня» в admin_list_cars нет, и заводить его ради
                двух карточек не стали: список отсортирован по свежести,
                и сегодняшние решения лежат сверху. */}
            <AdminTile
              href="/admin/listings?status=active&sort=created_desc"
              label="Одобрено сегодня"
              value={stats.approved_today}
            />
            <AdminTile
              href="/admin/listings?status=rejected&sort=created_desc"
              label="Отклонено сегодня"
              value={stats.rejected_today}
            />
            <AdminTile
              href="/admin/listings?status=active"
              label="Активных объявлений"
              value={stats.active_total}
            />

            <AdminTile
              href="/admin/users"
              label="Пользователей"
              value={stats.users_total}
            />
            {/* Фильтр по дате регистрации добавлен в 0085 именно ради
                этой карточки: без него число не на чем проверить. */}
            <AdminTile
              href="/admin/users?new_days=7"
              label="Новых за 7 дней"
              value={stats.users_new_7d}
            />
            {/* ПОЧЕМУ ПИСЬМА ВЕДУТ В ЖУРНАЛ, А НЕ В СВОЙ РАЗДЕЛ.
                Очередь писем живёт в таблице email_queue, читающей RPC
                у неё нет, и заводить целый раздел ради двух цифр в
                рамках этой задачи не стали. Журнал — ближайшее место,
                где видно, что происходило с решениями модерации, за
                которыми письма и следуют.
                Фильтр по действию не подставляем: значений «письмо» в
                журнале нет (там только car_*), и ссылка с ?action=email
                открыла бы заведомо пустой список. */}
            <AdminTile
              href="/admin/log"
              label="Писем в очереди"
              value={stats.email_pending}
              hint="Норма: уходят в течение минуты"
            />
            {/* Единственная карточка, которая умеет краснеть заливкой.
                Провалившиеся письма — не статистика, а инцидент:
                продавцы не получают решений модерации. */}
            <AdminTile
              href="/admin/log"
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
        // остальное: разделы читаются другими запросами и, скорее
        // всего, живы. Ронять весь экран из-за счётчиков нельзя.
        //
        // StateCard variant="error" здесь НЕ ПОДХОДИТ, хотя выглядит
        // подходящим по смыслу: он прогоняет ссылки через localeHref и
        // при locale='ru' увёл бы на несуществующий /ru/admin, а вторая
        // его кнопка ведёт в каталог — выброс из рабочего инструмента
        // на витрину.
        <div className="mt-6 rounded-card border border-error/30 bg-status-error p-4">
          <p className="font-semibold text-error">Сводка недоступна</p>
          <p className="mt-1 text-caption text-neutral-70">
            Счётчики не загрузились. Разделы ниже открываются и работают
            независимо.
          </p>
          <Link
            href="/admin"
            className="mt-2 inline-block text-caption text-brand-blue hover:underline"
          >
            Обновить
          </Link>
        </div>
      )}

      {/* ============================================================
          РАЗДЕЛЫ — бывшие пункты сайдбара, теперь окна.
          ============================================================
          Сверено с прежним меню: Очередь, Объявления, Пользователи,
          Журнал. «Дашборд» — этот самый экран, «← На сайт» — в шапке.
          Ни один пункт не потерян. */}
      <h2 className="mt-10 text-h3 font-semibold">Разделы</h2>

      <div className={`mt-3 ${GRID}`}>
        <AdminTile
          href="/admin/queue"
          label="Очередь"
          hint="Проверка объявлений"
        />
        <AdminTile
          href="/admin/listings"
          label="Объявления"
          hint="Поиск и статусы"
        />
        <AdminTile
          href="/admin/users"
          label="Пользователи"
          hint="Профили и права"
        />
        {/* Заявки салонов. Со счётчиком и тоном accent, как у очереди
            модерации: это тоже неразобранная работа, только приходит
            она с формы «Автосалонам», а не из подачи объявлений.
            До этой карточки таблица dealer_leads (0053) заполнялась
            формой на /dealers и не читалась никем: открыть её было
            неоткуда — ни ссылки, ни страницы в админке не было.
            Ноль новых заявок счётчик показывает честно: карточка тогда
            просто не требует внимания, но раздел остаётся доступным. */}
        <AdminTile
          href="/admin/leads"
          label="Заявки салонов"
          value={newLeads}
          tone="accent"
          hint="Новые, ждут звонка"
        />
        {/* ЗАЯВКИ НА СТАТУС — ОТДЕЛЬНАЯ КАРТОЧКА, а не пункт внутри
            «Заявок салонов» выше. Разница в последствиях: там лид,
            который ведёт к звонку и ничего не выдаёт, здесь —
            решение, выдающее аккаунту витрину в каталоге и отметку
            «Автосалон» на объявлениях. Сложи мы их в один счётчик,
            число «7» перестало бы отвечать на вопрос, что именно
            ждёт разбора. Тон accent — это неразобранная работа, как
            очередь модерации. */}
        <AdminTile
          href="/admin/dealer-applications"
          label="Статус салона"
          value={pendingApplications}
          tone="accent"
          hint="Заявки, ждут решения"
        />
        <AdminTile
          href="/admin/log"
          label="Журнал"
          hint="Действия администраторов"
        />
        {/* Согласия на куки (0094). Без счётчика намеренно: число
            согласий растёт с каждым первым визитом и работы не
            означает — смотреть сюда идут не «разбирать», а
            предъявлять доказательство по конкретному запросу. */}
        <AdminTile
          href="/admin/consents"
          label="Согласия на куки"
          hint="Доказательства и выгрузка"
        />
      </div>

      {/* ============================================================
          АВТОСАЛОНЫ.
          ============================================================
          Раздела с таким списком в прежнем меню не было вовсе: салоны
          разбирались через общий список пользователей с фильтром. */}
      <h2 className="mt-10 text-h3 font-semibold">Автосалоны</h2>

      {dealers.length === 0 ? (
        <div className="mt-3">
          <StateCard
            locale="ru"
            title="Салонов пока нет"
            text="Карточка появится здесь автоматически, как только зарегистрируется первый автосалон."
          />
        </div>
      ) : (
        // Сетка та же, что у окон выше: салон — такое же окно, и
        // выделять его отдельной раскладкой незачем.
        <div className={`mt-3 ${GRID}`}>
          {dealers.map((dealer) => (
            <DealerTile key={dealer.user_id} dealer={dealer} />
          ))}
        </div>
      )}

      {/* ============================================================
          ГОЛОВА ОЧЕРЕДИ.
          ============================================================
          Единственный список на экране окон — и он здесь заслуженно:
          отвечает на вопрос «что именно ждёт», на который карточка со
          счётчиком ответить не может. */}
      <div className="mt-10 flex items-center justify-between gap-4">
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
              {/* Строка целиком — ссылка на карточку проверки.
                  min-h 44px: на телефоне это цель нажатия. */}
              <Link
                href={`/admin/queue/${car.id}`}
                className="
                  flex min-h-[44px] flex-col justify-center gap-1 px-4 py-2.5 text-caption
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
