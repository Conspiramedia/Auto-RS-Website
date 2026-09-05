'use client';

// ============================================================
// RS AUTO — Уровень продавца в карточке пользователя. Client Component.
// ============================================================
// Уровень (0143) обычно считается сам: объявления, квалифицированные
// продажи, статус салона, нарушения. Этот блок нужен для случаев,
// которых формула не знает, и устроен так, чтобы РУЧНОЕ НАЗНАЧЕНИЕ
// БЫЛО ВИДНО СРАЗУ — иначе через полгода никто не отличит уровень,
// заработанный продавцом, от выданного руками.
//
// ПОЧЕМУ ПРИЧИНА ОБЯЗАТЕЛЬНА И В ФОРМЕ, И В БАЗЕ. В базе — чтобы
// правило нельзя было обойти в принципе (constraint в 0143). Здесь —
// чтобы админ узнал об этом до отправки, а не из красной строки
// после. Кнопка «Назначить» до заполнения причины выключена.
//
// СОСТОЯНИЕ — ИЗ ОТВЕТА СЕРВЕРА, как у TrustedToggle. Оптимистичное
// обновление здесь вредно: назначение перекрывает расчёт, и увидеть
// выданный уровень при неудавшейся операции значит решить, что вопрос
// закрыт, хотя он не закрыт.
// ============================================================

import { useState, useTransition } from 'react';

import { clearSellerTier, setSellerTier } from '@/app/admin/actions';

type Props = {
  userId: string;
  // Действующий уровень (то, что видят покупатели).
  tier: number;
  // Назначенный вручную. null — уровень считается по данным.
  override: number | null;
  overrideReason: string | null;
  // Пока отметка в будущем, расчётный уровень понижен на ступень.
  penaltyUntil: string | null;
};

// Подписи ступеней. Административные, а не покупательские: админу
// нужен номер и металл, а не «Активный продавец».
const TIER_LABELS: Record<number, string> = {
  0: '0 — без уровня',
  1: '1 — бронза',
  2: '2 — серебро',
  3: '3 — золото',
};

const DATE = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export default function SellerTierControl({
  userId,
  tier,
  override,
  overrideReason,
  penaltyUntil,
}: Props) {
  const [current, setCurrent] = useState(tier);
  const [manual, setManual] = useState<number | null>(override);
  const [reasonText, setReasonText] = useState(overrideReason ?? '');
  const [choice, setChoice] = useState<number>(override ?? tier);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const penaltyActive =
    penaltyUntil !== null && new Date(penaltyUntil) > new Date();

  const apply = () => {
    setError(null);
    startTransition(async () => {
      const result = await setSellerTier(userId, choice, reasonText.trim());

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setCurrent(result.tier);
      setManual(choice);
    });
  };

  const clear = () => {
    setError(null);
    startTransition(async () => {
      const result = await clearSellerTier(userId);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Уровень вернулся к расчётному — показываем ИМЕННО его, а не
      // прежнее ручное значение: ради этого RPC и пересчитывает сразу.
      setCurrent(result.tier);
      setManual(null);
      setReasonText('');
      setChoice(result.tier);
    });
  };

  return (
    <div className="rounded-card border border-neutral-10 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">Уровень продавца</p>
        <span className="text-caption text-neutral-60">
          сейчас: {TIER_LABELS[current] ?? current}
        </span>
      </div>

      {/* Происхождение уровня — первое, что нужно знать при разборе.
          Три взаимоисключающих состояния, поэтому одна строка, а не
          набор пометок. */}
      <p className="mt-1 text-caption text-neutral-60">
        {manual !== null
          ? 'Назначен вручную — расчёт по данным не действует.'
          : 'Считается по данным: объявления, продажи, статус салона.'}
      </p>

      {manual !== null && overrideReason && (
        <p className="mt-2 rounded-control bg-surface-muted p-2 text-caption">
          Причина: {overrideReason}
        </p>
      )}

      {/* Штраф показываем всегда, когда он действует: без него
          расчётный уровень выглядит занижённым без причины, и админ
          пойдёт искать ошибку в формуле. */}
      {penaltyActive && penaltyUntil && (
        <p className="mt-2 text-caption text-error">
          Действует понижение на ступень до {DATE.format(new Date(penaltyUntil))}{' '}
          (снято объявление).
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0">
          <span className="block text-micro text-neutral-50">Назначить</span>
          <select
            value={choice}
            onChange={(e) => setChoice(Number(e.target.value))}
            disabled={pending}
            className="
              mt-1 min-h-[44px] rounded-control border border-neutral-15
              bg-white px-3 text-caption disabled:opacity-40
            "
          >
            {[0, 1, 2, 3].map((v) => (
              <option key={v} value={v}>
                {TIER_LABELS[v]}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0 flex-1">
          <span className="block text-micro text-neutral-50">
            Причина (обязательно)
          </span>
          <input
            type="text"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            disabled={pending}
            placeholder="Например: договор с салоном, компенсация за сбой"
            className="
              mt-1 min-h-[44px] w-full rounded-control border border-neutral-15
              px-3 text-caption disabled:opacity-40
            "
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={pending || reasonText.trim().length === 0}
          className="
            min-h-[44px] rounded-control bg-brand-dark px-4
            text-caption font-semibold text-white
            transition-opacity duration-fast
            hover:opacity-90 disabled:opacity-40
          "
        >
          {pending ? 'Сохраняем…' : 'Назначить'}
        </button>

        {/* Снятие показываем только когда есть что снимать: кнопка,
            которая ничего не делает, заставляет гадать, что она
            делает. */}
        {manual !== null && (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="
              min-h-[44px] rounded-control border border-neutral-15 px-4
              text-caption transition-colors duration-fast
              hover:bg-surface-hover disabled:opacity-40
            "
          >
            Вернуть расчёт по данным
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-caption text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
