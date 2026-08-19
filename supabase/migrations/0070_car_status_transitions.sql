-- ============================================================
-- AUTO.RS — Миграция 0070: смена статуса объявления владельцем
-- ============================================================
-- ЗАЧЕМ. Кабинет продавца (сайт /my, приложение my_cars) даёт снять
-- объявление с публикации, вернуть его обратно и отметить проданным.
-- До сих пор это делалось ПРЯМЫМ UPDATE по таблице cars
-- (cars_repository.dart: setCarStatus → update({'status': …})) под
-- политикой cars_update_own.
--
-- Чем плох прямой UPDATE. Политика проверяет ровно одно: строка
-- принадлежит вызывающему. Какой статус на какой меняется — не
-- проверяет никто, поэтому клиент может:
--   * поставить 'active' объявлению в статусе 'moderation' или
--     'rejected' — то есть опубликовать себя в обход модерации;
--   * вернуть в 'active' то, что модератор отклонил;
--   * выставить 'draft' или любое другое значение enum.
-- Это прямое нарушение принципа «толстого бэкенда»: бизнес-правило
-- (какие переходы допустимы) обязано жить в базе, а не в клиенте.
--
-- РЕШЕНИЕ. RPC с явной матрицей переходов. Клиент присылает желаемый
-- статус, сервер решает, разрешён ли переход из текущего.
--
-- МАТРИЦА (ровно то, что нужно кабинету, и ничего сверх):
--   active     → archived   снять с публикации
--   active     → sold       продано
--   archived   → active     вернуть в публикацию
--   sold       → active     снова выставить (сделка сорвалась)
--   moderation → archived   передумал, пока ждал проверки
--   rejected   → archived   убрать отклонённое из списка
-- Всё остальное — исключение.
--
-- Отдельно про переходы В 'moderation' и В 'rejected': их здесь НЕТ
-- намеренно. На модерацию объявление уходит само при редактировании
-- (update_car_v2), а отклонить может только администратор
-- (reject_car). Дать это владельцу значило бы позволить ему
-- имитировать решение модератора.
--
-- Возврат archived/sold → active БЕЗ повторной модерации — сознательно:
-- объявление уже проверено, его содержимое с тех пор не менялось
-- (правка контента идёт через update_car_v2, который сам отправляет на
-- проверку). Гонять проверенное объявление по второму кругу означало
-- бы наказывать продавца за то, что он снял его на неделю.
--
-- ВАЖНО ДЛЯ ПРИЛОЖЕНИЯ: существующий прямой UPDATE не ломается —
-- политика cars_update_own остаётся на месте, эта миграция ничего не
-- отзывает. Приложение продолжает работать как раньше и переводится на
-- RPC отдельной задачей.
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
as $$
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

  update public.cars c
     set status = p_status::car_status,
         -- Снятие с публикации гасит продвижение: объявление уходит из
         -- выдачи, и оплаченные (пока подарочные) дни продолжали бы
         -- «гореть» впустую. При возврате в active продвижение не
         -- восстанавливается — это осознанно, иначе пришлось бы хранить
         -- остаток срока и объяснять пользователю его судьбу.
         is_vip = case
                    when p_status in ('archived', 'sold') then false
                    else c.is_vip
                  end,
         boosted_until = case
                           when p_status in ('archived', 'sold') then null
                           else c.boosted_until
                         end
   where c.id = p_car_id;

  -- Возвращаем то, что нужно кабинету для перерисовки карточки без
  -- повторного запроса всего списка.
  return query
    select c.id, c.status::text, c.boosted_until
      from public.cars c
     where c.id = p_car_id;
end;
$$;

comment on function public.set_my_car_status(uuid, text)
  is 'Смена статуса своего объявления по матрице переходов (снять/вернуть/продано). Снятие гасит продвижение';

-- После миграции 0065 EXECUTE не выдаётся автоматически: default
-- privileges закрыты, и без явного гранта функция недоступна клиенту.
grant execute on function public.set_my_car_status(uuid, text) to authenticated;

-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ
-- ============================================================
-- 1) Разрешённый переход (от имени владельца активного объявления):
--      select * from public.set_my_car_status('<car_id>', 'archived');
--    Ожидается строка со status = 'archived' и boosted_until = null.
--
-- 2) Запрещённый переход — должен упасть с check_violation:
--      select * from public.set_my_car_status('<car_id>', 'active');
--      -- где объявление в статусе moderation
--
-- 3) Чужое объявление — insufficient_privilege:
--      select * from public.set_my_car_status('<чужой car_id>', 'sold');
-- ============================================================


-- ============================================================
-- ДОПОЛНЕНИЕ: get_my_listings_stats — причина отклонения и вид сделки
-- ============================================================
-- ЗАЧЕМ. Кабинету сайта не хватает трёх полей, и без них экран
-- «Мои объявления» показывал бы неполную или неверную картину:
--
--   moderation_comment — ПРИЧИНА ОТКЛОНЕНИЯ. Сейчас продавец видит
--     красный бейдж «Отклонено» и не знает, что исправлять. Причину
--     пишет модератор (reject_car, миграция 0039), она лежит в cars,
--     но наружу этой функцией не отдавалась.
--
--   is_for_sale / is_for_rent — ВИД СДЕЛКИ. Функция возвращает обе
--     цены (sale_price и rent_price_daily), но не говорит, какая из
--     них относится к делу. У объявления «только аренда» sale_price
--     равен null, и карточка без этих флагов показала бы «Цена по
--     запросу» вместо суточной ставки.
--
-- Приложение НЕ ЛОМАЕТСЯ: набор колонок только расширяется, порядок
-- существующих сохранён. Flutter разбирает ответ по именам полей
-- (listing_stats_model.dart), лишние поля он просто игнорирует.
--
-- Сигнатура returns table меняется, поэтому функцию нужно удалить
-- перед пересозданием: CREATE OR REPLACE не умеет менять состав
-- возвращаемых колонок и упал бы с ошибкой.
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
  -- Новые поля.
  moderation_comment text,
  is_for_sale        boolean,
  is_for_rent        boolean
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
    c.is_for_rent
  from public.cars c
  left join public.listing_stats s on s.car_id = c.id
  where c.user_id = auth.uid()
  order by c.created_at desc;
$$;

comment on function public.get_my_listings_stats()
  is 'Мои объявления со статистикой, статусом продвижения, причиной отклонения и видом сделки — для кабинета продавца';

grant execute on function public.get_my_listings_stats() to authenticated;
