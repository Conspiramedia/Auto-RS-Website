'use client';

// ============================================================
// RS AUTO — Выход из админки. Client Component.
// ============================================================
// ПОЧЕМУ НЕ ОБЩИЙ SignOutButton. Тот сделан для кабинета: он
// локализован (принимает Locale, берёт тексты из словаря) и открывает
// диалог подтверждения на пол-экрана с объяснением последствий —
// «аккаунт не удаляется, объявления остаются». Всё это верно для
// продавца, который случайно нажмёт выход и потеряет доступ до нового
// SMS-кода.
//
// В админке условия другие. Раздел одноязычный (русский), а вход
// администратора идёт по ПОЧТЕ, а не по SMS: повторный вход не стоит
// ни денег, ни суточной квоты номера. Поэтому здесь достаточно
// подтверждения в самой кнопке, без модального окна.
//
// Подтверждение всё же есть: выход одним нажатием из шапки, которая
// висит на каждой странице раздела, слишком легко задеть при работе с
// очередью.
//
// Сам выход выполняет тот же Server Action, что и в кабинете:
// удалить cookie сессии может только он.
// ============================================================

import { useState, useTransition } from 'react';

import { signOut } from '@/app/my/actions';

export default function AdminSignOut() {
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();

  // Локаль сербская: админка своих зеркал не имеет, а редирект после
  // выхода ведёт на корень сайта — то есть на сербскую главную.
  const doSignOut = () => startTransition(() => void signOut('sr'));

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="
          flex min-h-[44px] items-center rounded-control px-3
          text-caption text-on-dark-70
          transition-colors duration-fast
          hover:bg-white/10 hover:text-white
        "
      >
        Выйти
      </button>
    );
  }

  return (
    // Вопрос и два ответа в одну строку. Подпись «Выйти?» остаётся
    // видимой: без неё две голые кнопки «Да / Отмена» не объясняют,
    // на что отвечают.
    <div className="flex items-center gap-1">
      <span className="hidden pl-1 text-caption text-on-dark-70 sm:inline">
        Выйти?
      </span>

      <button
        type="button"
        onClick={doSignOut}
        disabled={pending}
        className="
          flex min-h-[44px] items-center rounded-control px-3
          text-caption font-semibold text-white
          transition-colors duration-fast
          hover:bg-white/10 disabled:opacity-40
        "
      >
        {pending ? 'Выходим…' : 'Да'}
      </button>

      <button
        type="button"
        onClick={() => setAsking(false)}
        disabled={pending}
        className="
          flex min-h-[44px] items-center rounded-control px-3
          text-caption text-on-dark-70
          transition-colors duration-fast
          hover:bg-white/10 hover:text-white disabled:opacity-40
        "
      >
        Отмена
      </button>
    </div>
  );
}
