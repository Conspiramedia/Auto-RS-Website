'use client';

// ============================================================
// RS AUTO — Тумблер «публиковать без модерации». Client Component.
// ============================================================
// Управляет profiles.trusted_seller одного салона.
//
// ЧТО ЭТОТ ФЛАГ ЗНАЧИТ НА САМОМ ДЕЛЕ. Салон с ним получает право
// публиковать в обход единственной проверки контента на площадке.
// Поэтому интерфейс здесь намеренно неторопливый: переключение
// спрашивает подтверждение, а состояние перерисовывается по ОТВЕТУ
// СЕРВЕРА, а не по нажатию. Оптимистичное обновление тут было бы
// вредным: увидеть включённый тумблер при невыполненной операции —
// значит решить, что объявления салона больше не проверяются, хотя
// они проверяются.
//
// role="switch" вместо checkbox: это ровно переключатель состояния,
// и скринридер обязан прочитать его как «включено / выключено», а не
// как пункт списка выбора.
//
// ВКЛЮЧЕНИЕ И ВЫКЛЮЧЕНИЕ НЕСИММЕТРИЧНЫ ПО ЦЕНЕ ОШИБКИ, но подтверждение
// спрашивается в обе стороны. Ошибочное включение открывает поток
// непроверенных объявлений; ошибочное выключение заваливает очередь
// работой, которой не должно быть. Оба случая стоят одного нажатия.
// ============================================================

import { useState, useTransition } from 'react';

import { setDealerTrusted } from '@/app/admin/actions';

type Props = {
  userId: string;
  initial: boolean;
};

export default function TrustedToggle({ userId, initial }: Props) {
  const [trusted, setTrusted] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = () => {
    setError(null);
    startTransition(async () => {
      const result = await setDealerTrusted(userId, !trusted);

      if (!result.ok) {
        setError(result.error);
        setAsking(false);
        return;
      }

      // Состояние — из ответа сервера. См. шапку файла.
      setTrusted(result.trusted);
      setAsking(false);
    });
  };

  return (
    <div className="rounded-card border border-neutral-10 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-semibold">Публиковать без модерации</p>
          <p className="mt-1 text-caption text-neutral-60">
            {trusted
              ? 'Объявления салона попадают в выдачу сразу, минуя очередь.'
              : 'Объявления салона проходят проверку, как у всех продавцов.'}
          </p>
        </div>

        {/* Сам переключатель. min-w/h держат цель нажатия: дорожка
            44×24 плюс поле вокруг неё за счёт p-2 у кнопки. */}
        <button
          type="button"
          role="switch"
          aria-checked={trusted}
          aria-label="Публиковать без модерации"
          disabled={pending}
          onClick={() => setAsking(true)}
          className="
            flex min-h-[44px] shrink-0 items-center rounded-control p-2
            transition-colors duration-fast
            hover:bg-surface-hover disabled:opacity-40
          "
        >
          <span
            className={[
              'relative h-6 w-11 rounded-pill transition-colors duration-fast',
              trusted ? 'bg-success' : 'bg-neutral-30',
            ].join(' ')}
          >
            <span
              className={[
                'absolute top-0.5 size-5 rounded-pill bg-white shadow-sticky',
                'transition-all duration-fast',
                trusted ? 'left-[22px]' : 'left-0.5',
              ].join(' ')}
            />
          </span>
        </button>
      </div>

      {/* Подтверждение. Строкой под тумблером, а не модальным окном:
          в отличие от блокировки, это обратимое действие в один клик,
          и останавливать ради него работу всего экрана незачем. */}
      {asking && (
        <div className="mt-3 rounded-control bg-surface-muted p-3">
          <p className="text-caption">
            {trusted
              ? 'Вернуть объявления салона в очередь модерации?'
              : 'Разрешить салону публиковать без проверки? Новые объявления сразу попадут в выдачу.'}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={apply}
              disabled={pending}
              className="
                min-h-[44px] rounded-control bg-brand-dark px-4
                text-caption font-semibold text-white
                transition-opacity duration-fast
                hover:opacity-90 disabled:opacity-40
              "
            >
              {pending ? 'Сохраняем…' : 'Да'}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={pending}
              className="
                min-h-[44px] rounded-control border border-neutral-15 px-4
                text-caption transition-colors duration-fast
                hover:bg-surface-hover disabled:opacity-40
              "
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-caption text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
