-- ============================================================
-- AUTO.RS — Миграция 0044 (ЭТАП 0, ПАКЕТ B): статистика объявлений
-- ============================================================
-- Продавцу нужен ответ на вопрос «работает ли моё объявление»: сколько раз
-- карточку открыли, сколько раз добавили в избранное, сколько раз запросили
-- контакт. Три метрики, три источника:
--
--   views     — RPC track_listing_event('view'), вызывается при открытии карточки;
--   favorites — ТРИГГЕРЫ на favorites (insert/delete), клиент не участвует;
--   contacts  — RPC track_listing_event('contact'), вызов по «Позвонить»/«Написать».
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ КОЛОНКИ В cars:
--   счётчики меняются на порядок чаще самих объявлений; держать их в cars —
--   значит на каждый просмотр переписывать «толстую» строку объявления и
--   раздувать её версии (bloat), мешая индексам каталога. Узкая таблица
--   listing_stats обновляется дёшево.
--
-- ДЕДУПЛИКАЦИЯ ПРОСМОТРОВ (требование заказчика):
--   один пользователь = не более одного засчитанного просмотра в сутки на
--   объявление. Без неё счётчик накручивается обновлением экрана и цифра
--   теряет смысл. Реализовано узкой таблицей listing_view_log с UNIQUE-ключом
--   (car_id, viewer_id, view_date) — повторный INSERT в тот же день просто
--   ничего не делает (ON CONFLICT DO NOTHING), и счётчик не растёт.
--   Гость (uid = null) в лог не пишется: у него нет стабильного идентификатора,
--   а писать по IP на Этапе 0 избыточно — его просмотр считается всегда.
-- ============================================================


-- ============================================================
-- 1) ТАБЛИЦА: listing_stats — агрегированные счётчики объявления
-- ============================================================
-- car_id одновременно первичный ключ и внешний: ровно одна строка статистики
-- на объявление (это и есть требуемый unique). При удалении объявления
-- статистика удаляется каскадно — хранить её отдельно смысла нет.
create table if not exists public.listing_stats (
  car_id     uuid        primary key references public.cars (id) on delete cascade,
  views      integer     not null default 0,   -- открытий карточки (дедуп: 1/сутки/пользователь)
  favorites  integer     not null default 0,   -- сейчас в избранном (ведётся триггерами)
  contacts   integer     not null default 0,   -- запросов контакта (звонок/сообщение)
  updated_at timestamptz not null default now(),

  -- Счётчики не могут уйти в минус ни при какой последовательности событий.
  -- Это страховка от ошибки в триггере, а не от нормальной работы.
  constraint chk_stats_nonnegative check (
    views >= 0 and favorites >= 0 and contacts >= 0
  )
);

comment on table public.listing_stats
  is 'Счётчики объявления: просмотры, избранное, запросы контакта';
comment on column public.listing_stats.favorites
  is 'Сколько пользователей сейчас держат объявление в избранном (триггеры на favorites)';


-- ------------------------------------------------------------
-- RLS: статистику видит владелец объявления и админ.
-- Прямая запись закрыта — счётчики меняют только триггеры и RPC
-- (SECURITY DEFINER, обходят RLS). Иначе продавец мог бы накрутить себе
-- просмотры обычным UPDATE с клиента.
-- ------------------------------------------------------------
alter table public.listing_stats enable row level security;

drop policy if exists "listing_stats_select_owner" on public.listing_stats;
create policy "listing_stats_select_owner" on public.listing_stats
  for select to authenticated
  using (
    exists (
      select 1 from public.cars c
      where c.id = listing_stats.car_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "listing_stats_select_admin" on public.listing_stats;
create policy "listing_stats_select_admin" on public.listing_stats
  for select to authenticated
  using (public.is_admin());


-- ============================================================
-- 2) ТАБЛИЦА: listing_view_log — журнал для дедупликации просмотров
-- ============================================================
-- Хранит ФАКТ засчитанного просмотра, а не саму статистику. Ключ дедупликации —
-- (объявление, зритель, календарный день). view_date хранится отдельной
-- колонкой типа date, а не вычисляется из created_at: только так его можно
-- включить в UNIQUE-ограничение (выражение now()::date не IMMUTABLE).
--
-- Дата берётся в часовом поясе Europe/Belgrade — «сутки» должны совпадать с
-- сутками пользователя в Сербии, а не с UTC, иначе граница дня уезжает.
create table if not exists public.listing_view_log (
  car_id     uuid        not null references public.cars (id) on delete cascade,
  viewer_id  uuid        not null references auth.users (id) on delete cascade,
  view_date  date        not null,
  created_at timestamptz not null default now(),

  -- Тот самый ключ дедупликации: повторный просмотр в те же сутки не пройдёт.
  primary key (car_id, viewer_id, view_date)
);

comment on table public.listing_view_log
  is 'Журнал засчитанных просмотров для дедупликации: 1 просмотр в сутки на пользователя';

-- Индекс под регулярную очистку старых записей (см. cleanup_view_log ниже).
create index if not exists idx_view_log_date
  on public.listing_view_log (view_date);

-- RLS включаем, политик чтения НЕ добавляем: журнал — служебные данные,
-- клиенту он не нужен ни в каком виде, пишет в него только SECURITY DEFINER.
alter table public.listing_view_log enable row level security;


-- ============================================================
-- 3) АВТО-СОЗДАНИЕ строки статистики для нового объявления
-- ============================================================
-- Строка listing_stats заводится сразу при создании объявления, чтобы кабинет
-- продавца всегда показывал нули, а не пустоту, и чтобы RPC не приходилось
-- каждый раз делать upsert.
create or replace function public.tg_create_listing_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.listing_stats (car_id)
  values (new.id)
  on conflict (car_id) do nothing;   -- страховка от повторного вызова
  return new;
end;
$$;

drop trigger if exists trg_create_listing_stats on public.cars;
create trigger trg_create_listing_stats
  after insert on public.cars
  for each row execute function public.tg_create_listing_stats();

-- Backfill: заводим строки статистики для уже существующих объявлений,
-- иначе у старых карточек кабинет остался бы без цифр.
insert into public.listing_stats (car_id)
select c.id from public.cars c
on conflict (car_id) do nothing;


-- ============================================================
-- 4) ТРИГГЕРЫ СЧЁТЧИКА ИЗБРАННОГО (требование: только триггерами)
-- ============================================================
-- favorites показывает, сколько человек ДЕРЖАТ объявление в избранном сейчас:
-- insert увеличивает, delete уменьшает. Клиент в подсчёте не участвует вообще —
-- он лишь дёргает toggle_favorite, а счётчик ведёт база.
--
-- greatest(..., 0) в decrement — защита от ухода в минус, если строка
-- статистики почему-то отсутствовала на момент вставки закладки.
create or replace function public.tg_favorites_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Добавили в избранное. upsert: если строки статистики нет (объявление
    -- создано до этой миграции и backfill не отработал) — создаём с единицей.
    insert into public.listing_stats (car_id, favorites, updated_at)
    values (new.car_id, 1, now())
    on conflict (car_id) do update
      set favorites  = public.listing_stats.favorites + 1,
          updated_at = now();
    return new;

  elsif tg_op = 'DELETE' then
    -- Убрали из избранного.
    update public.listing_stats
       set favorites  = greatest(favorites - 1, 0),
           updated_at = now()
     where car_id = old.car_id;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_favorites_count_ins on public.favorites;
create trigger trg_favorites_count_ins
  after insert on public.favorites
  for each row execute function public.tg_favorites_count();

drop trigger if exists trg_favorites_count_del on public.favorites;
create trigger trg_favorites_count_del
  after delete on public.favorites
  for each row execute function public.tg_favorites_count();

-- Backfill счётчика избранного по фактическому содержимому favorites:
-- на момент миграции закладки уже есть, а счётчик нулевой.
update public.listing_stats s
   set favorites = coalesce(f.cnt, 0),
       updated_at = now()
  from (
    select car_id, count(*)::int as cnt
    from public.favorites
    group by car_id
  ) f
 where f.car_id = s.car_id;


-- ============================================================
-- 5) RPC: track_listing_event(p_car_id, p_event) — учёт события
-- ============================================================
-- p_event: 'view' (открыли карточку) | 'contact' (запросили контакт).
--
-- Правила:
--   * ПРОСМОТРЫ ВЛАДЕЛЬЦЕМ НЕ СЧИТАЮТСЯ — иначе продавец накручивает счётчик
--     собственными заходами. Это же относится к 'contact'.
--   * Просмотр авторизованного дедуплицируется: 1 раз в сутки на объявление.
--   * Гость (uid = null) засчитывается всегда: стабильного идентификатора для
--     дедупликации у него нет.
--
-- Возвращает true, если событие было ЗАСЧИТАНО, и false, если отброшено
-- (свой просмотр или повтор в те же сутки). Клиенту это знать не обязательно,
-- но удобно для отладки и тестов.
--
-- Функция намеренно НЕ падает с ошибкой на несуществующем объявлении и на
-- собственном просмотре: учёт статистики — фоновое действие, оно не должно
-- ломать открытие карточки. Просто возвращает false.
-- ============================================================
create or replace function public.track_listing_event(
  p_car_id uuid,
  p_event  text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_owner    uuid;
  v_today    date;
  v_inserted integer;
begin
  if p_event not in ('view', 'contact') then
    raise exception 'Недопустимый тип события: %', p_event
      using errcode = 'check_violation';
  end if;

  -- Владелец объявления. Заодно проверяем существование карточки.
  select c.user_id into v_owner
    from public.cars c
   where c.id = p_car_id;

  if v_owner is null then
    return false;                       -- объявления нет — молча выходим
  end if;

  -- Собственные действия владельца не учитываем ни для view, ни для contact.
  if v_user is not null and v_user = v_owner then
    return false;
  end if;

  if p_event = 'view' then
    -- Дедупликация только для авторизованных: у гостя нет идентификатора.
    if v_user is not null then
      -- «Сутки» считаем по времени Сербии, чтобы граница дня совпадала
      -- с ощущением пользователя, а не с UTC.
      v_today := (now() at time zone 'Europe/Belgrade')::date;

      insert into public.listing_view_log (car_id, viewer_id, view_date)
      values (p_car_id, v_user, v_today)
      on conflict (car_id, viewer_id, view_date) do nothing;

      -- Сколько строк реально вставилось: 0 — этот пользователь уже смотрел
      -- объявление сегодня, счётчик трогать нельзя.
      get diagnostics v_inserted = row_count;
      if v_inserted = 0 then
        return false;
      end if;
    end if;

    update public.listing_stats
       set views      = views + 1,
           updated_at = now()
     where car_id = p_car_id;

  else  -- p_event = 'contact'
    -- Запросы контакта не дедуплицируем: повторный звонок — отдельный
    -- значимый сигнал интереса, в отличие от повторного открытия экрана.
    update public.listing_stats
       set contacts   = contacts + 1,
           updated_at = now()
     where car_id = p_car_id;
  end if;

  return true;
end;
$$;

comment on function public.track_listing_event(uuid, text)
  is 'Учёт события объявления: view (дедуп 1/сутки) или contact. Действия владельца не считаются';

-- Доступна и гостю: просмотры неавторизованных тоже нужно считать.
grant execute on function public.track_listing_event(uuid, text) to anon, authenticated;


-- ============================================================
-- 6) RPC: get_my_listings_stats() — статистика кабинета продавца
-- ============================================================
-- Возвращает строку на каждое объявление текущего пользователя с метриками
-- и минимумом данных для отрисовки карточки списка (марка/модель/год/цена/
-- статус/фото), чтобы кабинет собирался ОДНИМ запросом без доборов.
--
-- Суммарные значения по всем объявлениям продавец получает сложением на
-- клиенте — отдельная агрегатная строка усложнила бы контракт (пришлось бы
-- смешивать в одном наборе строки-объявления и строку-итог). Для удобства
-- итог также доступен отдельной функцией get_my_stats_totals ниже.
--
-- Сортировка: свежие объявления сверху — как в списке «Мои объявления».
-- ============================================================
create or replace function public.get_my_listings_stats()
returns table (
  car_id      uuid,
  brand       text,
  model       text,
  year        integer,
  city        text,
  status      text,
  sale_price  numeric,
  rent_price_daily numeric,
  currency    text,
  photo_url   text,
  views       integer,
  favorites   integer,
  contacts    integer,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.brand,
    c.model,
    c.year,
    c.city,
    c.status::text,
    c.sale_price,
    c.rent_price_daily,
    c.currency::text,
    -- Первое фото объявления для превью карточки.
    (select ci.image_url from public.car_images ci
      where ci.car_id = c.id
      order by ci.order_index asc
      limit 1) as photo_url,
    -- coalesce на случай объявления без строки статистики (теоретически
    -- невозможно после backfill + триггера, но список не должен ломаться).
    coalesce(s.views, 0),
    coalesce(s.favorites, 0),
    coalesce(s.contacts, 0),
    c.created_at
  from public.cars c
  left join public.listing_stats s on s.car_id = c.id
  where c.user_id = auth.uid()
  order by c.created_at desc;
$$;

comment on function public.get_my_listings_stats()
  is 'Мои объявления со статистикой (просмотры/избранное/контакты) для кабинета продавца';

grant execute on function public.get_my_listings_stats() to authenticated;


-- ------------------------------------------------------------
-- RPC: get_my_stats_totals() — суммарные метрики продавца
-- ------------------------------------------------------------
-- Итоговая плашка кабинета («всего просмотров/в избранном/контактов»).
-- Считает только по активным и проданным объявлениям? — НЕТ, по всем:
-- продавцу важна общая отдача, включая архив.
-- ------------------------------------------------------------
create or replace function public.get_my_stats_totals()
returns table (
  listings_count integer,
  views          integer,
  favorites      integer,
  contacts       integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::int,
    coalesce(sum(s.views), 0)::int,
    coalesce(sum(s.favorites), 0)::int,
    coalesce(sum(s.contacts), 0)::int
  from public.cars c
  left join public.listing_stats s on s.car_id = c.id
  where c.user_id = auth.uid();
$$;

comment on function public.get_my_stats_totals()
  is 'Суммарная статистика по всем объявлениям продавца (итоговая плашка кабинета)';

grant execute on function public.get_my_stats_totals() to authenticated;


-- ============================================================
-- 7) RPC: get_unread_count() — бейдж таба «Сообщения»
-- ============================================================
-- В базе уже есть total_unread_count() из миграции 0018, но она:
--   * не SECURITY DEFINER и полагается на RLS messages_select_participant;
--   * не учитывает блокировки, появившиеся в 0041, — сообщения от
--     заблокированного пользователя всё ещё попадали бы в бейдж.
--
-- Заводим get_unread_count() с явной логикой и не трогаем старую функцию,
-- чтобы не сломать текущие вызовы клиента (замена — во фронтенд-части Этапа 0).
--
-- Считаем входящие непрочитанные в чатах, где текущий пользователь —
-- участник, исключая отправителей, которых он заблокировал.
-- ============================================================
create or replace function public.get_unread_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.messages m
  join public.chats ch on ch.id = m.chat_id
  where m.is_read = false
    -- входящие: чужие сообщения
    and m.sender_id <> auth.uid()
    -- только мои чаты
    and (ch.buyer_id = auth.uid() or ch.seller_id = auth.uid())
    -- сообщения заблокированных мной пользователей в бейдж не попадают
    and not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = auth.uid()
        and b.blocked_id = m.sender_id
    );
$$;

comment on function public.get_unread_count()
  is 'Непрочитанные входящие сообщения для бейджа таба «Сообщения» (без заблокированных)';

grant execute on function public.get_unread_count() to authenticated;


-- ============================================================
-- 8) ОБСЛУЖИВАНИЕ: очистка журнала просмотров
-- ============================================================
-- listing_view_log нужен только для дедупликации «в пределах суток», поэтому
-- записи старше недели бесполезны и лишь занимают место. Функцию можно
-- повесить на pg_cron (раз в сутки) — вызов оставлен на усмотрение
-- администратора, автоматическое расписание в миграции не создаётся.
create or replace function public.cleanup_view_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.listing_view_log
   where view_date < ((now() at time zone 'Europe/Belgrade')::date - 7);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.cleanup_view_log()
  is 'Удаляет записи журнала просмотров старше 7 дней. Вызывать по расписанию (pg_cron)';

-- Клиенту не нужна: вызывается из SQL Editor или планировщика.
revoke execute on function public.cleanup_view_log() from anon, authenticated;
