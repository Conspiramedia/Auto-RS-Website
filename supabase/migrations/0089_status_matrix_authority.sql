-- ============================================================
-- AUTO.RS — Миграция 0089: авторство снятия и матрица статусов
-- ============================================================
-- ЗАЧЕМ. Аудит матрицы переходов вскрыл конфликт «младшая роль
-- отменяет старшую»: администратор снимал объявление с публикации
-- (admin_set_car_status, 0080), а владелец возвращал его обратно
-- кнопкой «Вернуть» в кабинете (set_my_car_status, 0070). Матрица
-- 0070 разрешает archived → active БЕЗ ОГЛЯДКИ на то, кто именно
-- отправил объявление в архив, а в строке cars нет ни одного поля,
-- по которому это можно было бы выяснить: причина снятия уходила в
-- admin_action_log и в notifications, но не в саму машину.
--
-- ЧТО ЗАКРЫВАЕТ ЭТА МИГРАЦИЯ (нумерация пунктов — из отчёта):
--   Р1  cars.archived_by + cars.archived_reason: авторство снятия
--       хранится в СТРОКЕ, и его проставляют все пути в archived.
--   Р2  set_my_car_status: archived → active только для того архива,
--       который владелец создал сам.
--   К4  email_on_car_moderation: возвращена ветка active → archived,
--       потерянная при пересоздании функции в 0086.
--   К5  admin_block_dealer: журнал по КАЖДОМУ объявлению, авторство
--       и блокировка строк cars.
--   К6  единый триггер гасит продвижение при уходе в archived/sold —
--       вместо гашения внутри одной из RPC.
--   К7  автопубликация не воскрешает объявление, которое админ
--       когда-либо отклонял вручную.
--   К9  владельческий возврат из архива попадает в журнал.
--
-- ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ (осознанная отсрочка, см. отчёт):
--   * revoke update on public.cars — колоночные гранты по образцу
--     0069. Приложение (cars_repository.dart:301) до сих пор меняет
--     статус ПРЯМЫМ UPDATE, и revoke сегодня оставил бы пользователей
--     Flutter без кнопок «Снять» и «Продано». Сначала аппа переходит
--     на set_my_car_status и релизится, затем отзыв. Пока отзыва нет,
--     владелец технически способен обойти Р2 прямым UPDATE — но
--     обойти его через ИНТЕРФЕЙС (сайт и аппа) уже нельзя, а это и
--     есть сценарий из тикета.
--   * revoke execute on update_car_v2 — её вызывает приложение
--     (cars_repository.dart:272). Отзыв сломал бы редактирование
--     объявления в аппе. Отсрочено до того же релиза.
--
-- НОВОГО ЗНАЧЕНИЯ В car_status НЕ ПОЯВЛЯЕТСЯ. Enum торчит наружу в
-- get_car_details, search_cars_*, sitemap и во Flutter-моделях
-- (CarStatus.fromValue) — новое значение сломало бы клиенты и все
-- фильтры каталога. Авторство снятия — отдельное поле рядом со
-- статусом, аддитивное и никем не читаемое по умолчанию.
-- ============================================================

begin;


-- ############################################################
-- Р1. АВТОРСТВО СНЯТИЯ: archived_by + archived_reason
-- ############################################################

-- ------------------------------------------------------------
-- Тип: кто отправил объявление в архив.
-- ------------------------------------------------------------
-- ОТДЕЛЬНЫЙ ENUM, А НЕ text С CHECK. Значений ровно три, они
-- перечисляются исчерпывающе и меняться не будут: за архив отвечает
-- либо человек-владелец, либо человек-администратор, либо
-- автоматика. Enum даёт эту гарантию на уровне типа и читается в
-- psql без обращения к определению таблицы.
--
-- 'system' заведён заранее и сегодня не проставляется ни одним путём:
-- он для будущих регламентных снятий (истёк срок, не прошла
-- перепроверка). Значение в enum, которым пока никто не пользуется,
-- ничего не стоит; добавление значения в enum задним числом требует
-- отдельной миграции и не может выполняться в транзакции вместе с
-- его использованием.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'archived_by_kind') then
    create type public.archived_by_kind as enum ('owner', 'admin', 'system');
  end if;
end $$;

-- ------------------------------------------------------------
-- Колонки.
-- ------------------------------------------------------------
-- NULL означает «объявление не в архиве ЛИБО в архиве с незапамятных
-- времён». Оба случая трактуются одинаково — как владельческий архив,
-- потому что до этой миграции админского снятия с фиксацией авторства
-- не существовало вовсе, и запретить возврат задним числом значило бы
-- наказать продавцов за наш недосмотр. Именно поэтому Р2 ниже
-- проверяет «IS NULL OR = owner», а не «= owner».
alter table public.cars
  add column if not exists archived_by     public.archived_by_kind,
  add column if not exists archived_reason text;

comment on column public.cars.archived_by
  is 'Кто отправил объявление в архив: owner | admin | system. NULL — не в архиве либо архив до миграции 0089. Определяет, вправе ли владелец вернуть объявление сам';
comment on column public.cars.archived_reason
  is 'Причина снятия. Заполняется для admin/system: владельцу нужно видеть, за что сняли. Для owner остаётся NULL — он снял сам и причина ему известна';

-- Частичный индекс: единственный запрос по этой колонке — «покажи
-- админский архив» (карточка кабинета, разбор жалоб). Полный индекс
-- по колонке, где у подавляющего большинства строк NULL, был бы
-- тратой места на пустоту.
create index if not exists idx_cars_archived_by_admin
  on public.cars (archived_by)
  where archived_by = 'admin';


-- ############################################################
-- К6. ЕДИНОЕ ГАШЕНИЕ ПРОДВИЖЕНИЯ — ТРИГГЕР ВМЕСТО RPC
-- ############################################################
-- ПРОБЛЕМА. Гашение is_vip/boosted_until при уходе в archived/sold
-- жило ВНУТРИ set_my_car_status (0070). Любой другой путь в те же
-- статусы его не выполнял:
--   * admin_set_car_status (0080) писала только status — объявление
--     уезжало в архив с действующим продвижением, оплаченные дни
--     горели впустую, а после возврата промо оставалось живым (тогда
--     как после владельческого снятия — терялось);
--   * admin_block_dealer (0085) — тот же массовый UPDATE;
--   * прямой UPDATE из приложения — тем более.
--
-- РЕШЕНИЕ. BEFORE UPDATE на таблице. Правило «в архиве и у проданного
-- продвижения нет» — свойство САМОГО СТАТУСА, а не одного из способов
-- его сменить, поэтому его место на таблице. Триггер закрывает и те
-- пути, которые ещё не переведены на RPC.
--
-- BEFORE, А НЕ AFTER: значения правятся в NEW до записи, одной
-- операцией и без второго UPDATE (который вызвал бы триггеры повторно
-- и мог бы уйти в рекурсию).
-- ------------------------------------------------------------
create or replace function public.f_cars_status_side_effects()
returns trigger
language plpgsql
as $fn$
begin
  -- Статус не менялся — не трогаем ничего. Триггер висит на UPDATE OF
  -- status, но Postgres вызывает его и когда колонку переписали тем же
  -- значением, а гасить промо у объявления, которое как было active,
  -- так и осталось, нельзя.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Уход из публикации гасит продвижение: объявление исчезает из
  -- выдачи, и оплаченные (пока подарочные) дни продолжали бы «гореть»
  -- впустую. При возврате в active продвижение НЕ восстанавливается —
  -- это осознанно, иначе пришлось бы хранить остаток срока и
  -- объяснять пользователю его судьбу.
  if new.status in ('archived', 'sold') then
    new.is_vip        := false;
    new.boosted_until := null;
  end if;

  -- Выход из архива стирает авторство: объявление снова в обороте, и
  -- прошлое снятие больше ни на что не влияет. Без этой строки
  -- запись admin осталась бы навсегда и заблокировала бы владельцу
  -- уже СВОЁ следующее снятие — Р2 увидела бы старое 'admin'.
  --
  -- Условие «не в архиве» вместо «= active»: из архива объявление
  -- может уйти и в sold, и в moderation (правка), и признак архива
  -- одинаково теряет смысл во всех случаях.
  if new.status <> 'archived' then
    new.archived_by     := null;
    new.archived_reason := null;
  end if;

  return new;
end;
$fn$;

comment on function public.f_cars_status_side_effects()
  is 'Побочные эффекты смены статуса: гашение продвижения при уходе в archived/sold и сброс авторства архива при выходе из него. На таблице, а не в RPC: статус меняют несколько путей';

drop trigger if exists trg_cars_status_side_effects on public.cars;

create trigger trg_cars_status_side_effects
  before update of status on public.cars
  for each row execute function public.f_cars_status_side_effects();


-- ############################################################
-- Р2 + К9. set_my_car_status — архив владельца и журнал возврата
-- ############################################################
-- ИЗМЕНЕНИЯ ОТНОСИТЕЛЬНО 0070:
--   + archived → active разрешено, только если архив создал сам
--     владелец (archived_by is null or = 'owner'). Админский архив
--     возвращает только администратор — тем же admin_set_car_status,
--     которым снимал.
--   + при уходе в archived проставляется archived_by = 'owner'.
--   + возврат из архива пишется в журнал как car_restored_by_owner
--     (К9): модератор должен уметь увидеть, что снятое им объявление
--     вернулось в выдачу. Раньше это действие не оставляло следов
--     нигде.
--   − гашение is_vip/boosted_until убрано: его делает триггер (К6).
--
-- КОД ОШИБКИ ПРИ ОТКАЗЕ — insufficient_privilege, а НЕ
-- check_violation. Различие принципиальное и для UI, и по смыслу:
-- check_violation означает «такой переход не существует», а здесь
-- переход существует и разрешён — просто не этой роли. Фронт
-- различает их по коду и показывает разные тексты.
--
-- Матрица переходов в остальном не меняется. Сигнатура и состав
-- возвращаемых колонок сохранены — приложение, когда перейдёт на эту
-- RPC, получит тот же ответ, что описан в 0070.
-- ============================================================
create or replace function public.set_my_car_status(
  p_car_id uuid,
  p_status text
)
returns table (
  id            uuid,
  status        text,
  boosted_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_car  public.cars;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Блокируем строку: два параллельных нажатия («Продано» и «Снять»)
  -- не должны разойтись в гонке и оставить статус от проигравшего.
  -- Эта же блокировка сериализует владельца с администратором: если
  -- админ в параллельной транзакции архивирует объявление, владелец
  -- дождётся её конца и прочитает УЖЕ обновлённый archived_by.
  select c.* into v_car
    from public.cars c
   where c.id = p_car_id
   for update;

  if v_car.id is null then
    raise exception 'Объявление не найдено'
      using errcode = 'no_data_found';
  end if;

  -- Владелец — и только он. Проверка идёт ДО матрицы переходов, чтобы
  -- по тексту ошибки нельзя было выяснить статус чужого объявления.
  if v_car.user_id <> v_user then
    raise exception 'Нельзя менять статус чужого объявления'
      using errcode = 'insufficient_privilege';
  end if;

  -- Матрица допустимых переходов. Белый список: то, чего здесь нет,
  -- запрещено по умолчанию. Так новый статус в enum не станет
  -- автоматически достижимым для клиента.
  if not (
       (v_car.status = 'active'     and p_status in ('archived', 'sold'))
    or (v_car.status = 'archived'   and p_status = 'active')
    or (v_car.status = 'sold'       and p_status = 'active')
    or (v_car.status = 'moderation' and p_status = 'archived')
    or (v_car.status = 'rejected'   and p_status = 'archived')
  ) then
    raise exception 'Недопустимый переход статуса: % → %', v_car.status, p_status
      using errcode = 'check_violation';
  end if;

  -- Р2. РЕШЕНИЕ АДМИНИСТРАТОРА ВЛАДЕЛЬЦУ НЕ ОТМЕНИТЬ.
  -- Объявление, снятое администратором, возвращает в выдачу только
  -- администратор. Иначе снятие не было бы решением: продавец
  -- нажимал бы «Вернуть» столько раз, сколько модератор нажимает
  -- «Снять».
  --
  -- NULL трактуется как владельческий архив — см. комментарий к
  -- колонке: до этой миграции авторство не фиксировалось, и запрет
  -- задним числом ударил бы по добросовестным продавцам.
  if v_car.status = 'archived'
     and p_status = 'active'
     and v_car.archived_by is not null
     and v_car.archived_by <> 'owner'
  then
    raise exception 'Объявление снято администратором, обратитесь в поддержку'
      using errcode = 'insufficient_privilege';
  end if;

  -- Гашение продвижения здесь БОЛЬШЕ НЕ ДЕЛАЕТСЯ: его выполняет
  -- триггер trg_cars_status_side_effects для всех путей сразу (К6).
  -- Дублировать логику в двух местах — верный способ получить два
  -- расходящихся правила.
  update public.cars c
     set status = p_status::car_status,
         -- Владельческий архив помечаем явно: без метки он был бы
         -- неотличим от архива «до 0089», и следующая проверка Р2
         -- опиралась бы на умолчание вместо факта.
         archived_by = case
                         when p_status = 'archived' then 'owner'::public.archived_by_kind
                         else c.archived_by   -- сброс делает триггер
                       end,
         -- Причина владельческого снятия не спрашивается и не
         -- хранится: продавец снял объявление сам и знает зачем.
         archived_reason = case
                             when p_status = 'archived' then null
                             else c.archived_reason
                           end
   where c.id = p_car_id;

  -- К9. ВОЗВРАТ ИЗ АРХИВА — В ЖУРНАЛ.
  -- Действие владельца, а не администратора, но место ему именно
  -- здесь: журнал отвечает на вопрос «почему объявление сейчас в
  -- таком состоянии», и возврат из архива — часть этого ответа.
  -- Актор в записи — сам владелец (f_admin_log берёт auth.uid()).
  --
  -- Только archived → active: остальные переходы владельца
  -- («продано», «снять») — обычная жизнь объявления, и заваливать
  -- ими журнал модератора незачем.
  if v_car.status = 'archived' and p_status = 'active' then
    perform public.f_admin_log(
      'car_restored_by_owner',
      'cars',
      p_car_id,
      jsonb_build_object(
        'prev_archived_by', v_car.archived_by,
        'user_id',          v_car.user_id,
        'brand',            v_car.brand,
        'model',            v_car.model
      )
    );
  end if;

  -- Возвращаем то, что нужно кабинету для перерисовки карточки без
  -- повторного запроса всего списка.
  return query
    select c.id, c.status::text, c.boosted_until
      from public.cars c
     where c.id = p_car_id;
end;
$fn$;

comment on function public.set_my_car_status(uuid, text)
  is 'Смена статуса своего объявления по матрице переходов. Возврат из архива — только если владелец снял его сам (0089)';

grant execute on function public.set_my_car_status(uuid, text) to authenticated;


-- ############################################################
-- Р1. admin_set_car_status — фиксация авторства снятия
-- ############################################################
-- ИЗМЕНЕНИЯ ОТНОСИТЕЛЬНО 0080:
--   + при снятии проставляются archived_by = 'admin' и
--     archived_reason = причина. Это и есть то поле, на которое
--     опирается Р2 и по которому триггер писем (К4) отличает
--     админское снятие от владельческого.
--   + при возврате авторство сбрасывает триггер (К6) — здесь ничего
--     писать не нужно.
--
-- ПОРЯДОК «ЖУРНАЛ → UPDATE» СОХРАНЁН, хотя триггер писем больше не
-- ищет запись в журнале (К4). Причина не в письмах: журнал должен
-- содержать запись даже если UPDATE упадёт на триггере или
-- ограничении, — иначе действие модератора исчезнет бесследно.
--
-- Сигнатура и returns public.cars НЕ МЕНЯЮТСЯ.
-- ============================================================
create or replace function public.admin_set_car_status(
  p_car_id uuid,
  p_status text,
  p_reason text
)
returns public.cars
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_car    public.cars;
  v_reason text;
  v_prev   text;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: смена статуса доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  -- Причина — до всякой работы со строкой: незачем блокировать её
  -- ради заведомо неверного вызова. Границы те же, что в reject_car
  -- (0078): расхождение путало бы модератора, который видит один и
  -- тот же счётчик символов в двух диалогах.
  v_reason := btrim(coalesce(p_reason, ''));

  if length(v_reason) < 10 then
    raise exception 'Причина обязательна и должна содержать не менее 10 символов'
      using errcode = 'check_violation';
  end if;

  if length(v_reason) > 1000 then
    raise exception 'Причина слишком длинная: % символов, максимум 1000', length(v_reason)
      using errcode = 'check_violation';
  end if;

  -- Блокируем строку до чтения статуса: два администратора не должны
  -- разойтись в гонке.
  select c.* into v_car from public.cars c where c.id = p_car_id for update;

  if v_car.id is null then
    raise exception 'Объявление % не найдено', p_car_id
      using errcode = 'no_data_found';
  end if;

  v_prev := v_car.status::text;

  if not (
       (v_prev = 'active'   and p_status = 'archived')
    or (v_prev = 'archived' and p_status = 'active')
  ) then
    raise exception 'Переход % → % не разрешён', v_prev, p_status
      using errcode = 'check_violation';
  end if;

  -- Журнал ПЕРЕД обновлением — см. комментарий в шапке функции.
  perform public.f_admin_log(
    case when p_status = 'archived' then 'car_archived' else 'car_restored' end,
    'cars',
    v_car.id,
    jsonb_build_object(
      'reason',      v_reason,
      'prev_status', v_prev,
      'user_id',     v_car.user_id,
      'brand',       v_car.brand,
      'model',       v_car.model
    )
  );

  update public.cars
     set status = p_status::car_status,
         -- Авторство и причина — то, чего не хватало строке cars,
         -- чтобы владелец в кабинете увидел «снято администратором»,
         -- а не безликое «в архиве». При возврате обе колонки
         -- обнуляет триггер.
         archived_by = case
                         when p_status = 'archived' then 'admin'::public.archived_by_kind
                         else archived_by
                       end,
         archived_reason = case
                             when p_status = 'archived' then v_reason
                             else archived_reason
                           end
   where id = p_car_id
   returning * into v_car;

  -- Уведомление в колокольчик. Письмо ставит триггер — здесь его
  -- дублировать нельзя, продавец получил бы два.
  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_car.user_id,
    case when p_status = 'archived'
         then 'Объявление снято с публикации'
         else 'Объявление снова опубликовано' end,
    v_reason,
    case when p_status = 'archived' then 'car_archived' else 'car_restored' end,
    v_car.id
  );

  return v_car;
end;
$fn$;

comment on function public.admin_set_car_status(uuid, text, text)
  is 'Снятие/возврат объявления администратором с обязательной причиной, записью в журнал и фиксацией авторства снятия (0089)';

grant execute on function public.admin_set_car_status(uuid, text, text) to authenticated;


-- ############################################################
-- К5. admin_block_dealer — журнал по каждому объявлению
-- ############################################################
-- ПРОБЛЕМА ВЕРСИИ 0085. Блокировка салона архивировала все его
-- активные объявления ОДНИМ массовым UPDATE, а в журнал шла ОДНА
-- запись — на profiles. Последствия:
--   * по конкретной машине не видно, почему она в архиве;
--   * владелец возвращал каждую машину в пул через «Вернуть»,
--     обходя блокировку салона целиком;
--   * триггер письма (в версии 0080, искавший запись в журнале) не
--     находил её и считал снятие владельческим.
--
-- РЕШЕНИЕ. Цикл по объявлениям: FOR UPDATE на каждой строке,
-- archived_by = 'admin', отдельная запись car_archived в журнале.
-- Первые два пункта закрывают обход через «Вернуть», третий —
-- слепоту журнала.
--
-- ЦИКЛ ВМЕСТО МАССОВОГО UPDATE — сознательный размен. У салона
-- десятки объявлений, не миллионы; блокировка выполняется руками
-- модератора считанные разы в месяц. Стоимость цикла здесь ничтожна,
-- а без него нельзя ни заблокировать строки по одной, ни написать
-- запись журнала на каждую.
--
-- Сигнатура и returns НЕ МЕНЯЮТСЯ.
-- ============================================================
create or replace function public.admin_block_dealer(
  p_user_id uuid,
  p_reason  text
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kind    text;
  v_company text;
  v_reason  text;
  v_hidden  integer := 0;
  v_car     record;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: блокировка салона доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));

  if length(v_reason) < 10 then
    raise exception 'Причина обязательна и должна содержать не менее 10 символов'
      using errcode = 'check_violation';
  end if;

  if length(v_reason) > 1000 then
    raise exception 'Причина слишком длинная: % символов, максимум 1000', length(v_reason)
      using errcode = 'check_violation';
  end if;

  select p.seller_kind, p.company_name
    into v_kind, v_company
    from public.profiles p
   where p.id = p_user_id
   for update;

  if v_kind is null then
    raise exception 'Профиль % не найден', p_user_id
      using errcode = 'no_data_found';
  end if;

  if v_kind <> 'dealer' then
    raise exception 'Функция применима только к автосалонам'
      using errcode = 'check_violation';
  end if;

  -- 1) Снимаем право публиковать без модерации.
  update public.profiles
     set trusted_seller = false,
         updated_at     = now()
   where id = p_user_id;

  -- 2) Убираем из выдачи только ОПУБЛИКОВАННЫЕ объявления.
  -- Ждущие проверки не трогаем: они и так не видны покупателю, а
  -- модератор разберёт их обычным порядком.
  --
  -- FOR UPDATE в курсоре: между выборкой и UPDATE владелец может
  -- успеть сменить статус сам, и без блокировки мы записали бы архив
  -- поверх его «продано».
  for v_car in
    select c.id, c.brand, c.model
      from public.cars c
     where c.user_id = p_user_id
       and c.status  = 'active'
     order by c.id          -- детерминированный порядок захвата
                            -- блокировок: две параллельные блокировки
                            -- салонов не встанут в дедлок
     for update
  loop
    update public.cars
       set status          = 'archived',
           archived_by     = 'admin'::public.archived_by_kind,
           archived_reason = v_reason,
           updated_at      = now()
     where id = v_car.id;

    -- Запись на КАЖДОЕ объявление: журнал по машине должен отвечать
    -- на вопрос «почему она в архиве» без раскопок по журналу салона.
    perform public.f_admin_log(
      'car_archived',
      'cars',
      v_car.id,
      jsonb_build_object(
        'reason',      v_reason,
        'prev_status', 'active',
        'user_id',     p_user_id,
        'brand',       v_car.brand,
        'model',       v_car.model,
        -- Отличает массовое снятие от точечного: у первого причина
        -- одна на все объявления и относится к салону, а не к машине.
        'via',         'dealer_blocked'
      )
    );

    v_hidden := v_hidden + 1;
  end loop;

  -- 3) Итоговая запись по салону — остаётся: она отвечает на другой
  -- вопрос, «что случилось с салоном», и несёт число скрытых машин.
  perform public.f_admin_log(
    'dealer_blocked',
    'profiles',
    p_user_id,
    jsonb_build_object(
      'company', v_company,
      'reason',  v_reason,
      'hidden',  v_hidden
    )
  );

  return v_hidden;
end;
$fn$;

comment on function public.admin_block_dealer(uuid, text)
  is 'Блокировка салона: снятие права автопубликации и архивирование активных объявлений с записью в журнал по каждому (0089)';

grant execute on function public.admin_block_dealer(uuid, text) to authenticated;


-- ############################################################
-- К4. email_on_car_moderation — возвращённая ветка снятия
-- ############################################################
-- РЕГРЕССИЯ, КОТОРУЮ ЧИНИМ. Миграция 0080 добавила в эту функцию
-- ветку active → archived с письмом car_archived_by_admin. Миграция
-- 0086 пересоздала функцию целиком ради одного условия про
-- автопубликацию — и ветку не перенесла. С тех пор продавец,
-- которому администратор снял объявление, письма НЕ получал: только
-- колокольчик, который заметит не каждый. Шаблон
-- car_archived_by_admin при этом остался в белом списке шаблонов и
-- не использовался ни разу.
--
-- ЧТО ИЗМЕНИЛОСЬ ПО СРАВНЕНИЮ С ВЕРСИЕЙ 0080. Администратор
-- определяется по NEW.archived_by = 'admin' — по СТРОКЕ, а не
-- поиском свежей записи в admin_action_log. Прежний способ был
-- хрупок трижды:
--   * зависел от окна «1 минута» и от того, что журнал пишется
--     раньше UPDATE;
--   * опирался на допущение «второго снятия того же объявления не
--     бывает», неверное при открытом прямом UPDATE;
--   * молча ломался, если запись в журнал не попадала (ровно случай
--     admin_block_dealer до К5).
-- Значение archived_by кладёт та же транзакция, что меняет статус, и
-- AFTER-триггер видит его в NEW гарантированно.
--
-- ПОДАВЛЕНИЕ ПИСЬМА ПРИ АВТОПУБЛИКАЦИИ (0086) СОХРАНЕНО дословно.
-- ============================================================
create or replace function public.email_on_car_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email  text;
  v_locale text;
  v_url    text;
begin
  -- АВТОПУБЛИКАЦИЯ ПИСЬМА НЕ ШЛЁТ. Флаг ставит f_car_autopublish
  -- (0086) непосредственно перед сменой статуса. Салон с этим правом
  -- знает, что его объявления уходят в выдачу сразу, а письмо на
  -- каждую машину при десятках подач в день — спам.
  --
  -- current_setting с true возвращает NULL, если переменная не
  -- задавалась вовсе: обычная модерация флага не ставит, и условие
  -- для неё никогда не срабатывает.
  if coalesce(current_setting('rs_auto.skip_moderation_email', true), 'off') = 'on' then
    return new;
  end if;

  -- Статус не менялся — выходим сразу, не трогая profiles. Триггер
  -- висит на UPDATE OF status, но Postgres вызывает его и когда
  -- колонку переписали тем же значением.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Интересуют три перехода: два решения модерации и снятие
  -- опубликованного объявления администратором.
  if not (
    (new.status = 'active'   and old.status in ('moderation', 'rejected'))
    or
    (new.status = 'rejected' and old.status = 'moderation')
    or
    (new.status = 'archived' and old.status = 'active')
  ) then
    return new;
  end if;

  -- Снятие: письмо шлём, только если это сделал администратор.
  -- Продавец, снявший объявление сам, и так знает об этом — письмо
  -- было бы спамом. Признак берём из строки (см. шапку функции).
  if new.status = 'archived'
     and (new.archived_by is distinct from 'admin'::public.archived_by_kind)
  then
    return new;
  end if;

  -- Адрес и язык получателя. Профиль читаем ОДНИМ запросом.
  select p.email, p.locale
    into v_email, v_locale
    from public.profiles p
   where p.id = new.user_id;

  -- Почты нет (вход по SMS, профиль не заполнен) — письма не будет.
  -- Уведомление в колокольчик уже поставила вызывающая RPC.
  if v_email is null then
    return new;
  end if;

  -- Ссылка собирается тем же f_car_site_url, что и canonical на сайте
  -- (0048): адрес в письме обязан совпадать с адресом в выдаче до
  -- символа, иначе продавец, перейдя из письма, попадёт на дубль.
  v_url := public.f_car_site_url(new.id);

  if new.status = 'active' then
    perform public.f_enqueue_email(
      v_email,
      'car_approved',
      jsonb_build_object(
        'locale',  coalesce(v_locale, 'sr'),
        'brand',   new.brand,
        'model',   new.model,
        'year',    new.year,
        'car_url', v_url
      ),
      new.user_id
    );

  elsif new.status = 'archived' then
    perform public.f_enqueue_email(
      v_email,
      'car_archived_by_admin',
      jsonb_build_object(
        'locale', coalesce(v_locale, 'sr'),
        'brand',  new.brand,
        'model',  new.model,
        'year',   new.year,
        -- Причина обязательна на уровне admin_set_car_status и
        -- admin_block_dealer, поэтому пустой она сюда не приходит.
        -- nullif оставлен на случай будущего пути, который об этом
        -- не знает.
        'reason', nullif(btrim(coalesce(new.archived_reason, '')), '')
      ),
      new.user_id
    );

  else
    perform public.f_enqueue_email(
      v_email,
      'car_rejected',
      jsonb_build_object(
        'locale', coalesce(v_locale, 'sr'),
        'brand',  new.brand,
        'model',  new.model,
        'year',   new.year,
        -- Причина из moderation_comment — та же строка, что видит
        -- продавец в кабинете и в колокольчике.
        'reason', nullif(btrim(coalesce(new.moderation_comment, '')), '')
      ),
      new.user_id
    );
  end if;

  return new;
end;
$fn$;

comment on function public.email_on_car_moderation()
  is 'Письмо продавцу о решении модерации и о снятии объявления админом (признак — cars.archived_by). Пропускает автопубликацию салона. На таблице, а не в RPC: статус меняют несколько путей';

-- Триггер пересоздавать не нужно: tg_email_on_car_moderation (0071)
-- висит на той же функции и подхватывает новое тело. Пересоздание
-- потребовалось бы только при смене списка колонок в UPDATE OF.


-- ############################################################
-- К7. АВТОПУБЛИКАЦИЯ НЕ ВОСКРЕШАЕТ ОТКЛОНЁННОЕ
-- ############################################################
-- ПРОБЛЕМА. f_car_autopublish (0086) публикует любое объявление
-- доверенного салона, находящееся в статусе moderation. Гейт по
-- статусу защищает от публикации того, что лежит в rejected прямо
-- сейчас, но не от такого сценария:
--   1) модератор отклонил объявление салона (rejected + причина);
--   2) салон правит его через update_car_v3 — статус уходит в
--      moderation, moderation_comment очищается;
--   3) салон добавляет фотографию — срабатывает автопубликация, и
--      объявление уходит в выдачу, минуя модератора, который его
--      только что отклонил.
-- Правка контента при этом может быть косметической: достаточно
-- изменить пробел в описании.
--
-- РЕШЕНИЕ — ПАМЯТЬ ЖУРНАЛА, А НЕ ПОЛЕ В СТРОКЕ. Признак «это
-- объявление админ когда-либо отклонял вручную» берётся из
-- admin_action_log: наличие записи car_rejected по этому car_id.
--
-- ПОЧЕМУ ЖУРНАЛ. Любое поле в cars пришлось бы либо очищать при
-- правке (и тогда оно ничего не помнит — ровно та дыра, которую
-- чиним), либо не очищать никогда (и тогда это тот же журнал, только
-- дублированный). Журнал уже хранит ровно этот факт, он append-only,
-- и запись в него делает reject_car в той же транзакции, что и смену
-- статуса. Нового значения в car_status при этом не появляется —
-- прямое требование задачи.
--
-- ЧТО ПРОИСХОДИТ ДАЛЬШЕ. Объявление остаётся в moderation и уходит в
-- обычную очередь — то есть ведёт себя как у недоверенного продавца.
-- Салон получает уведомление с объяснением: иначе он ждал бы
-- мгновенной публикации, которая не наступает.
--
-- ПРАВО САЛОНА НЕ ОТЗЫВАЕТСЯ: ограничение действует на одно
-- объявление, а не на продавца. Остальные его машины публикуются
-- сразу, как и раньше.
-- ============================================================
create or replace function public.f_car_autopublish()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_car     public.cars;
  v_trusted boolean;
  v_kind    text;
  v_reason  text;
begin
  -- Блокируем строку объявления: две фотографии могут вставляться
  -- параллельно, и без блокировки обе ветки прочитали бы статус
  -- 'moderation' и обе попытались бы опубликовать.
  select c.* into v_car
    from public.cars c
   where c.id = new.car_id
   for update;

  -- Объявления нет — вставка фото к несуществующей машине невозможна
  -- (внешний ключ), но защищаемся: триггер не должен ронять вставку.
  if v_car.id is null then
    return new;
  end if;

  -- Работаем ТОЛЬКО с объявлением, ждущим проверки. Это же условие
  -- отсекает второе и последующие фото: после публикации статус уже
  -- 'active', и ветка не выполняется.
  --
  -- Оно же защищает от нежелательного случая: фотографию добавили к
  -- давно отклонённому объявлению — оно не должно от этого
  -- опубликоваться.
  if v_car.status <> 'moderation' then
    return new;
  end if;

  -- ---------- Право на автопубликацию ----------
  select p.seller_kind, p.trusted_seller
    into v_kind, v_trusted
    from public.profiles p
   where p.id = v_car.user_id;

  -- Частник не получает автопубликацию НИКОГДА, даже если флаг
  -- trusted_seller каким-то образом выставлен: право привязано к
  -- виду продавца, а не к одному флагу.
  if v_kind is distinct from 'dealer' or v_trusted is not true then
    return new;
  end if;

  -- ---------- К7: объявление с историей отклонения ----------
  -- Проверяем ДО авто-валидации: результат один и тот же (объявление
  -- остаётся в очереди), но причина в журнале должна быть именно эта.
  -- Модератор, однажды отклонивший объявление, обязан увидеть
  -- исправленный вариант своими глазами — независимо от того,
  -- проходит ли тот формальную проверку.
  if exists (
    select 1
      from public.admin_action_log l
     where l.target_table = 'cars'
       and l.target_id    = v_car.id
       and l.action       = 'car_rejected'
  ) then
    v_reason := 'объявление ранее отклонялось модератором';
  else
    -- ---------- Авто-валидация ----------
    v_reason := public.f_car_autopublish_check(v_car);
  end if;

  if v_reason is not null then
    -- НЕ отклоняем — оставляем в очереди.
    --
    -- Пишем НАПРЯМУЮ, а не через f_admin_log: тот берёт актора из
    -- auth.uid() и предназначен для действий администратора. Здесь
    -- действует система, и актором записан сам салон — иначе строка
    -- нарушила бы NOT NULL на actor_id.
    insert into public.admin_action_log
      (actor_id, action, target_table, target_id, payload)
    values (
      v_car.user_id,
      'car_autopublish_skipped',
      'cars',
      v_car.id,
      jsonb_build_object(
        'dealer_id', v_car.user_id,
        'reason',    v_reason,
        'brand',     v_car.brand,
        'model',     v_car.model
      )
    );

    -- Уведомление салону в кабинет. Без него объявление молча уходит
    -- в очередь, а салон ждёт публикации, которая не наступает.
    insert into public.notifications (user_id, title, body, type, action_id)
    values (
      v_car.user_id,
      'Объявление отправлено на проверку',
      format(
        '%s %s не прошло автоматическую проверку (%s) и ждёт модератора.',
        v_car.brand, v_car.model, v_reason
      ),
      'car_autopublish_skipped',
      v_car.id
    );

    return new;
  end if;

  -- ---------- Публикация ----------
  -- Подавляем письмо об одобрении: салон с автопубликацией знает, что
  -- его объявления уходят сразу, и письмо на каждую машину при
  -- десятках подач в день — спам. Флаг читает триггер писем.
  perform set_config('rs_auto.skip_moderation_email', 'on', true);

  update public.cars
     set status             = 'active',
         moderation_comment = null,
         updated_at         = now()
   where id = v_car.id;

  -- Сбрасываем флаг сразу: true в set_config означает «до конца
  -- транзакции», а в той же транзакции может смениться статус другого
  -- объявления — его письмо подавлять не следует.
  perform set_config('rs_auto.skip_moderation_email', 'off', true);

  -- Журнал. Актор — сам салон: это его действие, выполненное по
  -- выданному ему праву.
  insert into public.admin_action_log
    (actor_id, action, target_table, target_id, payload)
  values (
    v_car.user_id,
    'car_auto_approved',
    'cars',
    v_car.id,
    jsonb_build_object(
      'dealer_id', v_car.user_id,
      'brand',     v_car.brand,
      'model',     v_car.model,
      'year',      v_car.year
    )
  );

  -- Уведомление в кабинет — как при обычном одобрении.
  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_car.user_id,
    'Объявление опубликовано',
    format('%s %s опубликовано без модерации', v_car.brand, v_car.model),
    'car_approved',
    v_car.id
  );

  return new;
end;
$fn$;

comment on function public.f_car_autopublish()
  is 'Автопубликация объявления доверенного салона. Не срабатывает для объявлений, которые модератор когда-либо отклонял вручную (0089)';

-- Триггер tg_car_autopublish (0086) висит на этой же функции и
-- подхватывает новое тело — пересоздавать не нужно.


-- ############################################################
-- Р4. get_my_listings_stats — авторство и причина снятия
-- ############################################################
-- ЗАЧЕМ. Кабинет продавца показывал снятое администратором
-- объявление так же, как снятое им самим: серый бейдж «В архиве» и
-- кнопка «Вернуть». После Р2 кнопка перестала работать, и без этих
-- полей продавец получал бы ошибку вместо объяснения — худший из
-- возможных исходов.
--
-- Теперь карточка знает, кто снял и за что, и показывает причину
-- вместо кнопки.
--
-- ПРИЛОЖЕНИЕ НЕ ЛОМАЕТСЯ: набор колонок только расширяется, порядок
-- существующих сохранён дословно. Flutter разбирает ответ по именам
-- полей (listing_stats_model.dart), лишние поля игнорирует.
--
-- Сигнатура returns table меняется, поэтому функцию нужно удалить
-- перед пересозданием: CREATE OR REPLACE не умеет менять состав
-- возвращаемых колонок.
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
  -- Новые поля (0089).
  archived_by        text,
  archived_reason    text
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
    -- Действует ли продвижение прямо сейчас: флаг сам по себе не истекает,
    -- поэтому проверяем его вместе со сроком.
    (c.is_vip and c.boosted_until is not null and c.boosted_until > now()),
    c.boosted_until,
    c.created_at,
    -- Причина отклонения показывается только в статусе 'rejected':
    -- после одобрения approve_car очищает поле, но у объявления,
    -- снятого в архив из отклонённых, комментарий остаётся, и
    -- показывать его рядом с «В архиве» было бы бессмысленно.
    case when c.status = 'rejected' then c.moderation_comment end,
    c.is_for_sale,
    c.is_for_rent,
    -- Авторство архива отдаём КАК ТЕКСТ, а не как enum: клиентские
    -- библиотеки (supabase-js, Flutter) получают пользовательский тип
    -- строкой, и объявлять его text здесь честнее, чем оставлять
    -- клиенту гадать. Заодно тип не протекает наружу и его будущее
    -- расширение не станет ломающим изменением API.
    c.archived_by::text,
    c.archived_reason
  from public.cars c
  left join public.listing_stats s on s.car_id = c.id
  where c.user_id = auth.uid()
  order by c.created_at desc;
$$;

comment on function public.get_my_listings_stats()
  is 'Мои объявления со статистикой, статусом продвижения, причиной отклонения, видом сделки и авторством снятия — для кабинета продавца';

grant execute on function public.get_my_listings_stats() to authenticated;


-- ############################################################
-- Р4 (админка). admin_get_car — кто снял объявление
-- ############################################################
-- ИЗМЕНЕНИЯ ОТНОСИТЕЛЬНО 0079:
--   + archived_by / archived_reason: модератор, открывший карточку,
--     должен видеть, его коллега снял объявление или сам продавец.
--   + история решений расширена: раньше в неё попадали только
--     car_approved и car_rejected, поэтому снятия и возвраты —
--     ровно те события, вокруг которых возник конфликт ролей, — в
--     карточке не отображались вовсе. Теперь видны и они, включая
--     владельческий возврат car_restored_by_owner (К9).
--
-- Порядок существующих колонок сохранён, новые добавлены в конец.
-- ============================================================
drop function if exists public.admin_get_car(uuid);

create or replace function public.admin_get_car(p_car_id uuid)
returns table (
  car_id             uuid,
  user_id            uuid,
  status             text,
  is_for_sale        boolean,
  is_for_rent        boolean,
  brand              text,
  model              text,
  year               integer,
  mileage            integer,
  body_type          text,
  transmission       text,
  fuel               text,
  currency           text,
  sale_price         numeric,
  rent_price_daily   numeric,
  deposit_amount     numeric,
  city               text,
  description        text,
  contact_phone      text,
  moderation_comment text,
  created_at         timestamptz,
  updated_at         timestamptz,
  owner_name           text,
  owner_email          text,
  owner_phone          text,
  owner_locale         text,
  owner_created_at     timestamptz,
  owner_listings_total integer,
  owner_rejected_count integer,
  photos             jsonb,
  moderation_history jsonb,
  -- Новые поля (0089).
  archived_by        text,
  archived_reason    text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: карточка модерации доступна только администратору'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    c.id,
    c.user_id,
    c.status::text,
    c.is_for_sale,
    c.is_for_rent,
    c.brand,
    c.model,
    c.year,
    c.mileage,
    c.body_type::text,
    c.transmission::text,
    c.fuel::text,
    c.currency::text,
    c.sale_price,
    c.rent_price_daily,
    c.deposit_amount,
    c.city,
    c.description,
    c.contact_phone,
    c.moderation_comment,
    c.created_at,
    c.updated_at,

    p.full_name,
    p.email,
    p.phone,
    p.locale,
    p.created_at,

    (select count(*)::integer
       from public.cars oc
      where oc.user_id = c.user_id
        and oc.status <> 'draft'),

    (select count(*)::integer
       from public.cars oc
      where oc.user_id = c.user_id
        and oc.status = 'rejected'),

    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'image_url',   ci.image_url,
                  'order_index', ci.order_index
                )
                order by ci.order_index asc
              )
         from public.car_images ci
        where ci.car_id = c.id),
      '[]'::jsonb
    ),

    -- История решений по этому объявлению. Свежие сверху.
    --
    -- СПИСОК ДЕЙСТВИЙ РАСШИРЕН до всех, что пишутся по target_table =
    -- 'cars'. Прежний фильтр из двух кодов прятал именно те события,
    -- ради которых карточку и открывают в спорном случае: снятие,
    -- возврат администратором и возврат владельцем. Отбор идёт по
    -- таблице, а не по перечню кодов, — так новая запись, добавленная
    -- будущей RPC, появится здесь сама, а не потеряется молча.
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'action',     l.action,
                  'created_at', l.created_at,
                  'actor_name', coalesce(ap.full_name, ap.email, 'модератор'),
                  'payload',    l.payload
                )
                order by l.created_at desc
              )
         from public.admin_action_log l
         left join public.profiles ap on ap.id = l.actor_id
        where l.target_table = 'cars'
          and l.target_id = c.id),
      '[]'::jsonb
    ),

    c.archived_by::text,
    c.archived_reason
  from public.cars c
  join public.profiles p on p.id = c.user_id
  where c.id = p_car_id;
end;
$fn$;

comment on function public.admin_get_car(uuid)
  is 'Карточка объявления для модерации: поля, фото, авторство снятия и полная история решений по журналу; только для админа';

grant execute on function public.admin_get_car(uuid) to authenticated;

commit;


-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ
-- ============================================================
-- Автоматическая: supabase/checks/0089_status_matrix_test.sql
--   npm run test:sql
--
-- Вручную, главный сценарий из тикета:
--   1) от админа:    select * from public.admin_set_car_status(
--                      '<car_id>', 'archived', 'нарушение правил размещения');
--      → в cars: status = 'archived', archived_by = 'admin'.
--   2) от владельца: select * from public.set_my_car_status('<car_id>', 'active');
--      → ОШИБКА insufficient_privilege «Объявление снято
--        администратором, обратитесь в поддержку».
--   3) от админа:    select * from public.admin_set_car_status(
--                      '<car_id>', 'active', 'продавец устранил замечания');
--      → status = 'active', archived_by = null (сбросил триггер).
-- ============================================================
