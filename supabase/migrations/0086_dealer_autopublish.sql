-- ============================================================
-- AUTO.RS — Миграция 0086: автопубликация для доверенных салонов
-- ============================================================
-- Включает то, что миграция 0085 подготовила, но намеренно не
-- активировала: объявление доверенного салона публикуется сразу,
-- минуя очередь модерации.
--
-- ПРАВИЛО ЦЕЛИКОМ:
--   seller_kind = 'dealer' И trusted_seller = true И объявление
--   прошло авто-валидацию → status = 'active';
--   иначе → status остаётся 'moderation' (в схеме статус очереди
--   называется именно так, не 'pending' — см. car_status в 0001).
--
-- ------------------------------------------------------------
-- ПОЧЕМУ ТРИГГЕР НА car_images, А НЕ НА cars
-- ------------------------------------------------------------
-- Ключевое ограничение, определившее всю конструкцию: фотографии
-- лежат в ОТДЕЛЬНОЙ таблице и вставляются ПОСЛЕ строки cars — так
-- устроены обе функции подачи (create_car_v2 для приложения,
-- create_car_v3 для сайта). Триггер на INSERT в cars фотографий ещё
-- не видит, и проверка «фото ≥ 1» проваливалась бы ВСЕГДА: ни одно
-- объявление не публиковалось бы автоматически, а причина выглядела
-- бы как «у салона нет фото», хотя фото есть.
--
-- Поэтому решение принимается при вставке ПЕРВОЙ фотографии: к этому
-- моменту в транзакции уже есть и строка cars, и хотя бы один снимок.
-- Триггер срабатывает на каждое фото, но работает только на первом
-- (order_index не проверяем — проверяем текущий статус объявления).
--
-- Побочная выгода: правило действует для ОБЕИХ функций подачи и для
-- любого будущего пути создания объявления, не требуя правки их
-- сигнатур. Вызовы приложения не меняются вовсе — прямое требование
-- CLAUDE.md.
--
-- ОБЪЯВЛЕНИЕ БЕЗ ФОТОГРАФИЙ автоматически не публикуется никогда:
-- триггер для него просто не сработает, и оно останется в очереди.
-- Это ровно то поведение, которого требует пункт «фото ≥ 1».
--
-- ------------------------------------------------------------
-- РЕДАКТИРОВАНИЕ ТОЖЕ ПОПАДАЕТ ПОД ПРАВИЛО — и это намеренно.
-- ------------------------------------------------------------
-- update_car_v3 (0067) при существенной правке возвращает объявление
-- в 'moderation' и полностью перезаписывает набор фотографий
-- (delete + insert). Значит триггер сработает снова, и объявление
-- доверенного салона после правки опубликуется без очереди — так же,
-- как при первой подаче.
--
-- Это верно по смыслу: право «публиковать без модерации» выдано
-- салону, а не конкретному объявлению. Если бы правка отправляла его
-- в общую очередь, салон с автопубликацией не мог бы исправить
-- опечатку в цене, не потеряв на сутки видимость машины, — и право
-- обесценивалось бы при первой же ошибке в объявлении.
--
-- Валидация при этом выполняется заново: правка, оставившая
-- объявление без телефона или с нулевой ценой, уйдёт в очередь,
-- как и первичная подача с теми же дефектами.
--
-- ------------------------------------------------------------
-- НЕ ПРОШЁЛ ВАЛИДАЦИЮ — НЕ ЗНАЧИТ ОТКЛОНЁН
-- ------------------------------------------------------------
-- Объявление доверенного салона, не прошедшее проверку, уходит в
-- ОБЫЧНУЮ ОЧЕРЕДЬ, а не в 'rejected'. Авто-отклонение здесь было бы
-- ошибкой: правила проверяют форму (есть ли фото, заполнен ли
-- телефон), а не содержание, и «нет второго фото» — не повод
-- отказывать. Модератор посмотрит и решит сам.
--
-- Причина непрохождения пишется в журнал действием
-- 'car_autopublish_skipped': салон вправе узнать, почему его
-- объявление на этот раз пошло через очередь.
--
-- ПИСЬМО ОБ ОДОБРЕНИИ НЕ ОТПРАВЛЯЕТСЯ. Триггер писем
-- (tg_email_on_car_moderation, 0071) висит на UPDATE OF status и
-- ловит переход moderation → active. Здесь такой переход происходит,
-- поэтому письмо ушло бы автоматически — и это неверно: салон с
-- автопубликацией и так знает, что его объявления уходят сразу, а
-- при десятках машин в день письмо на каждую превращается в спам.
-- Подавляем его через session-переменную (см. блок 3).
-- ============================================================


-- ============================================================
-- БЛОК 1. f_car_autopublish_check — авто-валидация
-- ============================================================
-- Возвращает NULL, если объявление проверку прошло, иначе — причину
-- отказа человеческим текстом (она уходит в журнал).
--
-- Отдельная функция, а не код внутри триггера: ту же проверку нужно
-- уметь вызвать из SQL-тестов и из админки («почему это не
-- опубликовалось само»), не воспроизводя условия заново.
--
-- ТЕЛЕФОН. Формат сербского мобильного: 8–9 цифр национальной части,
-- первая цифра 6. Те же правила, что на клиенте
-- (lib/inputFormat.ts → serbianPhoneToE164), и это не случайное
-- совпадение: разойдись они, форма подачи принимала бы номер, который
-- сервер считает невалидным, и салон терял бы автопубликацию без
-- видимой причины.
--
-- Проверяем по ЦИФРАМ, а не по строке целиком: сайт присылает E.164
-- (+3816XXXXXXXX), приложение может прислать с пробелами
-- («+381 61 234 5678»), и требовать один формат значило бы отключить
-- автопубликацию для одного из двух клиентов.
create or replace function public.f_car_autopublish_check(p_car public.cars)
returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v_digits text;
begin
  -- ---------- Обязательные поля ----------
  -- brand, model, year в схеме уже not null, но проверка нужна: они
  -- могут прийти пустыми строками или пробелами, а constraint такое
  -- пропускает.
  if nullif(btrim(coalesce(p_car.brand, '')), '') is null then
    return 'не заполнена марка';
  end if;

  if nullif(btrim(coalesce(p_car.model, '')), '') is null then
    return 'не заполнена модель';
  end if;

  if p_car.year is null then
    return 'не заполнен год выпуска';
  end if;

  -- ---------- Цена ----------
  -- Проверяем ту цену, которая относится к типу сделки. Объявление,
  -- выставленное и на продажу, и в аренду, обязано иметь обе.
  --
  -- Договорная цена (NULL) автопубликацию НЕ проходит, хотя схема её
  -- допускает: объявление без цены — самый частый повод для вопросов
  -- к модерации, и пропускать его мимо очереди не стоит.
  if p_car.is_for_sale then
    if p_car.sale_price is null then
      return 'не указана цена продажи';
    end if;
    if p_car.sale_price <= 0 then
      return 'цена продажи должна быть больше нуля';
    end if;
  end if;

  if p_car.is_for_rent then
    if p_car.rent_price_daily is null then
      return 'не указана цена аренды';
    end if;
    if p_car.rent_price_daily <= 0 then
      return 'цена аренды должна быть больше нуля';
    end if;
  end if;

  -- ---------- Телефон ----------
  if nullif(btrim(coalesce(p_car.contact_phone, '')), '') is null then
    return 'не указан контактный телефон';
  end if;

  -- Национальная часть: снимаем всё, кроме цифр, затем код страны
  -- (00381 / 381) или ведущий ноль — ровно как serbianNationalDigits
  -- на клиенте.
  v_digits := regexp_replace(p_car.contact_phone, '[^0-9]', '', 'g');

  if v_digits like '00381%' then
    v_digits := substring(v_digits from 6);
  elsif v_digits like '381%' then
    v_digits := substring(v_digits from 4);
  elsif v_digits like '0%' then
    v_digits := substring(v_digits from 2);
  end if;

  if length(v_digits) not between 8 and 9 or left(v_digits, 1) <> '6' then
    return 'телефон не похож на сербский мобильный номер';
  end if;

  return null;
end;
$fn$;

comment on function public.f_car_autopublish_check(public.cars)
  is 'Авто-валидация объявления перед автопубликацией. NULL — прошло, иначе текст причины. Фотографии проверяются отдельно (они в другой таблице)';


-- ============================================================
-- БЛОК 2. f_car_autopublish — решение о публикации
-- ============================================================
-- Вызывается триггером при вставке ПЕРВОЙ фотографии объявления.
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
  -- виду продавца, а не к одному флагу. Проверка обоих условий здесь
  -- и есть то, что делает это правилом, а не настройкой.
  if v_kind is distinct from 'dealer' or v_trusted is not true then
    return new;
  end if;

  -- ---------- Авто-валидация ----------
  v_reason := public.f_car_autopublish_check(v_car);

  if v_reason is not null then
    -- НЕ отклоняем — оставляем в очереди (см. шапку файла).
    -- Запись в журнал: салон вправе узнать, почему его объявление
    -- на этот раз пошло обычным путём.
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
  -- десятках подач в день — спам. Флаг читает триггер писем (блок 3).
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

  -- Журнал. Действие называется car_auto_approved и несёт id салона —
  -- прямое требование задачи. Актор — сам салон: это его действие,
  -- выполненное по выданному ему праву, и приписывать его
  -- администратору, которого в транзакции нет, неверно.
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
  is 'Автопубликация объявления доверенного салона. Срабатывает при вставке первой фотографии: фото лежат в другой таблице и на INSERT в cars ещё не видны';

drop trigger if exists tg_car_autopublish on public.car_images;

create trigger tg_car_autopublish
  after insert on public.car_images
  for each row execute function public.f_car_autopublish();


-- ============================================================
-- БЛОК 3. Подавление письма при автопубликации
-- ============================================================
-- Пересоздаём триггерную функцию писем: добавляется ОДНА проверка в
-- начале. Остальное тело не меняется — переписывать его целиком ради
-- одного условия значило бы рисковать разойтись с 0071.
create or replace function public.email_on_car_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  -- Интересуют ровно два перехода.
  if not (
    (new.status = 'active'   and old.status in ('moderation', 'rejected'))
    or
    (new.status = 'rejected' and old.status = 'moderation')
  ) then
    return new;
  end if;

  select p.email, p.locale
    into v_email, v_locale
    from public.profiles p
   where p.id = new.user_id;

  if v_email is null then
    return new;
  end if;

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
  else
    perform public.f_enqueue_email(
      v_email,
      'car_rejected',
      jsonb_build_object(
        'locale', coalesce(v_locale, 'sr'),
        'brand',  new.brand,
        'model',  new.model,
        'year',   new.year,
        'reason', nullif(btrim(coalesce(new.moderation_comment, '')), '')
      ),
      new.user_id
    );
  end if;

  return new;
end;
$$;

comment on function public.email_on_car_moderation()
  is 'Письмо продавцу о решении модерации. Пропускает автопубликацию доверенного салона (0086). На таблице, а не в RPC: статус меняют несколько путей';
