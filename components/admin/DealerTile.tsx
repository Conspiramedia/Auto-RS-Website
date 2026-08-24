// ============================================================
// RS AUTO — Карточка автосалона на главной админки. Server Component.
// ============================================================
// Отличается от AdminTile тем, что показывает не одно число, а
// сущность: логотип, название и состояние дел. Поэтому отдельный
// компонент, а не параметр к общей плитке — попытка выразить это
// пропами превратила бы AdminTile в конструктор с семью флагами.
//
// НОВЫЙ САЛОН ПОЯВЛЯЕТСЯ САМ. Список приходит из admin_dealer_cards(),
// которая берёт все профили с seller_kind = 'dealer' через LEFT JOIN:
// салон попадает в сетку сразу после регистрации, ещё до первого
// объявления. Ручного добавления в какой-либо список нет.
// ============================================================

import Image from 'next/image';
import Link from 'next/link';

import type { AdminDealerCard } from '@/lib/types';

export default function DealerTile({ dealer }: { dealer: AdminDealerCard }) {
  // Первая буква названия как запасной знак. Логотип есть не у всех —
  // поле logo_url заполняется салоном добровольно, — а пустой серый
  // квадрат читается как незагрузившаяся картинка.
  const initial = dealer.company_name.trim().charAt(0).toUpperCase() || 'A';

  return (
    <Link
      href={`/admin/dealers/${dealer.user_id}`}
      className="
        flex min-h-[44px] flex-col rounded-card border border-neutral-10 p-4
        transition-colors duration-fast hover:bg-surface-hover
      "
    >
      <div className="flex items-center gap-3">
        {/* Логотип 40×40. relative + fill: пропорции у логотипов
            салонов произвольные, и object-cover обрезает их до
            квадрата вместо растягивания. */}
        <div className="relative size-10 shrink-0 overflow-hidden rounded-control bg-surface-muted">
          {dealer.logo_url ? (
            <Image
              src={dealer.logo_url}
              alt={dealer.company_name}
              fill
              sizes="40px"
              className="object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center font-bold text-neutral-50">
              {initial}
            </span>
          )}
        </div>

        <div className="min-w-0">
          {/* truncate: названия салонов бывают длинными, а карточка в
              двухколоночной сетке на 360px узкая. */}
          <p className="truncate font-semibold">{dealer.company_name}</p>
          {dealer.company_city && (
            <p className="truncate text-micro text-neutral-50">
              {dealer.company_city}
            </p>
          )}
        </div>
      </div>

      {/* Состояние дел. Активные объявления — всегда; очередь — только
          когда есть что проверять: постоянный «0 в очереди» перестаёт
          замечаться, и появление первой единицы теряется. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro">
        <span className="tabular-nums text-neutral-60">
          {dealer.active_count} активных
        </span>

        {dealer.queue_count > 0 && (
          <span className="rounded-pill bg-brand-gold px-2 py-0.5 font-bold text-brand-dark tabular-nums">
            {dealer.queue_count} в очереди
          </span>
        )}

        {/* Метка доверия. Показывается только включённой: у обычного
            салона отсутствие метки и означает «как все».
            Подпись тёмная, а не зелёная: brand.green как ЦВЕТ ТЕКСТА
            даёт 3.0:1 на светлой заливке и не проходит WCAG AA
            (известный долг, см. tests/e2e/a11y.spec.ts). Зелёным здесь
            работает подложка, и этого достаточно, чтобы метка читалась
            как положительная. */}
        {dealer.trusted_seller && (
          <span className="rounded-pill bg-status-success px-2 py-0.5 font-semibold text-neutral-80">
            без модерации
          </span>
        )}
      </div>
    </Link>
  );
}
