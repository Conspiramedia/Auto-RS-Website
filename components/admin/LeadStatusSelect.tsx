'use client';

// ============================================================
// RS AUTO — Стадия заявки автосалона. Client Component.
// ============================================================
// Единственный интерактивный элемент списка заявок. Всё остальное на
// экране остаётся серверным — клиентской становится одна ячейка
// таблицы, а не страница.
//
// ПОЧЕМУ SELECT, А НЕ ЧЕТЫРЕ КНОПКИ ИЛИ ТУМБЛЕР. Стадий четыре, и
// они не образуют пары «вкл/выкл»: заявка идёт new → in_progress →
// done либо rejected, причём менеджер вправе вернуть её назад
// (позвонил, не дозвонился, отложил). Ряд из четырёх кнопок в каждой
// строке таблицы на пятьдесят заявок — двести целей нажатия на
// экране; select занимает одну ячейку и читается как «текущее
// значение плюс список возможных».
//
// ПОДТВЕРЖДЕНИЯ НЕТ — в отличие от TrustedToggle и блокировки салона.
// Разница по цене ошибки: те действия меняют, что видят посетители
// сайта (право публиковать без проверки, скрытие объявлений), а стадия
// заявки — рабочая пометка менеджера, видимая только в админке и
// обратимая тем же select'ом в один шаг. Спрашивать «вы уверены?» на
// каждое «взял в работу» значило бы приучить нажимать «да» не читая —
// и подтверждение перестало бы работать там, где оно нужно.
//
// СОСТОЯНИЕ ПЕРЕРИСОВЫВАЕТСЯ ПО ОТВЕТУ СЕРВЕРА, а не по выбору. При
// отказе (сняли права, заявку удалили) значение возвращается к
// прежнему: показывать «Обработана» у заявки, которая в базе всё ещё
// новая, — худший исход для списка, по которому распределяют работу.
// ============================================================

import { useState, useTransition } from 'react';

import { setLeadStatus } from '@/app/admin/actions';

// Подписи и цвета стадий. Цвет сообщает СОСТОЯНИЕ РАБОТЫ, а не
// оценку: новая заявка золотая (требует внимания, как очередь
// модерации на дашборде), в работе — синяя, обработанная — зелёная,
// отклонённая — серая. Тот же приглушённый набор заливок, что у
// StatusChip: в таблице на полсотни строк сплошные цвета перебивают
// собственно данные.
const STATUSES: { value: string; label: string; className: string }[] = [
  { value: 'new', label: 'Новая', className: 'bg-status-warning text-warning' },
  {
    value: 'in_progress',
    label: 'В работе',
    className: 'bg-status-info text-brand-primary',
  },
  {
    value: 'done',
    label: 'Обработана',
    className: 'bg-status-success text-success',
  },
  {
    value: 'rejected',
    label: 'Отклонена',
    className: 'bg-surface-muted text-neutral-60',
  },
];

type Props = {
  leadId: string;
  initial: string;
};

export default function LeadStatusSelect({ leadId, initial }: Props) {
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current =
    STATUSES.find((s) => s.value === status) ?? STATUSES[STATUSES.length - 1];

  function change(next: string) {
    if (next === status) return;

    const previous = status;
    setError(null);
    // Значение в поле меняем сразу: без этого select визуально не
    // реагировал бы на выбор до ответа сервера и выглядел бы
    // сломанным. Откат ниже возвращает прежнее при отказе.
    setStatus(next);

    startTransition(async () => {
      const result = await setLeadStatus(leadId, next);

      if (!result.ok) {
        setStatus(previous);
        setError(result.error ?? 'Не удалось сохранить.');
      }
    });
  }

  return (
    <div className="min-w-0">
      {/* Заливка на самом select: так стадия читается взглядом по
          колонке, не вчитываясь в текст каждой строки. Своя стрелка
          не рисуется — системная у select привычнее и не требует
          подгонки под тему. */}
      <select
        value={status}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        aria-label="Стадия заявки"
        className={[
          'h-8 w-full min-w-0 rounded-pill px-2 text-micro font-medium',
          'border border-transparent outline-none',
          'transition-opacity duration-fast',
          'focus:border-neutral-30 disabled:opacity-50',
          current.className,
        ].join(' ')}
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {error && (
        <p className="mt-1 text-micro text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
