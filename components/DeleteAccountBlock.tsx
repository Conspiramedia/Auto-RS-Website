'use client';

// ============================================================
// RS AUTO — Удаление аккаунта. Client Component.
// ============================================================
// Исполняет обещание политики конфиденциальности о праве на полное
// забвение (lib/legal.ts). До миграции 0126 обещание существовало
// только на бумаге: механизма в интерфейсе не было.
//
// ПОЧЕМУ БЛОК СТОИТ В САМОМ НИЗУ ПРОФИЛЯ И ВЫГЛЯДИТ СДЕРЖАННО.
// Удаление — законное право человека, и прятать его нельзя: то, что
// приходится искать, обещанием считаться перестаёт. Но это и не
// повседневное действие, и красная кнопка посреди формы редактирования
// профиля соседствовала бы с «Сохранить» — а промах между ними стоит
// слишком дорого. Отсюда компромисс: отдельная карточка внизу, ссылка
// вместо кнопки, диалог с набором слова.
//
// ДВА ЗАМКА, И ОБА ОСМЫСЛЕННЫ. Первый — сам диалог, где перечислено,
// что именно исчезнет. Второй — набор слова DELETE: он ломает
// автоматизм «нажал → подтвердил» и заставляет прочитать список. Ту же
// проверку независимо делает база (delete_my_account), потому что RPC
// можно позвать в обход интерфейса.
//
// СЛОВО DELETE НЕ ПЕРЕВОДИТСЯ. Это константа протокола, а не текст
// интерфейса: база сверяет его с одним и тем же значением для обеих
// локалей и обоих клиентов. Переведи мы его — сервер держал бы список
// переводов, и добавление третьего языка молча сломало бы удаление.
//
// ЧТО ВИДИТ ЧЕЛОВЕК ПОСЛЕ. Server Action гасит сессию и уводит на
// главную: оставить его в кабинете удалённого аккаунта значило бы
// показать пустые поля вместо понятного завершения.
// ============================================================

import { useEffect, useRef, useState, useTransition } from 'react';

import { deleteAccount } from '@/app/my/actions';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { getT, type Locale } from '@/lib/i18n';
import { useDismissableLayer } from '@/lib/useDismissableLayer';

// Слово подтверждения. См. шапку: не локализуется.
const CONFIRM_WORD = 'DELETE';

type Props = {
  locale: Locale;
};

export default function DeleteAccountBlock({ locale }: Props) {
  const t = getT(locale);

  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);

  // Esc, клик вне окна и блокировка прокрутки фона — общий хук, тот же
  // что у остальных слоёв сайта. locked во время удаления: закрыть
  // окно на полпути нельзя, транзакция уже идёт.
  useDismissableLayer({ open, onClose: () => setOpen(false), locked: pending });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Регистр не учитываем: цель проверки — заставить прочитать и
  // осознанно набрать слово, а не поймать на Caps Lock.
  const matches = word.trim().toUpperCase() === CONFIRM_WORD;
  const canSubmit = matches && !pending;

  function close() {
    setOpen(false);
    setWord('');
    setFailed(false);
  }

  function submit() {
    if (!canSubmit) return;

    setFailed(false);
    startTransition(async () => {
      const result = await deleteAccount(locale, word.trim());
      // Успех сюда не возвращается: Server Action уводит на главную
      // через redirect. Значит любой ответ здесь — отказ.
      if (!result.ok) setFailed(true);
    });
  }

  return (
    <>
      <Card>
        <h2 className="text-h4 font-semibold">{t('delete_account_title')}</h2>
        <p className="mt-1 text-caption text-neutral-60">
          {t('delete_account_lead')}
        </p>

        {/* Ссылка, а не кнопка: см. шапку — рядом стоит «Сохранить»,
            и две одинаковые по весу кнопки приглашали бы к промаху. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="
            mt-3 min-h-[44px] text-caption font-medium text-brand-red
            underline underline-offset-4 hover:opacity-80
          "
        >
          {t('delete_account_button')}
        </button>
      </Card>

      {open && (
        <div
          className="fixed inset-0 z-modal flex items-end justify-center bg-surface-overlay p-0 sm:items-center sm:p-4"
          onClick={() => {
            if (!pending) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            onClick={(e) => e.stopPropagation()}
            className="
              max-h-[90dvh] w-full overflow-y-auto rounded-t-card bg-white p-4
              sm:max-w-lg sm:rounded-card sm:p-6
            "
          >
            <h2
              id="delete-account-title"
              className="text-h3 font-semibold"
            >
              {t('delete_account_confirm_title')}
            </h2>

            {/* Список последствий — до поля ввода: решение принимается
                здесь, а не после того, как слово набрано. */}
            <p className="mt-3 text-caption font-medium">
              {t('delete_account_what')}
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-caption text-neutral-60">
              <li>{t('delete_account_item_listings')}</li>
              <li>{t('delete_account_item_chats')}</li>
              <li>{t('delete_account_item_profile')}</li>
              <li>{t('delete_account_item_saved')}</li>
            </ul>

            {/* Что остаётся — обязательная часть честного обещания:
                человек вправе знать, что мы храним после удаления и
                почему. */}
            <p className="mt-3 text-micro text-neutral-50">
              {t('delete_account_keep')}
            </p>
            <p className="mt-2 text-micro text-neutral-50">
              {t('delete_account_return')}
            </p>

            <label
              htmlFor="delete-account-word"
              className="mt-4 block text-caption font-medium"
            >
              {t('delete_account_type')}
            </label>
            <input
              id="delete-account-word"
              ref={inputRef}
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={CONFIRM_WORD}
              className="
                mt-1 w-full rounded-control border border-neutral-15 px-3 py-2
                text-caption outline-none focus:border-neutral-30
              "
            />

            {failed && (
              <Alert tone="error" className="mt-3">
                {t('delete_account_error')}
              </Alert>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={close} disabled={pending}>
                {t('delete_account_cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={submit}
                disabled={!canSubmit}
              >
                {pending
                  ? t('delete_account_deleting')
                  : t('delete_account_submit')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
