// ============================================================
// AUTO.RS — Edge Function: send-email
// ============================================================
// Разбирает очередь public.email_queue (миграция 0071) и отправляет
// письма через Resend.
//
// ЗЕРКАЛО send-push, и это осознанно: у площадки уже есть работающая
// схема асинхронной доставки, и второй, «свой» вариант очереди означал
// бы два разных набора граблей в одном проекте. Отличия ровно три:
// провайдер (Resend вместо FCM), меньший размер пачки (письмо — это
// HTTP-запрос наружу, сто запросов не уложатся в лимит времени) и
// трёхзначный статус вместо булева sent (см. комментарий к таблице).
//
// ПОЧЕМУ БАЗА НЕ ХОДИТ В СЕТЬ САМА. Триггер, отправляющий письмо прямо
// из транзакции, поставил бы одобрение объявления в зависимость от
// доступности почтового провайдера: таймаут Resend откатил бы UPDATE
// статуса. Поэтому триггеры только кладут строку в очередь.
//
// ------------------------------------------------------------
// ЗАПУСК: по расписанию (Dashboard → Edge Functions → Schedules,
// раз в 5 минут) либо вручную HTTP-запросом. Параллельные запуски
// безопасны: claim_email_batch использует FOR UPDATE SKIP LOCKED,
// поэтому одно письмо не уйдёт дважды.
//
// ------------------------------------------------------------
// ТРЕБУЕМЫЕ СЕКРЕТЫ (supabase secrets set ...):
//   RESEND_API_KEY   — ключ API Resend (Dashboard → API Keys)
//   MAIL_FROM        — адрес отправителя, домен обязан быть
//                      верифицирован в Resend: noreply@rsauto.rs
//   MAIL_FROM_NAME   — необязательный, отображаемое имя (по умолчанию
//                      «RS Auto»)
//   MAIL_REPLY_TO    — необязательный, адрес для ответов. Письма
//                      уходят с noreply, но на служебные письма
//                      администратору отвечать удобно на support@
//   SITE_BASE_URL    — необязательный. Базовый адрес для ссылок в
//                      письмах; если не задан, берётся из
//                      app_settings.site_base_url той же базы
//   SUPABASE_URL              — подставляется платформой автоматически
//   SUPABASE_SERVICE_ROLE_KEY — подставляется платформой автоматически
//   EMAIL_BATCH_LIMIT — необязательный, размер пачки (по умолчанию 50)
// ------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { renderEmail } from './templates.ts';

// ------------------------------------------------------------
// Задание из очереди: одна строка email_queue.
// ------------------------------------------------------------
interface EmailJob {
  id: string;
  to_email: string;
  template_key: string;
  payload: Record<string, unknown>;
  // Номер текущей попытки: claim_email_batch увеличивает счётчик при
  // выдаче, поэтому здесь уже значение с учётом этого запуска.
  attempts: number;
}

// ============================================================
// Отправка одного письма через Resend.
// ============================================================
// Возвращает id письма у провайдера при успехе либо текст ошибки.
// Ошибку возвращаем строкой, а не бросаем: разбор пачки не должен
// останавливаться из-за одного отказа.
async function sendViaResend(params: {
  apiKey: string;
  from: string;
  replyTo: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { apiKey, from, replyTo, to, subject, html, text } = params;

  let response: Response;

  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        // Текстовая версия обязательна: без неё письмо теряет баллы у
        // спам-фильтров, а текстовые клиенты показали бы пустоту.
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch (e) {
    // Сеть недоступна — это временная неудача. Письмо останется в
    // очереди и уйдёт при следующем запуске.
    return {
      ok: false,
      error: `Сеть: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const body = await response.text();

  if (response.ok) {
    // Resend отвечает {"id":"..."} — сохраняем идентификатор, по нему
    // судьба письма видна в панели провайдера при разборе жалоб
    // «письмо не пришло».
    try {
      const parsed = JSON.parse(body) as { id?: string };
      return { ok: true, id: parsed.id ?? '' };
    } catch {
      // Тело нечитаемо, но статус успешный — письмо принято.
      return { ok: true, id: '' };
    }
  }

  return { ok: false, error: `Resend ${response.status}: ${body.slice(0, 500)}` };
}

// ============================================================
// Главный обработчик.
// ============================================================
Deno.serve(async (_req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const apiKey = Deno.env.get('RESEND_API_KEY');
    const mailFrom = Deno.env.get('MAIL_FROM');

    if (!supabaseUrl || !serviceKey) {
      throw new Error('Не заданы SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    }
    if (!apiKey) {
      throw new Error('Не задан секрет RESEND_API_KEY');
    }
    if (!mailFrom) {
      throw new Error('Не задан секрет MAIL_FROM');
    }

    // service_role обходит RLS — единственный способ читать очередь,
    // у которой политик нет вовсе (deny-all).
    const supabase = createClient(supabaseUrl, serviceKey);

    const fromName = Deno.env.get('MAIL_FROM_NAME') ?? 'RS Auto';
    // Формат «Имя <адрес>»: без отображаемого имени письмо приходит от
    // голого noreply@ и выглядит как рассылка.
    const from = `${fromName} <${mailFrom}>`;
    const replyTo = Deno.env.get('MAIL_REPLY_TO') ?? null;

    // Базовый адрес для ссылок в письмах. Приоритет у секрета функции;
    // если его нет — берём из той же таблицы, что и canonical сайта
    // (app_settings.site_base_url, миграция 0048). Второй источник
    // истины для домена недопустим: ссылка в письме обязана совпадать
    // с адресом в выдаче.
    let siteUrl = Deno.env.get('SITE_BASE_URL') ?? '';

    if (!siteUrl) {
      const { data: setting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'site_base_url')
        .maybeSingle();

      siteUrl = (setting?.value as string | undefined) ?? '';
    }

    siteUrl = siteUrl.replace(/\/+$/, '');

    if (!siteUrl) {
      throw new Error(
        'Не удалось определить базовый адрес сайта: задайте секрет SITE_BASE_URL или строку app_settings.site_base_url',
      );
    }

    const batchLimit = Number(Deno.env.get('EMAIL_BATCH_LIMIT') ?? '50');

    // Забираем пачку. Функция сразу увеличивает attempts, поэтому
    // повторный запуск не подхватит те же строки бесконечно: после
    // 5 неудач задание перестаёт выбираться и получает статус failed.
    const { data: jobs, error } = await supabase.rpc('claim_email_batch', {
      p_limit: batchLimit,
    });

    if (error) throw new Error(`claim_email_batch: ${error.message}`);

    const list = (jobs ?? []) as EmailJob[];

    if (list.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: 'Очередь пуста' }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    let sent = 0;
    let failed = 0;

    for (const job of list) {
      const rendered = renderEmail(job.template_key, job.payload ?? {}, siteUrl);

      // Неизвестный шаблон: функция старее миграции либо ключ записан с
      // опечаткой в обход check-ограничения. Повторные попытки этого не
      // исправят — гасим задание сразу, отметив причину.
      if (!rendered) {
        await supabase.rpc('mark_email_sent', {
          p_id: job.id,
          p_ok: false,
          p_error: `Неизвестный шаблон: ${job.template_key}`,
          p_provider_id: null,
        });
        failed++;
        continue;
      }

      const result = await sendViaResend({
        apiKey,
        from,
        replyTo,
        to: job.to_email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      await supabase.rpc('mark_email_sent', {
        p_id: job.id,
        p_ok: result.ok,
        p_error: result.ok ? null : result.error,
        p_provider_id: result.ok ? result.id : null,
      });

      if (result.ok) sent++;
      else failed++;
    }

    return new Response(
      JSON.stringify({ processed: list.length, sent, failed }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    // Ошибку возвращаем текстом и статусом 500 — так её видно и в логах
    // функции, и в ответе планировщика.
    const message = e instanceof Error ? e.message : String(e);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
