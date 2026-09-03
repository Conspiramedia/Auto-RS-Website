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
// что именно исчезнет. Второй — набор ПОЧТЫ АККАУНТА: он ломает
// автоматизм «нажал → подтвердил» и заодно отвечает на вопрос, на
// который слово DELETE не отвечало, — точно ли за экраном владелец
// аккаунта. Сидящий в чужой незакрытой сессии почты не знает.
//
// Ту же проверку независимо делает база (delete_my_account, 0128):
// здешняя нужна ради мгновенной реакции поля, защитой она не является
// — RPC можно позвать в обход интерфейса.
//
// ЧТО ИМЕННО НАБИРАТЬ — РЕШАЕТ СЕРВЕР. Почта есть не у всех: у
// аккаунтов, заведённых по SMS, в профиле её нет вовсе (0035), и
// требовать её значило бы запереть человека в кабинете без всякой
// возможности уйти. Поэтому вид подтверждения приходит пропсом из
// get_my_delete_confirmation: 'email' → почта, 'phone' → телефон,
// 'word' → прежнее слово DELETE.
//
// САМО ЗНАЧЕНИЕ СЮДА НЕ ПЕРЕДАЁТСЯ, только вид. Подставить почту в
// подсказку было бы удобнее для вёрстки и ровно этим отменило бы
// смысл проверки: человек в чужой сессии прочитал бы адрес с экрана.
//
// ЧТО ВИДИТ ЧЕЛОВЕК ПОСЛЕ. Server Action гасит сессию и уводит на
// главную: оставить его в кабинете удалённого аккаунта значило бы
// показать пустые поля вместо понятного завершения.
// ============================================================

import { useState, useTransition } from 'react';

import { deleteAccount } from '@/app/my/actions';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { getT, type Locale } from '@/lib/i18n';
import { useDismissableLayer } from '@/lib/useDismissableLayer';

// Слово подтверждения для последней ступени. См. шапку: не
// локализуется — база сверяет его с одним значением для обеих локалей
// и обоих клиентов.
const CONFIRM_WORD = 'DELETE';

// Что человек должен ввести. Приходит с сервера, см. шапку.
export type DeleteConfirmKind = 'email' | 'phone' | 'word';

type Props = {
  locale: Locale;
  kind: DeleteConfirmKind;
  // Почта и телефон аккаунта — ДЛЯ СВЕРКИ НА КЛИЕНТЕ, не для показа.
  // Нужны, чтобы кнопка включалась по мере набора, а не после
  // обращения к серверу. В разметку не попадают ни в каком виде.
  email: string | null;
  phone: string | null;
};

export default function DeleteAccountBlock({
  locale,
  kind,
  email,
  phone,
}: Props) {
  const t = getT(locale);

  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  // Род отказа, а не флаг: «почта не совпадает» и «не удалось
  // удалить» требуют от человека разных действий.
  const [failed, setFailed] = useState<'mismatch' | 'unknown' | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  // Esc, клик вне окна и блокировка прокрутки фона — общий хук, тот же
  // что у остальных слоёв сайта. locked во время удаления: закрыть
  // окно на полпути нельзя, транзакция уже идёт.
  useDismissableLayer({ open, onClose: () => setOpen(false), locked: pending });

  // ПОЛЕ НЕ ПОЛУЧАЕТ ФОКУС АВТОМАТИЧЕСКИ, и это осознанно.
  //
  // Здесь стоял focus() при открытии — обычная любезность, которая в
  // этом диалоге работала против него. На мобильном фокус открывает
  // экранную клавиатуру, браузер прокручивает поле в видимую область,
  // и верх окна уезжает: заголовок «Удалить аккаунт?» и список того,
  // что будет удалено, оказываются за пределами экрана. Человек видит
  // поле ввода и кнопку «Удалить навсегда», не прочитав ни строки
  // предупреждения, — ровно наоборот замыслу, по которому список
  // последствий стоит ДО поля.
  //
  // Экономия одного касания не стоит непрочитанного предупреждения
  // перед необратимым действием. Поле человек откроет сам, когда
  // дочитает.

  // ------------------------------------------------------------
  // Сверка ввода. Правила ТЕ ЖЕ, что в базе (0128).
  // ------------------------------------------------------------
  // Почта — регистронезависимо: адреса на практике регистр не
  // различают, и отказать набравшему Ivan@ вместо ivan@ значило бы
  // придраться на ровном месте.
  //
  // Телефон — по цифрам: в профиле он лежит как «+381 61 234 567», а
  // набирают его как придётся. Сравнение строк отвергало бы верный
  // номер из-за пробела.
  const typed = word.trim();

  const matches = (() => {
    if (kind === 'email') {
      return (
        typed.length > 0 &&
        typed.toLocaleLowerCase() === (email ?? '').trim().toLocaleLowerCase()
      );
    }
    if (kind === 'phone') {
      const digits = (value: string) => value.replace(/\D/g, '');
      return digits(typed).length > 0 && digits(typed) === digits(phone ?? '');
    }
    // Последняя ступень. Регистр не учитываем: цель — заставить
    // осознанно набрать слово, а не поймать на Caps Lock.
    return typed.toUpperCase() === CONFIRM_WORD;
  })();

  const canSubmit = matches && !pending;

  // Подсказка над полем и текст ошибки зависят от ступени.
  const typeLabel =
    kind === 'email'
      ? t('delete_account_type_email')
      : kind === 'phone'
        ? t('delete_account_type_phone')
        : t('delete_account_type');

  const mismatchText =
    kind === 'email'
      ? t('delete_account_mismatch_email')
      : kind === 'phone'
        ? t('delete_account_mismatch_phone')
        : t('delete_account_error');

  function close() {
    setOpen(false);
    setWord('');
    setFailed(null);
  }

  function submit() {
    if (!canSubmit) return;

    setFailed(null);
    startTransition(async () => {
      const result = await deleteAccount(locale, typed);
      // Успех сюда не возвращается: Server Action уводит на главную
      // через redirect. Значит любой ответ здесь — отказ.
      if (!result.ok) setFailed(result.error ?? 'unknown');
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
              {typeLabel}
            </label>
            <input
              id="delete-account-word"
              // Тип поля по ступени: на телефоне это меняет клавиатуру —
              // почте нужна раскладка с «@», номеру цифровая. type="email"
              // не ставим: браузерная валидация формы здесь ни при чём,
              // а подсветка «неверный адрес» на чужой почте сбивала бы.
              type={kind === 'phone' ? 'tel' : 'text'}
              inputMode={
                kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'text'
              }
              value={word}
              onChange={(e) => setWord(e.target.value)}
              // Автозаполнение выключено намеренно: подставленная
              // браузером почта свела бы проверку к нажатию, а она
              // ровно затем и стоит, чтобы человек ввёл адрес сам.
              autoComplete="off"
              // Верхний регистр навязываем только слову DELETE. Почте он
              // помешал бы: адрес набирают строчными.
              autoCapitalize={kind === 'word' ? 'characters' : 'none'}
              spellCheck={false}
              // Плейсхолдер — только у слова. Для почты и телефона его
              // нет: любой пример здесь читался бы как подсказка, каким
              // должен быть ответ.
              placeholder={kind === 'word' ? CONFIRM_WORD : undefined}
              className="
                mt-1 w-full rounded-control border border-neutral-15 px-3 py-2
                text-caption outline-none focus:border-neutral-30
              "
            />

            {failed && (
              <Alert tone="error" className="mt-3">
                {failed === 'mismatch'
                  ? mismatchText
                  : t('delete_account_error')}
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
