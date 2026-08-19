// ============================================================
// AUTO.RS — Edge Function: send-push
// ============================================================
// Разбирает очередь public.push_queue и отправляет уведомления через
// Firebase Cloud Messaging HTTP v1.
//
// Почему отдельная функция, а не отправка прямо из триггера: база не должна
// ходить в сеть. Таймаут или сбой FCM заблокировал бы транзакцию публикации
// объявления. Триггеры лишь кладут задание в очередь, доставка асинхронна.
//
// ЗАПУСК: по расписанию (см. раздел «Планировщик» в отчёте) либо вручную
// HTTP-запросом. Функция забирает пачку заданий, отправляет и помечает
// результат. Параллельные запуски безопасны: claim_push_batch использует
// FOR UPDATE SKIP LOCKED, поэтому одно уведомление не уйдёт дважды.
//
// ------------------------------------------------------------
// ТРЕБУЕМЫЕ СЕКРЕТЫ (supabase secrets set ...):
//   FCM_PROJECT_ID      — id проекта Firebase (поле project_id из service account JSON)
//   FCM_CLIENT_EMAIL    — client_email из service account JSON
//   FCM_PRIVATE_KEY     — private_key из service account JSON (с \n внутри строки)
//   SUPABASE_URL        — подставляется платформой автоматически
//   SUPABASE_SERVICE_ROLE_KEY — подставляется платформой автоматически
//   PUSH_BATCH_LIMIT    — необязательный, размер пачки (по умолчанию 100)
// ------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ------------------------------------------------------------
// Задание из очереди: одна строка push_queue + токены устройств получателя.
// ------------------------------------------------------------
interface PushJob {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  tokens: string[];
}

// ============================================================
// OAuth2 для FCM HTTP v1.
// ------------------------------------------------------------
// Legacy-протокол FCM с простым server key отключён, поэтому нужен access
// token, полученный по service account: подписываем JWT приватным ключом и
// меняем его на токен у Google. Токен живёт час — кэшируем в памяти инстанса,
// чтобы не делать лишний обмен на каждый запуск.
// ============================================================
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Отдаём кэш, если до истечения больше минуты (запас на дорогу запроса).
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.value;
  }

  const clientEmail = Deno.env.get('FCM_CLIENT_EMAIL');
  const rawKey = Deno.env.get('FCM_PRIVATE_KEY');

  if (!clientEmail || !rawKey) {
    throw new Error('Не заданы секреты FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY');
  }

  // В переменных окружения переводы строк хранятся как литерал \n —
  // возвращаем им настоящий перенос, иначе PEM не разберётся.
  const privateKey = rawKey.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const toBase64Url = (data: string) =>
    btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const unsigned =
    `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(claims))}`;

  // Импортируем PEM-ключ в WebCrypto: убираем заголовки и переносы,
  // декодируем base64 в бинарный DER.
  const pemBody = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const der = Uint8Array.from(atob(pemBody), (ch) => ch.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(unsigned),
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${unsigned}.${signatureB64}`;

  // Обмен подписанного JWT на access token.
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth2 отказал: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.value;
}

// ============================================================
// Отправка одного уведомления на один токен.
// ------------------------------------------------------------
// Возвращает 'ok' | 'invalid_token' | текст ошибки.
// 'invalid_token' — устройство переустановило приложение или отозвало
// разрешение; такой токен удаляется из базы, иначе очередь будет вечно
// пытаться слать на мёртвый адрес.
// ============================================================
async function sendToToken(
  projectId: string,
  accessToken: string,
  token: string,
  job: PushJob,
): Promise<'ok' | 'invalid_token' | string> {
  // payload FCM обязан быть плоским объектом строк — числа и объекты
  // приводим к строкам, иначе FCM отклонит сообщение.
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(job.payload ?? {})) {
    data[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  const message = {
    message: {
      token,
      notification: {
        title: job.title,
        body: job.body ?? '',
      },
      // data дублирует цель перехода: по тапу приложение открывает
      // /car/{car_id} или чат — deep link берётся отсюда.
      data,
      android: {
        priority: 'HIGH',
        notification: { sound: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
    },
  };

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    },
  );

  if (response.ok) return 'ok';

  const text = await response.text();

  // UNREGISTERED / INVALID_ARGUMENT по токену = токен мёртв.
  if (
    response.status === 404 ||
    text.includes('UNREGISTERED') ||
    text.includes('registration-token-not-registered')
  ) {
    return 'invalid_token';
  }

  return `FCM ${response.status}: ${text}`;
}

// ============================================================
// Главный обработчик.
// ============================================================
Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const projectId = Deno.env.get('FCM_PROJECT_ID');

    if (!supabaseUrl || !serviceKey) {
      throw new Error('Не заданы SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    }
    if (!projectId) {
      throw new Error('Не задан секрет FCM_PROJECT_ID');
    }

    // service_role обходит RLS — это единственный способ читать чужие
    // задания очереди и токены устройств.
    const supabase = createClient(supabaseUrl, serviceKey);

    const batchLimit = Number(Deno.env.get('PUSH_BATCH_LIMIT') ?? '100');

    // Забираем пачку заданий. Функция сразу увеличивает attempts, поэтому
    // повторный запуск не подхватит те же строки бесконечно: после 5 неудач
    // задание перестаёт выбираться.
    const { data: jobs, error } = await supabase.rpc('claim_push_batch', {
      p_limit: batchLimit,
    });

    if (error) throw new Error(`claim_push_batch: ${error.message}`);

    const list = (jobs ?? []) as PushJob[];
    if (list.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: 'Очередь пуста' }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    const accessToken = await getAccessToken();

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const job of list) {
      // У получателя нет ни одного зарегистрированного устройства —
      // отправлять некуда. Помечаем отправленным, чтобы задание не висело
      // в очереди вечно.
      if (!job.tokens || job.tokens.length === 0) {
        await supabase.rpc('mark_push_sent', {
          p_id: job.id,
          p_ok: true,
          p_error: 'Нет зарегистрированных устройств',
        });
        skipped++;
        continue;
      }

      // Шлём на все устройства пользователя; успехом считаем доставку
      // хотя бы на одно.
      let anyOk = false;
      let lastError: string | null = null;

      for (const token of job.tokens) {
        const result = await sendToToken(projectId, accessToken, token, job);

        if (result === 'ok') {
          anyOk = true;
        } else if (result === 'invalid_token') {
          // Чистим мёртвый токен, чтобы не пытаться снова.
          await supabase.rpc('delete_push_token', { p_token: token });
        } else {
          lastError = result;
        }
      }

      await supabase.rpc('mark_push_sent', {
        p_id: job.id,
        p_ok: anyOk,
        p_error: anyOk ? null : lastError,
      });

      if (anyOk) sent++;
      else failed++;
    }

    return new Response(
      JSON.stringify({ processed: list.length, sent, failed, skipped }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    // Ошибку возвращаем текстом и статусом 500 — так её видно в логах
    // функции и в ответе планировщика.
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
