-- ============================================================
-- AUTO.RS — Миграция 0104: заявку нельзя подать повторно
-- ============================================================
-- ЗАЧЕМ:
--   Заявка на статус автосалона подаётся двумя путями, и защита от
--   повторной подачи стояла только на одном из них.
--
--   Путь через профиль (submit_dealer_application, 0100) закрыт:
--     * действующему салону отказывает проверка seller_kind;
--     * вторую ждущую заявку отсекает уникальный индекс
--       uq_dealer_app_pending.
--
--   Путь через /dealers (submit_dealer_lead, 0053) не проверял НИЧЕГО,
--   кроме «3 заявки на номер в сутки». Отсюда три дыры:
--     1. действующий салон подавал лид заново;
--     2. человек с ждущей заявкой в профиле дублировал её лидом, и
--        администратор разбирал один и тот же салон дважды;
--     3. одна компания слала лиды бесконечно, меняя номер телефона, —
--        лимит считался по номеру, а не по компании.
--
--   Здесь дыры закрываются. Ключ проверки — PIB: это единственный
--   реквизит, который у компании один и не меняется, тогда как номер
--   телефона, почта и написание названия меняются свободно. С 0103
--   PIB обязателен в обеих формах, поэтому опереться на него можно.
--
-- ЧТО СЧИТАЕТСЯ ПОВТОРОМ:
--   * лид с тем же PIB, который ещё не разобран (new / in_progress);
--   * лид с PIB компании, у которой УЖЕ есть статус салона;
--   * лид с PIB, по которому в dealer_applications лежит ждущая или
--     одобренная заявка;
--   * лид от вошедшего пользователя, который уже салон или уже подал
--     заявку из профиля.
--
--   Отклонённые (rejected / done) НЕ мешают: отказ — не приговор,
--   после исправления замечаний салон вправе подать заявку снова.
--   Ровно так же ведёт себя submit_dealer_application (0100).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Индекс под проверку повторов по PIB
-- ------------------------------------------------------------
-- Без него проверка ниже читала бы таблицу целиком на каждой заявке.
-- Частичный: строки без PIB (поданные до 0102) в проверке не
-- участвуют и в индексе не нужны.
create index if not exists idx_dealer_leads_tax_id
  on public.dealer_leads (tax_id)
  where tax_id is not null;

-- Тот же индекс на стороне заявок: по PIB ищется ждущая или уже
-- одобренная заявка того же салона.
create index if not exists idx_dealer_app_tax_id
  on public.dealer_applications (tax_id);

-- Отдельного индекса по profiles НЕТ намеренно: реквизитов в profiles
-- не существует — PIB живёт только в dealer_applications. Поэтому
-- «эта компания уже салон» проверяется через одобренную заявку с этим
-- PIB, автор которой получил статус (см. проверки ниже), а нужный для
-- этого индекс — idx_dealer_app_tax_id выше.


-- ------------------------------------------------------------
-- 2. submit_dealer_lead: отказ повторной заявке
-- ------------------------------------------------------------
-- Сигнатура НЕ меняется (0103) — меняются только проверки внутри.
create or replace function public.submit_dealer_lead(
  p_company_name text,
  p_contact_name text,
  p_phone        text,
  p_email        text default null,
  p_city         text default null,
  p_comment      text default null,
  p_tax_id       text default null,
  p_reg_num      text default null,
  p_website      text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Номер приводим к цифрам и плюсу: '+381 60 123-45' и '+38160 12345'
  -- должны считаться одним номером, иначе ограничение частоты обходится
  -- простым добавлением пробела.
  v_phone   text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_company text := btrim(coalesce(p_company_name, ''));
  v_contact text := btrim(coalesce(p_contact_name, ''));
  v_tax     text := nullif(regexp_replace(coalesce(p_tax_id, ''), '[^0-9]', '', 'g'), '');
  v_reg     text := nullif(regexp_replace(coalesce(p_reg_num, ''), '[^0-9]', '', 'g'), '');
  v_email   text := nullif(btrim(coalesce(p_email, '')), '');
  v_city    text := nullif(btrim(coalesce(p_city, '')), '');
  v_site    text := nullif(btrim(coalesce(p_website, '')), '');
  v_recent  integer;
  -- Пользователь, если форму заполняет вошедший. Аноним здесь null —
  -- это нормальный сценарий, форма на /dealers открыта всем.
  v_user    uuid := auth.uid();
begin
  -- ---------- Валидация обязательных полей ----------
  if v_company = '' or length(v_company) > 200 then
    return json_build_object('ok', false, 'error', 'invalid_company');
  end if;

  if v_contact = '' or length(v_contact) > 200 then
    return json_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  -- Минимум 9 цифр — короче не бывает ни один валидный номер.
  if length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 9
     or length(v_phone) > 20 then
    return json_build_object('ok', false, 'error', 'invalid_phone');
  end if;

  -- Реквизиты обязательны: по ним администратор проверяет компанию
  -- в APR, и заявка без них означала бы разбор через переписку.
  if v_tax is null or v_tax !~ '^[0-9]{9}$' then
    return json_build_object('ok', false, 'error', 'invalid_tax_id');
  end if;

  if v_reg is null or v_reg !~ '^[0-9]{8}$' then
    return json_build_object('ok', false, 'error', 'invalid_reg_num');
  end if;

  -- Почта и город тоже обязательны — см. комментарий у
  -- submit_dealer_application.
  if v_email is null
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return json_build_object('ok', false, 'error', 'invalid_email');
  end if;

  if v_city is null then
    return json_build_object('ok', false, 'error', 'invalid_city');
  end if;

  -- Длины остальных полей.
  if length(v_email) > 200
     or length(v_city) > 100
     or length(coalesce(p_comment, '')) > 2000
     or length(coalesce(v_site, '')) > 200 then
    return json_build_object('ok', false, 'error', 'too_long');
  end if;

  -- ---------- ЗАЩИТА ОТ ПОВТОРНОЙ ПОДАЧИ (0104) ----------
  -- Порядок веток — от самого определённого ответа к общему: человеку
  -- полезнее услышать «у вас уже есть статус», чем «заявка уже
  -- подана», когда верны оба утверждения.

  -- Компания уже салон. Двумя путями, потому что PIB в profiles не
  -- хранится: либо заявитель вошёл и сам уже салон, либо по этому PIB
  -- есть одобренная заявка, автор которой получил статус.
  if exists (
    select 1 from public.profiles p
     where p.seller_kind = 'dealer'
       and (
         (v_user is not null and p.id = v_user)
         or exists (
           select 1 from public.dealer_applications a
            where a.user_id = p.id
              and a.tax_id = v_tax
              and a.status = 'approved'
         )
       )
  ) then
    return json_build_object('ok', false, 'error', 'already_dealer');
  end if;

  -- По этой компании уже есть ждущая или одобренная заявка из
  -- профиля. Одобренная тоже считается: статус по ней либо уже выдан,
  -- либо вот-вот будет, и второй разбор той же компании не нужен.
  if exists (
    select 1 from public.dealer_applications a
     where a.status in ('pending', 'approved')
       and (a.tax_id = v_tax or (v_user is not null and a.user_id = v_user))
  ) then
    return json_build_object('ok', false, 'error', 'application_exists');
  end if;

  -- Неразобранный лид по той же компании уже лежит в очереди.
  -- Отклонённые и обработанные (rejected / done) не мешают: отказ не
  -- лишает права подать заявку снова, исправив замечания.
  if exists (
    select 1 from public.dealer_leads d
     where d.tax_id = v_tax
       and d.status in ('new', 'in_progress')
  ) then
    return json_build_object('ok', false, 'error', 'lead_exists');
  end if;

  -- ---------- Ограничение частоты ----------
  -- Остаётся как было: ловит спам с одного номера по РАЗНЫМ компаниям,
  -- чего проверки по PIB выше не видят.
  select count(*) into v_recent
  from public.dealer_leads d
  where d.phone = v_phone
    and d.created_at > now() - interval '24 hours';

  if v_recent >= 3 then
    return json_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.dealer_leads
    (company_name, contact_name, phone, email, city, comment,
     tax_id, registration_number, website)
  values (
    v_company,
    v_contact,
    v_phone,
    v_email,
    v_city,
    nullif(btrim(coalesce(p_comment, '')), ''),
    v_tax,
    v_reg,
    v_site
  );

  return json_build_object('ok', true);
end;
$$;

comment on function public.submit_dealer_lead(
  text, text, text, text, text, text, text, text, text)
  is 'Приём заявки автосалона с сайта. Аноним, 3 заявки на номер в сутки. Отказывает, если по этому PIB уже есть статус салона, заявка или неразобранный лид';

grant execute on function public.submit_dealer_lead(
  text, text, text, text, text, text, text, text, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 3. submit_dealer_application: закрыть тот же обход с другой стороны
-- ------------------------------------------------------------
-- Обратная дыра: человек оставил лид с /dealers, затем вошёл и подал
-- заявку из профиля. Проверка seller_kind её не ловит — статуса ещё
-- нет, — и администратор снова разбирает одну компанию дважды.
--
-- Добавляется проверка по PIB: неразобранный лид той же компании
-- означает, что заявка уже в очереди. Остальные проверки и тексты
-- ошибок не трогаем — их разбирает app/my/actions.ts по подстроке.
create or replace function public.submit_dealer_application(
  p_company_name        text,
  p_tax_id              text,
  p_registration_number text,
  p_company_city        text default null,
  p_contact_person      text default null,
  p_phone               text default null,
  p_website             text default null,
  p_comment             text default null,
  p_email               text default null
)
returns public.dealer_applications
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_app  public.dealer_applications;
  -- Реквизиты чистим от всего, что не цифра: человек наберёт PIB как
  -- «PIB 123 456 789» или «123-456-789», и требовать от него ровно
  -- девять символов подряд — придирка, которую легко снять здесь.
  v_tax  text := regexp_replace(coalesce(p_tax_id, ''), '[^0-9]', '', 'g');
  v_reg  text := regexp_replace(coalesce(p_registration_number, ''), '[^0-9]', '', 'g');
  -- Контактные поля приводим к «пусто = null» один раз здесь, чтобы
  -- ниже и проверять, и вставлять одно и то же значение.
  v_city   text := nullif(btrim(coalesce(p_company_city, '')), '');
  v_person text := nullif(btrim(coalesce(p_contact_person, '')), '');
  v_phone  text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email  text := nullif(btrim(coalesce(p_email, '')), '');
  v_site   text := nullif(btrim(coalesce(p_website, '')), '');
begin
  if v_user is null then
    raise exception 'Требуется авторизация'
      using errcode = 'insufficient_privilege';
  end if;

  -- Уже салон — заявка не нужна. Проверяем и по аккаунту, и по PIB:
  -- статус мог быть выдан другому аккаунту той же компании. PIB в
  -- profiles не хранится, поэтому второй путь идёт через одобренную
  -- заявку этой компании.
  if exists (
    select 1 from public.profiles p
     where p.seller_kind = 'dealer'
       and (
         p.id = v_user
         or (v_tax <> '' and exists (
           select 1 from public.dealer_applications a
            where a.user_id = p.id
              and a.tax_id = v_tax
              and a.status = 'approved'
         ))
       )
  ) then
    raise exception 'У вас уже есть статус автосалона'
      using errcode = 'check_violation';
  end if;

  if length(btrim(coalesce(p_company_name, ''))) < 2 then
    raise exception 'Укажите название автосалона'
      using errcode = 'check_violation';
  end if;

  if length(btrim(p_company_name)) > 120 then
    raise exception 'Название автосалона слишком длинное'
      using errcode = 'check_violation';
  end if;

  -- Проверяем ДЛИНУ ПОСЛЕ очистки: сообщение должно называть то, что
  -- от человека действительно требуется, — девять цифр, а не девять
  -- символов.
  if v_tax !~ '^[0-9]{9}$' then
    raise exception 'PIB состоит из 9 цифр'
      using errcode = 'check_violation';
  end if;

  if v_reg !~ '^[0-9]{8}$' then
    raise exception 'Матични број состоит из 8 цифр'
      using errcode = 'check_violation';
  end if;

  -- ---------- Контакты: обязательны с 0103 ----------
  if v_city is null then
    raise exception 'Укажите город'
      using errcode = 'check_violation';
  end if;
  if length(v_city) > 100 then
    raise exception 'Название города слишком длинное'
      using errcode = 'check_violation';
  end if;

  if v_person is null then
    raise exception 'Укажите контактное лицо'
      using errcode = 'check_violation';
  end if;
  if length(v_person) > 120 then
    raise exception 'Имя контактного лица слишком длинное'
      using errcode = 'check_violation';
  end if;

  if v_phone is null then
    raise exception 'Укажите телефон'
      using errcode = 'check_violation';
  end if;
  if length(v_phone) > 40 then
    raise exception 'Телефон слишком длинный'
      using errcode = 'check_violation';
  end if;

  -- Почта: проверяем наличие и грубый формат. Строгую проверку по RFC
  -- здесь не строим — она отвергает валидные адреса чаще, чем ловит
  -- невалидные, а опечатку в домене всё равно поймает только письмо.
  if v_email is null then
    raise exception 'Укажите email'
      using errcode = 'check_violation';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Проверьте email'
      using errcode = 'check_violation';
  end if;
  if length(v_email) > 200 then
    raise exception 'Email слишком длинный'
      using errcode = 'check_violation';
  end if;

  -- Сайт остаётся необязательным: он есть не у каждого салона.
  if length(coalesce(v_site, '')) > 200 then
    raise exception 'Адрес сайта слишком длинный'
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_comment, '')) > 1000 then
    raise exception 'Комментарий слишком длинный'
      using errcode = 'check_violation';
  end if;

  -- ---------- Неразобранный лид той же компании (0104) ----------
  -- Текст содержит «уже отправлена»: app/my/actions.ts распознаёт по
  -- этой подстроке причину pending_exists, и заявитель увидит ту же
  -- понятную строку, что и при второй заявке из профиля.
  if exists (
    select 1 from public.dealer_leads d
     where d.tax_id = v_tax
       and d.status in ('new', 'in_progress')
  ) then
    raise exception 'Ваша заявка уже отправлена и ждёт рассмотрения'
      using errcode = 'check_violation';
  end if;

  begin
    insert into public.dealer_applications (
      user_id, company_name, tax_id, registration_number,
      company_city, contact_person, phone, website, comment, email
    )
    values (
      v_user,
      btrim(p_company_name),
      v_tax,
      v_reg,
      v_city,
      v_person,
      v_phone,
      v_site,
      nullif(btrim(coalesce(p_comment, '')), ''),
      v_email
    )
    returning * into v_app;
  exception
    -- Текст ДОСЛОВНО как в 0100: server action распознаёт причину по
    -- подстроке «уже отправлена» (app/my/actions.ts), и перефразировка
    -- превратила бы понятную причину в «неизвестную ошибку».
    when unique_violation then
      raise exception 'Ваша заявка уже отправлена и ждёт рассмотрения'
        using errcode = 'check_violation';
  end;

  return v_app;
end;
$fn$;

comment on function public.submit_dealer_application(
  text, text, text, text, text, text, text, text, text)
  is 'Подача заявки на статус автосалона. Обязательны реквизиты и контакты, необязателен только сайт. Отказывает при статусе салона, ждущей заявке или неразобранном лиде по тому же PIB';

grant execute on function public.submit_dealer_application(
  text, text, text, text, text, text, text, text, text) to authenticated;
