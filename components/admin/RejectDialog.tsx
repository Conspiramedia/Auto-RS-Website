'use client';

// ============================================================
// RS AUTO — Диалог отклонения объявления. Client Component.
// ============================================================
// ГЛАВНОЕ РЕШЕНИЕ ЭТОГО ФАЙЛА: причина выбирается из типового списка,
// общего с приложением (lib/admin/rejectionReasons.ts), и уходит
// продавцу НА ЕГО ЯЗЫКЕ, а не на языке модератора.
//
// Почему так. Причина — это текст от площадки: продавец увидит его в
// письме и в колокольчике. Модератор работает в русской админке, но
// сербский продавец обязан получить сербскую формулировку. Поэтому
// чипс показывает модератору русский перевод (он должен понимать, что
// отправляет), а в reject_car уходит строка на locale получателя.
// Под списком видно, на каком языке уйдёт текст, — иначе это
// превращение выглядело бы фокусом.
//
// «Другое» — свободный ввод. Он уходит как есть, на языке модератора:
// перевести произвольную фразу мы не можем, а отказ без объяснения
// хуже отказа на чужом языке. Ровно так же устроено в приложении.
//
// ВАЛИДАЦИЯ ДУБЛИРУЕТ СЕРВЕР НАМЕРЕННО. reject_car (0078) не примет
// причину короче 10 символов и упадёт с check_violation. Показывать
// модератору исключение вместо подсказки — плохо, поэтому кнопка
// «Отклонить» неактивна, пока причина не набрана. Источник истины при
// этом остаётся на сервере: числа берутся из того же файла, где
// записаны серверные границы.
// ============================================================

import { useEffect, useRef, useState } from 'react';

import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import {
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  REJECTION_REASONS,
  reasonText,
} from '@/lib/admin/rejectionReasons';
import { useDismissableLayer } from '@/lib/useDismissableLayer';

type Props = {
  open: boolean;
  onClose: () => void;
  // Язык продавца из profiles.locale (owner_locale). null = не выбирал
  // → сербский, как и в шаблонах писем.
  ownerLocale: string | null;
  // Отправка. Возвращает текст ошибки или null при успехе — диалог сам
  // решает, закрыться ему или показать причину отказа.
  onSubmit: (reason: string) => Promise<string | null>;
};

// Код «Другое». Не входит в REJECTION_REASONS: это не причина, а
// переключение в режим свободного ввода.
const OTHER = '__other__';

export default function RejectDialog({
  open,
  onClose,
  ownerLocale,
  onSubmit,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstChipRef = useRef<HTMLButtonElement>(null);
  const customRef = useRef<HTMLTextAreaElement>(null);

  // Escape, блокировка прокрутки и возврат фокуса на кнопку, с которой
  // диалог открыли, — общий хук сайта. Свой обработчик Escape здесь
  // был бы четвёртой копией одного и того же поведения.
  //
  // locked во время отправки: закрыть диалог, пока запрос в пути,
  // нельзя — модератор не узнал бы, чем всё кончилось.
  useDismissableLayer({ open, onClose, locked: busy });

  // Сброс при каждом открытии. Без него диалог, закрытый по Escape,
  // открылся бы со старым выбором — и модератор отправил бы причину от
  // предыдущего объявления, даже не заметив.
  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setCustom('');
    setError(null);
    // Фокус на первый чипс: диалог открывается клавишей R, и рука
    // модератора на клавиатуре. Таймер нулевой — ждём, пока элемент
    // окажется в DOM после рендера.
    const id = window.setTimeout(() => firstChipRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Фокус в поле, как только выбрали «Другое»: иначе пришлось бы
  // отдельно целиться в textarea мышью.
  useEffect(() => {
    if (selected === OTHER) customRef.current?.focus();
  }, [selected]);

  if (!open) return null;

  const isOther = selected === OTHER;
  const trimmed = custom.trim();

  // Итоговый текст: типовая причина на языке продавца либо свободный
  // ввод как есть.
  const reason = isOther
    ? trimmed
    : selected
      ? (() => {
          const found = REJECTION_REASONS.find((r) => r.code === selected);
          return found ? reasonText(found, ownerLocale) : '';
        })()
      : '';

  const canSubmit = reason.length >= REASON_MIN_LENGTH && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const message = await onSubmit(reason);

    // Успех — закрытие и переход делает вызывающая сторона.
    if (message === null) return;

    setBusy(false);
    setError(message);
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-end justify-center bg-surface-overlay p-0 sm:items-center sm:p-4"
      // Клик по затемнению закрывает — но не во время отправки.
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-dialog-title"
        // Клик внутри не должен закрывать диалог, всплыв до подложки.
        onClick={(e) => e.stopPropagation()}
        className="
          max-h-[90dvh] w-full overflow-y-auto rounded-t-card bg-white p-4
          sm:max-w-2xl sm:rounded-card sm:p-6
        "
      >
        <h2 id="reject-dialog-title" className="text-h3 font-semibold">
          Причина отклонения
        </h2>

        <p className="mt-1 text-caption text-neutral-60">
          Продавец получит её письмом{' '}
          {ownerLocale === 'ru' ? 'на русском' : 'на сербском'} — выберите
          типовую или напишите свою.
        </p>

        {/* ---------- Типовые причины ---------- */}
        {/* Чипсы, а не выпадающий список: восемь формулировок должны
            быть видны разом, чтобы модератор выбирал взглядом, а не
            раскрывал список на каждом объявлении. */}
        <div className="mt-4 flex flex-col gap-2">
          {REJECTION_REASONS.map((r, i) => {
            const active = selected === r.code;
            return (
              <button
                key={r.code}
                ref={i === 0 ? firstChipRef : undefined}
                type="button"
                onClick={() => setSelected(r.code)}
                aria-pressed={active}
                className={[
                  'rounded-control border px-3 py-2 text-left text-caption',
                  'transition-colors duration-fast',
                  active
                    ? 'border-brand-dark bg-brand-dark text-white'
                    : 'border-neutral-15 hover:bg-surface-hover',
                ].join(' ')}
              >
                {/* Модератору — русский текст: он обязан понимать, что
                    отправляет. Продавцу уйдёт вариант на его языке. */}
                {r.ru}
              </button>
            );
          })}

          {/* «Другое» — последним, как в приложении. */}
          <button
            type="button"
            onClick={() => setSelected(OTHER)}
            aria-pressed={isOther}
            className={[
              'rounded-control border px-3 py-2 text-left text-caption',
              'transition-colors duration-fast',
              isOther
                ? 'border-brand-dark bg-brand-dark text-white'
                : 'border-neutral-15 hover:bg-surface-hover',
            ].join(' ')}
          >
            Другое (указать причину вручную)…
          </button>
        </div>

        {/* ---------- Свободный ввод ---------- */}
        {isOther && (
          <div className="mt-3">
            <textarea
              ref={customRef}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              maxLength={REASON_MAX_LENGTH}
              rows={3}
              placeholder="Опишите, что не так с объявлением"
              className="
                w-full rounded-control border border-neutral-15 px-3 py-2
                text-caption outline-none focus:border-neutral-30
              "
            />
            <p className="mt-1 text-micro text-neutral-50">
              {trimmed.length < REASON_MIN_LENGTH
                ? `Минимум ${REASON_MIN_LENGTH} символов (введено ${trimmed.length})`
                : `${trimmed.length} из ${REASON_MAX_LENGTH}`}
            </p>
          </div>
        )}

        {/* Что именно уйдёт продавцу — показываем дословно. Модератор
            видит русский чипс, а отправляется сербский текст: без
            этого блока превращение выглядело бы непредсказуемым. */}
        {selected && !isOther && ownerLocale !== 'ru' && (
          <div className="mt-3 rounded-control bg-surface-subtle p-3">
            <p className="text-micro text-neutral-50">Текст для продавца</p>
            <p className="mt-0.5 text-caption">{reason}</p>
          </div>
        )}

        {error && (
          <Alert tone="error" className="mt-3">
            {error}
          </Alert>
        )}

        {/* ---------- Действия ---------- */}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {busy ? 'Отклоняем…' : 'Отклонить'}
          </Button>
        </div>
      </div>
    </div>
  );
}
