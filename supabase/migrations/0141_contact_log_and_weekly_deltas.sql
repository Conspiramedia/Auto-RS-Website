-- ============================================================
-- 0141 — ЖУРНАЛ КОНТАКТОВ И ДЕЛЬТЫ МЕТРИК ЗА НЕДЕЛЮ
-- ============================================================
-- ЗАЧЕМ. Блок статистики кабинета показывает под каждой метрикой
-- прирост за 7 дней («+12 за неделю»). Голое число «просмотров: 340»
-- не отвечает на главный вопрос продавца — работает объявление
-- сейчас или уже нет; прирост отвечает.
--
-- ТРИ МЕТРИКИ ИЗ ЧЕТЫРЁХ СЧИТАЮТСЯ НА СУЩЕСТВУЮЩИХ ДАННЫХ:
--   объявления — cars.created_at;
--   просмотры  — listing_view_log.view_date (0044);
--   избранное  — favorites.created_at (0023).
--
-- ЧЕТВЁРТАЯ — КОНТАКТЫ — НЕ СЧИТАЛАСЬ НИКАК. listing_stats.contacts
-- инкрементится на единицу и истории не хранит: в 0044 запросы
-- контакта намеренно не дедуплицируются (повторный звонок — отдельный
-- сигнал интереса), и журнала рядом с ними не завели.
--
-- Эта миграция заводит такой журнал.
--
-- ЧЕСТНОЕ ОГРАНИЧЕНИЕ: дельта по контактам начинает считаться С
-- МОМЕНТА ПРИМЕНЕНИЯ. Первую неделю она будет заниженной, а у
-- объявлений, набравших контакты раньше, покажет «+0». Восстановить
-- прошлое неоткуда — событий не сохранилось. Это осознанная цена
-- запуска метрики, а не дефект.
--
-- ЧЕМ ЖУРНАЛ КОНТАКТОВ ОТЛИЧАЕТСЯ ОТ listing_view_log:
--   * НЕТ дедупликации и первичного ключа по (car_id, viewer_id, дата)
--     — каждый запрос контакта это отдельная строка, ровно по правилу
--     из 0044;
--   * viewer_id ДОПУСКАЕТ NULL: телефон запрашивает и гость. В
--     listing_view_log такого не бывает, потому что там дедупликация
--     возможна только для авторизованных;
--   * хранится не 7 дней, а 90 (см. чистку в конце): журнал
--     просмотров нужен ТОЛЬКО для дедупликации внутри суток и старше
--     недели бесполезен, а этот — источник самой метрики, и месячный
--     разрез по нему захочется завести следующим.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Журнал запросов контакта
-- ------------------------------------------------------------
create table if not exists public.listing_contact_log (
  id         bigint generated always as identity primary key,
  car_id     uuid        not null references public.cars (id) on delete cascade,
  -- NULL — контакт запросил гость. Телефон на карточке доступен
  -- только авторизованным (0116), но кнопка «Написать» и переходы по
  -- tel: остаются, и терять такие события нельзя.
  --
  -- on delete set null, а не cascade: удаление аккаунта покупателя не
  -- должно задним числом уменьшать статистику продавца — событие
  -- было, и продавец его уже видел.
  viewer_id  uuid        references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.listing_contact_log
  is 'Журнал запросов контакта: по одной строке на событие, без дедупликации (0141)';
comment on column public.listing_contact_log.viewer_id
  is 'NULL — контакт запросил неавторизованный посетитель';

-- Индекс под единственный запрос, который к таблице ходит: «сколько
-- событий по объявлениям этого продавца за последние N дней».
-- Составной (car_id, created_at) покрывает и отбор по объявлению, и
-- отсечку по дате внутри него.
create index if not exists idx_contact_log_car_date
  on public.listing_contact_log (car_id, created_at desc);


-- ------------------------------------------------------------
-- 2) RLS: журнал служебный, клиенту не читается
-- ------------------------------------------------------------
-- Политик чтения НЕТ намеренно — ровно как у listing_view_log (0044).
-- Продавец видит агрегат через get_my_stats_totals (SECURITY DEFINER),
-- а сырые события с идентификаторами покупателей наружу не отдаются:
-- по ним можно было бы восстановить, кто именно интересовался
-- машиной.
--
-- Пишет в таблицу только track_listing_event (SECURITY DEFINER,
-- обходит RLS), поэтому политики insert тоже не нужны: без них прямая
-- запись с клиента невозможна, и накрутить себе контакты нельзя.
alter table public.listing_contact_log enable row level security;


-- ------------------------------------------------------------
-- 3) track_listing_event — пишем событие в журнал
-- ------------------------------------------------------------
-- Тело перенесено из 0044 ДОСЛОВНО; добавлена одна вставка в ветке
-- 'contact'. Сигнатура (uuid, text) не меняется — контракт с
-- мобильным приложением не затрагивается, drop не нужен.
--
-- Порядок внутри ветки: сначала журнал, потом счётчик. Обе операции
-- идут в одной транзакции функции, поэтому разойтись они не могут;
-- порядок выбран так, чтобы при будущем переносе счётчика на
-- вычисление из журнала правка свелась к удалению update.
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
    -- Поэтому в журнал (0141) идёт строка на КАЖДОЕ событие.
    insert into public.listing_contact_log (car_id, viewer_id)
    values (p_car_id, v_user);

    update public.listing_stats
       set contacts   = contacts + 1,
           updated_at = now()
     where car_id = p_car_id;
  end if;

  return true;
end;
$$;

comment on function public.track_listing_event(uuid, text)
  is 'Учёт события объявления: view (дедуп 1/сутки) или contact (журнал 0141). Действия владельца не считаются';

-- Права не наследуются только при drop; здесь функция заменена
-- create or replace, поэтому грант с 0044 остаётся в силе. Повторяем
-- его явно — так строка не потеряется при возможном будущем drop.
grant execute on function public.track_listing_event(uuid, text)
  to anon, authenticated;


-- ------------------------------------------------------------
-- 4) get_my_stats_totals — четыре метрики и четыре дельты
-- ------------------------------------------------------------
-- Набор возвращаемых колонок расширяется, а на это create or replace
-- отвечает SQLSTATE 42P13 — отсюда drop и повторный grant (0065
-- закрыл default privileges).
--
-- Сигнатура (без аргументов) не меняется: вызов на клиенте прежний,
-- и приложение, читающее только первые четыре поля, продолжает
-- работать — PostgREST отдаёт объект, лишние ключи клиент
-- игнорирует.
--
-- ОКНО — 7 СУТОК ОТ ТЕКУЩЕГО МОМЕНТА (now() - interval '7 days'), а
-- не «с начала недели»: подпись обещает «за неделю», и календарная
-- граница означала бы, что в понедельник утром дельта у всех
-- обнуляется. Скользящее окно ведёт себя предсказуемо в любой день.
--
-- ПРОСМОТРЫ СЧИТАЮТСЯ ПО ЖУРНАЛУ, а не по разнице счётчиков: журнал
-- чистится с горизонтом ровно 7 суток (cleanup_view_log, 0044), то
-- есть в нём лежит ровно нужное окно. Совпадение удачное, но хрупкое:
-- условие по дате оставлено ЯВНЫМ, чтобы смена горизонта чистки не
-- изменила смысл метрики молча.
--
-- ДЕДУПЛИКАЦИЯ ПРОСМОТРОВ В ЖУРНАЛЕ ТОЛЬКО ДЛЯ АВТОРИЗОВАННЫХ (0044):
-- просмотры гостей в listing_view_log не попадают вовсе. Поэтому
-- дельта просмотров МЕНЬШЕ реального прироста счётчика. Это
-- сознательный компромисс: других данных с датами нет, а
-- заниженная цифра честнее выдуманной.

drop function if exists public.get_my_stats_totals();

create or replace function public.get_my_stats_totals()
returns table (
  listings_count integer,
  views          integer,
  favorites      integer,
  contacts       integer,
  -- Прирост за последние 7 суток (0141). Нулём, а не NULL: клиент
  -- сравнивает с нулём, и отдельная ветка под «нет данных» ему не
  -- нужна — «ничего не прибавилось» и «нечего показывать» для
  -- подписи «+N за неделю» это один случай.
  listings_week  integer,
  views_week     integer,
  favorites_week integer,
  contacts_week  integer
)
language sql
stable
security definer
set search_path = public
as $$
  with my_cars as (
    -- Объявления текущего продавца. Отдельным CTE, потому что к ним
    -- обращаются пять раз ниже, и повторять условие в каждом
    -- подзапросе значило бы пять шансов разойтись при правке.
    select c.id, c.created_at
      from public.cars c
     where c.user_id = auth.uid()
  ),
  since as (
    select now() - interval '7 days' as ts
  )
  select
    (select count(*)::int from my_cars),
    (select coalesce(sum(s.views), 0)::int
       from my_cars mc
       left join public.listing_stats s on s.car_id = mc.id),
    (select coalesce(sum(s.favorites), 0)::int
       from my_cars mc
       left join public.listing_stats s on s.car_id = mc.id),
    (select coalesce(sum(s.contacts), 0)::int
       from my_cars mc
       left join public.listing_stats s on s.car_id = mc.id),

    -- ---------- дельты ----------
    (select count(*)::int
       from my_cars mc, since
      where mc.created_at >= since.ts),

    -- Просмотры: view_date — это дата (не момент), поэтому сравниваем
    -- с датой границы окна. Пограничные сутки попадают целиком, и это
    -- правильнее отсечки по времени: журнал хранит только дату, и
    -- часа события в нём попросту нет.
    (select count(*)::int
       from public.listing_view_log v
       join my_cars mc on mc.id = v.car_id, since
      where v.view_date >= since.ts::date),

    (select count(*)::int
       from public.favorites f
       join my_cars mc on mc.id = f.car_id, since
      where f.created_at >= since.ts),

    (select count(*)::int
       from public.listing_contact_log l
       join my_cars mc on mc.id = l.car_id, since
      where l.created_at >= since.ts);
$$;

comment on function public.get_my_stats_totals()
  is 'Суммарная статистика продавца и прирост каждой метрики за 7 суток (0141)';

grant execute on function public.get_my_stats_totals() to authenticated;


-- ------------------------------------------------------------
-- 5) Обслуживание: чистка журнала контактов
-- ------------------------------------------------------------
-- Горизонт 90 суток, а не 7 как у просмотров: тот журнал существует
-- исключительно ради дедупликации внутри суток и старше недели
-- бесполезен, а этот — единственный источник истории контактов.
-- Трёх месяцев хватает и на недельную дельту, и на месячную, если
-- она понадобится, при этом таблица не растёт бесконечно.
--
-- Вызывается из Edge Function daily-cleanup — той же точки, что
-- cleanup_view_log и expire_listings (см. 0113). Расписание в
-- миграции не создаётся: у проекта один способ запуска ежедневных
-- задач, и заводить рядом pg_cron значило бы держать два.
create or replace function public.cleanup_contact_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.listing_contact_log
   where created_at < now() - interval '90 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.cleanup_contact_log()
  is 'Удаляет записи журнала контактов старше 90 суток; вызывается из daily-cleanup (0141)';

-- Служебная функция: вызывать вправе только service_role. Клиенту
-- она не нужна ни в каком виде — та же логика, что у
-- cleanup_view_log в 0065.
revoke execute on function public.cleanup_contact_log() from anon, authenticated;
