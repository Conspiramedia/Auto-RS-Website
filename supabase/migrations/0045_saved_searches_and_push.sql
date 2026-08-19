-- ============================================================
-- AUTO.RS — Миграция 0045 (ЭТАП 0, ПАКЕТ C): сохранённые поиски и пуши
-- ============================================================
-- Три источника пушей:
--   1) появилось объявление под сохранённый поиск пользователя;
--   2) подешевело объявление из его избранного;
--   3) пришло новое сообщение в чат.
--
-- Пуш не отправляется из триггера напрямую: база не должна ходить в сеть —
-- падение FCM или таймаут заблокировали бы транзакцию публикации объявления.
-- Вместо этого триггеры кладут задание в push_queue, а Edge Function send-push
-- разбирает очередь асинхронно.
--
-- ГЛАВНОЕ АРХИТЕКТУРНОЕ РЕШЕНИЕ ПАКЕТА — общий предикат совпадения.
-- Условие «объявление подходит под фильтры» нужно в двух местах: в каталоге
-- (search_cars_advanced) и в триггере рассылки. Если написать его дважды,
-- то однажды они разойдутся, и пользователь начнёт получать пуши про
-- объявления, которых не видит в поиске. Поэтому предикат вынесен в
-- ОДНУ функцию car_matches_filters(cars, jsonb), и её используют оба места.
-- ============================================================


-- ============================================================
-- 1) ОБЩИЙ ПРЕДИКАТ СОВПАДЕНИЯ: car_matches_filters(car, filters)
-- ============================================================
-- Принимает СТРОКУ объявления целиком и jsonb-фильтры сохранённого поиска.
-- Ключи filters (все необязательны): brand, model, city, fuel,
-- price_from, price_to, year_from, year_to.
--
-- Правила ровно те же, что в search_cars_advanced:
--   * текстовые поля сравниваются через public.f_normalize — двуалфавитность
--     (кириллица/латиница) и диакритика (Đ, Č, Š, Ž) не мешают совпадению;
--   * цена берётся по назначению объявления: для аренды rent_price_daily,
--     иначе sale_price — та же логика, что в фильтре каталога;
--   * отсутствующий или null-ключ = фильтр не задан, ограничения нет.
--
-- IMMUTABLE-объявить нельзя (f_normalize immutable, но обращение к типу
-- строки таблицы делает функцию зависимой от схемы), поэтому STABLE —
-- этого достаточно и для триггера, и для WHERE в запросе.
-- ============================================================
create or replace function public.car_matches_filters(
  p_car     public.cars,
  p_filters jsonb
)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    -- Марка и модель: точное совпадение после нормализации.
    (p_filters ->> 'brand' is null
      or public.f_normalize(p_car.brand) = public.f_normalize(p_filters ->> 'brand'))
    and (p_filters ->> 'model' is null
      or public.f_normalize(p_car.model) = public.f_normalize(p_filters ->> 'model'))
    and (p_filters ->> 'city' is null
      or public.f_normalize(p_car.city) = public.f_normalize(p_filters ->> 'city'))
    -- Топливо — enum, сравниваем как текст (значения латиницей, нормализация не нужна).
    and (p_filters ->> 'fuel' is null
      or p_car.fuel::text = p_filters ->> 'fuel')
    -- Год выпуска.
    and (p_filters ->> 'year_from' is null
      or p_car.year >= (p_filters ->> 'year_from')::int)
    and (p_filters ->> 'year_to' is null
      or p_car.year <= (p_filters ->> 'year_to')::int)
    -- Цена: тот же выбор поля, что в каталоге (аренда → суточная).
    and (p_filters ->> 'price_from' is null
      or coalesce(
           case when p_car.is_for_rent then p_car.rent_price_daily else p_car.sale_price end,
           0
         ) >= (p_filters ->> 'price_from')::numeric)
    and (p_filters ->> 'price_to' is null
      or coalesce(
           case when p_car.is_for_rent then p_car.rent_price_daily else p_car.sale_price end,
           0
         ) <= (p_filters ->> 'price_to')::numeric);
$$;

comment on function public.car_matches_filters(public.cars, jsonb)
  is 'ЕДИНЫЙ предикат «объявление подходит под фильтры». Используется и каталогом, и триггером рассылки';

grant execute on function public.car_matches_filters(public.cars, jsonb) to anon, authenticated;


-- ============================================================
-- 2) ТАБЛИЦА: saved_searches — сохранённые поиски
-- ============================================================
-- filters_hash — md5 от КАНОНИЗИРОВАННОГО jsonb (см. f_filters_hash ниже).
-- Нужен для upsert: без него повторное нажатие «Сообщить, когда появится»
-- с теми же фильтрами плодило бы дубли, и пользователь получал бы по два
-- одинаковых пуша. Сравнивать jsonb напрямую в UNIQUE нельзя — порядок
-- ключей и типы значений могут отличаться при одинаковом смысле.
create table if not exists public.saved_searches (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  filters      jsonb       not null,
  filters_hash text        not null,
  -- Заголовок для списка «Мои подписки» («BMW до 10 000 €, Београд»).
  title        text,
  -- Выключенная подписка не рассылает пуши, но остаётся в списке —
  -- пользователь может включить её обратно, не настраивая фильтры заново.
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),

  -- Один и тот же набор фильтров у пользователя существует в единственном
  -- экземпляре — это и есть ключ upsert'а.
  constraint uq_saved_search unique (user_id, filters_hash)
);

comment on table public.saved_searches
  is 'Сохранённые поиски пользователя. Совпадение нового объявления → пуш';
comment on column public.saved_searches.filters_hash
  is 'md5 канонизированных фильтров. Ключ upsert: защищает от дублей подписки';

-- Индекс под триггер рассылки: он перебирает только активные подписки.
create index if not exists idx_saved_searches_active
  on public.saved_searches (user_id) where active;

-- RLS: пользователь управляет только своими подписками.
alter table public.saved_searches enable row level security;

drop policy if exists "saved_searches_select_own" on public.saved_searches;
create policy "saved_searches_select_own" on public.saved_searches
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "saved_searches_update_own" on public.saved_searches;
create policy "saved_searches_update_own" on public.saved_searches
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "saved_searches_delete_own" on public.saved_searches;
create policy "saved_searches_delete_own" on public.saved_searches
  for delete to authenticated using (auth.uid() = user_id);

-- INSERT напрямую не разрешаем: подписка создаётся только через
-- save_search_from_filters, которая канонизирует фильтры и считает хэш.
-- Прямая вставка с произвольным filters_hash сломала бы дедупликацию.


-- ------------------------------------------------------------
-- ХЕЛПЕР: f_filters_hash(jsonb) — канонизация и хэш фильтров
-- ------------------------------------------------------------
-- Приводит фильтры к каноническому виду ДО хэширования, иначе одинаковые по
-- смыслу подписки дали бы разные хэши и разъехались в дубли:
--   * выбрасываются пустые значения (null, пустая строка) — «фильтр не задан»;
--   * ключи сортируются (jsonb сам хранит их упорядоченно, но собираем явно);
--   * текстовые значения нормализуются f_normalize — «BMW», «bmw» и «БМВ»
--     это одна и та же подписка;
--   * числовые приводятся к числу — «2015» и 2015 не должны различаться.
-- ------------------------------------------------------------
create or replace function public.f_filters_hash(p_filters jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select md5(
    coalesce(
      (
        select string_agg(key || '=' || value, '&' order by key)
        from (
          -- Текстовые ключи: нормализуем значение.
          select k as key, public.f_normalize(p_filters ->> k) as value
          from unnest(array['brand', 'model', 'city', 'fuel']) as k
          where nullif(trim(coalesce(p_filters ->> k, '')), '') is not null

          union all

          -- Числовые ключи: приводим к numeric и обратно к тексту, чтобы
          -- '10000' и 10000.0 дали одинаковую строку.
          select k, (p_filters ->> k)::numeric::text
          from unnest(array['price_from', 'price_to', 'year_from', 'year_to']) as k
          where nullif(trim(coalesce(p_filters ->> k, '')), '') is not null
        ) parts
      ),
      ''                                   -- пустые фильтры → хэш пустой строки
    )
  );
$$;

comment on function public.f_filters_hash(jsonb)
  is 'Канонизирует фильтры (нормализация текста, числа, сортировка ключей) и возвращает md5 — ключ дедупликации подписок';


-- ------------------------------------------------------------
-- RPC: save_search_from_filters(p_filters, p_title) — upsert подписки
-- ------------------------------------------------------------
-- Вызывается из онбординга (шаг «марки») и кнопки «Сообщить, когда появится»
-- в пустом каталоге. Повторный вызов с теми же фильтрами НЕ создаёт дубль:
-- срабатывает ON CONFLICT по (user_id, filters_hash) и подписка просто
-- реактивируется — это же поведение нужно, если пользователь ранее её отключил.
--
-- Перед сохранением фильтры ЧИСТЯТСЯ: остаются только известные ключи с
-- непустыми значениями. Иначе клиент мог бы записать в jsonb что угодно, и
-- предикат совпадения получил бы мусор.
-- ------------------------------------------------------------
create or replace function public.save_search_from_filters(
  p_filters jsonb,
  p_title   text default null
)
returns public.saved_searches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_clean  jsonb := '{}'::jsonb;
  v_key    text;
  v_value  text;
  v_hash   text;
  v_search public.saved_searches;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Оставляем только поддерживаемые ключи с непустыми значениями.
  foreach v_key in array array[
    'brand', 'model', 'city', 'fuel',
    'price_from', 'price_to', 'year_from', 'year_to'
  ] loop
    v_value := nullif(trim(coalesce(p_filters ->> v_key, '')), '');
    if v_value is not null then
      v_clean := v_clean || jsonb_build_object(v_key, v_value);
    end if;
  end loop;

  -- Подписка без единого фильтра означала бы «уведомлять о каждом объявлении
  -- на площадке» — это гарантированный спам, поэтому запрещаем.
  if v_clean = '{}'::jsonb then
    raise exception 'Задайте хотя бы один фильтр для подписки'
      using errcode = 'check_violation';
  end if;

  v_hash := public.f_filters_hash(v_clean);

  insert into public.saved_searches (user_id, filters, filters_hash, title, active)
  values (v_user, v_clean, v_hash, nullif(trim(p_title), ''), true)
  on conflict (user_id, filters_hash) do update
    set active = true,                              -- повторное нажатие включает обратно
        -- Заголовок обновляем только если передан новый: пустой не затирает старый.
        title  = coalesce(nullif(trim(excluded.title), ''), public.saved_searches.title)
  returning * into v_search;

  return v_search;
end;
$$;

comment on function public.save_search_from_filters(jsonb, text)
  is 'Создаёт или реактивирует подписку на поиск (upsert по хэшу фильтров). Дубли невозможны';

grant execute on function public.save_search_from_filters(jsonb, text) to authenticated;


-- ------------------------------------------------------------
-- RPC: get_my_saved_searches() / toggle_saved_search / delete_saved_search
-- ------------------------------------------------------------
-- Управление подписками из профиля. Чтение можно было бы делать прямым
-- SELECT (RLS разрешает), но RPC даёт стабильный контракт для клиента.
-- ------------------------------------------------------------
create or replace function public.get_my_saved_searches()
returns setof public.saved_searches
language sql
stable
security definer
set search_path = public
as $$
  select * from public.saved_searches
  where user_id = auth.uid()
  order by created_at desc;
$$;

grant execute on function public.get_my_saved_searches() to authenticated;

create or replace function public.toggle_saved_search(p_id uuid)
returns public.saved_searches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_search public.saved_searches;
begin
  update public.saved_searches
     set active = not active
   where id = p_id and user_id = auth.uid()   -- чужую подписку не трогаем
  returning * into v_search;

  if v_search.id is null then
    raise exception 'Подписка не найдена' using errcode = 'no_data_found';
  end if;

  return v_search;
end;
$$;

grant execute on function public.toggle_saved_search(uuid) to authenticated;


-- ============================================================
-- 3) ТАБЛИЦА: push_queue — очередь push-уведомлений
-- ============================================================
-- Триггеры пишут сюда, Edge Function send-push читает sent = false и
-- отправляет через FCM. Разделение обязательно: транзакция БД не должна
-- зависеть от доступности внешнего сервиса.
--
-- payload jsonb всегда содержит car_id или chat_id — под deep links
-- (открыть карточку /car/{id} или чат по тапу на уведомление).
create table if not exists public.push_queue (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  title        text        not null,
  body         text,
  payload      jsonb       not null default '{}'::jsonb,
  -- Тип события: нужен для агрегации антиспама и для аналитики доставки.
  kind         text        not null default 'generic',
  -- Ссылка на подписку, породившую пуш (только для kind = 'saved_search').
  -- Используется агрегацией: «сколько раз сегодня уже слали по этой подписке».
  search_id    uuid        references public.saved_searches (id) on delete cascade,
  sent         boolean     not null default false,
  sent_at      timestamptz,
  -- Текст ошибки последней попытки отправки (для разбора недоставленных).
  error        text,
  attempts     integer     not null default 0,
  created_at   timestamptz not null default now(),

  constraint chk_push_kind check (
    kind in ('saved_search', 'price_drop', 'new_message', 'generic')
  )
);

comment on table public.push_queue
  is 'Очередь push-уведомлений. Пишут триггеры, разбирает Edge Function send-push';
comment on column public.push_queue.payload
  is 'Данные для deep link: car_id / chat_id. Всегда содержит цель перехода';

-- Индекс под главный запрос Edge Function: неотправленные, старые сверху.
-- Частичный — отправленные записи в индекс не попадают, он остаётся компактным.
create index if not exists idx_push_queue_pending
  on public.push_queue (created_at) where not sent;

-- Индекс под антиспам-агрегацию: «пуши этой подписки за сегодня».
create index if not exists idx_push_queue_user_kind
  on public.push_queue (user_id, kind, created_at desc);

-- RLS: пользователь может прочитать свои уведомления (история пушей).
-- Записи напрямую нет ни у кого — пишут только SECURITY DEFINER триггеры,
-- а Edge Function работает под service_role, который RLS не подчиняется.
alter table public.push_queue enable row level security;

drop policy if exists "push_queue_select_own" on public.push_queue;
create policy "push_queue_select_own" on public.push_queue
  for select to authenticated using (auth.uid() = user_id);


-- ============================================================
-- 4) ТАБЛИЦА: user_push_tokens — FCM-токены устройств
-- ============================================================
-- У одного пользователя может быть несколько устройств, у одного устройства
-- со временем меняется токен. Ключ — сам токен: он уникален глобально.
-- При переустановке приложения FCM выдаёт новый токен, старый становится
-- невалидным — Edge Function удаляет такие при ошибке UNREGISTERED.
create table if not exists public.user_push_tokens (
  token       text        primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  platform    text        not null default 'android',   -- android | ios | web
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint chk_push_platform check (platform in ('android', 'ios', 'web'))
);

comment on table public.user_push_tokens
  is 'FCM-токены устройств пользователя. Один пользователь — много устройств';

create index if not exists idx_push_tokens_user
  on public.user_push_tokens (user_id);

alter table public.user_push_tokens enable row level security;

drop policy if exists "push_tokens_select_own" on public.user_push_tokens;
create policy "push_tokens_select_own" on public.user_push_tokens
  for select to authenticated using (auth.uid() = user_id);


-- ------------------------------------------------------------
-- RPC: register_push_token(p_token, p_platform)
-- ------------------------------------------------------------
-- Вызывается приложением после выдачи разрешения на уведомления и при каждом
-- обновлении токена (onTokenRefresh). Upsert по токену: если тот же токен
-- пришёл от ДРУГОГО пользователя (на устройстве сменили аккаунт) — токен
-- переезжает к новому владельцу, иначе прежний пользователь продолжал бы
-- получать чужие пуши.
-- ------------------------------------------------------------
create or replace function public.register_push_token(
  p_token    text,
  p_platform text default 'android'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  if nullif(trim(coalesce(p_token, '')), '') is null then
    raise exception 'Пустой push-токен' using errcode = 'check_violation';
  end if;

  insert into public.user_push_tokens (token, user_id, platform)
  values (trim(p_token), v_user, coalesce(p_platform, 'android'))
  on conflict (token) do update
    set user_id    = v_user,
        platform   = excluded.platform,
        updated_at = now();
end;
$$;

comment on function public.register_push_token(text, text)
  is 'Регистрация FCM-токена устройства за текущим пользователем (upsert по токену)';

grant execute on function public.register_push_token(text, text) to authenticated;


-- Отвязка токена при выходе из аккаунта: иначе следующий владелец устройства
-- получал бы пуши предыдущего.
create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_push_tokens
  where token = p_token and user_id = auth.uid();
$$;

grant execute on function public.unregister_push_token(text) to authenticated;


-- ============================================================
-- 5) АНТИСПАМ: агрегация пушей по подписке
-- ============================================================
-- Требование заказчика: несколько совпадений по ОДНОЙ подписке за сутки
-- склеиваются в один пуш «+N авто по вашему запросу».
--
-- Реализация выбрана самая простая из работающих и НЕ усложняет триггер:
-- вместо вставки второй строки в очередь мы ОБНОВЛЯЕМ уже существующую
-- неотправленную запись по той же подписке — увеличиваем счётчик в payload
-- и переписываем текст. Ключевые свойства:
--   * если первый пуш ещё не ушёл (обычный случай при пачке объявлений) —
--     пользователь получит ровно одно уведомление «+3 авто…»;
--   * если первый уже отправлен, а за сутки приходит следующее совпадение —
--     срабатывает суточный лимит: не более 3 пушей в сутки на одну подписку,
--     дальше события копятся в последней записи, не создавая новых.
--
-- Такой подход не требует ни отдельной таблицы-агрегатора, ни планировщика.
-- ============================================================
create or replace function public.f_enqueue_saved_search_push(
  p_user_id   uuid,
  p_search_id uuid,
  p_car       public.cars
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending    public.push_queue;
  v_today_sent integer;
  v_count      integer;
  v_title      text;
begin
  -- Есть ли по этой подписке НЕОТПРАВЛЕННЫЙ пуш, к которому можно приклеиться.
  select * into v_pending
    from public.push_queue
   where user_id = p_user_id
     and search_id = p_search_id
     and kind = 'saved_search'
     and not sent
   order by created_at desc
   limit 1
   for update;                       -- блокируем строку: пачка объявлений может
                                     -- вставляться параллельно

  if v_pending.id is not null then
    -- Склеиваем: увеличиваем счётчик и переписываем текст.
    v_count := coalesce((v_pending.payload ->> 'count')::int, 1) + 1;

    update public.push_queue
       set body    = format('%s и ещё %s объявлений по вашему запросу',
                            p_car.brand || ' ' || p_car.model, v_count - 1),
           -- В payload держим и счётчик, и ПОСЛЕДНЕЕ объявление: по тапу
           -- открываем именно его (deep link на /car/{id}).
           payload = v_pending.payload
                     || jsonb_build_object('count', v_count, 'car_id', p_car.id)
     where id = v_pending.id;
    return;
  end if;

  -- Неотправленного пуша нет. Проверяем суточный лимит по этой подписке.
  select count(*) into v_today_sent
    from public.push_queue
   where user_id = p_user_id
     and search_id = p_search_id
     and kind = 'saved_search'
     and created_at > now() - interval '24 hours';

  -- Лимит: не более 3 уведомлений в сутки на одну подписку. Превышение —
  -- молча пропускаем: пользователь увидит новые объявления при заходе в поиск.
  if v_today_sent >= 3 then
    return;
  end if;

  insert into public.push_queue (user_id, title, body, kind, search_id, payload)
  values (
    p_user_id,
    'Появилось авто по вашему запросу',
    format('%s %s, %s — %s',
           p_car.brand, p_car.model, p_car.year, p_car.city),
    'saved_search',
    p_search_id,
    jsonb_build_object('car_id', p_car.id, 'count', 1, 'type', 'saved_search')
  );
end;
$$;

comment on function public.f_enqueue_saved_search_push(uuid, uuid, public.cars)
  is 'Кладёт пуш по подписке с агрегацией: склеивает неотправленные в «+N авто», лимит 3/сутки на подписку';


-- ============================================================
-- 6) ТРИГГЕР: объявление стало активным → пуши по подпискам
-- ============================================================
-- Ловим ДВА случая одним триггером:
--   * INSERT сразу со статусом 'active' (если такой путь появится);
--   * UPDATE статуса на 'active' из любого другого — это основной путь,
--     approve_car переводит moderation → active.
--
-- Условие «статус СТАЛ active» важно: без сравнения со старым значением
-- любое редактирование активного объявления рассылало бы пуши заново.
--
-- Владельцу пуш о собственном объявлении не отправляется.
-- ============================================================
create or replace function public.tg_push_on_car_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub record;
begin
  -- Отсекаем всё, кроме перехода В active.
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;                      -- уже был активен — не рассылка, а правка
  end if;

  -- Перебираем активные подписки, чьи фильтры совпали с объявлением.
  -- Совпадение считает ОБЩИЙ предикат — тот же, что у каталога.
  for v_sub in
    select s.id, s.user_id
      from public.saved_searches s
     where s.active
       and s.user_id <> new.user_id            -- не уведомляем автора
       and public.car_matches_filters(new, s.filters)
  loop
    perform public.f_enqueue_saved_search_push(v_sub.user_id, v_sub.id, new);
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_push_on_car_active on public.cars;
create trigger trg_push_on_car_active
  after insert or update of status on public.cars
  for each row execute function public.tg_push_on_car_active();


-- ============================================================
-- 7) ТРИГГЕР: снижение цены → пуш тем, у кого авто в избранном
-- ============================================================
-- Реагируем только на СНИЖЕНИЕ и только у активных объявлений: повышение
-- цены пользователю неинтересно, а объявление на модерации показывать рано.
--
-- Цена берётся по назначению объявления — та же логика, что в каталоге
-- и в предикате совпадения.
--
-- Дедупликация: если по этому объявлению у пользователя уже висит
-- неотправленный пуш о снижении, обновляем его вместо создания второго
-- (продавец может править цену несколько раз подряд).
-- ============================================================
create or replace function public.tg_push_on_price_drop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_price numeric;
  v_new_price numeric;
  v_fav       record;
  v_pending   uuid;
begin
  if new.status <> 'active' then
    return new;
  end if;

  v_old_price := case when old.is_for_rent then old.rent_price_daily else old.sale_price end;
  v_new_price := case when new.is_for_rent then new.rent_price_daily else new.sale_price end;

  -- Нужны обе цены и реальное снижение.
  if v_old_price is null or v_new_price is null or v_new_price >= v_old_price then
    return new;
  end if;

  for v_fav in
    select f.user_id
      from public.favorites f
     where f.car_id = new.id
       and f.user_id <> new.user_id          -- владельцу не пишем
  loop
    -- Уже есть неотправленный пуш о снижении по этому авто?
    select id into v_pending
      from public.push_queue
     where user_id = v_fav.user_id
       and kind = 'price_drop'
       and payload ->> 'car_id' = new.id::text
       and not sent
     limit 1;

    if v_pending is not null then
      -- Обновляем текст на актуальную цену вместо второго уведомления.
      update public.push_queue
         set body    = format('%s %s теперь %s %s (было %s)',
                              new.brand, new.model, v_new_price,
                              new.currency, v_old_price),
             payload = payload || jsonb_build_object('price', v_new_price)
       where id = v_pending;
    else
      insert into public.push_queue (user_id, title, body, kind, payload)
      values (
        v_fav.user_id,
        'Цена снижена',
        format('%s %s теперь %s %s (было %s)',
               new.brand, new.model, v_new_price, new.currency, v_old_price),
        'price_drop',
        jsonb_build_object(
          'car_id', new.id,
          'type', 'price_drop',
          'price', v_new_price,
          'old_price', v_old_price
        )
      );
    end if;

    v_pending := null;               -- сбрасываем перед следующей итерацией
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_push_on_price_drop on public.cars;
create trigger trg_push_on_price_drop
  after update of sale_price, rent_price_daily on public.cars
  for each row execute function public.tg_push_on_price_drop();


-- ============================================================
-- 8) ТРИГГЕР: новое сообщение → пуш получателю
-- ============================================================
-- Логика получателя — как в notify_on_message (0024). Отличие: учитываем
-- БЛОКИРОВКИ, появившиеся в 0041, ровно так же, как это делает
-- get_unread_count из Пакета B: если получатель заблокировал отправителя,
-- пуш не ставится в очередь.
--
-- Дополнительно склеиваем поток сообщений: если по этому чату уже висит
-- неотправленный пуш, обновляем его. Иначе быстрая переписка обернулась бы
-- очередью из десятка уведомлений.
-- ============================================================
create or replace function public.tg_push_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat      public.chats;
  v_recipient uuid;
  v_preview   text;
  v_pending   uuid;
begin
  select * into v_chat from public.chats where id = new.chat_id;
  if v_chat.id is null then
    return new;
  end if;

  -- Получатель — участник чата, который не отправитель.
  if new.sender_id = v_chat.buyer_id then
    v_recipient := v_chat.seller_id;
  else
    v_recipient := v_chat.buyer_id;
  end if;

  -- Получатель заблокировал отправителя — пуш не отправляем.
  if exists (
    select 1 from public.user_blocks b
    where b.blocker_id = v_recipient
      and b.blocked_id = new.sender_id
  ) then
    return new;
  end if;

  v_preview := left(coalesce(new.text, ''), 50);
  if length(coalesce(new.text, '')) > 50 then
    v_preview := v_preview || '…';
  end if;

  -- Склейка непрочитанной серии по одному чату.
  select id into v_pending
    from public.push_queue
   where user_id = v_recipient
     and kind = 'new_message'
     and payload ->> 'chat_id' = new.chat_id::text
     and not sent
   limit 1;

  if v_pending is not null then
    -- Текст заменяем на последнее сообщение, счётчик увеличиваем: клиент
    -- покажет «N новых сообщений», если count > 1.
    update public.push_queue
       set body    = v_preview,
           payload = payload || jsonb_build_object(
                       'count',
                       coalesce((payload ->> 'count')::int, 1) + 1
                     )
     where id = v_pending;
    return new;
  end if;

  insert into public.push_queue (user_id, title, body, kind, payload)
  values (
    v_recipient,
    'Новое сообщение',
    v_preview,
    'new_message',
    -- car_id кладём тоже: по тапу можно открыть и чат, и объявление.
    jsonb_build_object(
      'chat_id', new.chat_id,
      'car_id', v_chat.car_id,
      'type', 'new_message',
      'count', 1
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_push_on_message on public.messages;
create trigger trg_push_on_message
  after insert on public.messages
  for each row execute function public.tg_push_on_message();


-- ============================================================
-- 9) СЛУЖЕБНОЕ ДЛЯ EDGE FUNCTION
-- ============================================================
-- Edge Function работает под service_role и RLS не подчиняется, но ей нужен
-- удобный контракт: забрать пачку заданий вместе с токенами устройств.
--
-- claim_push_batch помечает выбранные задания как «взятые в работу»
-- (attempts + 1) в той же транзакции, что и чтение, — так параллельные
-- запуски функции не отправят одно уведомление дважды.
-- FOR UPDATE SKIP LOCKED: второй запуск просто возьмёт следующие строки.
-- ============================================================
create or replace function public.claim_push_batch(p_limit integer default 100)
returns table (
  id       uuid,
  user_id  uuid,
  title    text,
  body     text,
  payload  jsonb,
  tokens   text[]
)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select q.id
      from public.push_queue q
     where not q.sent
       and q.attempts < 5                -- после 5 неудач считаем недоставленным
     order by q.created_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
     for update skip locked
  ),
  bumped as (
    update public.push_queue q
       set attempts = q.attempts + 1
      from claimed c
     where q.id = c.id
    returning q.id, q.user_id, q.title, q.body, q.payload
  )
  select
    b.id, b.user_id, b.title, b.body, b.payload,
    -- Токены всех устройств получателя. Пустой массив = отправлять некуда.
    coalesce(
      array(
        select t.token from public.user_push_tokens t
        where t.user_id = b.user_id
      ),
      '{}'::text[]
    ) as tokens
  from bumped b;
$$;

comment on function public.claim_push_batch(integer)
  is 'Забирает пачку заданий очереди вместе с FCM-токенами. SKIP LOCKED защищает от двойной отправки';

-- Только service_role (Edge Function). Клиенту недоступна.
revoke execute on function public.claim_push_batch(integer) from anon, authenticated;


-- Отметка результата отправки. Вызывается Edge Function после ответа FCM.
create or replace function public.mark_push_sent(
  p_id    uuid,
  p_ok    boolean,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.push_queue
     set sent    = p_ok,
         sent_at = case when p_ok then now() end,
         error   = p_error
   where id = p_id;
$$;

revoke execute on function public.mark_push_sent(uuid, boolean, text) from anon, authenticated;


-- Удаление токена, признанного FCM невалидным (UNREGISTERED / INVALID_ARGUMENT).
-- Без этого очередь бесконечно пыталась бы слать на мёртвые устройства.
create or replace function public.delete_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_push_tokens where token = p_token;
$$;

revoke execute on function public.delete_push_token(text) from anon, authenticated;


-- Очистка отправленных заданий старше 30 дней: очередь не должна расти вечно.
create or replace function public.cleanup_push_queue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.push_queue
   where sent and created_at < now() - interval '30 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.cleanup_push_queue() from anon, authenticated;
