-- ============================================================
-- AUTO.RS — Миграция 0101: заявитель узнаёт о решении по заявке
-- ============================================================
-- ЧТО ЧИНИМ. Миграция 0100 научила площадку выдавать статус автосалона
-- по заявке, но НЕ научила сообщать заявителю о решении. Человек
-- отправлял реквизиты и оставался в неведении: узнать исход можно было,
-- только зайдя в профиль и обновив страницу. Отказ с причиной,
-- написанный администратором специально для того, чтобы заявку
-- исправили, при этом не доходил ни до кого.
--
-- ДВА КАНАЛА, КАК У МОДЕРАЦИИ ОБЪЯВЛЕНИЙ:
--   1) уведомление в колокольчик (notifications) — БЕЗУСЛОВНОЕ. Оно
--      работает всегда: не зависит ни от адреса почты, ни от доставки;
--   2) письмо (email_queue) — если у заявителя заполнен profiles.email.
--      Вход на площадку идёт по SMS, и почта у большинства пуста
--      (0035, 0071), поэтому письмо — дополнение к колокольчику, а не
--      замена ему.
--
-- ПОЧЕМУ ПРЯМО В RPC, А НЕ ТРИГГЕРОМ НА ТАБЛИЦЕ.
-- Письма модерации объявлений живут в триггере на cars (0071) — и там
-- это правильно: статус объявления меняют несколько путей (approve_car,
-- reject_car, admin_set_car_status, set_my_car_status), и письмо,
-- привязанное к одному из них, не ушло бы из остальных.
--
-- У заявки путь РОВНО ОДИН: admin_review_dealer_application. Прямой
-- UPDATE закрыт наглухо (0100: политик на запись нет, гранты отозваны),
-- и второго способа рассмотреть заявку не существует. Триггер здесь
-- добавил бы уровень косвенности, ничего не защищая, — и разнёс бы
-- решение и его последствия по двум файлам.
--
-- ЯЗЫК. Уведомление в колокольчик пишется ПО-РУССКИ, как и все
-- остальные (их пишут триггеры, общие с приложением; см. пояснение в
-- components/pages/NotificationsPageView.tsx). Письмо же уходит на
-- языке заявителя из profiles.locale — шаблон выбирает локаль сам по
-- payload.locale, и сербу придёт сербское письмо.
--
-- ЗАДНИМ ЧИСЛОМ НИЧЕГО НЕ РАССЫЛАЕТСЯ. Заявки, заведённые блоком 6
-- миграции 0100 действующим салонам, уже одобрены — и рассылка по ним
-- означала бы письма «ваш статус подтверждён» тем, кто получил его
-- полгода назад и ничего не запрашивал.
-- ============================================================


-- ============================================================
-- БЛОК 1. Ключи шаблонов писем
-- ============================================================
-- Ограничение пересоздаётся целиком со всем прежним перечнем плюс два
-- новых ключа. Порядок важен: вставка письма с неизвестным
-- template_key упала бы на chk_email_template и откатила транзакцию
-- вместе с решением по заявке — то есть отказ администратора не
-- сохранился бы из-за письма.
--
-- ВНИМАНИЕ ПРИ ДЕПЛОЕ (то же предупреждение, что в 0080): шаблоны
-- должны появиться и в Edge Function
-- (supabase/functions/send-email/templates.ts). Пока функция не
-- задеплоена, renderEmail вернёт null и письмо ляжет в failed с
-- внятной ошибкой — оно не потеряется, но и не уйдёт.
alter table public.email_queue
  drop constraint if exists chk_email_template;

alter table public.email_queue
  add constraint chk_email_template check (
    template_key in (
      'car_approved',           -- объявление одобрено, ссылка на карточку
      'car_rejected',           -- отклонено: причина + ссылка на /my
      'car_archived_by_admin',  -- снято администратором: причина + ссылка на /my
      'contact_received',       -- копия обращения автору
      'contact_admin',          -- обращение — администратору
      'dealer_lead_admin',      -- заявка салона — администратору
      -- Новое (0101). Решение по заявке на СТАТУС автосалона.
      -- Не путать с dealer_lead_admin выше: тот уходит администратору
      -- о маркетинговом лиде с формы, эти — заявителю о его правах.
      'dealer_app_approved',    -- статус выдан: ссылка на витрину
      'dealer_app_rejected'     -- отказ: причина + ссылка в профиль
    )
  );


-- ============================================================
-- БЛОК 2. admin_review_dealer_application — с уведомлением и письмом
-- ============================================================
-- Функция пересоздаётся целиком. Логика решения (проверка прав,
-- FOR UPDATE, защита от повторного рассмотрения, перенос реквизитов,
-- журнал) сохранена из 0100 БЕЗ ИЗМЕНЕНИЙ — добавлены только
-- уведомление и письмо в конце каждой ветки.
--
-- ПОРЯДОК ВНУТРИ ТРАНЗАКЦИИ: сначала решение, потом извещение. Если
-- решение почему-либо не сохранится, извещения не будет тоже — а не
-- наоборот, когда человек получает «статус подтверждён» по заявке,
-- которая на самом деле осталась ждущей.
--
-- ПИСЬМО НЕ МОЖЕТ УРОНИТЬ РЕШЕНИЕ. f_enqueue_email при пустом или
-- битом адресе возвращает NULL и ничего не вставляет (0071) — это
-- штатный исход для заявителя, вошедшего по SMS. Сама вставка в
-- очередь в сеть не ходит: письмо отправляет Edge Function позже,
-- и недоступность почтового провайдера транзакцию не касается.
create or replace function public.admin_review_dealer_application(
  p_id      uuid,
  p_approve boolean,
  p_reason  text default null
)
returns public.dealer_applications
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_app    public.dealer_applications;
  v_reason text;
  -- Контакты и язык заявителя. Читаются ОДИН раз после решения и
  -- используются обоими каналами: отдельный select под каждый был бы
  -- вторым обращением к profiles за теми же тремя полями.
  v_email  text;
  v_locale text;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав: решение по заявке принимает только администратор'
      using errcode = 'insufficient_privilege';
  end if;

  if p_approve is null then
    raise exception 'Решение обязательно'
      using errcode = 'check_violation';
  end if;

  -- FOR UPDATE: два администратора могли открыть одну заявку. Второй
  -- дождётся коммита первого и увидит стадию, отличную от pending, —
  -- и получит внятный отказ вместо перезаписи чужого решения.
  select * into v_app
    from public.dealer_applications a
   where a.id = p_id
   for update;

  if v_app.id is null then
    raise exception 'Заявка не найдена'
      using errcode = 'no_data_found';
  end if;

  if v_app.status <> 'pending' then
    raise exception 'Заявка уже рассмотрена: текущая стадия = %', v_app.status
      using errcode = 'check_violation';
  end if;

  -- ---------- ОТКАЗ ----------
  if not p_approve then
    v_reason := btrim(coalesce(p_reason, ''));

    -- Границы те же, что у отказа в модерации и блокировки салона.
    if length(v_reason) < 10 then
      raise exception 'Причина обязательна и должна содержать не менее 10 символов'
        using errcode = 'check_violation';
    end if;

    if length(v_reason) > 1000 then
      raise exception 'Причина слишком длинная: % символов, максимум 1000', length(v_reason)
        using errcode = 'check_violation';
    end if;

    update public.dealer_applications
       set status        = 'rejected',
           reject_reason = v_reason,
           reviewed_by   = auth.uid(),
           reviewed_at   = now(),
           updated_at    = now()
     where id = p_id
    returning * into v_app;

    perform public.f_admin_log(
      'dealer_app_rejected',
      'dealer_applications',
      p_id,
      jsonb_build_object(
        'user_id', v_app.user_id,
        'company', v_app.company_name,
        'tax_id',  v_app.tax_id,
        'reason',  v_reason
      )
    );

    select p.email, p.locale into v_email, v_locale
      from public.profiles p
     where p.id = v_app.user_id;

    -- ------------------------------------------------------------
    -- КОЛОКОЛЬЧИК: отказ.
    -- ------------------------------------------------------------
    -- ПРИЧИНА ВХОДИТ В body ЦЕЛИКОМ. Отказ без объяснения не даёт
    -- исправить заявку и превращает повторную подачу в угадывание —
    -- ровно то, ради чего причина сделана обязательной. В ленте она
    -- обрезается до двух строк (line-clamp-2 в NotificationRow), а
    -- полностью человек читает её в профиле, куда ведёт уведомление.
    --
    -- action_id = NULL намеренно, и это не упущение: поле хранит id
    -- сущности, у которой есть своя страница (объявление, диалог).
    -- Заявка такой страницы не имеет — она показывается блоком внутри
    -- профиля. Куда ведёт уведомление, решает NotificationRow по
    -- ТИПУ; см. targetHref в components/NotificationRow.tsx.
    insert into public.notifications (user_id, title, body, type, action_id)
    values (
      v_app.user_id,
      'Заявка на статус автосалона отклонена',
      format('%s. Причина: %s', v_app.company_name, v_reason),
      'dealer_app_rejected',
      null
    );

    -- ------------------------------------------------------------
    -- ПИСЬМО: отказ.
    -- ------------------------------------------------------------
    -- locale в payload — язык заявителя; шаблон при NULL возьмёт
    -- сербский (основной рынок), как и все остальные письма.
    perform public.f_enqueue_email(
      v_email,
      'dealer_app_rejected',
      jsonb_build_object(
        'locale',  coalesce(v_locale, 'sr'),
        'company', v_app.company_name,
        'reason',  v_reason
      ),
      v_app.user_id
    );

    return v_app;
  end if;

  -- ---------- ОДОБРЕНИЕ ----------
  update public.dealer_applications
     set status      = 'approved',
         -- Причину при одобрении затираем: поле означает «за что
         -- отказали», и текст из прошлой жизни заявки вводил бы в
         -- заблуждение.
         reject_reason = null,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         updated_at  = now()
   where id = p_id
  returning * into v_app;

  -- Статус салона и реквизиты — из заявки. Поля витрины (обложка,
  -- слоган, часы, описание) НЕ трогаем: их заполняет сам салон, и
  -- пустыми они и должны быть у только что одобренного.
  --
  -- coalesce у города и контактного лица: заявка могла их не
  -- содержать (поля необязательные), и затирать уже заполненное
  -- администратором в окне салона незачем.
  update public.profiles p
     set seller_kind    = 'dealer',
         company_name   = v_app.company_name,
         company_city   = coalesce(v_app.company_city, p.company_city),
         contact_person = coalesce(v_app.contact_person, p.contact_person),
         -- Телефон салона из заявки — если владелец его указал и в
         -- профиле пусто. Это контакт для покупателей на витрине.
         dealer_phone   = coalesce(p.dealer_phone, v_app.phone),
         website        = coalesce(p.website, v_app.website),
         updated_at     = now()
   where p.id = v_app.user_id;

  perform public.f_admin_log(
    'dealer_app_approved',
    'dealer_applications',
    p_id,
    jsonb_build_object(
      'user_id', v_app.user_id,
      'company', v_app.company_name,
      'tax_id',  v_app.tax_id,
      'reg_num', v_app.registration_number
    )
  );

  select p.email, p.locale into v_email, v_locale
    from public.profiles p
   where p.id = v_app.user_id;

  -- ------------------------------------------------------------
  -- КОЛОКОЛЬЧИК: статус выдан.
  -- ------------------------------------------------------------
  -- Текст называет, что именно человек получил, а не просто «заявка
  -- одобрена»: «одобрена» отвечает на вопрос о судьбе документа, а
  -- владельцу важно, что у него теперь есть витрина и её надо
  -- заполнить.
  insert into public.notifications (user_id, title, body, type, action_id)
  values (
    v_app.user_id,
    'Статус автосалона подтверждён',
    format(
      '%s: теперь у вас есть страница салона в каталоге. Заполните витрину в профиле.',
      v_app.company_name
    ),
    'dealer_app_approved',
    -- action_id хранит id ПОЛЬЗОВАТЕЛЯ, потому что адрес витрины —
    -- /dealer/{user_id}: у салона идентификатор страницы совпадает с
    -- идентификатором владельца (см. app/dealer/[id]/page.tsx).
    -- Это единственный тип уведомления, где action_id указывает на
    -- профиль, а не на отдельную сущность.
    v_app.user_id
  );

  -- ------------------------------------------------------------
  -- ПИСЬМО: статус выдан.
  -- ------------------------------------------------------------
  perform public.f_enqueue_email(
    v_email,
    'dealer_app_approved',
    jsonb_build_object(
      'locale',  coalesce(v_locale, 'sr'),
      'company', v_app.company_name,
      -- Адрес витрины собирает шаблон из site_base_url и этого id:
      -- готовую ссылку в payload класть нельзя, домен площадки —
      -- настройка окружения (0048), а не свойство заявки.
      'dealer_id', v_app.user_id
    ),
    v_app.user_id
  );

  return v_app;
end;
$fn$;

comment on function public.admin_review_dealer_application(uuid, boolean, text)
  is 'Решение по заявке салона. При одобрении сама ставит seller_kind = dealer и переносит реквизиты. Пишет в журнал, шлёт уведомление и письмо заявителю (0101). Только для админа';

grant execute on function public.admin_review_dealer_application(uuid, boolean, text) to authenticated;
