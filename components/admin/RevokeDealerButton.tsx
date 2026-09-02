'use client';

// ============================================================
// RS AUTO — Отзыв статуса автосалона. Client Component.
// ============================================================
// ЧЕМ ОТЛИЧАЕТСЯ ОТ БЛОКИРОВКИ, стоящей рядом. Блокировка снимает
// флаг доверия и убирает объявления из выдачи, но продавец остаётся
// салоном: витрина /dealer/{id} жива, он числится в каталоге салонов,
// а одобренная заявка позволяет ему вернуть публикацию. Отзыв
// забирает сам статус — заявки уходят в rejected, профиль становится
// частным, поля витрины затираются (admin_revoke_dealer, 0125).
//
// ОБРАТИМОСТЬ НЕСИММЕТРИЧНА, и это главное, что должен понимать
// администратор до нажатия. Объявления он вернёт сам, по одному, с
// карточки каждого. Статус — не вернёт: владелец обязан подать новую
// заявку, и её снова придётся рассматривать. Поэтому подтверждение
// здесь строже, чем у блокировки: мало написать причину, нужно
// набрать название салона. Это не украшение — набор названия ломает
// автоматизм «диалог → кнопка справа» и заставляет прочитать, над
// каким именно салоном занесена рука.
//
// ПРИЧИНА ОБЯЗАТЕЛЬНА и с теми же границами (10–1000), что во всех
// диалогах админки. Она уходит владельцу в колокольчик и письмо, и
// попадает в журнал: через полгода нужно уметь ответить, за что у
// салона забрали статус.
//
// Разметка диалога повторяет BlockDealerButton — два разных модальных
// окна в одном инструменте читались бы как элементы разных продуктов.
// ============================================================

import { useEffect, useRef, useState } from 'react';

import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import {
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
} from '@/lib/admin/rejectionReasons';
import { revokeDealer } from '@/app/admin/actions';
import { useDismissableLayer } from '@/lib/useDismissableLayer';

type Props = {
  userId: string;
  companyName: string;
  // Сколько объявлений уйдёт из выдачи. Показывается в диалоге:
  // «отозвать статус» звучит абстрактно, «скроется 12 объявлений» —
  // нет.
  activeCount: number;
};

export default function RevokeDealerButton({
  userId,
  companyName,
  activeCount,
}: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
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
  // Сравнение без учёта регистра и краевых пробелов: цель проверки —
  // заставить прочитать название, а не поймать на опечатке в регистре.
  const nameMatches =
    confirmName.trim().toLocaleLowerCase() ===
    companyName.trim().toLocaleLowerCase();
  const canSubmit =
    trimmed.length >= REASON_MIN_LENGTH && nameMatches && !busy;

  function close() {
    setOpen(false);
    setConfirmName('');
  }

  async function submit() {
    if (!canSubmit) return;

    setBusy(true);
    setError(null);

    const result = await revokeDealer(userId, trimmed);

    if (result.ok) {
      setBusy(false);
      setOpen(false);
      setReason('');
      setConfirmName('');
      // Показываем результат строкой под кнопкой: одного закрытия
      // диалога мало — админ останется гадать, сработало ли.
      setDone(result.hidden);
      return;
    }

    setBusy(false);
    setError(result.error);
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Отозвать статус салона
      </Button>

      {done !== null && (
        <p className="mt-2 text-caption text-neutral-70">
          Статус отозван, продавец снова частное лицо. Скрыто объявлений:{' '}
          {done}. Вернуть их можно по одному — на карточке каждого
          объявления. Статус салона возвращается только новой заявкой
          владельца.
        </p>
      )}

      {open && (
        <div
          className="fixed inset-0 z-modal flex items-end justify-center bg-surface-overlay p-0 sm:items-center sm:p-4"
          onClick={() => {
            if (!busy) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="revoke-dealer-title"
            onClick={(e) => e.stopPropagation()}
            className="
              max-h-[90dvh] w-full overflow-y-auto rounded-t-card bg-white p-4
              sm:max-w-lg sm:rounded-card sm:p-6
            "
          >
            <h2 id="revoke-dealer-title" className="text-h3 font-semibold">
              Отозвать статус у «{companyName}»
            </h2>

            {/* Последствия перечислены до полей ввода: решение
                принимается здесь, а не после того, как причина
                написана. Список, а не абзац, — их четыре, и абзацем
                они не читаются. */}
            <ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-neutral-60">
              <li>Продавец станет частным лицом.</li>
              <li>
                Страница салона в каталоге отключится, витрина (логотип,
                описание, обложка, контакты салона) будет очищена.
              </li>
              {activeCount > 0 && (
                <li>
                  {activeCount}{' '}
                  {activeCount === 1 ? 'объявление уйдёт' : 'объявлений уйдут'}{' '}
                  из выдачи. Объявления не удаляются — их можно вернуть на
                  карточке каждого.
                </li>
              )}
              <li className="font-medium text-neutral-70">
                Вернуть статус сможет только новая заявка владельца — её
                придётся рассматривать заново.
              </li>
            </ul>

            <textarea
              ref={inputRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={REASON_MAX_LENGTH}
              rows={3}
              placeholder="За что отзывается статус салона"
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

            {/* Набор названия — второй замок. См. шапку файла. */}
            <label
              htmlFor="revoke-confirm-name"
              className="mt-4 block text-caption font-medium"
            >
              Для подтверждения введите название салона
            </label>
            <input
              id="revoke-confirm-name"
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
              placeholder={companyName}
              className="
                mt-1 w-full rounded-control border border-neutral-15 px-3 py-2
                text-caption outline-none focus:border-neutral-30
              "
            />

            {error && (
              <Alert tone="error" className="mt-3">
                {error}
              </Alert>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={close} disabled={busy}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={submit}
                disabled={!canSubmit}
              >
                {busy ? 'Отзываем…' : 'Отозвать статус'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
