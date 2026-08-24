// ============================================================
// RS AUTO — Строка фильтров админки. Server Component.
// ============================================================
// ФИЛЬТРЫ ЖИВУТ В URL, а не в состоянии React. Это решение, а не
// экономия: адрес с фильтрами можно переслать коллеге («посмотри вот
// эти отклонённые в Нови-Саде»), сохранить в закладке и вернуться
// назад кнопкой браузера. Состояние в компоненте не умеет ничего из
// этого, зато требует 'use client' на весь список.
//
// Отсюда форма обычная, method="get": браузер сам соберёт поля в
// строку запроса и перезагрузит страницу. Ни одной строчки
// JavaScript — список остаётся серверным целиком.
//
// Кнопка «Сбросить» — обычная ссылка на тот же путь без параметров.
// Появляется только когда есть что сбрасывать: постоянная кнопка
// рядом с пустой формой сбивает с толку.
// ============================================================

import Link from 'next/link';
import type { ReactNode } from 'react';

type Props = {
  // Куда отправлять форму — путь текущего раздела.
  action: string;
  // Есть ли применённые фильтры: от этого зависит кнопка сброса.
  active: boolean;
  children: ReactNode;
};

// Общий вид поля фильтра: подпись сверху, контрол снизу.
export function FilterField({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="text-micro text-neutral-50">{label}</span>
      {children}
    </label>
  );
}

// Единый стиль контролов: высота и радиус те же, что у полей сайта,
// но плотнее — админка про плотность.
export const CONTROL_CLASS =
  'h-9 min-w-0 rounded-control border border-neutral-15 bg-white px-2 text-caption outline-none focus:border-neutral-30';

export default function AdminFilters({ action, active, children }: Props) {
  return (
    <form
      action={action}
      method="get"
      className="mt-4 flex flex-wrap items-end gap-2 rounded-card border border-neutral-10 p-3"
    >
      {children}

      {/* Кнопки в конце строки и прижаты к низу: они выравниваются по
          контролам, а не по подписям над ними. */}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="
            h-9 shrink-0 rounded-control bg-brand-dark px-4 text-caption
            font-medium text-white transition-opacity duration-fast
            hover:opacity-90
          "
        >
          Показать
        </button>

        {active && (
          <Link
            href={action}
            className="
              flex h-9 shrink-0 items-center rounded-control px-3 text-caption
              text-brand-red transition-colors duration-fast
              hover:bg-status-error
            "
          >
            Сбросить
          </Link>
        )}
      </div>
    </form>
  );
}
