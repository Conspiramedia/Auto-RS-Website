// ============================================================
// RS AUTO — Окно автосалона. Server Component.
// ============================================================
// Всё про один салон на одном экране: профиль, право публиковать без
// модерации, объявления со статусами и блокировка.
//
// ПОЧЕМУ ОТДЕЛЬНОЕ ОКНО, А НЕ КАРТОЧКА ПОЛЬЗОВАТЕЛЯ. Салон и частник
// разбираются по-разному. У частника вопрос «что за человек и что он
// подал»; у салона — «работает ли он по договору, можно ли ему
// доверять публикацию и что у него сейчас в выдаче». Это разные наборы
// полей и разные действия, и попытка уложить их в один экран дала бы
// карточку с половиной пустых блоков в каждом из двух случаев.
//
// ДАННЫЕ — ДВА ВЫЗОВА, ОБА ПАРАЛЛЕЛЬНО:
//   admin_get_dealer (0085) — профиль и мини-статы одной строкой;
//   admin_list_cars (0080)  — объявления салона; своей RPC для них не
//     заводим, у существующей уже есть фильтр по владельцу.
//
// Права проверил layout. Настоящая защита ниже: обе RPC падают с
// insufficient_privilege у любого, кто не админ.
// ============================================================

import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminBackBar from '@/components/admin/AdminBackBar';
import BlockDealerButton from '@/components/admin/BlockDealerButton';
import CarStatusButton from '@/components/admin/CarStatusButton';
import RevokeDealerButton from '@/components/admin/RevokeDealerButton';
import StatusChip from '@/components/admin/StatusChip';
import TrustedToggle from '@/components/admin/TrustedToggle';
import { getServerClient } from '@/lib/supabaseServer';
import type { AdminCarRow, AdminDealerProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Объявлений на экран. Салон с сотней объявлений разбирается в общем
// списке, где есть фильтры и пагинация, — сюда ведёт ссылка внизу.
const LISTINGS_LIMIT = 50;

const DATE = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

// Дата с временем — для МОМЕНТА (регистрация салона). Здесь, в
// отличие от узких колонок списков, время встаёт в одну строку: поле
// стоит в сетке профиля и ширины хватает.
//
// DATE выше остаётся и используется для КАЛЕНДАРНОЙ ДАТЫ договора:
// у неё времени нет по смыслу, и печатать «00:00» значило бы
// выдумывать точность, которой в данных не было.
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Поле профиля. Незаполненные не печатаются заглушками вида «—»:
// поля города, контактного лица и даты договора появились в 0085, и у
// существующих салонов они пусты. Ряд прочерков выглядит как
// сломанная страница, а не как «данных пока нет».
function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null;
}) {
  if (value === null || value === undefined || value === '') return null;

  return (
    <div className="min-w-0">
      <dt className="text-micro text-neutral-50">{label}</dt>
      <dd className="mt-0.5 break-words text-caption">{value}</dd>
    </div>
  );
}

// Мини-стат. Ведёт в отфильтрованный список объявлений салона: число
// без возможности его разобрать бесполезно.
function MiniStat({
  label,
  value,
  href,
  tone = 'plain',
}: {
  label: string;
  value: number;
  href: string;
  tone?: 'plain' | 'accent' | 'alert';
}) {
  const valueClass =
    tone === 'alert'
      ? 'text-error'
      : tone === 'accent'
        ? 'text-brand-gold'
        : 'text-neutral-100';

  return (
    <Link
      href={href}
      className="
        flex min-h-[44px] flex-col justify-center rounded-card
        border border-neutral-10 p-3
        transition-colors duration-fast hover:bg-surface-hover
      "
    >
      <span className="text-micro text-neutral-50">{label}</span>
      <span className={`mt-0.5 text-h3 font-bold tabular-nums ${valueClass}`}>
        {value}
      </span>
    </Link>
  );
}

type Params = { id: string };

export default async function AdminDealerPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await getServerClient();

  const [dealerResult, listingsResult] = await Promise.all([
    supabase.rpc('admin_get_dealer', { p_user_id: id }),
    supabase.rpc('admin_list_cars', {
      p_status: null,
      p_query: null,
      p_city: null,
      p_user_id: id,
      p_sort: 'created_desc',
      p_limit: LISTINGS_LIMIT,
      p_offset: 0,
    }),
  ]);

  if (dealerResult.error) notFound();

  const dealer = ((dealerResult.data ?? [])[0] ??
    null) as AdminDealerProfile | null;

  // Профиля нет или это не салон — RPC отдаёт пустой результат в обоих
  // случаях (проверка seller_kind внутри неё). 404 честнее пустой
  // страницы с заголовком «Автосалон».
  if (!dealer) notFound();

  // Список объявлений не критичен: без него окно всё равно показывает
  // профиль и управление. Ронять страницу из-за него нельзя.
  const listings = (listingsResult.error
    ? []
    : (listingsResult.data ?? [])) as AdminCarRow[];

  const initial = dealer.company_name.trim().charAt(0).toUpperCase() || 'A';
  const listingsHref = `/admin/listings?user=${dealer.user_id}`;

  return (
    <>
      <AdminBackBar current={dealer.company_name} />

      {/* ---------- Шапка окна ---------- */}
      <div className="mt-2 flex items-center gap-3">
        <div className="relative size-14 shrink-0 overflow-hidden rounded-card bg-surface-muted">
          {dealer.logo_url ? (
            <Image
              src={dealer.logo_url}
              alt={dealer.company_name}
              fill
              sizes="56px"
              className="object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-h3 font-bold text-neutral-50">
              {initial}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <h1 className="truncate text-h2 font-bold">{dealer.company_name}</h1>
          {dealer.trusted_seller && (
            <span className="mt-1 inline-block rounded-pill bg-status-success px-2 py-0.5 text-micro font-semibold text-neutral-80">
              публикует без модерации
            </span>
          )}
        </div>
      </div>

      {/* ---------- Мини-статы ---------- */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <MiniStat
          label="Активные"
          value={dealer.active_count}
          href={`${listingsHref}&status=active`}
        />
        <MiniStat
          label="В очереди"
          value={dealer.queue_count}
          href={`${listingsHref}&status=moderation`}
          tone="accent"
        />
        <MiniStat
          label="Отклонённые"
          value={dealer.rejected_count}
          href={`${listingsHref}&status=rejected`}
          tone="alert"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* ---------- Профиль и управление ---------- */}
        <div className="min-w-0">
          <div className="rounded-card border border-neutral-10 p-4">
            <h2 className="text-h4 font-semibold">Профиль</h2>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Город" value={dealer.company_city} />
              <Field label="Контактное лицо" value={dealer.contact_person} />
              <Field
                label="Телефон для связи"
                value={
                  dealer.contact_phone ? (
                    <a
                      href={`tel:${dealer.contact_phone.replace(/\s/g, '')}`}
                      className="text-brand-blue hover:underline"
                    >
                      {dealer.contact_phone}
                    </a>
                  ) : null
                }
              />
              <Field label="Телефон входа" value={dealer.phone} />
              <Field
                label="Почта"
                value={
                  dealer.email ? (
                    <a
                      href={`mailto:${dealer.email}`}
                      className="text-brand-blue hover:underline"
                    >
                      {dealer.email}
                    </a>
                  ) : null
                }
              />
              <Field
                label="Дата договора"
                value={
                  dealer.contract_date
                    ? DATE.format(new Date(dealer.contract_date))
                    : null
                }
              />
              <Field
                label="Регистрация"
                value={DATE_TIME.format(new Date(dealer.created_at))}
              />
            </dl>

            {/* Подсказка, когда реквизиты не заполнены. Поля появились
                в 0085, и у заведённых раньше салонов они пусты — без
                этой строки блок выглядел бы обрезанным. */}
            {!dealer.company_city &&
              !dealer.contact_person &&
              !dealer.contract_date && (
                <p className="mt-3 text-micro text-neutral-50">
                  Город, контактное лицо и дата договора пока не заполнены.
                </p>
              )}
          </div>

          {/* Тумблер доверия — отдельным блоком под профилем: это не
              справочное поле, а действие с последствиями. */}
          <div className="mt-4">
            <TrustedToggle
              userId={dealer.user_id}
              initial={dealer.trusted_seller}
            />
          </div>

          {/* Блокировка и отзыв — в самом низу колонки, одним блоком.
              Порядок от мягкого к жёсткому: сначала обратимая
              блокировка, ниже отзыв статуса, за которым владельцу
              придётся подавать заявку заново. Разделены чертой и
              подписями, чтобы две красные кнопки подряд не читались
              как одна и та же с разными словами. */}
          <div className="mt-4 rounded-card border border-neutral-10 p-4">
            <h2 className="text-h4 font-semibold">Блокировка</h2>
            <p className="mt-1 text-caption text-neutral-60">
              Отключает публикацию без модерации и убирает активные
              объявления из выдачи. Продавец остаётся салоном.
            </p>
            <div className="mt-3">
              <BlockDealerButton
                userId={dealer.user_id}
                companyName={dealer.company_name}
                activeCount={dealer.active_count}
              />
            </div>

            <div className="mt-5 border-t border-neutral-10 pt-4">
              <h2 className="text-h4 font-semibold">Отзыв статуса</h2>
              <p className="mt-1 text-caption text-neutral-60">
                Продавец становится частным лицом: страница салона
                отключается, витрина очищается, активные объявления
                уходят из выдачи. Вернуть статус сможет только новая
                заявка владельца.
              </p>
              <div className="mt-3">
                <RevokeDealerButton
                  userId={dealer.user_id}
                  companyName={dealer.company_name}
                  activeCount={dealer.active_count}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ---------- Объявления салона ---------- */}
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-h4 font-semibold">Объявления</h2>
            <Link
              href={listingsHref}
              className="shrink-0 text-caption text-brand-blue hover:underline"
            >
              В общем списке →
            </Link>
          </div>

          {listings.length === 0 ? (
            <p className="mt-2 text-caption text-neutral-50">
              {listingsResult.error
                ? 'Список объявлений не загрузился. Обновите страницу.'
                : 'Салон не подавал объявлений.'}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-neutral-10 rounded-card border border-neutral-10">
              {listings.map((car) => (
                <li
                  key={car.car_id}
                  className="
                    flex flex-col gap-2 px-3 py-2.5
                    sm:flex-row sm:items-center sm:justify-between sm:gap-3
                  "
                >
                  {/* Название ведёт на карточку проверки — оттуда
                      видно фотографии и историю решений. */}
                  <Link
                    href={`/admin/queue/${car.car_id}`}
                    className="min-w-0 flex-1 text-caption hover:underline"
                  >
                    <span className="block truncate font-medium">
                      {car.brand} {car.model}, {car.year}
                    </span>
                    <span className="block truncate text-micro text-neutral-50">
                      {car.city}
                      {car.sale_price
                        ? ` · ${car.sale_price} ${car.currency}`
                        : ''}
                    </span>
                  </Link>

                  <span className="flex shrink-0 items-center gap-2">
                    <StatusChip status={car.status} />
                    {/* Снятие с продажи прямо отсюда: это самое частое
                        действие при разборе жалобы на салон. Кнопка та
                        же, что в общем списке объявлений, — второй её
                        реализации быть не должно. */}
                    {(car.status === 'active' || car.status === 'archived') && (
                      <CarStatusButton carId={car.car_id} status={car.status} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {listings.length >= LISTINGS_LIMIT && (
            <p className="mt-2 text-micro text-neutral-50">
              Показаны последние {LISTINGS_LIMIT}. Остальные — в общем
              списке по ссылке выше.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
