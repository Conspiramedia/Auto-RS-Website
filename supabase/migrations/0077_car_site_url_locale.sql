-- ============================================================
-- RS AUTO — 0077. Адрес объявления на языковом зеркале.
-- ============================================================
-- ПРОБЛЕМА. f_car_site_url(uuid) из 0048 всегда собирает
-- {SITE_BASE_URL}/car/{id} — сербское зеркало. Для canonical это верно
-- и меняться не должно: одно объявление — один канонический адрес,
-- и он сербский (см. lib/seo.ts на сайте).
--
-- Но по этой же ссылке уходит письмо продавцу о решении модерации
-- (0071, email_on_car_moderation). Язык письма берётся из
-- profiles.locale, и русскоязычный продавец получал письмо на русском
-- с кнопкой на сербскую версию карточки: текст на одном языке, сайт
-- по ссылке — на другом.
--
-- РЕШЕНИЕ. Вторая, двухаргументная форма функции, собирающая адрес
-- зеркала. Письмо ведёт ЧЕЛОВЕКА на его язык; краулер сюда не ходит,
-- и canonical остаётся сербским, как и был.
--
-- ПОЧЕМУ НЕ `p_locale text default 'sr'` У СТАРОЙ ФУНКЦИИ. Аргумент по
-- умолчанию сделал бы вызов f_car_site_url(uuid) неоднозначным:
-- Postgres не смог бы выбрать между одноаргументной формой и
-- двухаргументной с подставленным умолчанием и отверг бы вызов с
-- ошибкой «function is not unique». А одноаргументную форму вызывают
-- девять RPC карточек и выдачи (0048, 0050, 0051, 0052, 0055, 0057,
-- 0059, 0072) и приложение — ломать их нельзя.
--
-- Поэтому: две отдельные сигнатуры без умолчаний. Старая сохраняет
-- своё поведение и делегирует новой с 'sr' — путь '/car/{id}' остаётся
-- прописанным ровно в одном месте, ради чего функция и заводилась.
--
-- Миграция аддитивна: существующие сигнатуры, права и вызовы
-- сохранены.
-- ============================================================


-- ------------------------------------------------------------
-- f_car_site_url(uuid, text) — адрес объявления на зеркале локали
-- ------------------------------------------------------------
-- Префикс зеркала повторяет localeHref сайта (lib/i18n.ts): сербский
-- живёт в корне без префикса, русский — под /ru. Незнакомый или
-- пустой язык трактуется как сербский: это язык по умолчанию, и
-- письмо с ним уже уходит (coalesce в 0071).
create or replace function public.f_car_site_url(
  p_car_id uuid,
  p_locale text
)
returns text
language sql
stable
set search_path = public
as $$
  select public.f_site_base_url()
      || case when p_locale = 'ru' then '/ru' else '' end
      || '/car/'
      || p_car_id::text;
$$;

comment on function public.f_car_site_url(uuid, text)
  is 'Адрес объявления на зеркале локали: {SITE_BASE_URL}[/ru]/car/{id}. Для писем человеку; canonical остаётся сербским';

-- Права те же, что у одноаргументной формы после 0065: чтение адреса
-- не раскрывает ничего, чего нет в самой карточке.
grant execute on function public.f_car_site_url(uuid, text) to anon, authenticated;


-- ------------------------------------------------------------
-- f_car_site_url(uuid) — прежняя форма, теперь делегирует новой
-- ------------------------------------------------------------
-- Поведение НЕ меняется: тот же сербский канонический адрес. Тело
-- переписано только чтобы путь '/car/{id}' не был продублирован в двух
-- функциях — иначе при переносе роута (/car → /listing) одну из них
-- забыли бы поправить.
create or replace function public.f_car_site_url(p_car_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select public.f_car_site_url(p_car_id, 'sr');
$$;

comment on function public.f_car_site_url(uuid)
  is 'Канонический адрес объявления: {SITE_BASE_URL}/car/{id}. Путь совпадает с роутом приложения';


-- ------------------------------------------------------------
-- Триггер модерации: ссылка на зеркале получателя
-- ------------------------------------------------------------
-- Единственное изменение против 0071 — v_url собирается с языком
-- получателя, который в функции уже прочитан (v_locale). Остальное
-- тело воспроизведено без правок: create or replace заменяет функцию
-- целиком, и вырезать из неё логику здесь нечего.
--
-- Триггер tg_email_on_car_moderation пересоздавать НЕ НУЖНО: он
-- ссылается на функцию по имени, а не на её тело.
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
  -- Статус не менялся — выходим сразу, не трогая profiles. Триггер
  -- висит на UPDATE OF status, но Postgres вызывает его и когда
  -- колонку переписали тем же значением.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Интересуют ровно два перехода: публикация и отклонение (подробный
  -- разбор — в комментарии к функции в 0071).
  if not (
    (new.status = 'active'   and old.status in ('moderation', 'rejected'))
    or
    (new.status = 'rejected' and old.status = 'moderation')
  ) then
    return new;
  end if;

  -- Адрес и язык получателя. Профиль читаем ОДНИМ запросом: два
  -- обращения к одной строке ради двух полей — лишний проход по
  -- индексу на каждой модерации.
  select p.email, p.locale
    into v_email, v_locale
    from public.profiles p
   where p.id = new.user_id;

  -- Почты нет (вход по SMS, профиль не заполнен) — письма не будет.
  -- Уведомление в колокольчик поставила approve_car/reject_car, и
  -- продавец увидит решение в кабинете. Это штатный путь, а не ошибка.
  if v_email is null then
    return new;
  end if;

  -- Ссылка на ЗЕРКАЛЕ ПОЛУЧАТЕЛЯ, а не канонический сербский адрес:
  -- письмо написано на языке продавца (тот же v_locale уходит в
  -- payload ниже), и кнопка обязана вести на страницу того же языка.
  -- Canonical это не затрагивает — он сербский и задаётся сайтом.
  v_url := public.f_car_site_url(new.id, coalesce(v_locale, 'sr'));

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
        -- Причина из moderation_comment — та же строка, что видит
        -- продавец в кабинете и в колокольчике. Пустая причина
        -- допустима: шаблон покажет формулировку по умолчанию, а
        -- выдумывать причину за модератора нельзя.
        'reason', nullif(btrim(coalesce(new.moderation_comment, '')), '')
      ),
      new.user_id
    );
  end if;

  return new;
end;
$$;

comment on function public.email_on_car_moderation()
  is 'Письмо продавцу о решении модерации. Ссылка — на зеркале языка получателя (0077)';
