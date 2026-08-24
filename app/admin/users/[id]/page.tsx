// ============================================================
// RS AUTO — Карточка пользователя. Server Component.
// ============================================================
// Профиль, его объявления и действия администраторов НАД НИМ — одним
// вызовом admin_get_user (0080).
//
// «Действия над ним» — записи журнала, где target_id равен id
// пользователя (верификация документов, блокировки). Действия над его
// ОБЪЯВЛЕНИЯМИ сюда не попадают: у них target_id — идентификатор
// объявления, и их история живёт на карточке каждого объявления, где
// ей и место. Смешать их значило бы получить ленту, в которой не
// разобрать, что относится к человеку, а что к конкретной машине.
//
// РОЛЬ АДМИНИСТРАТОРА ТОЛЬКО ПОКАЗЫВАЕТСЯ. Кнопки выдачи и снятия
// нет: флаг ставится вручную в SQL Editor (см. 0078). Это защита от
// собственного скомпрометированного аккаунта, а не недоделка.
// ============================================================

import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminBackBar from '@/components/admin/AdminBackBar';
import ActionLabel from '@/components/admin/ActionLabel';
import StatusChip from '@/components/admin/StatusChip';
import { getServerClient } from '@/lib/supabaseServer';
import type { AdminUser } from '@/lib/types';

export const dynamic = 'force-dynamic';

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const DATE = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro text-neutral-50">{label}</dt>
      <dd className="mt-0.5 break-words text-caption">{value}</dd>
    </div>
  );
}

const VERIFICATION: Record<string, string> = {
  unverified: 'не подавались',
  pending: 'на проверке',
  verified: 'подтверждены',
  rejected: 'отклонены',
};

type Params = { id: string };

export default async function AdminUserPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('admin_get_user', {
    p_user_id: id,
  });

  if (error) notFound();

  const user = ((data ?? [])[0] ?? null) as AdminUser | null;
  if (!user) notFound();

  return (
    <>
      <AdminBackBar
        parent={{ label: 'Пользователи', href: '/admin/users' }}
        current={user.full_name ?? 'Профиль'}
      />

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-h3 font-semibold">
          {user.full_name ?? 'без имени'}
        </h1>
        {/* Флаг администратора — только показ, см. шапку файла. */}
        {user.is_admin && (
          <span className="rounded-pill bg-brand-dark px-2 py-0.5 text-micro font-medium text-white">
            администратор
          </span>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* ---------- Профиль ---------- */}
        <div className="min-w-0">
          <div className="rounded-card border border-neutral-10 p-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Почта" value={user.email} />
              <Field label="Телефон" value={user.phone ?? '—'} />
              <Field
                label="Роль"
                value={user.role === 'dealer' ? 'Автосалон' : 'Частное лицо'}
              />
              <Field
                label="Язык писем"
                value={user.locale === 'ru' ? 'русский' : 'сербский'}
              />
              <Field
                label="Регистрация"
                value={DATE.format(new Date(user.created_at))}
              />
              <Field
                label="Последний вход"
                value={
                  user.last_sign_in_at
                    ? DATE.format(new Date(user.last_sign_in_at))
                    : '—'
                }
              />
              <Field
                label="Документы"
                value={
                  VERIFICATION[user.verification_status] ??
                  user.verification_status
                }
              />
              <Field
                label="Рейтинг"
                value={
                  user.reviews_count > 0
                    ? `${user.rating_avg} (${user.reviews_count})`
                    : 'нет отзывов'
                }
              />
            </dl>

            {/* Причина отказа по документам — если она есть, это
                важнее половины полей выше: человек мог написать в
                поддержку именно из-за неё. */}
            {user.verification_comment && (
              <div className="mt-3 rounded-control bg-status-error p-2">
                <p className="text-micro text-neutral-50">
                  Причина отказа по документам
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-caption">
                  {user.verification_comment}
                </p>
              </div>
            )}
          </div>

          {/* Сводка по объявлениям. Числа кликабельны: с карточки
              продавца в отфильтрованный список — самый частый переход
              при разборе жалобы. */}
          <div className="mt-4 rounded-card border border-neutral-10 p-4">
            <p className="text-micro text-neutral-50">Объявления</p>
            <p className="mt-1 text-caption">
              Всего {user.listings_total} · активных {user.listings_active}
              {user.listings_rejected > 0 && (
                <span className="text-error">
                  {' '}
                  · отклонено {user.listings_rejected}
                </span>
              )}
            </p>
            <Link
              href={`/admin/listings?user=${user.user_id}`}
              className="mt-2 inline-block text-caption text-brand-blue hover:underline"
            >
              Открыть в списке объявлений →
            </Link>
          </div>
        </div>

        {/* ---------- Объявления и действия ---------- */}
        <div className="min-w-0">
          <h2 className="text-h4 font-semibold">Объявления</h2>

          {user.listings.length === 0 ? (
            <p className="mt-2 text-caption text-neutral-50">
              Пользователь не подавал объявлений.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-neutral-10 rounded-card border border-neutral-10">
              {user.listings.map((listing) => (
                <li key={listing.car_id}>
                  <Link
                    href={`/admin/queue/${listing.car_id}`}
                    className="
                      flex flex-col gap-1 px-3 py-2 text-caption
                      transition-colors duration-fast hover:bg-surface-hover
                      sm:flex-row sm:items-center sm:justify-between sm:gap-3
                    "
                  >
                    <span className="min-w-0 truncate font-medium">
                      {listing.brand} {listing.model}, {listing.year}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <StatusChip status={listing.status} />
                      <span className="tabular-nums text-neutral-50">
                        {DATE.format(new Date(listing.created_at))}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* Действия администраторов над самим пользователем.
              Блок появляется только когда они есть: у обычного
              продавца их не бывает вовсе, и пустой заголовок был бы
              шумом. */}
          {user.actions.length > 0 && (
            <>
              <h2 className="mt-6 text-h4 font-semibold">Действия</h2>
              <ul className="mt-2 space-y-2">
                {user.actions.map((event, i) => (
                  <li
                    key={`${event.created_at}-${i}`}
                    className="rounded-control border border-neutral-10 p-2 text-caption"
                  >
                    <ActionLabel action={event.action} />
                    <span className="text-neutral-60">
                      {' · '}
                      {event.actor_name}
                      {' · '}
                      {DATE_TIME.format(new Date(event.created_at))}
                    </span>
                    {typeof event.payload?.reason === 'string' && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-neutral-70">
                        {event.payload.reason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}
