'use client';

// ============================================================
// RS AUTO — Счётчики непрочитанного для шапки. Клиентский хук.
// ============================================================
// ОДИН источник правды для двух потребителей: бейджа на бургере
// (общее число) и пунктов внутри меню («Сообщения», «Уведомления»
// со своими цифрами). Держать два независимых запроса нельзя —
// кружок на кнопке и цифры под ней разъехались бы между собой.
//
// ПОЧЕМУ КЛИЕНТСКИЙ, а не серверный. Ровно та же причина, по которой
// клиентским был HeaderAuth: каталог и карточки объявлений кэшируются
// (revalidate 300–3600), и чтение cookie сессии в серверной шапке
// перевело бы КАЖДУЮ страницу сайта в динамический рендер. Цена одной
// цифры в бейдже — потеря статики на всём сайте.
//
// ГОСТЮ — НИ ОДНОГО ЗАПРОСА К БАЗЕ. Сначала локальная проверка сессии
// (cookie, без сети), и только у вошедшего запрашиваются счётчики.
// Посетитель без аккаунта — большинство трафика.
//
// REALTIME НЕ ПОДКЛЮЧАЕТСЯ: постоянное соединение ради цифры в шапке
// несоразмерно. Счётчики обновляются при переходах между страницами —
// внутри чата свежесть обеспечивает сам чат.
// ============================================================

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getBrowserClient } from './supabaseClient';

export type BadgeCounts = {
  messages: number;
  notifications: number;
  total: number;
};

const EMPTY: BadgeCounts = { messages: 0, notifications: 0, total: 0 };

export type BadgeState = {
  // null — проверка сессии ещё идёт. До её конца шапка не показывает
  // ни «Войти», ни бейдж: мелькнувшее состояние гостя у вошедшего
  // читается как разлогин.
  signedIn: boolean | null;
  counts: BadgeCounts;
};

export function useBadgeCounts(): BadgeState {
  const pathname = usePathname();

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<BadgeCounts>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const supabase = getBrowserClient();

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      const hasSession = data.session != null;
      setSignedIn(hasSession);

      // Ключевая экономия: гостю дальше ходить некуда.
      if (!hasSession) {
        setCounts(EMPTY);
        return;
      }

      // Одна RPC на оба счётчика (миграция 0074): сумма считается на
      // сервере, чтобы цифра совпадала с приложением.
      const { data: rows, error } = await supabase.rpc('get_badge_counts');
      if (cancelled || error) return;

      // RPC объявлена как returns table — supabase-js отдаёт массив
      // строк, даже когда строка заведомо одна.
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return;

      setCounts({
        messages: row.messages ?? 0,
        notifications: row.notifications ?? 0,
        total: row.total ?? 0,
      });
    })();

    return () => {
      cancelled = true;
    };
    // pathname в зависимостях — счётчики обновляются при переходах
    // между страницами: это и есть замена realtime.
  }, [pathname]);

  return { signedIn, counts };
}
