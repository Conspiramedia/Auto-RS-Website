'use server';

// ============================================================
// RS AUTO — Server Actions кабинета.
// ============================================================
// Выход выполняется НА СЕРВЕРЕ, а не в браузере. Причина в том, где
// теперь живёт сессия: она в cookie (lib/supabaseClient.ts), и удалить
// их обязан тот, кто может выставить заголовок Set-Cookie. Server
// Component этого не умеет — HTTP не разрешает менять заголовки после
// начала стриминга ответа, — а Server Action выполняется отдельным
// запросом, где ответ ещё формируется.
//
// Клиентский signOut() очистил бы состояние только в браузере: cookie
// остались бы, и следующий серверный рендер кабинета снова показал бы
// пользователя вошедшим.
// ============================================================

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import type { Locale } from '@/lib/i18n';
import { localeHref } from '@/lib/i18n';

export async function signOut(locale: Locale): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Не заданы NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  const cookieStore = await cookies();

  // Отдельный клиент, а не getServerClient из lib/supabaseServer.ts:
  // там setAll намеренно пуст (Server Component не может писать cookie),
  // и вызванный через него signOut удалил бы сессию на сервере Supabase,
  // но оставил бы cookie в браузере. Здесь запись работает по-настоящему.
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });

  // scope: 'local' — гасим сессию этого браузера, не трогая остальные
  // устройства. Выход на сайте не должен разлогинивать человека в
  // приложении: это один аккаунт, но разные клиенты.
  await supabase.auth.signOut({ scope: 'local' });

  // На главную своей локали: кабинет после выхода недоступен, а
  // оставлять пользователя на его адресе значило бы показать ему форму
  // входа вместо понятного места.
  redirect(localeHref(locale, '/'));
}
