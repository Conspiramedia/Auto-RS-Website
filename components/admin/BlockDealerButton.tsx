'use client';

// ============================================================
// RS AUTO — Блокировка автосалона. Client Component.
// ============================================================
// Снимает флаг доверия и убирает активные объявления салона из выдачи.
// Оба действия — одной транзакцией в admin_block_dealer (0085):
// разделять их нельзя, см. пояснение в самой миграции.
//
// ДИАЛОГ, А НЕ ПОДТВЕРЖДЕНИЕ В СТРОКЕ — в отличие от тумблера доверия
// рядом. Разница в цене ошибки: тумблер переключается обратно одним
// нажатием, а блокировка снимает с публикации все объявления салона,
// и возвращать их придётся по одному через карточку каждого. Такое
// действие обязано требовать осознанного шага и объяснения причины.
//
// ПРИЧИНА ОБЯЗАТЕЛЬНА и с теми же границами (10–1000), что у отказа
// в модерации и снятия объявления: один и тот же счётчик символов во
// всех диалогах админки. Она попадает в журнал — через полгода нужно
// уметь ответить, за что салон закрыли.
//
// Разметка диалога повторяет CarStatusButton: два разных модальных
// окна в одном инструменте читались бы как элементы разных продуктов.
// ============================================================

import { useEffect, useRef, useState } from 'react';

import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import {
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
} from '@/lib/admin/rejectionReasons';
import { blockDealer } from '@/app/admin/actions';
import { useDismissableLayer } from '@/lib/useDismissableLayer';

type Props = {
  userId: string;
  companyName: string;
  // Сколько объявлений скроется. Показывается в диалоге: «заблокировать»
  // звучит абстрактно, «скроется 12 объявлений» — нет.
  activeCount: number;
};

export default function BlockDealerButton({
  userId,
  companyName,
  activeCount,
}: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Esc, клик вне окна и блокировка прокрутки фона — общий хук, тот же
  // что у остальных слоёв сайта.
  useDismissableLayer({ open, onClose: () => setOpen(false), locked: busy });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= REASON_MIN_LENGTH && !busy;

  async function submit() {
    if (!canSubmit) return;

    setBusy(true);
    setError(null);

    const result = await blockDealer(userId, trimmed);

    if (result.ok) {
      setBusy(false);
      setOpen(false);
      setReason('');
      // Показываем результат строкой под кнопкой: сколько именно
      // объявлений скрылось. Просто закрыть диалог — значит оставить
      // админа гадать, сработало ли.
      setDone(result.hidden);
      return;
    }

    setBusy(false);
    setError(result.error);
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Заблокировать салон
      </Button>

      {done !== null && (
        <p className="mt-2 text-caption text-neutral-70">
          Салон заблокирован. Скрыто объявлений: {done}. Вернуть их можно
          по одному — на карточке каждого объявления.
        </p>
      )}

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
            aria-labelledby="block-dealer-title"
            onClick={(e) => e.stopPropagation()}
            className="
              max-h-[90dvh] w-full overflow-y-auto rounded-t-card bg-white p-4
              sm:max-w-lg sm:rounded-card sm:p-6
            "
          >
            <h2 id="block-dealer-title" className="text-h3 font-semibold">
              Заблокировать «{companyName}»
            </h2>

            {/* Последствия перечислены до поля ввода: решение
                принимается здесь, а не после того, как причина
                написана. */}
            <p className="mt-1 text-caption text-neutral-60">
              Публикация без модерации будет отключена
              {activeCount > 0 ? (
                <>
                  , а {activeCount}{' '}
                  {activeCount === 1 ? 'объявление уйдёт' : 'объявлений уйдут'}{' '}
                  из выдачи
                </>
              ) : null}
              . Объявления не удаляются — их можно вернуть на карточке
              каждого.
            </p>

            <textarea
              ref={inputRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={REASON_MAX_LENGTH}
              rows={3}
              placeholder="За что блокируется салон"
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
                variant="destructive"
                onClick={submit}
                disabled={!canSubmit}
              >
                {busy ? 'Блокируем…' : 'Заблокировать'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
