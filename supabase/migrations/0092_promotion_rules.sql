-- ============================================================
-- AUTO.RS — Миграция 0092: правила продвижения объявления
-- ============================================================
-- ПРОБЛЕМА. activate_promotion (0048) проверяла ровно три вещи:
-- авторизацию, владельца и статус active. Больше ничего — ни как
-- давно объявление подано, ни как часто его уже поднимали. Услуга
-- бесплатна, поэтому продавец мог поднять объявление в день подачи,
-- а потом повторять это сколько угодно раз подряд, продлевая срок
-- бесконечно (0048 прибавляет дни к остатку). Салон с двумя сотнями
-- машин мог занять собой весь промо-блок выдачи и держать его вечно.
--
-- ЧТО ВВОДИТСЯ (действует на ОБА клиента — RPC одна на всех):
--   1) окно ожидания: продвигать можно с 15-го дня после подачи;
--   2) частота: не чаще одного раза в 30 дней на объявление,
--      отсчёт от СТАРТА предыдущего продвижения;
--   3) срок продвижения фиксирован — 7 дней;
--   4) в журнал подарка пишется created_by = auth.uid().
--
-- ПОЧЕМУ ИМЕННО «С 15-го ДНЯ». Свежее объявление и так стоит наверху:
-- окно свежести f_fresh_window() (0088, трое суток) поднимает его без
-- всякого продвижения. Поднимать то, что и так на первом экране, —
-- потраченная впустую услуга. Пятнадцать дней — это момент, когда
-- объявление уже ушло из окна свежести и растворилось в перемешке,
-- то есть когда подъём впервые начинает что-то значить.
--
-- ПОЧЕМУ ОТСЧЁТ ОТ СТАРТА, А НЕ ОТ КОНЦА ПРЕДЫДУЩЕГО ПРОМО. Отсчёт от
-- boosted_until означал бы «30 дней после окончания», то есть реальный
-- цикл 37 дней, причём плавающий: снятие с публикации гасит
-- boosted_until (триггер К6 из 0089), и точка отсчёта исчезла бы
-- вместе с ним. Старт — неподвижная и честная величина: между двумя
-- подъёмами ровно 30 суток, что бы с объявлением ни происходило.
--
-- ============================================================
-- ПОЧЕМУ НУЖНО НОВОЕ ПОЛЕ, А НЕ boosted_until И НЕ КОШЕЛЁК
-- ============================================================
-- boosted_until не годится: он гасится в null при снятии, продаже и
-- существенной правке. Продавец снял объявление на день, вернул — и
-- лимит обнулился бы, потому что «предыдущего промо» больше нет в
-- данных. Это дыра, открывающаяся одним нажатием кнопки.
--
-- wallet_transactions тоже не годится, хотя строка о подарке там есть:
--   * car_id объявлен как on delete set null — удалили объявление,
--     и связь с ним исчезла;
--   * это финансовый журнал, а не источник бизнес-правил; чистка или
--     смена схемы кошелька молча сломала бы лимит продвижения;
--   * запрос по нему требовал бы индекса по (car_id, created_at),
--     которого нет, — на каждое нажатие полный проход по журналу.
--
-- Поэтому заводим отдельное поле promoted_at. Оно ставится при каждом
-- успешном продвижении и НИКОГДА не гасится: ни триггером К6, ни
-- правкой, ни возвратом из архива. В этом весь смысл — оно помнит
-- факт подъёма, а не его действующий срок.
-- ============================================================


-- ============================================================
-- БЛОК 1. Поле «когда объявление продвигали в последний раз»
-- ============================================================
alter table public.cars
  add column if not exists promoted_at timestamptz;

comment on column public.cars.promoted_at
  is 'Момент старта последнего продвижения. NULL — не продвигалось ни разу. '
     'В отличие от boosted_until НЕ гасится при снятии, продаже и правке: '
     'по нему считается лимит «одно продвижение в 30 дней» (0092)';

-- Частичный индекс: в него попадают только те объявления, которые
-- когда-либо продвигались, — их единицы процентов от каталога.
-- Нужен проверке лимита внутри activate_promotion (поиск по id уже
-- идёт по первичному ключу, но по этому полю строится и отчётность:
-- «кого и когда поднимали»).
create index if not exists idx_cars_promoted_at
  on public.cars (promoted_at desc)
  where promoted_at is not null;


-- ------------------------------------------------------------
-- ЗАСЕВ ПОЛЯ ДЛЯ УЖЕ ПРОДВИГАЕМЫХ ОБЪЯВЛЕНИЙ
-- ------------------------------------------------------------
-- На момент миграции часть объявлений продвигается прямо сейчас, но
-- promoted_at у них пуст — их поднимали до появления поля. Оставь мы
-- null, лимит для них не действовал бы, и владелец смог бы поднять
-- объявление повторно сразу после окончания текущего срока.
--
-- Восстанавливаем старт из boosted_until: прежняя логика давала ровно
-- 7 дней от момента нажатия (сайт) — значит старт был на 7 дней
-- раньше окончания. Для промо, продлённого несколько раз, оценка
-- получится сдвинутой, но в безопасную сторону: старт окажется позже
-- истинного, и следующий подъём станет доступен не раньше, а позже.
--
-- Истёкшие промо не засеваем: они закончились неизвестно когда, а
-- запрет задним числом ударил бы по людям, которые ничего не нарушали.
update public.cars
   set promoted_at = boosted_until - interval '7 days'
 where promoted_at is null
   and is_vip
   and boosted_until is not null
   and boosted_until > now();


-- ============================================================
-- БЛОК 2. Константы правил
-- ============================================================
-- Вынесены в функции по той же причине, что f_promo_top_limit() в
-- 0088: числа читают и RPC, и тесты (supabase/checks/0092_…), и
-- будущий интерфейс. Литерал, размноженный по трём местам, рано или
-- поздно разойдётся.

-- Сколько дней с подачи объявление ждёт права на продвижение.
create or replace function public.f_promo_min_age()
returns interval
language sql
immutable
set search_path = public
as $$
  select interval '15 days';
$$;

comment on function public.f_promo_min_age()
  is 'С какого возраста объявления доступно продвижение (0092). Раньше этого срока объявление и так стоит высоко за счёт окна свежести';

-- Минимальный промежуток между двумя продвижениями одного объявления.
create or replace function public.f_promo_cooldown()
returns interval
language sql
immutable
set search_path = public
as $$
  select interval '30 days';
$$;

comment on function public.f_promo_cooldown()
  is 'Минимальный промежуток между двумя продвижениями одного объявления, от старта предыдущего (0092)';

-- Длительность одного продвижения. Фиксирована: выбора срока нет ни
-- в интерфейсе, ни в правилах.
create or replace function public.f_promo_duration()
returns interval
language sql
immutable
set search_path = public
as $$
  select interval '7 days';
$$;

comment on function public.f_promo_duration()
  is 'Длительность одного продвижения (0092). Срок фиксирован, выбора нет';

grant execute on function public.f_promo_min_age()  to anon, authenticated;
grant execute on function public.f_promo_cooldown() to anon, authenticated;
grant execute on function public.f_promo_duration() to anon, authenticated;


-- ============================================================
-- БЛОК 3. activate_promotion — правила и журнал
-- ============================================================
-- СИГНАТУРА НЕ МЕНЯЕТСЯ: (uuid, integer) с тем же умолчанием, тот же
-- возвращаемый тип public.cars. Приложение вызывает эту функцию с
-- параметром p_days и продолжит работать без единой правки.
--
-- ЧТО ТЕПЕРЬ ДЕЛАЕТ p_days. Срок продвижения фиксирован (7 дней), и
-- параметр БОЛЬШЕ НЕ ЗАДАЁТ его. Удалить параметр нельзя — это сломало
-- бы вызов приложения, поэтому он сохранён и намеренно игнорируется.
-- Значение, отличное от 7, не является ошибкой и не приводит к отказу:
-- клиент, просящий 30 дней, получает 7 — ровно то, что положено
-- правилами. Отказ здесь был бы хуже: приложение, передающее days=7,
-- работает как раньше, а любое другое значение просто нормализуется.
--
-- ПОРЯДОК ПРОВЕРОК важен и выбран так, чтобы сообщение об отказе
-- называло САМУЮ РАННЮЮ причину: сначала «не ваше», потом «не активно»,
-- потом «уже продвигается», потом возраст, потом частота. Человек,
-- у которого объявление и молодое, и уже продвигавшееся, должен
-- получить один понятный ответ, а не последовательность из двух.
--
-- ВСЕ ОТКАЗЫ — check_violation с человекочитаемым текстом. Интерфейс
-- показывает свои подсказки заранее и до сервера обычно не доходит,
-- но защита обязана стоять и здесь: RPC вызывается напрямую, минуя
-- любой интерфейс. Это и есть двойная защита — UI подсказывает,
-- сервер запрещает.
--
-- ДАТЫ В СООБЩЕНИЯХ форматируются как DD.MM.YYYY — так их пишут и
-- на сайте, и в приложении.
-- ============================================================
create or replace function public.activate_promotion(
  p_car_id uuid,
  p_days   integer default 7
)
returns public.cars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_car       public.cars;
  v_now       timestamptz := now();
  -- Момент, с которого объявление достаточно взрослое для продвижения.
  v_ready_at  timestamptz;
  -- Момент, с которого разрешено следующее продвижение по частоте.
  v_next_at   timestamptz;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку: параллельные вызовы не должны обойти лимит,
  -- прочитав promoted_at до того, как его обновит соседняя транзакция.
  select c.* into v_car
    from public.cars c
   where c.id = p_car_id
   for update;

  if v_car.id is null then
    raise exception 'Объявление не найдено'
      using errcode = 'no_data_found';
  end if;

  if v_car.user_id <> v_user then
    raise exception 'Продвигать можно только своё объявление'
      using errcode = 'insufficient_privilege';
  end if;

  if v_car.status <> 'active' then
    raise exception 'Продвигать можно только активное объявление (текущий статус: %)',
      v_car.status
      using errcode = 'check_violation';
  end if;

  -- ---------- Продвижение уже идёт ----------
  -- Прежняя версия в этом случае ПРОДЛЕВАЛА срок. Теперь это отказ:
  -- продление противоречит правилу «одно продвижение в 30 дней» —
  -- иначе лимит обходился бы нажатием кнопки каждый день.
  if v_car.is_vip
     and v_car.boosted_until is not null
     and v_car.boosted_until > v_now then
    raise exception 'Продвижение уже включено до %',
      to_char(v_car.boosted_until, 'DD.MM.YYYY')
      using errcode = 'check_violation';
  end if;

  -- ---------- Возраст объявления ----------
  v_ready_at := v_car.created_at + public.f_promo_min_age();

  if v_now < v_ready_at then
    raise exception 'Поднять объявление будет доступно с %',
      to_char(v_ready_at, 'DD.MM.YYYY')
      using errcode = 'check_violation';
  end if;

  -- ---------- Частота подъёмов ----------
  -- promoted_at не гасится ничем, поэтому проверка переживает и снятие
  -- с публикации, и правку, и возврат из архива.
  if v_car.promoted_at is not null then
    v_next_at := v_car.promoted_at + public.f_promo_cooldown();

    if v_now < v_next_at then
      raise exception 'Поднять объявление будет доступно с %',
        to_char(v_next_at, 'DD.MM.YYYY')
        using errcode = 'check_violation';
    end if;
  end if;

  -- ---------- Журнал выданной услуги ----------
  -- Сумма 0: деньги выключены, подарок не является движением средств.
  -- created_by заполняется (в 0048 оставался null): без него нельзя
  -- отличить подъём, сделанный самим владельцем, от продвижения,
  -- подаренного администратором, — а когда такая возможность появится,
  -- различить их задним числом будет уже нечем.
  insert into public.wallet_transactions (
    user_id, type, amount, description, car_id, created_by
  )
  values (
    v_car.user_id,
    'gift',
    0,
    format(
      'Продвижение «%s %s» на %s дн. (подарок)',
      v_car.brand,
      v_car.model,
      extract(day from public.f_promo_duration())::integer
    ),
    p_car_id,
    v_user
  );

  -- ---------- Включение ----------
  -- Отсчёт всегда от now(): продлевать нечего — действующее промо
  -- отсеяно проверкой выше.
  update public.cars
     set is_vip        = true,
         boosted_until = v_now + public.f_promo_duration(),
         promoted_at   = v_now,
         updated_at    = v_now
   where id = p_car_id
  returning * into v_car;

  return v_car;
end;
$$;

comment on function public.activate_promotion(uuid, integer)
  is 'Продвижение объявления на 7 дней. Правила (0092): только своё и только active, с 15-го дня после подачи, не чаще раза в 30 дней от старта предыдущего. Параметр p_days сохранён для совместимости и игнорируется. Этап 0: подарок на 0 EUR';

grant execute on function public.activate_promotion(uuid, integer) to authenticated;


-- ============================================================
-- БЛОК 4. Состояние кнопки «Поднять» для интерфейса
-- ============================================================
-- Интерфейс обязан показать подсказку ДО нажатия — с датой, когда
-- продвижение станет доступно. Считать эти даты на клиенте нельзя:
-- правила (15 и 30 дней) живут в базе, и второй их экземпляр в
-- TypeScript разошёлся бы с первым при любой правке. Поэтому
-- get_my_listings_stats отдаёт готовое состояние и готовую дату.
--
-- Сигнатура returns table меняется — функцию нужно удалить перед
-- пересозданием: create or replace не умеет менять состав колонок.
-- Прежние колонки сохранены В ТОМ ЖЕ ПОРЯДКЕ, новые добавлены в
-- конец: клиент, читающий поля по имени, не ломается.
--
-- promo_state — одно из четырёх значений:
--   'available' — можно продвигать прямо сейчас;
--   'active'    — продвижение уже идёт (дата в promo_available_at
--                 равна boosted_until, то есть «включено до»);
--   'too_young' — объявление моложе 15 дней;
--   'cooldown'  — не прошло 30 дней с прошлого подъёма;
--   'blocked'   — статус не active: кнопка неприменима вовсе.
-- ============================================================
drop function if exists public.get_my_listings_stats();

create or replace function public.get_my_listings_stats()
returns table (
  car_id           uuid,
  brand            text,
  model            text,
  year             integer,
  city             text,
  status           text,
  sale_price       numeric,
  rent_price_daily numeric,
  currency         text,
  photo_url        text,
  views            integer,
  favorites        integer,
  contacts         integer,
  is_promoted      boolean,
  boosted_until    timestamptz,
  created_at       timestamptz,
  moderation_comment text,
  is_for_sale        boolean,
  is_for_rent        boolean,
  archived_by        text,
  archived_reason    text,
  -- Новое (0092): состояние кнопки «Поднять» и дата, с которой
  -- продвижение станет доступно (либо до которой уже действует).
  promo_state        text,
  promo_available_at timestamptz
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
    (select ci.image_url from public.car_images ci
      where ci.car_id = c.id
      order by ci.order_index asc
      limit 1) as photo_url,
    coalesce(s.views, 0),
    coalesce(s.favorites, 0),
    coalesce(s.contacts, 0),
    (c.is_vip and c.boosted_until is not null and c.boosted_until > now()),
    c.boosted_until,
    c.created_at,
    -- Причина отклонения — только в статусе 'rejected' (см. 0089).
    case when c.status = 'rejected' then c.moderation_comment end,
    c.is_for_sale,
    c.is_for_rent,
    -- Авторство архива отдаём текстом, а не enum (см. 0089).
    c.archived_by::text,
    c.archived_reason,
    -- Порядок ветвей повторяет порядок проверок в activate_promotion:
    -- подсказка обязана называть ту же причину, что назовёт сервер.
    case
      when c.status <> 'active' then 'blocked'
      when c.is_vip and c.boosted_until is not null and c.boosted_until > now()
        then 'active'
      when now() < c.created_at + public.f_promo_min_age() then 'too_young'
      when c.promoted_at is not null
       and now() < c.promoted_at + public.f_promo_cooldown() then 'cooldown'
      else 'available'
    end,
    case
      when c.status <> 'active' then null
      when c.is_vip and c.boosted_until is not null and c.boosted_until > now()
        then c.boosted_until
      when now() < c.created_at + public.f_promo_min_age()
        then c.created_at + public.f_promo_min_age()
      when c.promoted_at is not null
       and now() < c.promoted_at + public.f_promo_cooldown()
        then c.promoted_at + public.f_promo_cooldown()
      else null
    end
  from public.cars c
  left join public.listing_stats s on s.car_id = c.id
  where c.user_id = auth.uid()
  order by c.created_at desc;
$$;

comment on function public.get_my_listings_stats()
  is 'Мои объявления со статистикой, статусом продвижения и состоянием кнопки «Поднять» (0092)';

grant execute on function public.get_my_listings_stats() to authenticated;
