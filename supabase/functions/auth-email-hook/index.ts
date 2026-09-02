// ============================================================
// AUTO.RS — Edge Function: auth-email-hook
// ============================================================
// Send Email Hook для Supabase Auth. GoTrue вызывает эту функцию
// вместо того, чтобы отправлять письмо самому, и передаёт готовый код.
// Мы шлём письмо через Resend нашим шаблоном (login_code) на языке
// получателя.
//
// ПОЧЕМУ ХУК, А НЕ ВСТРОЕННЫЙ ОТПРАВИТЕЛЬ SUPABASE:
//   * встроенный шлёт с общего адреса Supabase, у которого жёсткий
//     лимит и никакой репутации домена — письма уходят в спам;
//   * его шаблон правится в Dashboard, то есть вне репозитория:
//     вёрстка письма перестала бы быть частью кода;
//   * он не знает языка получателя, а у нас продавцы на двух языках.
//
// ПОЧЕМУ НЕ ОЧЕРЕДЬ email_queue. Очередь (0071) разбирается по
// расписанию раз в пять минут — для письма о модерации это нормально,
// для кода входа нет: человек стоит перед формой и ждёт. Здесь
// отправка синхронная, прямо в обработчике.
//
// ------------------------------------------------------------
// ВТОРОЙ РУБЕЖ ГЕЙТА — И ГЛАВНАЯ ПРИЧИНА, ПО КОТОРОЙ ЭТОТ ФАЙЛ
// ВЫГЛЯДИТ СЛОЖНЕЕ, ЧЕМ «ПРОСТО ОТПРАВЬ ПИСЬМО».
//
// Клиент перед signInWithOtp зовёт rpc_check_email_login и не даёт
// запросить код тому, кому нельзя. Но клиентскую проверку можно
// пропустить: signInWithOtp вызывается из консоли браузера одной
// строкой. Тогда GoTrue сгенерирует код и попросит нас его отправить.
//
// Здесь мы проверяем права ЕЩЁ РАЗ — через email_login_allowed() —
// и при отказе письмо не отправляем. Код останется в базе GoTrue
// невостребованным: он никому не известен и через 10 минут истечёт.
// Именно эта проверка, а не клиентская, и есть защита канала.
//
// ------------------------------------------------------------
// ТРЕБУЕМЫЕ СЕКРЕТЫ (supabase secrets set ...):
//   SEND_EMAIL_HOOK_SECRET — секрет хука из Dashboard → Authentication
//                            → Hooks. Формат «v1,whsec_…». Им подписан
//                            каждый запрос от GoTrue; без проверки
//                            подписи функция была бы открытым
//                            эндпоинтом рассылки писем.
//   RESEND_API_KEY         — ключ Resend (общий с send-email)
//   MAIL_FROM              — адрес отправителя на верифицированном домене
//   MAIL_FROM_NAME         — необязательный, по умолчанию «RS Auto»
//   SITE_BASE_URL          — необязательный, для ссылок в подвале письма
//   SUPABASE_URL              — подставляется платформой
//   SUPABASE_SERVICE_ROLE_KEY — подставляется платформой
//
// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ (делается один раз, вручную):
//   1. supabase functions deploy auth-email-hook --no-verify-jwt
//      Флаг обязателен: GoTrue приходит со своей подписью, а не с JWT
//      пользователя, и стандартная проверка отвергла бы запрос.
//   2. Dashboard → Authentication → Hooks → Send Email Hook:
//      включить, URL функции, скопировать секрет.
//   3. supabase secrets set SEND_EMAIL_HOOK_SECRET='v1,whsec_…'
//   4. Dashboard → Authentication → Providers → Email: выключить
//      «Allow new users to sign up». Вход по почте открывает
//      существующий аккаунт и не должен создавать новые.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

import { renderEmail, type Locale } from '../send-email/templates.ts';

// ------------------------------------------------------------
// Полезная нагрузка хука. Состав задан Supabase: пользователь и
// данные письма, которое GoTrue собирался отправить.
// ------------------------------------------------------------
interface HookPayload {
  user: {
    id: string;
    email?: string;
    phone?: string;
  };
  email_data: {
    // Шестизначный код — то, ради чего всё и затевалось.
    token: string;
    // Ссылочный вариант подтверждения. Мы им не пользуемся: письмо с
    // кодом намеренно без ссылок (см. комментарий к шаблону).
    token_hash: string;
    redirect_to: string;
    // magiclink | signup | recovery | invite | email_change
    email_action_type: string;
    site_url: string;
  };
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ------------------------------------------------------------
// Отправка через Resend. Копия sendViaResend из send-email, а не
// импорт: там она не экспортируется, а вытаскивать её наружу ради
// одного вызова значило бы менять работающую функцию очереди.
// ------------------------------------------------------------
async function sendViaResend(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { apiKey, from, to, subject, html, text } = params;

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Сеть: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, error: `Resend ${response.status}: ${body}` };
  }

  return { ok: true };
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const hookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const mailFrom = Deno.env.get('MAIL_FROM');

  if (!hookSecret || !resendKey || !mailFrom) {
    // Молчим о том, чего именно не хватает: ответ уходит наружу.
    console.error(
      'Не заданы секреты: SEND_EMAIL_HOOK_SECRET / RESEND_API_KEY / MAIL_FROM',
    );
    return json(500, { error: 'Not configured' });
  }

  // ---------- Проверка подписи ----------
  // ДО разбора тела и до любых действий. Без неё эндпоинт стал бы
  // открытой рассылкой: кто угодно слал бы письма с нашего домена,
  // подставив чужой адрес и любой текст «кода».
  const raw = await request.text();
  let payload: HookPayload;

  try {
    // Библиотека ждёт секрет без префикса «v1,whsec_».
    const wh = new Webhook(hookSecret.replace('v1,whsec_', ''));
    payload = wh.verify(raw, {
      'webhook-id': request.headers.get('webhook-id') ?? '',
      'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
      'webhook-signature': request.headers.get('webhook-signature') ?? '',
    }) as HookPayload;
  } catch (e) {
    console.error('Подпись хука не прошла проверку:', e);
    return json(401, { error: 'Invalid signature' });
  }

  const email = payload.user?.email?.trim();
  const code = payload.email_data?.token;

  if (!email || !code) {
    console.error('В запросе нет адреса или кода');
    return json(400, { error: 'Bad payload' });
  }

  // ---------- Второй рубеж гейта ----------
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: allowed, error: gateError } = await supabase.rpc(
    'email_login_allowed',
    { p_email: email },
  );

  if (gateError) {
    // Не смогли проверить права — не отправляем. Отказ в письме
    // безопаснее, чем письмо без проверки.
    console.error('Гейт не отработал:', gateError.message);
    return json(500, { error: 'Gate failed' });
  }

  if (allowed !== true) {
    // Права нет. Отвечаем 200, а НЕ ошибкой: для GoTrue ошибка
    // означает сбой доставки, и он показал бы её пользователю,
    // подтвердив тем самым, что адрес существует. Молча не отправляем:
    // код останется невостребованным и истечёт через 10 минут.
    console.warn('Вход по почте не разрешён для адреса, письмо не отправлено');
    return json(200, {});
  }

  // ---------- Третий рубеж: удалённый аккаунт (0126) ----------
  // ЗАЧЕМ ОТДЕЛЬНАЯ ПРОВЕРКА, РАЗ ГЕЙТ ВЫШЕ УЖЕ ОТРАБОТАЛ. Гейт с 0107
  // не смотрит в базу вовсе: вход по почте является и регистрацией,
  // поэтому email_login_allowed проверяет только форму адреса. Для
  // удалённого аккаунта этого мало — его почта в auth.users осталась
  // (delete_my_account обезличивает profiles, а строку GoTrue не
  // трогает), и без проверки ниже человек вошёл бы в пустой аккаунт,
  // из которого он ушёл.
  //
  // Проверяем ПО id, а не по адресу: и в profiles, и в auth.users
  // почта заменена заглушкой, искать там прежний адрес нечего.
  //
  // Рубеж остаётся нужен, хотя delete_my_account освобождает и
  // учётные данные: код входа может прийти по ещё живой ссылке,
  // запрошенной ДО удаления, а строка пользователя никуда не делась.
  //
  // Порядок важен: сначала гейт (он списывает квоту и защищает от
  // перебора), потом это. Обратный порядок тратил бы запрос к базе на
  // каждый мусорный адрес.
  const { data: isDeleted, error: deletedError } = await supabase.rpc(
    'f_account_deleted',
    { p_user_id: payload.user.id },
  );

  if (deletedError) {
    // Не смогли проверить — не отправляем, как и с гейтом выше. Отказ
    // безопаснее письма без проверки.
    console.error('Проверка удалённого аккаунта не отработала:', deletedError.message);
    return json(500, { error: 'Gate failed' });
  }

  if (isDeleted === true) {
    // Ответ 200 и молчание — по той же причине, что и у гейта: ошибка
    // подтвердила бы, что такой аккаунт существует. Код останется
    // невостребованным и истечёт.
    //
    // Человек при этом НЕ заперт: delete_my_account освобождает и
    // почту, и identities в auth.users, поэтому обращение с прежнего
    // адреса заводит новый чистый аккаунт и до этой строки не
    // доходит — сюда попадают только коды, запрошенные для СТАРОЙ
    // строки пользователя.
    console.warn('Аккаунт удалён владельцем, код входа не отправлен');
    return json(200, {});
  }

  // ---------- Язык получателя ----------
  // Из профиля: письмо приходит человеку, а не в браузер, и язык
  // интерфейса, с которого запросили код, тут ни при чём. null —
  // сербский, как во всех остальных письмах площадки.
  const { data: profile } = await supabase
    .from('profiles')
    .select('locale')
    .eq('id', payload.user.id)
    .maybeSingle();

  const locale: Locale = profile?.locale === 'ru' ? 'ru' : 'sr';

  // ---------- Письмо ----------
  const siteUrl =
    Deno.env.get('SITE_BASE_URL') ??
    payload.email_data.site_url ??
    'https://rsauto.rs';

  const rendered = renderEmail('login_code', { locale, code }, siteUrl);

  if (!rendered) {
    console.error('Шаблон login_code не найден — функция старее миграции');
    return json(500, { error: 'Template missing' });
  }

  const fromName = Deno.env.get('MAIL_FROM_NAME') ?? 'RS Auto';
  const result = await sendViaResend({
    apiKey: resendKey,
    from: `${fromName} <${mailFrom}>`,
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  if (!result.ok) {
    // Здесь ошибка уместна: письмо действительно не ушло, и GoTrue
    // должен сообщить об этом пользователю, чтобы тот повторил
    // попытку, а не ждал письма, которого не будет.
    console.error('Resend отказал:', result.error);
    return json(500, { error: 'Send failed' });
  }

  return json(200, {});
});
