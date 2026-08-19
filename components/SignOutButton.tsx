'use client';

// ============================================================
// RS AUTO — Кнопка выхода из кабинета.
// ============================================================
// Client Component нужен ровно для двух вещей: показать промежуточное
// состояние («Выходим…» вместо мёртвой кнопки) и не дать нажать дважды.
// Сам выход выполняет Server Action (app/my/actions.ts) — только он
// может удалить cookie сессии.
//
// ВИД. Третьестепенное действие: ссылка нейтрального тона, без заливки.
// Заливка (тем более цветная) поставила бы выход в один ряд с главными
// действиями кабинета, хотя это самое редкое из них.
// ============================================================

import { useTransition } from 'react';

import { signOut } from '@/app/my/actions';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

type Props = {
  locale: Locale;
};

export default function SignOutButton({ locale }: Props) {
  const t = getT(locale);
  // useTransition, а не собственный useState: сюда попадает и время
  // серверного редиректа после выхода, поэтому кнопка остаётся
  // заблокированной до конца перехода, а не до конца запроса.
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => signOut(locale))}
      className="shrink-0 text-sm font-semibold text-neutral-60 transition-colors duration-fast ease-out hover:text-brand-red disabled:opacity-40"
    >
      {pending ? t('my_auth_checking') : t('my_logout')}
    </button>
  );
}
