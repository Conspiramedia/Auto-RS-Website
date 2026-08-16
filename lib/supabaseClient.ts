'use client';

// ============================================================
// RS AUTO — Клиент Supabase для браузера.
// ============================================================
// Отдельный клиент от серверного (lib/supabase.ts) нужен потому, что здесь
// сессия ОБЯЗАНА сохраняться: подача объявления идёт в несколько шагов —
// вход по SMS-коду, затем загрузка фото в Storage от имени вошедшего
// пользователя, затем вызов create_car_v2. Серверный клиент намеренно
// работает без сессии, и переиспользовать его здесь нельзя.
//
// Клиент создаётся один раз (синглтон): каждый новый экземпляр заводит
// собственную подписку на обновление токена, что приводит к гонкам обновления.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Не заданы NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Сессия не читается из адресной строки: вход идёт по OTP, а не по
      // magic-link, и разбор URL здесь только создал бы лишнюю поверхность.
      detectSessionInUrl: false,
    },
  });

  return client;
}
