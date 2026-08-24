'use client';

// ============================================================
// RS AUTO — Снять объявление / вернуть в выдачу. Client Component.
// ============================================================
// В ОТЛИЧИЕ ОТ ОДОБРЕНИЯ, ЗДЕСЬ ДИАЛОГ ОБЯЗАТЕЛЕН — и не как
// «вы уверены?», а потому что нужна причина. Снятие опубликованного
// объявления продавец обнаружит сам: оно просто исчезнет из выдачи.
// Без объяснения это выглядит как поломка сайта, и человек идёт в
// поддержку выяснять, куда делось то, за что он мог заплатить за
// продвижение. Причина уходит ему письмом (шаблон
// car_archived_by_admin) и в колокольчик.
//
// Типовых причин здесь нет намеренно. Отклонение на модерации —
// поток из восьми повторяющихся случаев, для него список оправдан.
// Снятие опубликованного — редкое и всегда частное решение (жалоба,
// суд, продано мимо площадки), и готовый список только подталкивал
// бы выбрать приблизительно подходящий пункт вместо того, чтобы
// написать, что произошло на самом деле.
//
// Причина обязательна и при ВОЗВРАТЕ: через полгода нужно понимать,
// почему объявление вернули. Журнал без причины бесполезен ровно так
// же, как письмо без неё.
// ============================================================

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import {
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
} from '@/lib/admin/rejectionReasons';
import { setCarStatusByAdmin } from '@/app/admin/actions';
import { useDismissableLayer } from '@/lib/useDismissableLayer';

type Props = {
  carId: string;
  // Текущий статус: определяет доступное действие. Матрица переходов
  // живёт в admin_set_car_status (0080) — здесь только то, какую
  // кнопку показать.
  status: string;
  // Компактный вид для строки таблицы.
  size?: 'sm' | 'md';
};

export default function CarStatusButton({
  carId,
  status,
  size = 'sm',
}: Props) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useDismissableLayer({ open, onClose: () => setOpen(false), locked: busy });

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError(null);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Действие определяется статусом. Всё остальное — вне матрицы
  // переходов: на модерации решают approve_car/reject_car, проданное
  // и черновики администратор не трогает.
  const target: 'archived' | 'active' | null =
    status === 'active' ? 'archived' : status === 'archived' ? 'active' : null;

  if (target === null) return null;

  const isArchiving = target === 'archived';
  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= REASON_MIN_LENGTH && !busy;

  async function handleSubmit() {
    if (!canSubmit || target === null) return;
    setBusy(true);
    setError(null);

    const result = await setCarStatusByAdmin(carId, target, trimmed);

    if (result.ok) {
      setOpen(false);
      setBusy(false);
      // refresh, а не push: список перерисуется на месте, и модератор
      // не потеряет ни прокрутку, ни применённые фильтры.
      router.refresh();
      return;
    }

    setBusy(false);
    setError(result.error ?? 'Не удалось выполнить действие.');
  }

  return (
    <>
      <Button
        variant={isArchiving ? 'destructive' : 'secondary'}
        size={size}
        onClick={() => setOpen(true)}
      >
        {isArchiving ? 'Снять' : 'Вернуть'}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-modal flex items-end justify-center bg-surface-overlay p-0 sm:items-center sm:p-4"
          onClick={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="car-status-title"
            onClick={(e) => e.stopPropagation()}
            className="
              max-h-[90dvh] w-full overflow-y-auto rounded-t-card bg-white p-4
              sm:max-w-lg sm:rounded-card sm:p-6
            "
          >
            <h2 id="car-status-title" className="text-h3 font-semibold">
              {isArchiving
                ? 'Снять объявление с публикации'
                : 'Вернуть объявление в выдачу'}
            </h2>

            <p className="mt-1 text-caption text-neutral-60">
              {isArchiving
                ? 'Продавец получит письмо с этой причиной — объявление исчезнет из поиска, и без объяснения это выглядит как сбой.'
                : 'Причина попадёт в журнал: через полгода нужно понимать, почему объявление вернули.'}
            </p>

            <textarea
              ref={inputRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={REASON_MAX_LENGTH}
              rows={3}
              placeholder={
                isArchiving
                  ? 'Что не так с объявлением'
                  : 'Почему объявление возвращается'
              }
              className="
                mt-3 w-full rounded-control border border-neutral-15 px-3 py-2
                text-caption outline-none focus:border-neutral-30
              "
            />
            <p className="mt-1 text-micro text-neutral-50">
              {trimmed.length < REASON_MIN_LENGTH
                ? `Минимум ${REASON_MIN_LENGTH} символов (введено ${trimmed.length})`
                : `${trimmed.length} из ${REASON_MAX_LENGTH}`}
            </p>

            {error && (
              <Alert tone="error" className="mt-3">
                {error}
              </Alert>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Отмена
              </Button>
              <Button
                variant={isArchiving ? 'destructive' : 'primary'}
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {busy
                  ? 'Сохраняем…'
                  : isArchiving
                    ? 'Снять с публикации'
                    : 'Вернуть в выдачу'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
