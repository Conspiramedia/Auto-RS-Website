-- ============================================================
-- AUTO.RS — Миграция 0143: уровни активности продавца
-- ============================================================
-- Бронза / серебро / золото за активность на площадке. Уровень —
-- ПРОИЗВОДНАЯ от данных (объявления, продажи, статус салона,
-- нарушения), а не поле, которое кто-то проставляет руками.
--
-- ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ. Уровень продавца НЕ ИМЕЕТ ОТНОШЕНИЯ к платному
-- продвижению (cars.is_vip + значок «VIP» с короной, компонент
-- ui/VipBadge). Это две независимые оси: корона говорит «за это
-- объявление заплатили», плашка уровня — «этот продавец давно и
-- честно работает». Совпадение палитры (бронза/серебро/золото)
-- намеренное: призовые места читаются без объяснений. Совпадения
-- смысла нет, и в каталоге плашка уровня не показывается вовсе —
-- иначе рядом с золотой короной стояла бы вторая золотая метка.
--
-- ПОЧЕМУ smallint, А НЕ ENUM. Уровни СРАВНИМЫ: «не ниже серебра» —
-- основной вопрос к этому полю (лимиты, штраф, прогресс). У enum
-- сравнение работает по порядку объявления значений и читается плохо,
-- а добавление ступени в середину требует пересоздания типа.
-- smallint даёт сравнение арифметикой и вычитание штрафа одной
-- операцией (greatest(tier - 1, 0)).
--
--   0 — уровня нет (в интерфейсе плашки не будет вовсе)
--   1 — бронза
--   2 — серебро
--   3 — золото
--
-- ============================================================
-- ДВА ИСТОЧНИКА УРОВНЯ: ХРАНИМЫЙ И ВЫЧИСЛЯЕМЫЙ
-- ============================================================
-- profiles.seller_tier — хранимое значение, для ОТОБРАЖЕНИЯ. Его
-- пересчитывает ежедневный job, поэтому оно может отставать от
-- реальности максимум на сутки. Для плашки это допустимо: значок,
-- появившийся на день позже, никому не мешает.
--
-- f_seller_tier_now() — вычисление на лету, для РЕШЕНИЙ. Лимит на
-- подачу объявления читает ЕГО, а не колонку: иначе продавец,
-- выполнивший условия бронзы час назад, упёрся бы в лимит уровня 0 и
-- получил отказ по правилу, которое к нему уже не относится. Запрет,
-- который нельзя объяснить, — худшее, что можно показать в форме
-- подачи.
--
-- Обе точки зовут ОДНУ функцию расчёта, поэтому разойтись в правилах
-- они не могут — отличается только момент вызова.
-- ============================================================


-- ============================================================
-- БЛОК 1. КОЛОНКИ
-- ============================================================

alter table public.profiles
  -- Хранимый уровень. not null default 0: «уровня нет» — это
  -- полноценное состояние, а не отсутствие данных, и NULL здесь
  -- заставил бы каждое сравнение защищаться coalesce.
  add column if not exists seller_tier smallint not null default 0,

  -- Флаг «данные изменились, уровень пора пересчитать». true у всех
  -- существующих строк — бэкфил в блоке 7 их и разберёт.
  add column if not exists tier_dirty boolean not null default true,

  -- Срок действия штрафа за нарушение. Пока он в будущем, расчётный
  -- уровень уменьшается на единицу. NULL — штрафа нет.
  add column if not exists tier_penalty_until timestamptz,

  -- РУЧНОЕ НАЗНАЧЕНИЕ АДМИНИСТРАТОРОМ. NULL — уровень считается по
  -- данным (обычный случай). Не NULL — значение перекрывает расчёт
  -- целиком, включая штраф: администратор видит ситуацию, которой
  -- формула не знает (договорённость с крупным салоном, разбор
  -- жалобы), и его решение не должно отменяться ночным job.
  add column if not exists tier_override smallint,
  add column if not exists tier_override_reason text,
  add column if not exists tier_override_at timestamptz,
  add column if not exists tier_override_by uuid references auth.users (id) on delete set null;

alter table public.profiles
  drop constraint if exists chk_seller_tier;
alter table public.profiles
  add constraint chk_seller_tier check (seller_tier between 0 and 3);

alter table public.profiles
  drop constraint if exists chk_tier_override;
alter table public.profiles
  add constraint chk_tier_override check (
    tier_override is null or tier_override between 0 and 3
  );

-- Ручное назначение без причины запрещено: через полгода никто не
-- вспомнит, за что салону выдали золото, а журнал admin_action_log
-- отвечает на вопрос «кто», но не «почему именно этому».
alter table public.profiles
  drop constraint if exists chk_tier_override_reason;
alter table public.profiles
  add constraint chk_tier_override_reason check (
    tier_override is null
    or nullif(btrim(coalesce(tier_override_reason, '')), '') is not null
  );

comment on column public.profiles.seller_tier
  is 'Уровень продавца: 0 нет, 1 бронза, 2 серебро, 3 золото. Хранимое значение для отображения; решения принимаются по f_seller_tier_now()';
comment on column public.profiles.tier_dirty
  is 'Данные продавца изменились — уровень пересчитает ближайший запуск recalc_seller_tiers()';
comment on column public.profiles.tier_penalty_until
  is 'До этого момента расчётный уровень уменьшен на 1 (снятие активного объявления администратором)';
comment on column public.profiles.tier_override
  is 'Уровень, назначенный администратором вручную. NULL — считается по данным. Перекрывает расчёт и штраф';

-- Частичный индекс под единственный запрос job: «кого пересчитать».
-- Полный индекс по булеву полю, где после отработки job почти везде
-- false, был бы тратой места.
create index if not exists idx_profiles_tier_dirty
  on public.profiles (tier_dirty)
  where tier_dirty;


alter table public.cars
  -- Момент перехода в sold. Отдельная колонка, а не updated_at:
  -- updated_at меняет любая правка, и по нему нельзя отличить
  -- «продано вчера» от «вчера поправили цену».
  add column if not exists sold_at timestamptz,

  -- Продажа уже зачтена в уровень. Защита от накрутки: цикл
  -- sold → active → sold даёт сколько угодно переходов, но зачёт
  -- случается ровно один раз за объявление.
  add column if not exists tier_credited boolean not null default false;

comment on column public.cars.sold_at
  is 'Момент перехода в статус sold. Ставит триггер trg_cars_sold_at при любом пути смены статуса';
comment on column public.cars.tier_credited
  is 'Продажа уже зачтена в уровень продавца. Ставится в момент ЗАЧЁТА, а не продажи: не дотянувшая до порога продажа не сгорает';

-- Индекс под подсчёт квалифицированных продаж в расчёте уровня.
-- Частичный: строки, не дошедшие до sold, в нём не нужны.
create index if not exists idx_cars_sold_tier
  on public.cars (user_id, sold_at)
  where status = 'sold' and sold_at is not null;


-- ============================================================
-- БЛОК 2. ПОРОГИ ОДНИМ МЕСТОМ
-- ============================================================
-- Числа вынесены в функции, а не вписаны в расчёт: они упоминаются
-- трижды (расчёт уровня, лимит подачи, прогресс в кабинете), и
-- разъехавшиеся копии дали бы кабинету обещание «ещё 2 объявления»,
-- которое расчёт не исполнит.
--
-- immutable + parallel safe: планировщик подставляет значение как
-- константу, вызова на каждую строку не происходит.

-- Сколько дней объявление обязано прожить, чтобы продажа считалась
-- квалифицированной.
create or replace function public.f_tier_sale_min_days()
returns integer language sql immutable parallel safe as $$ select 14 $$;

-- Окно, в котором нарушение блокирует серебро и золото.
create or replace function public.f_tier_violation_days()
returns integer language sql immutable parallel safe as $$ select 90 $$;

-- Срок штрафа за одно нарушение.
create or replace function public.f_tier_penalty_days()
returns integer language sql immutable parallel safe as $$ select 90 $$;

comment on function public.f_tier_sale_min_days()
  is 'Минимальный возраст объявления (дней) для зачёта продажи в уровень';
comment on function public.f_tier_violation_days()
  is 'Окно (дней), в котором нарушение не даёт подняться выше бронзы';
comment on function public.f_tier_penalty_days()
  is 'Срок (дней), на который нарушение понижает уровень на одну ступень';


-- ------------------------------------------------------------
-- Лимит активных объявлений по уровню.
-- ------------------------------------------------------------
-- ОДОБРЕННЫЙ САЛОН — БЕЗ ЛИМИТА (возвращается NULL). У салона
-- складской ассортимент, и любое конечное число здесь означало бы,
-- что площадка не готова работать с автосалонами. Право проверено
-- администратором через dealer_applications — этого достаточно.
--
-- ЗАЯВКА НА РАССМОТРЕНИИ — 10. Человек уже подал реквизиты и ждёт
-- решения; резать его до трёх объявлений на время нашей же очереди
-- несправедливо. Отклонённая заявка возвращает на обычную шкалу
-- частника: отказ означает, что салона нет.
create or replace function public.f_tier_listing_limit(p_tier smallint)
returns integer
language sql
immutable
parallel safe
as $$
  select case coalesce(p_tier, 0)
           when 0 then 3
           when 1 then 10
           when 2 then 25
           when 3 then 100
         end;
$$;

comment on function public.f_tier_listing_limit(smallint)
  is 'Лимит активных объявлений частника по уровню: 0→3, 1→10, 2→25, 3→100';


-- ============================================================
-- БЛОК 3. РАСЧЁТ УРОВНЯ — ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ЖИВУТ ПРАВИЛА
-- ============================================================
-- Функция ЧИСТАЯ: ничего не пишет, только считает. Поэтому её
-- одинаково безопасно звать из job (пачкой), из проверки лимита (на
-- каждую подачу) и из прогресса в кабинете.
--
-- ============================================================
-- ЧТО СЧИТАЕТСЯ АКТИВНЫМ ОБЪЯВЛЕНИЕМ
-- ============================================================
-- Просто status = 'active'. Требования «прошло модерацию» здесь НЕТ
-- намеренно: у доверенного салона (profiles.trusted_seller, миграция
-- 0085 + автопубликация 0086) объявления попадают в active, МИНУЯ
-- очередь модерации. Условие «прошедших модерацию» навсегда оставило
-- бы такой салон на бронзе — притом что доверие ему выдал сам
-- администратор. К тому же в active иначе и не попасть: статус
-- ставит либо модератор, либо автопубликация доверенного салона.
--
-- ============================================================
-- ЧТО СЧИТАЕТСЯ КВАЛИФИЦИРОВАННОЙ ПРОДАЖЕЙ
-- ============================================================
-- status = 'sold' И объявление прожило не меньше f_tier_sale_min_days()
-- от создания до продажи.
--
-- ЧЕСТНОЕ ОГРАНИЧЕНИЕ (задокументировано и в DONE.md): возраст
-- считается как sold_at - created_at, то есть от СОЗДАНИЯ, а не от
-- начала публикации. Точное «время в статусе active» посчитать не из
-- чего: журнала смен статуса в схеме нет, а объявление между
-- созданием и продажей могло лежать на модерации и уходить в архив.
-- Приближение работает в СТРОГУЮ сторону — реальный срок публикации
-- всегда МЕНЬШЕ измеренного, значит порог не занижается, и накрутить
-- продажу «моложе» порога невозможно.
--
-- Порог существует именно против накрутки: статус sold ставит сам
-- продавец (set_my_car_status, переход active → sold разрешён), и без
-- порога десять нажатий давали бы золото за минуту.
--
-- ============================================================
-- ЧТО СЧИТАЕТСЯ НАРУШЕНИЕМ
-- ============================================================
-- Снятие администратором УЖЕ ОПУБЛИКОВАННОГО объявления. Отказ на
-- первичной модерации нарушением НЕ считается: объявление не было
-- опубликовано, вреда покупателю не случилось, а причиной отказа
-- бывает забытая фотография.
--
-- ИСТОЧНИК — admin_action_log, А НЕ cars.archived_by. Это принципиально.
-- cars.archived_by стирается: update_car_v3 (миграция 0090) при
-- существенной правке админского архива сбрасывает archived_by в NULL
-- и отправляет объявление на новый круг модерации. Логика там верная,
-- но для штрафа она означала бы, что нарушение отменяется самим
-- нарушителем — правкой описания. Плюс объявление могут удалить, и
-- след исчезнет вместе с ним.
--
-- admin_action_log писать может только f_admin_log(), а UPDATE и
-- DELETE на нём не выданы никому (миграция 0078) — журнал неизменяем.
-- Запись 'car_archived' ставит admin_set_car_status (0080), и она
-- разрешает единственный переход в архив: active → archived. То есть
-- сама эта запись и означает «снято уже опубликованное».
create or replace function public.f_calc_seller_tier(p_user_id uuid)
returns smallint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind          text;
  v_trusted       boolean;
  v_dealer_state  text;
  v_active        integer;
  v_sales         integer;
  v_violation     boolean;
  v_penalty_until timestamptz;
  v_override      smallint;
  v_tier          smallint := 0;
begin
  select p.seller_kind, p.trusted_seller, p.tier_penalty_until, p.tier_override
    into v_kind, v_trusted, v_penalty_until, v_override
    from public.profiles p
   where p.id = p_user_id;

  -- Профиля нет — считать нечего.
  if not found then
    return 0;
  end if;

  -- РУЧНОЕ НАЗНАЧЕНИЕ ПЕРЕКРЫВАЕТ ВСЁ, включая штраф. Администратор
  -- знает контекст, которого нет в данных, и ночной пересчёт не
  -- вправе отменять его решение.
  if v_override is not null then
    return v_override;
  end if;

  select count(*)::integer
    into v_active
    from public.cars c
   where c.user_id = p_user_id
     and c.status = 'active';

  -- Квалифицированные продажи. Считаем ФАКТ, а не флаг tier_credited:
  -- флаг защищает от повторного зачёта одного объявления, а здесь
  -- каждое объявление и так участвует ровно один раз — count по
  -- строкам таблицы. Условие по возрасту — то самое приближение,
  -- описанное в шапке блока.
  select count(*)::integer
    into v_sales
    from public.cars c
   where c.user_id = p_user_id
     and c.status = 'sold'
     and c.sold_at is not null
     and c.sold_at - c.created_at >= make_interval(days => public.f_tier_sale_min_days());

  -- Нарушение за последние 90 дней. payload->>'user_id' — владелец
  -- снятого объявления, его кладёт admin_set_car_status.
  select exists (
    select 1
      from public.admin_action_log l
     where l.action = 'car_archived'
       and l.payload ->> 'user_id' = p_user_id::text
       and l.created_at > now() - make_interval(days => public.f_tier_violation_days())
  ) into v_violation;

  -- ---------- САЛОН ----------
  -- Одобренная заявка = сам факт seller_kind = 'dealer': его ставит
  -- только approve_dealer_application (миграция 0100), пользователь
  -- себе этот статус не выпишет.
  if v_kind = 'dealer' then
    -- Золото салона — trusted_seller. Это не счётчик, а решение
    -- администратора: право публиковать без модерации и есть высшая
    -- степень доверия площадки.
    if coalesce(v_trusted, false) then
      v_tier := 3;
    elsif v_active >= 10 then
      v_tier := 2;
    else
      -- Бронза выдаётся уже за факт одобрения заявки: компанию
      -- проверил администратор, и это больше, чем три объявления
      -- частника.
      v_tier := 1;
    end if;

  -- ---------- ЧАСТНИК ----------
  else
    if v_active >= 25 or v_sales >= 10 then
      v_tier := 3;
    elsif v_active >= 10 or v_sales >= 3 then
      v_tier := 2;
    elsif v_active >= 3 or v_sales >= 1 then
      v_tier := 1;
    else
      v_tier := 0;
    end if;
  end if;

  -- ---------- НАРУШЕНИЕ ЗА 90 ДНЕЙ ----------
  -- Выше бронзы не поднимаемся. Условие «без нарушений» стоит только
  -- у серебра и золота — бронза остаётся достижимой, иначе продавец
  -- после единственной ошибки терял бы всякий стимул исправляться.
  -- Салона это касается наравне с частником.
  if v_violation and v_tier > 1 then
    v_tier := 1;
  end if;

  -- ---------- ШТРАФ ----------
  -- Вычитается из РЕЗУЛЬТАТА расчёта, а не из текущего значения
  -- колонки. Разница принципиальная: при вычитании из колонки два
  -- нарушения подряд утащили бы продавца в ноль и дальше, и штраф
  -- превратился бы в лестницу вниз. Здесь же повторное нарушение
  -- продлевает СРОК (это делает триггер в блоке 5), но глубина ямы
  -- остаётся одной ступенью, а по истечении срока уровень
  -- восстанавливается сам, без отдельной операции.
  if v_penalty_until is not null and v_penalty_until > now() then
    v_tier := greatest(v_tier - 1, 0)::smallint;
  end if;

  return v_tier;
end;
$$;

comment on function public.f_calc_seller_tier(uuid)
  is 'Расчёт уровня продавца по данным: активные объявления, квалифицированные продажи, статус салона, нарушения, штраф, ручное назначение. Ничего не пишет';


-- ------------------------------------------------------------
-- Уровень «прямо сейчас» — для РЕШЕНИЙ (лимит подачи).
-- ------------------------------------------------------------
-- Отдельное имя вместо прямого вызова f_calc_seller_tier по всему
-- коду: так в местах принятия решений видно намерение — «нужен
-- актуальный уровень, а не тот, что показан на плашке».
create or replace function public.f_seller_tier_now(p_user_id uuid)
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select public.f_calc_seller_tier(p_user_id);
$$;

comment on function public.f_seller_tier_now(uuid)
  is 'Актуальный уровень продавца, вычисляемый на лету. Используется там, где отставание хранимого поля недопустимо (лимит подачи)';


-- ============================================================
-- БЛОК 4. ПЕРЕСЧЁТ: ФЛАГ НА СОБЫТИИ, РАБОТА В JOB
-- ============================================================
-- ПОЧЕМУ ТРИГГЕР НЕ СЧИТАЕТ СРАЗУ. Модерация салона — это пакет из
-- десятков объявлений подряд; пересчёт внутри каждого триггера дал
-- бы десятки одинаковых расчётов и UPDATE одной строки profiles в
-- одной транзакции, то есть лишнюю нагрузку и точку взаимных
-- блокировок на ровном месте. Триггер ставит флаг — операция в одну
-- запись, идемпотентная по определению.
--
-- ОТСТАВАНИЕ НЕ ВРЕДИТ. Хранимое поле нужно плашке; решения
-- принимаются по f_seller_tier_now(), который отставания не знает.

create or replace function public.trg_mark_tier_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Помечаем владельца объявления. При смене владельца (в схеме
  -- невозможна, но триггер не должен на это полагаться) пометили бы
  -- обоих — отсюда развилка по TG_OP.
  if tg_op = 'DELETE' then
    update public.profiles set tier_dirty = true where id = old.user_id;
    return old;
  end if;

  update public.profiles set tier_dirty = true where id = new.user_id;

  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    update public.profiles set tier_dirty = true where id = old.user_id;
  end if;

  return new;
end;
$$;

comment on function public.trg_mark_tier_dirty()
  is 'Помечает профиль владельца объявления к пересчёту уровня. Сам расчёт делает recalc_seller_tiers()';

-- Только на смене статуса и на появлении/удалении объявления: правка
-- цены или описания на уровень не влияет, и будить из-за неё
-- пересчёт незачем.
drop trigger if exists cars_mark_tier_dirty on public.cars;
create trigger cars_mark_tier_dirty
  after insert or delete on public.cars
  for each row execute function public.trg_mark_tier_dirty();

drop trigger if exists cars_status_mark_tier_dirty on public.cars;
create trigger cars_status_mark_tier_dirty
  after update of status on public.cars
  for each row
  when (old.status is distinct from new.status)
  execute function public.trg_mark_tier_dirty();


-- ------------------------------------------------------------
-- Профиль: смена типа продавца и флага доверия.
-- ------------------------------------------------------------
-- Одобрение заявки салона (seller_kind → 'dealer') и выдача
-- trusted_seller меняют уровень немедленно по правилам блока 3,
-- поэтому профиль тоже обязан помечаться грязным.
--
-- ВАЖНО: триггер не трогает сам tier_dirty/seller_tier, иначе
-- UPDATE из recalc_seller_tiers() снова пометил бы строку грязной и
-- job зациклился бы на одном профиле. Отсюда условие when по трём
-- содержательным колонкам.
create or replace function public.trg_profile_mark_tier_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set tier_dirty = true where id = new.id;
  return new;
end;
$$;

drop trigger if exists profiles_mark_tier_dirty on public.profiles;
create trigger profiles_mark_tier_dirty
  after update of seller_kind, trusted_seller, tier_override on public.profiles
  for each row
  when (
    old.seller_kind    is distinct from new.seller_kind
    or old.trusted_seller is distinct from new.trusted_seller
    or old.tier_override  is distinct from new.tier_override
  )
  execute function public.trg_profile_mark_tier_dirty();


-- ------------------------------------------------------------
-- sold_at: ставится на ТАБЛИЦЕ, а не в RPC.
-- ------------------------------------------------------------
-- Статус меняют три пути: set_my_car_status (владелец),
-- admin_set_car_status (администратор) и update_car_v3 (правка
-- уводит на модерацию). Проставь мы sold_at в одной из RPC —
-- остальные пути дали бы продажу без отметки времени, и она не
-- попала бы в расчёт. На таблице путь ровно один.
--
-- tier_credited при возврате в active НЕ сбрасывается — в этом и
-- смысл флага: цикл sold → active → sold не даёт второго зачёта.
-- sold_at при возврате тоже сохраняется: он описывает состоявшийся
-- факт продажи, а не текущее состояние.
create or replace function public.trg_cars_sold_at()
returns trigger
language plpgsql
as $$
begin
  -- Первый переход в sold фиксирует момент. Повторный (после
  -- возврата в active) момент НЕ переписывает: иначе продавец
  -- обновлял бы дату продажи по кругу, и «возраст объявления»
  -- считался бы от свежей отметки.
  if new.status = 'sold'::car_status
     and old.status is distinct from new.status
     and new.sold_at is null then
    new.sold_at := now();
  end if;

  return new;
end;
$$;

comment on function public.trg_cars_sold_at()
  is 'Проставляет cars.sold_at при первом переходе в sold. На таблице, а не в RPC: статус меняют несколько путей';

drop trigger if exists cars_sold_at on public.cars;
create trigger cars_sold_at
  before update of status on public.cars
  for each row execute function public.trg_cars_sold_at();


-- ============================================================
-- БЛОК 5. ШТРАФ ЗА СНЯТИЕ АКТИВНОГО ОБЪЯВЛЕНИЯ
-- ============================================================
-- Вешается на admin_action_log, а не на cars: журнал неизменяем, и
-- запись 'car_archived' появляется ровно один раз на снятие. Ловить
-- то же событие на cars значило бы полагаться на archived_by, который
-- стирается при правке (см. шапку блока 3).
--
-- ПРОДЛЕНИЕ, А НЕ УГЛУБЛЕНИЕ. Повторное нарушение отодвигает срок от
-- сегодняшнего дня; глубина остаётся одной ступенью (вычитание живёт
-- в f_calc_seller_tier). greatest(...) защищает от укорачивания
-- действующего штрафа, если записи придут не по порядку времени.
create or replace function public.trg_tier_penalty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if new.action <> 'car_archived' then
    return new;
  end if;

  v_user := nullif(new.payload ->> 'user_id', '')::uuid;

  if v_user is null then
    return new;
  end if;

  update public.profiles p
     set tier_penalty_until = greatest(
           coalesce(p.tier_penalty_until, now()),
           now() + make_interval(days => public.f_tier_penalty_days())
         ),
         tier_dirty = true
   where p.id = v_user;

  return new;
end;
$$;

comment on function public.trg_tier_penalty()
  is 'Снятие администратором опубликованного объявления понижает уровень владельца на ступень на f_tier_penalty_days() дней';

drop trigger if exists admin_log_tier_penalty on public.admin_action_log;
create trigger admin_log_tier_penalty
  after insert on public.admin_action_log
  for each row execute function public.trg_tier_penalty();


-- ============================================================
-- БЛОК 6. ЕЖЕДНЕВНЫЙ JOB
-- ============================================================
-- Вызывается из Edge Function daily-cleanup — той же точки, что
-- expire_listings и остальные регламентные задачи. Отдельного
-- расписания pg_cron не заводим сознательно: в проекте уже принято
-- «один способ запуска для всех задач» (см. шапку daily-cleanup и
-- комментарий в 0113), и второй параллельный планировщик означал бы
-- два места, где нужно искать причину непроработавшей ночи.
--
-- ПАЧКОЙ И С ПОТОЛКОМ. p_limit ограничивает один запуск: даже если
-- грязными окажутся все профили разом (а после этой миграции так и
-- будет — бэкфил в блоке 7 разбирает их сам), job не упрётся в
-- таймаут. Остаток разберётся следующим запуском: отставание плашки
-- на сутки безвредно.
--
-- tier_credited проставляется ЗДЕСЬ, в момент зачёта, а не в момент
-- продажи. Продажа, не дотянувшая до порога, флага не получает — и
-- это правильно: возраст объявления на момент продажи зафиксирован
-- и больше не растёт, значит такая продажа не станет
-- квалифицированной никогда, и помечать её зачтённой было бы
-- неправдой. Флаг отвечает ровно на один вопрос — какие продажи
-- учтены в уровне; при разборе жалобы по нему видно основание.
create or replace function public.recalc_seller_tiers(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_tier    smallint;
  v_count   integer := 0;
begin
  for v_id in
    select p.id
      from public.profiles p
     where p.tier_dirty
     order by p.id
     limit least(greatest(coalesce(p_limit, 500), 1), 5000)
  loop
    v_tier := public.f_calc_seller_tier(v_id);

    update public.profiles p
       set seller_tier = v_tier,
           tier_dirty  = false
     where p.id = v_id;

    -- Отмечаем зачтённые продажи. Условие повторяет расчёт: те же
    -- объявления, что попали в счётчик, получают флаг.
    update public.cars c
       set tier_credited = true
     where c.user_id = v_id
       and c.status = 'sold'
       and c.sold_at is not null
       and not c.tier_credited
       and c.sold_at - c.created_at >= make_interval(days => public.f_tier_sale_min_days());

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.recalc_seller_tiers(integer)
  is 'Пересчитывает уровни помеченных профилей пачкой. Вызывается из Edge Function daily-cleanup';

-- Функция меняет чужие профили — вызывать её вправе только
-- service_role (тот же режим, что у expire_listings).
revoke all on function public.recalc_seller_tiers(integer) from anon, authenticated;


-- ============================================================
-- БЛОК 7. БЭКФИЛ
-- ============================================================
-- Считаем уровень всем существующим профилям по текущим данным:
-- действующие продавцы получают заслуженный уровень сразу, а не
-- начинают с нуля.
--
-- sold_at у уже проданных объявлений неоткуда взять точно — колонки
-- не существовало. Берём updated_at: у объявления в статусе sold
-- последнее изменение почти всегда и есть отметка о продаже.
-- Приближение в СТРОГУЮ сторону не работает (updated_at может быть
-- позже реальной продажи, и возраст окажется завышен), поэтому
-- отмечаем такие продажи как уже зачтённые — накрутить задним числом
-- через них нельзя, а честные продавцы не теряют историю.
update public.cars c
   set sold_at = coalesce(c.sold_at, c.updated_at)
 where c.status = 'sold'
   and c.sold_at is null;

-- Цикл, а не один UPDATE с вызовом функции: f_calc_seller_tier
-- читает profiles, и вызов её внутри UPDATE того же profiles в одном
-- операторе опирался бы на снимок строки до обновления. На объёме
-- существующей базы разница в скорости несущественна.
do $$
declare
  v_id   uuid;
  v_tier smallint;
begin
  for v_id in select id from public.profiles loop
    v_tier := public.f_calc_seller_tier(v_id);
    update public.profiles set seller_tier = v_tier, tier_dirty = false where id = v_id;
  end loop;
end $$;

-- Продажи, попавшие в расчёт, помечаем зачтёнными.
update public.cars c
   set tier_credited = true
 where c.status = 'sold'
   and c.sold_at is not null
   and not c.tier_credited
   and c.sold_at - c.created_at >= make_interval(days => public.f_tier_sale_min_days());


-- ============================================================
-- БЛОК 8. ЛИМИТ АКТИВНЫХ ОБЪЯВЛЕНИЙ ПРИ ПОДАЧЕ
-- ============================================================
-- ЛИМИТ БЛОКИРУЕТ ТОЛЬКО ПОДАЧУ НОВОГО. Существующие объявления не
-- снимаются и не трогаются никогда: продавец, у которого их больше
-- нового лимита, доживает их спокойно и просто не может добавить
-- очередное. Иначе миграция стала бы массовым снятием с публикации —
-- худшее, что можно сделать с живой площадкой.
--
-- Функция возвращает NULL, если подача разрешена, и текст ошибки,
-- если нет. Текст на сербском — как у лимита фотографий
-- (f_car_photo_limit, миграция 0105): сообщение уходит и в мобильное
-- приложение, которое зовёт ту же RPC, и локализовать его на стороне
-- базы не по чему. Сайт разбирает ошибку по КОДУ и показывает
-- собственный текст в нужной локали (см. lib/i18n.ts).
create or replace function public.f_check_listing_limit(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind    text;
  v_tier    smallint;
  v_active  integer;
  v_limit   integer;
  v_pending boolean;
begin
  select p.seller_kind into v_kind
    from public.profiles p where p.id = p_user_id;

  -- ОДОБРЕННЫЙ САЛОН — БЕЗ ЛИМИТА.
  if v_kind = 'dealer' then
    return null;
  end if;

  select count(*)::integer into v_active
    from public.cars c
   where c.user_id = p_user_id
     and c.status = 'active';

  -- ЗАЯВКА НА РАССМОТРЕНИИ — 10 независимо от уровня. Отклонённая
  -- заявка сюда не попадает: exists проверяет именно 'pending'.
  select exists (
    select 1 from public.dealer_applications a
     where a.user_id = p_user_id
       and a.status = 'pending'
  ) into v_pending;

  if v_pending then
    v_limit := 10;
  else
    -- Уровень берём ВЫЧИСЛЯЕМЫЙ, а не хранимый: продавец, только что
    -- выполнивший условия следующей ступени, не должен упираться в
    -- лимит, который для него уже не действует (см. шапку миграции).
    v_tier  := public.f_seller_tier_now(p_user_id);
    v_limit := public.f_tier_listing_limit(v_tier);
  end if;

  if v_active < v_limit then
    return null;
  end if;

  return format(
    'Dostigli ste ograničenje od %s aktivnih oglasa za vaš nivo. '
    'Prodajte ili arhivirajte neki oglas, ili podignite nivo naloga.',
    v_limit
  );
end;
$$;

comment on function public.f_check_listing_limit(uuid)
  is 'Проверка лимита активных объявлений при подаче. NULL — можно подавать, текст — причина отказа. Существующие объявления не трогает';
