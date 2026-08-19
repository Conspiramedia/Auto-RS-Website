# Развёртывание бэкенда Auto.RS в Supabase

## Что это
`full_schema.sql` — все 26 миграций (0001–0026) в одном файле, по порядку.
Разворачивает полную схему: профили, объявления с гео (PostGIS), модерация,
аренда с финансами и KYC, чаты, отзывы, избранное, уведомления.

## Шаги

1. Создайте проект на [supabase.com](https://supabase.com) (регион ближе к Сербии — EU).
2. Откройте **SQL Editor** → New query.
3. Вставьте содержимое `full_schema.sql`.
4. Нажмите **Run**.

### Если Run выдал ошибку `unsafe use of new value of enum`
Supabase оборачивает выполнение в одну транзакцию, а два enum-значения
(`paid`, `draft`) нельзя добавить и использовать в одной транзакции.
Решение — выполнить файл по частям через маркеры `[SPLIT POINT]`:

1. Выделите и выполните всё **до** строки `[SPLIT POINT #1]` → Run.
2. Выделите и выполните от `[SPLIT POINT #1]` **до** `[SPLIT POINT #2]` → Run.
3. Выделите и выполните всё от `[SPLIT POINT #2]` до конца → Run.

(В большинстве случаев файл проходит разом — сплиты нужны только при этой ошибке.)

## После развёртывания

1. **Settings → API** → скопируйте `Project URL` и `anon public` ключ.
2. Впишите их в `.env` проекта Flutter:
   ```
   SUPABASE_URL=https://ваш-ref.supabase.co
   SUPABASE_ANON_KEY=ваш-anon-ключ
   ```
3. **Назначьте первого админа** (для модерации/KYC). Сначала зарегистрируйтесь
   в приложении, затем в SQL Editor:
   ```sql
   update public.profiles set is_admin = true where email = 'ваш@email';
   ```
4. **Проверьте расширения** (обычно ставятся автоматически из 0001):
   Database → Extensions → должны быть включены: `postgis`, `pg_trgm`,
   `unaccent`, `btree_gist`, `uuid-ossp`.

## Storage-бакеты
Создаются автоматически из миграций:
- `car-images` (публичный) — фото объявлений;
- `user-documents` (приватный) — документы KYC.
Проверить: Storage → должны присутствовать оба бакета.

## Realtime
Таблицы `messages` и `notifications` добавляются в публикацию
`supabase_realtime` автоматически (миграции 0016, 0024). Проверить:
Database → Replication → publication `supabase_realtime`.

## Тестовый доступ к аренде
Триггер `enforce_verified_booking` (0020) блокирует бронь неверифицированным.
Для быстрого теста выдайте себе верификацию:
```sql
update public.profiles set verification_status = 'verified' where email = 'ваш@email';
```
