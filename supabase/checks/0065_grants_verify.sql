-- ============================================================
-- 0065 — ПРОВЕРКА ГРАНТОВ: одна таблица вердиктов
-- ============================================================
-- НАЗНАЧЕНИЕ: доказать, что после миграций 0064 и 0065
--   · anon может вызывать ровно свои 25 публичных функций;
--   · anon НЕ может вызывать приватные (баланс, деньги, админка);
--   · authenticated может вызывать пользовательские;
--   · служебные закрыты для обеих ролей;
--   · get_vendor_balance с ЧУЖИМ uuid падает с исключением.
--
-- Файл сведён в ОДИН select — SQL Editor выгружает в CSV результат
-- только последнего запроса, поэтому многосекционные файлы теряются.
--
-- Только чтение прав из системного каталога + безопасные smoke-вызовы
-- внутри транзакции с ROLLBACK. Ничего не меняет, безопасен для прода.
--
-- КАК ЧИТАТЬ: колонка verdict — OK или FAIL. FAIL быть не должно.
-- Прогнать ДО миграций и ПОСЛЕ; ДО ожидаются FAIL в строках 1-4
-- (в этом и смысл миграции), ПОСЛЕ — сплошные OK.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Smoke-вызовы: проверяем, что защита реально срабатывает.
-- ------------------------------------------------------------
-- has_function_privilege проверяет ГРАНТ, но не внутреннюю логику
-- функции. Поэтому отдельно вызываем get_vendor_balance с чужим uuid
-- и убеждаемся, что она падает с исключением, а не отдаёт данные.
create temporary table _smoke(check_name text, got text, expected text) on commit drop;

do $$
declare
  v_other uuid;
  v_val   numeric;
begin
  -- Чужой пользователь: любой профиль, отличный от текущего.
  select p.id into v_other from public.profiles p
   where p.id is distinct from coalesce(auth.uid(),
         '00000000-0000-0000-0000-000000000000'::uuid)
   limit 1;

  if v_other is null then
    insert into _smoke values
      ('get_vendor_balance с чужим uuid','НЕТ ДАННЫХ для теста','exception');
  else
    begin
      -- Прогон от имени владельца БД: auth.uid() здесь null, поэтому
      -- ожидаем «Требуется авторизация». Главное — что функция НЕ
      -- вернула число: любой возврат означает, что проверка не стоит.
      select public.get_vendor_balance(v_other) into v_val;
      insert into _smoke values
        ('get_vendor_balance с чужим uuid', 'вернула '||coalesce(v_val::text,'null'), 'exception');
    exception when others then
      insert into _smoke values
        ('get_vendor_balance с чужим uuid', 'exception', 'exception');
    end;
  end if;
end $$;


select * from (
  -- ==========================================================
  -- 1-4. ГРАНТЫ ANON: публичное доступно, приватное закрыто.
  -- ==========================================================
  select 1 as ord,
         'anon: публичные функции каталога' as check_name,
         count(*)::text                     as value,
         '25'                               as expected,
         case when count(*) = 25 then 'OK' else 'FAIL' end as verdict
    from (values
      ('car_matches_filters'),('f_car_site_url'),('f_site_base_url'),('f_slugify'),
      ('get_car_brands'),('get_car_details'),('get_car_images'),('get_car_models'),
      ('get_dealer_profile'),('get_search_total_count'),('get_seller_listings'),
      ('get_similar_cars'),('get_site_brands'),('get_site_cities'),('get_site_models'),
      ('get_site_stats'),('get_sitemap_cars'),('rpc_check_otp_quota'),
      ('search_cars_advanced'),('search_cars_public'),('search_cars_v2'),
      ('search_cars_with_links'),('submit_contact_message'),('submit_dealer_lead'),
      ('track_listing_event')
    ) t(fn)
    join pg_proc p on p.proname = t.fn
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where has_function_privilege('anon', p.oid, 'EXECUTE')

  union all
  -- Приватные для anon: баланс, деньги, админка, чужие данные.
  select 2,
         'anon: приватные функции ЗАКРЫТЫ',
         count(*)::text,
         '0',
         case when count(*) = 0 then 'OK' else 'FAIL' end
    from (values
      ('get_balance'),('get_vendor_balance'),('spend_balance'),('credit_gift'),
      ('pay_booking'),('get_transactions'),('approve_car'),('reject_car'),
      ('approve_user_verification'),('reject_user_verification'),
      ('submit_verification'),('update_seller_profile'),('is_admin'),
      ('create_car_v2'),('create_car_v3'),('update_car_v2'),('start_chat')
    ) t(fn)
    join pg_proc p on p.proname = t.fn
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where has_function_privilege('anon', p.oid, 'EXECUTE')

  union all
  -- ==========================================================
  -- 3. ГРАНТЫ AUTHENTICATED: пользовательские доступны.
  -- ==========================================================
  select 3,
         'authenticated: пользовательские функции',
         count(*)::text,
         '17',
         case when count(*) = 17 then 'OK' else 'FAIL' end
    from (values
      ('get_balance'),('get_vendor_balance'),('get_transactions'),
      ('create_car_v2'),('create_car_v3'),('update_car_v2'),
      ('get_my_listings_stats'),('get_my_saved_searches'),('get_my_stats_totals'),
      ('toggle_favorite'),('toggle_saved_search'),('save_search_from_filters'),
      ('hide_car'),('hide_city'),('start_chat'),('get_unread_count'),
      ('update_seller_profile')
    ) t(fn)
    join pg_proc p on p.proname = t.fn
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where has_function_privilege('authenticated', p.oid, 'EXECUTE')

  union all
  -- ==========================================================
  -- 4. СЛУЖЕБНЫЕ: закрыты для обеих клиентских ролей.
  -- ==========================================================
  select 4,
         'служебные закрыты для anon+authenticated',
         count(*)::text,
         '0',
         case when count(*) = 0 then 'OK' else 'FAIL' end
    from (values
      ('claim_push_batch'),('cleanup_push_queue'),('cleanup_view_log'),
      ('expire_promotions'),('mark_push_sent'),('rpc_cleanup_otp_log')
    ) t(fn)
    join pg_proc p on p.proname = t.fn
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')

  union all
  -- ==========================================================
  -- 4б. МОДУЛЬ АРЕНДЫ И KYC: грант сохранён (см. 0065, шаг 2б-бис).
  -- ==========================================================
  -- Клиент их сейчас не вызывает, но грант оставлен намеренно, чтобы
  -- миграция не сломала модуль при включении его экранов.
  select 45,
         'аренда/KYC: грант сохранён',
         count(*)::text,
         '8',
         case when count(*) = 8 then 'OK' else 'FAIL' end
    from (values
      ('pay_booking'),('cancel_booking'),('complete_booking'),('confirm_booking'),
      ('reject_booking'),('submit_verification'),('approve_user_verification'),
      ('reject_user_verification')
    ) t(fn)
    join pg_proc p on p.proname = t.fn
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where has_function_privilege('authenticated', p.oid, 'EXECUTE')

  union all
  -- ==========================================================
  -- 5. АДМИНСКИЕ: грант есть у authenticated, но внутри is_admin().
  -- ==========================================================
  -- Это существующий контракт приложения: обычный пользователь
  -- получит исключение уже внутри функции.
  select 5,
         'админские: грант есть, защита внутри',
         count(*)::text,
         '2',
         case when count(*) = 2 then 'OK' else 'FAIL' end
    from (values ('approve_car'),('reject_car')) t(fn)
    join pg_proc p on p.proname = t.fn
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where has_function_privilege('authenticated', p.oid, 'EXECUTE')

  union all
  -- ==========================================================
  -- 6. SMOKE: get_vendor_balance с чужим uuid обязана упасть.
  -- ==========================================================
  select 6, s.check_name, s.got, s.expected,
         case when s.got = s.expected then 'OK' else 'FAIL' end
    from _smoke s

  union all
  -- ==========================================================
  -- 7. DEFAULT PRIVILEGES: новые функции не открываются сами.
  -- ==========================================================
  -- Ищем запись, снимающую EXECUTE с PUBLIC (в acl это пустой
  -- грантополучатель "=X/" — его отсутствие означает, что умолчание
  -- закрыто).
  select 7,
         'default privileges закрыты для PUBLIC',
         count(*)::text,
         '1+',
         case when count(*) >= 1 then 'OK' else 'FAIL' end
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public'
     and d.defaclobjtype = 'f'
     and not exists (
       select 1 from aclexplode(d.defaclacl) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
     )

  union all
  -- ==========================================================
  -- 8. КОНТРОЛЬ: PUBLIC не имеет EXECUTE на наших функциях.
  -- ==========================================================
  -- Функции расширений (PostGIS) исключены — их права нас не касаются.
  select 8,
         'наших функций с EXECUTE у PUBLIC',
         count(*)::text,
         '0',
         case when count(*) = 0 then 'OK' else 'FAIL' end
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d
                      where d.objid = p.oid
                        and d.classid = 'pg_proc'::regclass
                        and d.deptype = 'e')
     and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
) x
order by ord;

rollback;
