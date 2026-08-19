// ============================================================
// AUTO.RS — Edge Function: daily-cleanup
// ============================================================
// Ежедневное обслуживание базы. Вызывает три SQL-функции:
//
//   cleanup_view_log     — удаляет записи журнала просмотров старше 7 дней.
//                          Журнал нужен только для дедупликации «1 просмотр
//                          в сутки», поэтому старые строки — мёртвый вес.
//   cleanup_push_queue   — удаляет отправленные задания старше 30 дней,
//                          чтобы очередь не росла бесконечно.
//   expire_promotions    — гасит флаг is_vip у объявлений с истёкшим сроком.
//                          Сортировка каталога и так проверяет boosted_until,
//                          но значок VIP на карточке читает именно флаг —
//                          без гашения он висел бы вечно.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ РАСПИСАНИЕ НА SQL. Планировщик Supabase
// (Dashboard → Edge Functions → Schedules) умеет вызывать только Edge
// Functions по HTTP — выполнить SQL напрямую он не может. Альтернатива —
// расширение pg_cron, но оно доступно не на всех тарифах, поэтому надёжнее
// один способ для обеих задач: и send-push, и чистки идут через планировщик
// Edge Functions.
//
// ПРАВА. Все три функции объявлены с REVOKE EXECUTE для anon/authenticated:
// вызвать их можно только под service_role, ключ которого доступен здесь
// из окружения. Клиент до них не доберётся.
//
// УСТОЙЧИВОСТЬ. Функции вызываются независимо друг от друга: сбой одной
// чистки не отменяет остальные. Итог по каждой возвращается в ответе —
// по нему видно в логах планировщика, что именно не отработало.
//
// ------------------------------------------------------------
// ТРЕБУЕМЫЕ СЕКРЕТЫ (подставляются платформой автоматически):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// Дополнительных секретов не нужно.
// ------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Результат одной задачи обслуживания.
interface TaskResult {
  task: string;
  ok: boolean;
  // Сколько строк обработала функция (или null, если задача упала).
  affected: number | null;
  error?: string;
}

Deno.serve(async (_req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceKey) {
      throw new Error('Не заданы SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    }

    // service_role обходит RLS и имеет право на служебные функции.
    const supabase = createClient(supabaseUrl, serviceKey);

    // Порядок не важен — задачи независимы. Выполняем последовательно,
    // а не через Promise.all: нагрузка ежедневная и небольшая, зато при
    // разборе логов видно, на какой именно задаче что произошло.
    const tasks = [
      'cleanup_view_log',
      'cleanup_push_queue',
      'expire_promotions',
    ];

    const results: TaskResult[] = [];

    for (const task of tasks) {
      const { data, error } = await supabase.rpc(task);

      if (error) {
        // Не прерываем цикл: остальные чистки должны отработать.
        results.push({
          task,
          ok: false,
          affected: null,
          error: error.message,
        });
        continue;
      }

      // Все три функции возвращают число обработанных строк.
      results.push({
        task,
        ok: true,
        affected: typeof data === 'number' ? data : 0,
      });
    }

    const failed = results.filter((r) => !r.ok);

    return new Response(
      JSON.stringify({
        ranAt: new Date().toISOString(),
        results,
        failed: failed.length,
      }),
      {
        // 500 при любом сбое — планировщик пометит запуск неуспешным,
        // и проблема не потеряется среди зелёных галочек.
        status: failed.length > 0 ? 500 : 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
