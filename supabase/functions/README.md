# Edge Functions и расписания — Auto.RS

Две функции, обе запускаются **по расписанию**, вручную дёргать не нужно.

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
| `daily-cleanup` | раз в сутки, 03:00 UTC | Чистит журнал просмотров, старую очередь пушей, гасит истёкшие промо |

## 1. Деплой

```bash
supabase functions deploy send-push
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

Проверить, что секреты на месте (значения не показываются, только имена):

```bash
supabase secrets list
```

## 3. Настройка расписаний в Dashboard

Путь: **Dashboard → Edge Functions → выбрать функцию → вкладка Schedules →
кнопка `Add schedule`** (в некоторых версиях панели раздел называется
**Integrations → Cron**).

В форме заполняются три поля:

- **Name** — произвольное имя расписания;
- **Schedule** — cron-выражение (см. таблицу ниже);
- **Type / Method** — HTTP-вызов этой же функции, метод `POST`.

### Cron-выражения

| Функция | Выражение | Расшифровка |
|---|---|---|
| `send-push` | `* * * * *` | каждую минуту |
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
select cron.schedule('daily-cleanup', '0 3 * * *', $$select public.cleanup_view_log(); select public.cleanup_push_queue(); select public.expire_promotions();$$);
```

`send-push` через pg_cron вызвать нельзя — ей нужен HTTP-запрос к FCM,
поэтому её расписание в любом случае настраивается в Edge Functions.

Держать оба механизма одновременно не нужно: выберите либо Schedules, либо
pg_cron, иначе чистки будут выполняться дважды.
