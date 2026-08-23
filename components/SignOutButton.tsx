'use client';

// ============================================================
// RS AUTO — Кнопка выхода из кабинета.
// ============================================================
// Client Component нужен ровно для трёх вещей: спросить подтверждение,
// показать промежуточное состояние («Выходим…» вместо мёртвой кнопки)
// и не дать нажать дважды. Сам выход выполняет Server Action
// (app/my/actions.ts) — только он может удалить cookie сессии.
//
// ПОЧЕМУ ВЫХОД СПРАШИВАЕТ ПОДТВЕРЖДЕНИЕ. Раньше он выполнялся с
// первого нажатия. Цена случайного нажатия здесь несоразмерна: вход
// в RS Auto — это SMS-код, то есть повторный вход стоит человеку
// ожидания сообщения и расхода суточной квоты (5 SMS на номер,
// миграция 0035). Кнопка при этом стоит в шапке кабинета рядом с
// вкладками, по которым переключаются постоянно.
//
// ПОЧЕМУ ДИАЛОГ, А НЕ ВОПРОС В СТРОКЕ. Сначала подтверждение было
// сделано переключением самой кнопки («Выйти из аккаунта? Да Отмена»),
// как у действий над объявлением. Для выхода этого мало: строка
// физически вмещает только вопрос, а объяснить нужно ПОСЛЕДСТВИЯ.
// Главное здесь — то, что НЕ происходит: аккаунт не удаляется,
// объявления и переписка остаются. Без этой строки выход выглядит
// опаснее, чем есть, и человек либо боится нажать, либо жмёт вслепую.
//
// window.confirm не годится: он выглядит как системная ошибка,
// не переводится на сербский и не поддаётся стилизации.
//
// Разметка диалога повторяет шторку фильтров (FilterPanel): затемнение
// на весь экран, снизу на мобильном и по центру с sm. Своего варианта
// модального окна заводить нельзя — два разных диалога на сайте
// читались бы как элементы разных продуктов.
//
// ВИД КНОПКИ. Третьестепенное действие: ссылка нейтрального тона, без
// заливки. Заливка (тем более цветная) поставила бы выход в один ряд
// с главными действиями кабинета, хотя это самое редкое из них.
// ============================================================

import { useEffect, useState, useTransition } from 'react';

import { signOut } from '@/app/my/actions';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import Button from './ui/Button';
import CloseButton from './ui/CloseButton';

type Props = {
  locale: Locale;
};

export default function SignOutButton({ locale }: Props) {
  const t = getT(locale);
  // useTransition, а не собственный useState: сюда попадает и время
  // серверного редиректа после выхода, поэтому кнопка остаётся
  // заблокированной до конца перехода, а не до конца запроса.
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Блокировка прокрутки страницы под открытым диалогом и Escape для
  // закрытия — то же поведение, что у меню шапки и шторки фильтров.
  // Во время выхода Escape намеренно НЕ закрывает окно: запрос уже
  // ушёл, и убирать индикатор происходящего нельзя.
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) setOpen(false);
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, pending]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 text-caption font-semibold text-neutral-60 transition-colors duration-fast ease-out hover:text-brand-red"
      >
        {t('my_logout')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-modal flex items-end justify-center bg-surface-overlay sm:items-center"
          // Клик по затемнению закрывает диалог, но не во время
          // выхода: запрос уже отправлен, и отменить его нечем.
          onClick={() => {
            if (!pending) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="signout-title"
        >
          <div
            className="w-full rounded-t-card bg-white p-5 sm:max-w-sm sm:rounded-card"
            // Клик внутри окна не должен закрывать его: иначе нажатие
            // по тексту схлопывало бы диалог.
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="signout-title" className="text-h4 font-semibold">
                {t('my_logout_confirm')}
              </h2>
              <CloseButton
                onClick={() => setOpen(false)}
                label={t('common_close')}
                disabled={pending}
              />
            </div>

            {/* Объяснение последствий — то, ради чего диалог и заведён.
                Сначала о сохранности данных, затем о цене возврата. */}
            <p className="mt-2 text-caption text-neutral-60">
              {t('my_logout_confirm_text')}
            </p>

            {/* Кнопки столбиком на мобильном (равной ширины) и в строку
                с sm — тот же паттерн, что в карточках состояний.
                Порядок «Отмена, затем Выйти»: подтверждающее действие
                стоит последним, у края, где его ищет большой палец. */}
            <div className="mt-5 grid grid-cols-1 gap-3 sm:flex sm:justify-end">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                {t('my_confirm_no')}
              </Button>

              {/* Красный — роль «необратимое действие», та же, что у
                  деструктивных операций над объявлением. */}
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => startTransition(() => signOut(locale))}
              >
                {pending ? t('my_auth_checking') : t('my_logout_confirm_yes')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
