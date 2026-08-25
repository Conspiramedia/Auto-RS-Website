// ============================================================
// RS AUTO — настоящая сессия для тестов кабинета.
// ============================================================
// ЗАЧЕМ НАСТОЯЩАЯ, А НЕ МОК. Кабинет решает, пускать ли, НА СЕРВЕРЕ:
// MyLayoutView зовёт getCurrentUser(), а тот сверяет токен с Supabase,
// а не доверяет содержимому cookie. Подделанный из браузера токен
// такую проверку не проходит — сервер отдаст форму входа, и тест
// «крестик в кабинете» проверял бы страницу входа.
//
// Поэтому сессия получается по-честному: тестовый номер из
// supabase/config.toml с фиксированным кодом ([auth.sms.test_otp]).
// GoTrue принимает его без отправки SMS — ни одного сообщения наружу
// не уходит, денег это не стоит.
//
// БЕЗ ЛОКАЛЬНОГО SUPABASE ЭТО НЕВОЗМОЖНО, и тесты кабинета честно
// пропускаются: см. isSupabaseUp в tests/env.ts.
// ============================================================

import type { BrowserContext, Page } from '@playwright/test';

import { SEED_USERS } from './seed';
import { TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_URL } from '../env';

// Ответ GoTrue на verify: полноценная сессия с подписанным токеном.
type TokenReply = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
};

// ------------------------------------------------------------
// Получение сессии через настоящий OTP локального стека.
// ------------------------------------------------------------
export async function signInAsSeller(): Promise<TokenReply | null> {
  const phone = SEED_USERS.seller.phone;
  const token = SEED_USERS.seller.otp;

  const headers = {
    apikey: TEST_SUPABASE_ANON_KEY,
    'content-type': 'application/json',
  };

  try {
    // 1) Запрос кода. Для тестового номера GoTrue SMS не отправляет —
    // код уже задан в config.toml.
    await fetch(`${TEST_SUPABASE_URL}/auth/v1/otp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone, create_user: true }),
      signal: AbortSignal.timeout(5000),
    });

    // 2) Обмен кода на сессию.
    const res = await fetch(
      `${TEST_SUPABASE_URL}/auth/v1/verify`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone, token, type: 'sms' }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) return null;

    const data = (await res.json()) as TokenReply;
    return data.access_token ? data : null;
  } catch {
    // Стек не поднят или номер не настроен — вызывающий пропустит тест.
    return null;
  }
}

// ------------------------------------------------------------
// Установка cookie сессии в браузер.
// ------------------------------------------------------------
// Формат cookie задаёт @supabase/ssr: имя `sb-<ref>-auth-token`, где
// ref — поддомен проекта. У локального стека адрес без поддомена,
// и ref там фиксирован строкой ниже — то же значение подставляет
// сам клиент, поэтому сервер найдёт cookie и прочитает токен.
export async function applySession(
  context: BrowserContext,
  session: TokenReply,
  baseURL: string,
): Promise<void> {
  const ref = projectRef(TEST_SUPABASE_URL);

  // Значение — тот же JSON, что кладёт клиентская библиотека,
  // закодированный в base64 с префиксом (формат @supabase/ssr).
  const payload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at:
      session.expires_at ??
      Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
    expires_in: session.expires_in ?? 3600,
    token_type: 'bearer',
  });

  const value = `base64-${Buffer.from(payload).toString('base64')}`;
  const { hostname } = new URL(baseURL);

  await context.addCookies([
    {
      name: `sb-${ref}-auth-token`,
      value,
      domain: hostname,
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

// Идентификатор проекта в имени cookie. Для облачного адреса это
// поддомен (<ref>.supabase.co), для локального — сам хост без точек.
function projectRef(url: string): string {
  const { hostname } = new URL(url);
  const parts = hostname.split('.');
  if (parts.length > 2) return parts[0];
  // 127.0.0.1 → «127-0-0-1»: точки в имени cookie допустимы, но
  // supabase-js заменяет их дефисами, и имя обязано совпасть.
  return hostname.replace(/\./g, '-');
}

// Удобная обёртка: войти и открыть страницу кабинета.
// Возвращает false, если сессию получить не удалось.
export async function openCabinet(
  page: Page,
  path: string,
): Promise<boolean> {
  const session = await signInAsSeller();
  if (!session) return false;

  await applySession(page.context(), session, page.url() || 'http://127.0.0.1:3100');
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return true;
}
