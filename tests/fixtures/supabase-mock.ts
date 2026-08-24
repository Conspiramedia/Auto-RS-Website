// ============================================================
// RS AUTO — перехват запросов к Supabase на уровне браузера.
// ============================================================
// ЗАЧЕМ. Вход на площадке идёт только через одноразовый код: SMS для
// обычных пользователей, письмо для администраторов. В тестах ни то,
// ни другое отправлять нельзя — это живые деньги за SMS и чужие
// почтовые ящики. Поэтому UI-тесты перехватывают HTTP-запросы к
// Supabase прямо в браузере и отвечают на них сами.
//
// ЧТО ИМЕННО ПЕРЕХВАТЫВАЕТСЯ. Три конечные точки, которыми пользуется
// components/AuthGate.tsx:
//   POST /rest/v1/rpc/rpc_check_otp_quota     — квота на SMS;
//   POST /rest/v1/rpc/rpc_check_email_login   — гейт и квота на почту;
//   POST /auth/v1/otp                          — запрос кода;
//   POST /auth/v1/verify                       — обмен кода на сессию.
//
// ГРАНИЦА ОТВЕТСТВЕННОСТИ. Здесь проверяется ПОВЕДЕНИЕ ИНТЕРФЕЙСА:
// что форма показывает поле кода после успешного запроса, что при
// отказе выводится нейтральное сообщение, что кнопка блокируется.
// САМИ ПРАВИЛА — кого пускать, сколько раз, с какого IP — проверяются
// отдельно и на настоящей базе (supabase/checks/0085_auth_gates_test.sql).
// Мок, повторяющий серверную логику, проверял бы сам себя.
// ============================================================

import type { Page, Route } from '@playwright/test';

// Ответ квоты/гейта. Форма одна у обеих RPC — так задумано в 0082,
// чтобы фронтенд обрабатывал их одинаково.
export type QuotaReply = {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
};

export const QUOTA_ALLOWED: QuotaReply = {
  allowed: true,
  used: 1,
  limit: 5,
  remaining: 4,
};

// Отказ. Именно так отвечает сервер и «нет такого адреса», и
// «адрес есть, но вход не разрешён» — ответы неразличимы намеренно.
export const QUOTA_DENIED: QuotaReply = {
  allowed: false,
  used: 1,
  limit: 5,
  remaining: 4,
};

// Квота исчерпана: remaining = 0 и used = limit.
export const QUOTA_EXHAUSTED: QuotaReply = {
  allowed: false,
  used: 5,
  limit: 5,
  remaining: 0,
};

// ------------------------------------------------------------
// Поддельная сессия.
// ------------------------------------------------------------
// Достаточная для supabase-js: он читает access_token, expires_at и
// user.id. Токен не подписан настоящим ключом — серверные запросы с
// ним не пройдут, и это правильно: UI-тест не должен получать доступ
// к данным, он проверяет переходы интерфейса.
function fakeSession(userId: string, email?: string, phone?: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: 'test-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'test-refresh-token',
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: email ?? '',
      phone: phone ?? '',
      app_metadata: { provider: email ? 'email' : 'phone' },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

export type AuthMockOptions = {
  // Ответ гейта/квоты. По умолчанию — разрешение.
  quota?: QuotaReply;
  // Должен ли verify выдать сессию. false — код неверный.
  verifySucceeds?: boolean;
  // Идентификатор пользователя в выданной сессии.
  userId?: string;
  // Считать запросы: тест проверяет, что при отказе гейта запрос кода
  // НЕ уходит вовсе (иначе письмо ушло бы вопреки отказу).
  counters?: { otpRequests: number; verifyRequests: number; quotaCalls: number };
};

// ------------------------------------------------------------
// Установка перехвата.
// ------------------------------------------------------------
// Вызывается ДО page.goto: Playwright применяет маршруты к запросам,
// начавшимся после регистрации обработчика.
export async function mockSupabaseAuth(
  page: Page,
  options: AuthMockOptions = {},
): Promise<Required<AuthMockOptions>['counters']> {
  const quota = options.quota ?? QUOTA_ALLOWED;
  const verifySucceeds = options.verifySucceeds ?? true;
  const userId = options.userId ?? '00000000-0000-4000-a000-00000000c101';

  const counters = options.counters ?? {
    otpRequests: 0,
    verifyRequests: 0,
    quotaCalls: 0,
  };

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      // CORS: страница обращается к другому origin (порт Supabase),
      // и без заголовка браузер отбросит ответ до того, как его
      // увидит приложение.
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });

  // ---------- Квота SMS и гейт почты ----------
  // Обе RPC отвечают одинаково устроенным json, поэтому один
  // обработчик на обе: различать их в моке незачем.
  await page.route('**/rest/v1/rpc/rpc_check_otp_quota', async (route) => {
    counters.quotaCalls += 1;
    await json(route, quota);
  });

  await page.route('**/rest/v1/rpc/rpc_check_email_login', async (route) => {
    counters.quotaCalls += 1;
    await json(route, quota);
  });

  // ---------- Запрос кода ----------
  // GoTrue на успешный запрос отвечает пустым объектом. Ошибку
  // возвращает под кодом 4xx с полем msg.
  await page.route('**/auth/v1/otp**', async (route) => {
    counters.otpRequests += 1;
    await json(route, {});
  });

  // ---------- Обмен кода на сессию ----------
  await page.route('**/auth/v1/verify**', async (route) => {
    counters.verifyRequests += 1;

    if (!verifySucceeds) {
      // Форма ответа GoTrue на неверный код.
      await json(
        route,
        {
          error: 'invalid_grant',
          error_description: 'Token has expired or is invalid',
          msg: 'Token has expired or is invalid',
        },
        403,
      );
      return;
    }

    await json(route, fakeSession(userId, undefined, '+381601234567'));
  });

  return counters;
}

// ------------------------------------------------------------
// Заглушка всех прочих обращений к базе.
// ------------------------------------------------------------
// Нужна тестам, которые проверяют вёрстку без поднятого Supabase:
// без неё страница ждёт ответа до таймаута, и падение выглядит как
// «тест медленный», а не «базы нет».
//
// Отдаём ПУСТЫЕ выборки, а не ошибки: приложение обязано пережить
// отсутствие данных и показать empty state — это и проверяется.
export async function mockSupabaseEmpty(page: Page): Promise<void> {
  await page.route('**/rest/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    });
  });
}
