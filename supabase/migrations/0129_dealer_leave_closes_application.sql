-- ============================================================
-- AUTO.RS — Миграция 0129: уход из салонов закрывает заявку
-- ============================================================
-- ЧТО БЫЛО НЕ ТАК. Салон, нажавший «Стать частным лицом», уходил в
-- private, но его заявка оставалась в стадии approved. А право на
-- статус проверяется именно по ней:
--
--   f_has_approved_dealer_application → exists(status = 'approved')
--
-- Значит вернуть статус можно было ОДНИМ СОХРАНЕНИЕМ ПРОФИЛЯ, минуя
-- администратора. Диалог отказа так и говорил: «вернуть статус можно
-- без новой заявки, одобренная продолжает действовать».
--
-- ПОЧЕМУ ЭТО НЕПРАВИЛЬНО. Статус автосалона — не настройка профиля, а
-- выданное площадкой право: витрина в каталоге, страница салона,
-- подпись «Автосалон» на объявлениях, возможная публикация без
-- модерации. Выдаётся оно по проверке ПИБ и матичного номера. Между
-- уходом и возвратом компания может перестать существовать, сменить
-- владельца или лишиться регистрации — и всё это время бессрочно
-- действующее одобрение пускало бы её обратно без единой проверки.
--
-- Одобрение относится к КОНКРЕТНОМУ обращению, а не выдаётся навсегда.
-- Отказавшись от статуса, человек закрывает это обращение сам.
--
-- ЧТО ДЕЛАЕТ МИГРАЦИЯ. При переходе dealer → private в
-- update_seller_profile одобренные заявки пользователя переводятся в
-- новую стадию 'withdrawn'. После этого
-- f_has_approved_dealer_application отдаёт false, и вернуть статус
-- можно только новой заявкой, которую снова рассмотрит администратор.
--
-- ------------------------------------------------------------
-- ПОЧЕМУ ОТДЕЛЬНАЯ СТАДИЯ, А НЕ 'rejected'.
-- ------------------------------------------------------------
-- Технически проще было бы поставить rejected — код уже так делает в
-- admin_revoke_dealer (0125). Но это разные события, и смешивать их
-- нельзя сразу по трём причинам:
--
--   * rejected означает «площадка отказала», withdrawn — «владелец
--     ушёл сам». В окне заявок администратора первое требует разбора,
--     второе нет;
--   * constraint chk_dealer_app_reason_required требует у rejected
--     причину от 10 символов. Придумывать её за человека («отказался
--     сам») значило бы писать в поле «за что отказано» текст, который
--     туда не относится;
--   * кабинет показывает у rejected причину отказа и кнопку «подать
--     снова». Ушедшему по своей воле показывать «ваша заявка
--     отклонена» — прямая ложь.
--
-- Клиентские экраны от новой стадии не ломаются: и кабинет, и админка
-- сравнивают статус явно ('pending', 'approved', 'rejected'), а
-- незнакомое значение попадает в ветку «заявки нет» — то есть человеку
-- показывается приглашение подать новую. Ровно это и требуется.
--
-- ------------------------------------------------------------
-- ЧТО НЕ МЕНЯЕТСЯ.
-- ------------------------------------------------------------
-- Сигнатура update_seller_profile та же — десять параметров в том же
-- порядке, тот же возвращаемый тип. Приложение продолжает звать её как
-- звало; меняется поведение внутри, и оно меняется для обоих клиентов
-- сразу, что и требуется от общего бэкенда.
--
-- admin_revoke_dealer (0125) намеренно НЕ трогаем: там администратор
-- отзывает статус принудительно, и rejected с причиной — верная
-- стадия. Заявитель видит в кабинете, за что у него забрали статус.
--
-- ------------------------------------------------------------
-- УСТАРЕВШИЙ КОММЕНТАРИЙ В 0100 (строки 243–246).
-- ------------------------------------------------------------
-- Там написано: «Обратно он вернётся без новой заявки: прежняя
-- одобренная никуда не делась и продолжает действовать». С этой
-- миграции это НЕВЕРНО — заявка закрывается при уходе. Файл 0100 уже
-- применён и правке не подлежит (иначе база и репозиторий разойдутся,
-- а db push не заметит изменения), поэтому опровержение фиксируется
-- здесь: читающий 0100 обязан дойти до этой миграции.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Новая стадия в белом списке.
-- ------------------------------------------------------------
-- Constraint пересоздаётся целиком: добавить значение в существующий
-- CHECK нельзя. Прежние три перечислены заново — потеряй мы одно,
-- ALTER упал бы на уже лежащих строках.
alter table public.dealer_applications
  drop constraint if exists chk_dealer_app_status;

alter table public.dealer_applications
  add constraint chk_dealer_app_status check (
    status in ('pending', 'approved', 'rejected', 'withdrawn')
  );

-- Причина обязательна только у rejected, и withdrawn под это правило
-- не подпадает: у отказа от статуса нет причины, которую кто-то писал
-- бы для показа заявителю. Constraint chk_dealer_app_reason_required
-- уже сформулирован как «status <> 'rejected' or …», поэтому менять
-- его не нужно — новая стадия проходит.
--
-- chk_dealer_app_reviewed требует непустой reviewed_at у всего, что не
-- pending. Для withdrawn это осмысленно: момент ухода — тоже решение
-- по заявке, просто принятое владельцем. Ниже он и проставляется.

comment on column public.dealer_applications.status
  is 'pending — ждёт решения; approved — статус выдан; rejected — отказано администратором; withdrawn — владелец сам отказался от статуса (0129)';


-- ------------------------------------------------------------
-- 2) update_seller_profile: уход в private закрывает заявку.
-- ------------------------------------------------------------
-- Тело повторяет редакцию 0100 целиком, добавлен ровно один блок —
-- после UPDATE профиля. Раньше вернуть его было нельзя иначе:
-- create or replace переписывает функцию целиком.
create or replace function public.update_seller_profile(
  p_seller_kind   text,
  p_company_name  text default null,
  p_logo_url      text default null,
  p_description   text default null,
  p_dealer_phone  text default null,
  p_website       text default null,
  p_opening_hours text default null,
  p_company_city  text default null,
  p_cover_url     text default null,
  p_tagline       text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_profile public.profiles;
  -- Прежний вид продавца. Нужен, чтобы отличить УХОД из салонов от
  -- обычного сохранения профиля частником: закрывать заявку надо
  -- только на переходе dealer → private, а не при каждом нажатии
  -- «Сохранить» у человека, который салоном никогда и не был.
  v_was     text;
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  if p_seller_kind not in ('private', 'dealer') then
    raise exception 'Недопустимый тип продавца: %', p_seller_kind
      using errcode = 'check_violation';
  end if;

  -- Читаем прежний вид продавца ДО обновления и блокируем строку:
  -- два одновременных сохранения не должны закрыть заявку дважды.
  select p.seller_kind into v_was
    from public.profiles p
   where p.id = v_user
   for update;

  -- ------------------------------------------------------------
  -- ГЛАВНАЯ ПРОВЕРКА МИГРАЦИИ 0100.
  -- ------------------------------------------------------------
  -- Стоит ПЕРЕД проверкой названия салона: человеку, у которого нет
  -- одобренной заявки, сообщение «укажите название автосалона»
  -- предлагало бы дозаполнить форму, которая всё равно не сохранится.
  --
  -- Код ошибки insufficient_privilege (42501), а не check_violation:
  -- это отказ в праве, и сайт разбирает его отдельной веткой.
  if p_seller_kind = 'dealer'
     and not public.f_has_approved_dealer_application(v_user) then
    raise exception 'Статус автосалона подтверждает администратор. Подайте заявку в профиле'
      using errcode = 'insufficient_privilege';
  end if;

  -- Дилер без названия салона не сохраняется: проверяем ДО UPDATE, чтобы
  -- вернуть человекочитаемую ошибку, а не текст constraint из Postgres.
  if p_seller_kind = 'dealer'
     and nullif(trim(coalesce(p_company_name, '')), '') is null then
    raise exception 'Укажите название автосалона'
      using errcode = 'check_violation';
  end if;

  -- Длины проверяются и здесь, хотя их стережёт CHECK на таблице:
  -- constraint отдаёт клиенту техническое «violates check constraint»,
  -- а продавцу нужно понятное «описание слишком длинное».
  if length(coalesce(p_description, '')) > 1000 then
    raise exception 'Описание салона слишком длинное'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_dealer_phone, '')) > 40 then
    raise exception 'Телефон салона слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_website, '')) > 200 then
    raise exception 'Адрес сайта слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_opening_hours, '')) > 200 then
    raise exception 'Часы работы слишком длинные'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_company_city, '')) > 100 then
    raise exception 'Название города слишком длинное'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_cover_url, '')) > 500 then
    raise exception 'Адрес обложки слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_tagline, '')) > 90 then
    raise exception 'Слоган слишком длинный'
      using errcode = 'check_violation';
  end if;

  update public.profiles p
     set seller_kind   = p_seller_kind,
         -- При возврате в private затираем витрину дилера.
         company_name  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_company_name), '') end,
         logo_url      = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_logo_url), '') end,
         description   = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_description), '') end,
         dealer_phone  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_dealer_phone), '') end,
         website       = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_website), '') end,
         opening_hours = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_opening_hours), '') end,
         company_city  = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_company_city), '') end,
         cover_url     = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_cover_url), '') end,
         tagline       = case when p_seller_kind = 'dealer'
                              then nullif(trim(p_tagline), '') end,
         updated_at    = now()
   where p.id = v_user
  returning p.* into v_profile;

  -- ------------------------------------------------------------
  -- НОВОЕ (0129): уход из салонов закрывает одобренную заявку.
  -- ------------------------------------------------------------
  -- Только на ПЕРЕХОДЕ dealer → private. Обычное сохранение профиля
  -- частником (v_was уже 'private') сюда не попадает: иначе UPDATE
  -- выполнялся бы вхолостую при каждом нажатии «Сохранить».
  --
  -- Закрываем ВСЕ одобренные строки, а не последнюю: блок 6 миграции
  -- 0100 выдавал заявки задним числом и дублей не запрещал, а проверка
  -- права — это exists, и одна пропущенная строка вернула бы статус
  -- в обход администратора.
  --
  -- reviewed_by = auth.uid(): решение принял сам владелец. Это не
  -- подмена администратора, а честная запись — в поле «кто закрыл
  -- заявку» стоит тот, кто её закрыл. reviewed_at обязателен по
  -- constraint chk_dealer_app_reviewed.
  --
  -- reject_reason НЕ ставим: причины у добровольного ухода нет, а
  -- поле означает «за что отказано» и показывается заявителю.
  if v_was = 'dealer' and p_seller_kind = 'private' then
    update public.dealer_applications
       set status      = 'withdrawn',
           reviewed_by = v_user,
           reviewed_at = now(),
           updated_at  = now()
     where user_id = v_user
       and status  = 'approved';
  end if;

  return v_profile;
end;
$$;

comment on function public.update_seller_profile(
  text, text, text, text, text, text, text, text, text, text
) is 'Сохранение профиля продавца. Статус dealer требует одобренной заявки; уход в private закрывает её (withdrawn) — вернуть статус можно только новой заявкой (0129)';
