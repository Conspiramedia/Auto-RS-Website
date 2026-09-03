# Edge Functions и расписания — Auto.RS

Три функции, все запускаются **по расписанию**, вручную дёргать не нужно.

> **Эти файлы — код для Deno, а не для Next.js.** Они импортируют модули
> по URL (`https://esm.sh/…`) и используют глобальный объект `Deno` —
> ни того, ни другого в окружении сайта нет. Поэтому каталог
> `supabase/functions` исключён из проверки типов сайта
> (`tsconfig.json` → `exclude`): без этого `npx tsc --noEmit` падал бы
> на «Cannot find name 'Deno'», хотя с самими функциями всё в порядке.
> Проверяются и деплоятся они через Supabase CLI (см. ниже).

| Функция | Расписание | Что делает |
|---|---|---|
| `send-push` | каждую минуту | Разбирает очередь `push_queue` и отправляет уведомления через FCM |
| `send-email` | каждые 5 минут | Разбирает очередь `email_queue` и отправляет письма через Resend |
| `daily-cleanup` | раз в сутки, 03:00 UTC | Чистит журнал просмотров, старые очереди пушей и писем, гасит истёкшие промо |

## 1. Деплой

```bash
supabase functions deploy send-push
```

```bash
supabase functions deploy send-email
```

```bash
supabase functions deploy daily-cleanup
```

## 2. Секреты

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` подставляются платформой
автоматически — задавать их не нужно. Вручную задаются только ключи FCM
(нужны для `send-push`; `daily-cleanup` работает без них):

```bash
supabase secrets set FCM_PROJECT_ID=auto-rs-58294
```

```bash
supabase secrets set FCM_CLIENT_EMAIL=firebase-adminsdk-xxxxx@auto-rs-58294.iam.gserviceaccount.com
```

Приватный ключ содержит переносы строк — передавайте его в кавычках, сохраняя
литералы `\n` из service account JSON:

```bash
supabase secrets set FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
```

### Секреты `send-email`

Ключ API Resend (Dashboard Resend → API Keys). Домен отправителя обязан
быть верифицирован в Resend, иначе письма не уходят вовсе:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
```

```bash
supabase secrets set MAIL_FROM=noreply@rsauto.rs
```

Необязательные. `MAIL_FROM_NAME` — отображаемое имя отправителя (по
умолчанию «RS Auto»); `MAIL_REPLY_TO` — адрес для ответов: письма уходят
с `noreply@`, но на служебные письма о заявках салонов отвечать удобно
на контактный ящик проекта:

```bash
supabase secrets set MAIL_REPLY_TO=info.rsauto.rs@gmail.com
```

`SITE_BASE_URL` задавать не нужно: если секрета нет, функция берёт адрес
из `app_settings.site_base_url` — той же строки, из которой собираются
canonical сайта и `site_url` объявлений. Это гарантирует, что ссылка в
письме совпадает с адресом в выдаче.

Адрес служебного ящика, на который приходят заявки салонов и обращения,
живёт не в секретах, а в базе — его читают SQL-триггеры. Значение
задано миграцией `0084` и совпадает с `OPERATOR.email` (lib/legal.ts):
адрес, который видит пользователь, и адрес доставки обязаны быть одним
и тем же. Сменить:

```sql
select public.set_admin_email('info.rsauto.rs@gmail.com');
```

Проверить, что секреты на месте (значения не показываются, только имена):

```bash
supabase secrets list
```

## 3. Настройка расписаний

**ВКЛАДКИ `Schedules` В ПАНЕЛИ ЭТОГО ПРОЕКТА НЕТ.** Прежняя редакция этого
раздела вела в **Dashboard → Edge Functions → Schedules**, и оба раза, когда
по ней шли, расписание в итоге не появлялось: у `daily-cleanup` дефект нашли
через месяц (миграция 0124), у `send-email` — через неделю, когда 26 писем
так и лежали в очереди неотправленными (миграция 0134).

Расписания живут **в базе, в `pg_cron`**, и заводятся миграцией — см.
раздел 5 и сами миграции 0124 / 0134 как образец. В интерфейсе их не видно;
смотреть так:

```sql
select jobname, schedule, active from cron.job;
```

Диагностика: `cron.job_run_details` пишет «succeeded», как только запрос
ПОСТАВЛЕН В ОЧЕРЕДЬ, — это не значит, что функция отработала. Настоящий итог
здесь:

```sql
select status_code, timed_out, error_msg from net._http_response order by created desc limit 5;
```

### Cron-выражения

| Функция | Выражение | Расшифровка |
|---|---|---|
| `send-push` | `* * * * *` | каждую минуту |
| `send-email` | `*/5 * * * *` | каждые 5 минут |
| `daily-cleanup` | `0 3 * * *` | ежедневно в 03:00 |

Порядок полей: `минута час день месяц день_недели`.

**Время в UTC.** Сербия летом UTC+2, зимой UTC+1, поэтому `0 3 * * *` — это
05:00 или 04:00 по Белграду. Для чисток это не важно (нагрузка ночная в любом
случае), но если захотите привязать задачу к местному времени, поправьте час
вручную.

### Если минутного запуска слишком часто

`send-push` при пустой очереди отвечает мгновенно (`{"processed":0}`) и почти
не потребляет ресурсов, поэтому раз в минуту — нормальный режим. Если нужно
реже, поставьте `*/5 * * * *` (каждые 5 минут), но учтите: настолько же
вырастет задержка доставки уведомления о новом сообщении.

## 4. Проверка

Разовый запуск вручную, не дожидаясь расписания.

**Проще всего через Dashboard:** Edge Functions → выбрать функцию → вкладка
**Testing** → метод `POST` → `Send`. Авторизация подставляется сама, ответ и
логи видны там же.

Через HTTP (подставьте `SUPABASE_ANON_KEY` из `.env`). Обратите внимание:
подкоманды `supabase functions invoke` в CLI нет — только HTTP-вызов:

```bash
curl -i -X POST "https://nedjfdswonnbhuxaxjsv.supabase.co/functions/v1/daily-cleanup" -H "Authorization: Bearer ВАШ_ANON_KEY"
```

```bash
curl -i -X POST "https://nedjfdswonnbhuxaxjsv.supabase.co/functions/v1/send-push" -H "Authorization: Bearer ВАШ_ANON_KEY"
```

```bash
curl -i -X POST "https://nedjfdswonnbhuxaxjsv.supabase.co/functions/v1/send-email" -H "Authorization: Bearer ВАШ_ANON_KEY"
```

Ожидаемый ответ `send-email` — сводка по разобранной пачке:

```json
{ "processed": 3, "sent": 3, "failed": 0 }
```

При пустой очереди: `{"processed":0,"message":"Очередь пуста"}`.

В Windows PowerShell `curl` может быть алиасом `Invoke-WebRequest` и не понимать
эти флаги. Тогда:

```bash
Invoke-RestMethod -Method Post -Uri "https://nedjfdswonnbhuxaxjsv.supabase.co/functions/v1/daily-cleanup" -Headers @{ Authorization = "Bearer ВАШ_ANON_KEY" } | ConvertTo-Json -Depth 5
```

Ожидаемый ответ `daily-cleanup` — по строке на каждую задачу:

```json
{
  "ranAt": "2026-08-16T03:00:00.000Z",
  "results": [
    { "task": "cleanup_view_log", "ok": true, "affected": 128 },
    { "task": "cleanup_push_queue", "ok": true, "affected": 40 },
    { "task": "cleanup_email_queue", "ok": true, "affected": 12 },
    { "task": "expire_promotions", "ok": true, "affected": 3 }
  ],
  "failed": 0
}
```

`failed > 0` означает, что часть задач упала — текст ошибки лежит в поле
`error` соответствующей строки, и функция отвечает статусом 500, чтобы
планировщик пометил запуск неуспешным.

Логи запусков: **Dashboard → Edge Functions → функция → Logs**.

## 5. Альтернатива: pg_cron

Если на вашем тарифе доступно расширение `pg_cron`, чистки можно повесить
прямо в базе, без `daily-cleanup`. Проверка доступности:

```sql
select * from pg_available_extensions where name in ('pg_cron', 'pg_net');
```

При наличии расширения (включается в **Database → Extensions**):

```sql
select cron.schedule('daily-cleanup', '0 3 * * *', $$select public.cleanup_view_log(); select public.cleanup_push_queue(); select public.cleanup_email_queue(); select public.expire_promotions();$$);
```

Через `pg_cron` вызываются и `send-push`, и `send-email` — вопреки тому,
что было написано в этом разделе раньше. Наружу (к FCM и к Resend) ходит не
база, а сама Edge Function; база лишь дёргает её HTTP-запросом через
`net.http_post`, как это делает работающее задание `daily-cleanup-job`:

```sql
select cron.schedule('send-email-job', '*/5 * * * *', $$select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/send-email', headers := jsonb_build_object('Authorization', 'Bearer <service_role_key>', 'Content-Type', 'application/json'), timeout_milliseconds := 120000);$$);
```

`timeout_milliseconds` указывать ОБЯЗАТЕЛЬНО: по умолчанию `net.http_post`
рвёт соединение через 5 секунд, и вызов не доходит до функции, а задание при
этом числится успешным (см. миграции 0124 и 0134).

Держать оба механизма одновременно не нужно: выберите либо Schedules, либо
pg_cron, иначе задачи будут выполняться дважды.
