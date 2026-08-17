# RS Auto — сайт маркетплейса автомобилей (Сербия)

Next.js 16 (App Router, TypeScript, Tailwind) + Supabase.

Сайт — **второй клиент того же Supabase**, что и мобильное приложение
(`D:\Project\Auto.RS`). Собственной базы у сайта нет, сущности не дублируются:
вся бизнес-логика живёт в PostgreSQL (RPC, триггеры, RLS), фронтенд только
вызывает функции и отображает результат.

---

## Запуск

```bash
npm install
```

Скопируйте `.env.example` в `.env.local` и заполните значения:

```bash
cp .env.example .env.local
```

| Переменная | Назначение |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL проекта Supabase (тот же, что у приложения) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Публичный anon-ключ |
| `NEXT_PUBLIC_SITE_BASE_URL` | Базовый адрес сайта для canonical, OG и sitemap |

`SERVICE_ROLE` сайту **не нужен и не должен добавляться**: весь публичный
контент доступен анониму через RLS и `SECURITY DEFINER` RPC.

Разработка и сборка:

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run typecheck
```

---

## Миграции Supabase

Миграции сайта лежат в репозитории приложения — там единый источник истины
для схемы БД: `D:\Project\Auto.RS\supabase\migrations\`.

| Файл | Содержимое |
|---|---|
| `0051_site_public_catalog.sql` | `search_cars_public` (сортировка + `total_count`), `get_similar_cars`, частичные индексы |
| `0052_site_seo_pages.sql` | `f_slugify`, `get_site_brands/models/cities`, `get_sitemap_cars`, `get_site_stats`, `get_car_images` |
| `0053_dealer_leads.sql` | Таблица заявок автосалонов + `submit_dealer_lead` (аноним, лимит 3/сутки) |
| `0054_seed_site_demo.sql` | **Только dev/staging.** 27 демо-объявлений |

Все миграции **аддитивные**: сигнатуры `search_cars_advanced` и
`search_cars_with_links`, которые вызывает приложение, не изменялись.

Применить (из папки приложения):

```bash
supabase db push
```

Миграции 0051–0054 применены вручную через SQL Editor, история приведена
в соответствие командой `supabase migration repair --status applied` для
всех версий 0001–0054 — до этого remote-история была пуста целиком, и
`db push` попытался бы выполнить заново всю схему приложения. Сейчас
`supabase db push --dry-run` отвечает «Remote database is up to date».

**`0054_seed_site_demo.sql` на боевую базу не применять** — демо-объявления
попадут в каталог и sitemap. Удаление — [`docs/cleanup_demo.sql`](docs/cleanup_demo.sql).

---

## Структура

```
app/                    Роуты. Тонкие обёртки: метаданные + вызов view
  page.tsx              /            главная (sr)
  cars/                 /cars, /cars/{brand}, /cars/{brand}/{model}
  car/[id]/             /car/{id} + opengraph-image (динамическая OG)
  sell/  dealers/  app/
  ru/                   Полное зеркало дерева на русском
  sitemap.ts  robots.ts
components/             Переиспользуемые компоненты
  pages/                Содержимое страниц, параметризованное локалью
lib/
  brand.ts              ДИЗАЙН-ТОКЕНЫ — единственное место правки бренда
  queries.ts            Все вызовы RPC
  seo.ts                canonical, hreflang, OG, JSON-LD
  i18n.ts               Словарь sr/ru и сборка ссылок
public/.well-known/     AASA и assetlinks.json (с плейсхолдерами)
```

### Локализация

- `sr` (латиница) — язык по умолчанию, живёт в корне сайта без префикса;
- `ru` — префикс `/ru/`;
- отдельной кириллической версии сербского **нет**: двуалфавитность решается
  нормализацией поиска на бэкенде (`f_normalize`), а не дублями страниц;
- `canonical` всегда указывает на сербскую версию, версии связаны `hreflang`.

### Дизайн-токены

Цвета, радиусы, сетка отступов и шрифт — в `lib/brand.ts`, перенесены из
приложения (`lib/core/theme/app_theme.dart`, `app_button_colors.dart`).
Tailwind берёт значения оттуда же. **Правка бренда делается только в этом файле.**

---

## Что уже работает

- **Карточка `/car/{id}`** — SSR, canonical, hreflang, OG + динамическая
  OG-картинка, JSON-LD (`Vehicle` + `Offer`), галерея, «Продолжить в
  приложении», QR на десктопе, «Поделиться», похожие объявления.
  Проданные (`sold`) открываются по прямой ссылке с плашкой и
  `availability: SoldOut`.
- **Каталог `/cars`** — фильтры в URL (SSR), чипсы применённых фильтров с «×»,
  сортировка ссылками, пагинация, empty state с причиной, сбросом и
  «Сообщить, когда появится». Mobile-first.
- **SEO-страницы** `/cars/{brand}` и `/cars/{brand}/{model}` — SSG по маркам
  и моделям, у которых есть активные объявления, хлебные крошки JSON-LD,
  перелинковка на модели.
- **Подача `/sell`** — 4 шага, вход по SMS (`rpc_check_otp_quota` →
  `signInWithOtp` → `verifyOtp`), загрузка фото в `car-images/{uid}/`,
  `create_car_v2`. Объявление создаётся со статусом `moderation`.
- **Антиспам** — honeypot в обеих формах, суточная квота OTP (5/номер),
  лимит заявок дилеров (3/номер) на стороне БД.
- **`sitemap.xml`** с hreflang-альтернативами, **`robots.txt`**,
  **`.well-known/`** для deep links.

Модерация выполняется **в приложении** существующей ролью `admin`
(`approve_car` / `reject_car`). Отдельная `/admin` на сайте намеренно
не строилась, чтобы не заводить вторую систему прав.

---

## TODO

### Обязательное перед продом

- [ ] **Удалить демо-данные.** В базе 27 демо-объявлений из миграции `0054`.
      Скрипт с проверками до и после — [`docs/cleanup_demo.sql`](docs/cleanup_demo.sql),
      выполняется в Supabase SQL Editor под ролью владельца проекта.
      Все демо-записи принадлежат одному служебному продавцу
      `00000000-0000-4000-a000-0000000000de` и помечены `[DEMO]` в описании,
      поэтому удаляются одним запросом, не задевая реальные объявления.
- [ ] **Домен.** Купить, прописать в `NEXT_PUBLIC_SITE_BASE_URL` **и** на сервере:
      `select public.set_site_base_url('https://ваш-домен');`
      Без второго шага `site_url` из БД останутся с плейсхолдером.
- [ ] **Deep links.** В `public/.well-known/` заменить плейсхолдеры:
      `TEAM_ID` (Apple Developer → Membership) в `apple-app-site-association`
      и `SHA256_FINGERPRINT` (отпечаток **релизного** ключа) в `assetlinks.json`.
      Подробности — `D:\Project\Auto.RS\docs\well-known\README.md`.
- [ ] **App Store ID.** После публикации проставить числовой ID в
      `lib/brand.ts` → `appIds.ios.appStoreId`; сейчас ссылка ведёт на поиск.
- [ ] **Applinks в приложении.** Android: `intent-filter` с `autoVerify`;
      iOS: Associated Domains `applinks:домен`. Это правки **в приложении** —
      выполняются отдельной задачей, по согласованию.
- [ ] **SMS-провайдер.** Проверить настройки Phone Auth в Supabase
      (Twilio/Vonage) и лимиты — без него вход на `/sell` не работает.

### Функциональное

- [ ] **Фото в демо-данных.** Сид создаёт объявления без изображений, поэтому
      каталог показывает заглушки с названием марки. Заливка автоматизирована —
      [`scripts/seed-demo-photos.mjs`](scripts/seed-demo-photos.mjs): скачивает
      по 3 кадра на объявление через официальный API Unsplash или Pexels,
      кладёт в `car-images/{user_id}/{car_id}/{n}.jpg` и прописывает
      `car_images` с `order_index`.

      Требует трёх ключей в `.env.local` (см. `.env.example`):
      `SUPABASE_SERVICE_ROLE_KEY` — потому что RLS разрешает запись только
      владельцу объявления, а демо-продавец служебный; и `UNSPLASH_ACCESS_KEY`
      **или** `PEXELS_API_KEY`. Ключи нужны только для этого разового запуска,
      в приложение Next они не попадают и на Vercel не задаются.

      ```bash
      node scripts/seed-demo-photos.mjs --dry-run
      ```

      Повторный запуск безопасен: объявления с фото пропускаются
      (перезалить — флаг `--force`).
- [ ] **Страница дилера.** RPC `get_seller_listings` (миграция 0050) уже есть,
      витрина `/dealer/{id}` на сайте пока не построена.
- [ ] **Sitemap-index.** Сейчас один файл до 45 000 карточек. При росте
      разбить на части (лимит формата — 50 000 URL).
- [ ] **Обработка заявок дилеров.** `dealer_leads` читает только админ через
      SQL; интерфейс разбора заявок не сделан.
- [ ] **Платёжный провайдер.** Промо-объявления (`activate_promotion`,
      баланс `wallet_transactions`) работают в приложении; оплаты с сайта нет.

### Замечания

- Аренда (`is_for_rent`) на сайте **отключена** продуктовым решением: фильтры,
  URL и JSON-LD под неё не строились. Схема БД аренду поддерживает.
- Строки на сербском не вычитаны носителем языка.
- **Поиск кириллицей по латинским названиям не работает** — запрос «БМВ»
  не находит «BMW». Причина в исходной схеме: `f_normalize` — это
  `unaccent + lower`, а `unaccent` снимает диакритику (Đ Č Š Ž), но не
  транслитерирует кириллицу в латиницу. Поведение одинаково на сайте и
  в приложении (`search_cars_advanced`), регрессии нет. Латиница и поиск
  по городам работают. Решение — таблица транслитерации или расширение
  `f_normalize`; затрагивает и приложение, поэтому требует отдельной задачи.

---

## Деплой (Vercel)

1. Импортировать репозиторий, framework определяется автоматически.
2. Задать три переменные окружения из таблицы выше (Production + Preview).
3. `.well-known` отдаётся статикой из `public/`; заголовок
   `Content-Type: application/json` для AASA задан в `next.config.mjs`.
