// ============================================================
// AUTO.RS — Edge Function: daily-cleanup
// ============================================================
// Ежедневное обслуживание базы. Вызывает четыре SQL-функции:
//
//   cleanup_view_log     — удаляет записи журнала просмотров старше 7 дней.
//                          Журнал нужен только для дедупликации «1 просмотр
//                          в сутки», поэтому старые строки — мёртвый вес.
//   cleanup_push_queue   — удаляет отправленные задания старше 30 дней,
//                          чтобы очередь не росла бесконечно.
//   cleanup_email_queue  — то же для очереди писем (миграция 0071).
//                          Провалившиеся письма не удаляются: след
//                          недоставленного сообщения обязан пережить чистку.
//   expire_promotions    — гасит флаг is_vip у объявлений с истёкшим сроком.
//                          Сортировка каталога и так проверяет boosted_until,
//                          но значок VIP на карточке читает именно флаг —
//                          без гашения он висел бы вечно.
//   осиротевшие фото     — файлы в бакете car-images, на которые не
//                          ссылается ни одно объявление (миграция 0123).
//                          Строки car_images уходят каскадом вместе с
//                          объявлением, а файлы оставались в бакете
//                          навсегда. Удаляются пачками и только те, что
//                          старше суток, — см. комментарий у задачи ниже.
//   expire_listings      — срок жизни объявлений (миграция 0113): за 7 дней
//                          до конца предупреждает продавца (уведомление в
//                          кабинете + письмо, если есть адрес), в срок
//                          переводит объявление в статус expired. Ничего не
//                          удаляет: продление возвращает объявление в
//                          каталог одним нажатием. Возвращает {warned,
//                          expired} — по этим числам в логах планировщика
//                          видно, что job реально сделал.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ РАСПИСАНИЕ НА SQL. Планировщик Supabase
// (Dashboard → Edge Functions → Schedules) умеет вызывать только Edge
// Functions по HTTP — выполнить SQL напрямую он не может. Альтернатива —
// расширение pg_cron, но оно доступно не на всех тарифах, поэтому надёжнее
// один способ для обеих задач: и send-push, и чистки идут через планировщик
// Edge Functions.
//
// ПРАВА. Все четыре функции объявлены с REVOKE EXECUTE для anon/authenticated:
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
      'cleanup_email_queue',
      'expire_promotions',
      // Срок жизни объявлений (0113). Идёт последней: предыдущие
      // задачи — чистки, а эта пишет в notifications и email_queue,
      // и при её сбое остальное обслуживание уже отработало.
      'expire_listings',
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

    // ------------------------------------------------------------
    // ОСИРОТЕВШИЕ ФОТОГРАФИИ (миграция 0123).
    // ------------------------------------------------------------
    // Стоит ОТДЕЛЬНО от цикла выше: те задачи — обычные RPC, а эта
    // состоит из двух шагов, потому что Postgres не умеет удалять
    // объекты хранилища. SQL возвращает имена, Storage API удаляет.
    //
    // ПАЧКАМИ И С ПОТОЛКОМ. Storage API принимает до 100 путей за
    // вызов, а общее число за запуск ограничено: даже если мусора
    // накопились тысячи, чистка растянется на несколько дней, зато
    // ежедневный job не упрётся в таймаут и не создаст пиковую
    // нагрузку. Отставание не страшно — файлы никуда не денутся.
    //
    // ЦИКЛ ОСТАНАВЛИВАЕТСЯ, КАК ТОЛЬКО SQL ВЕРНУЛ НЕПОЛНЫЙ БАТЧ:
    // это значит, что сироты кончились, и следующий запрос был бы
    // пустым.
    const ORPHAN_BATCH = 100;
    const ORPHAN_MAX_PER_RUN = 500;

    let orphanDeleted = 0;
    let orphanError: string | undefined;

    try {
      while (orphanDeleted < ORPHAN_MAX_PER_RUN) {
        const { data: orphans, error: findError } = await supabase.rpc(
          'find_orphan_car_images',
          { p_limit: ORPHAN_BATCH },
        );

        if (findError) throw new Error(findError.message);

        const names = (orphans ?? []).map(
          (row: { name: string }) => row.name,
        );

        if (names.length === 0) break;

        const { error: removeError } = await supabase.storage
          .from('car-images')
          .remove(names);

        if (removeError) throw new Error(removeError.message);

        orphanDeleted += names.length;

        // Неполный батч — значит это был последний.
        if (names.length < ORPHAN_BATCH) break;
      }
    } catch (e) {
      orphanError = e instanceof Error ? e.message : String(e);
    }

    results.push({
      task: 'cleanup_orphan_car_images',
      ok: orphanError === undefined,
      affected: orphanError === undefined ? orphanDeleted : null,
      ...(orphanError ? { error: orphanError } : {}),
    });

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
