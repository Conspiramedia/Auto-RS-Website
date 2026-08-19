-- ============================================================
-- AUTO.RS — Миграция 0065: закрытие EXECUTE по умолчанию
-- ============================================================
-- ПРОБЛЕМА. PostgreSQL при CREATE FUNCTION автоматически выдаёт
-- EXECUTE роли PUBLIC, а anon и authenticated в неё входят. В итоге
-- аудит показал: явно мы грантовали anon 25 функций, а фактически ему
-- были доступны 73 — включая approve_car, credit_gift, spend_balance,
-- pay_booking, get_transactions и submit_verification.
--
-- Большинство из них защищены изнутри (is_admin() / auth.uid()), но
-- полагаться на это как на единственный рубеж нельзя: любая новая
-- функция без внутренней проверки автоматически станет публичной.
--
-- РЕШЕНИЕ — три шага:
--   1) снять EXECUTE с PUBLIC на всех функциях схемы public;
--   2) раздать точечные гранты по матрице «функция × роль»;
--   3) закрыть DEFAULT PRIVILEGES, чтобы новые функции больше не
--      открывались автоматически и дыра не возобновилась.
--
-- МАТРИЦА ПОСТРОЕНА ПО ФАКТИЧЕСКИМ ВЫЗОВАМ, а не по предположениям:
--   · Flutter — grep по .rpc('…') в D:/Project/Auto.RS/lib      → 32 шт;
--   · Next.js — grep по .rpc('…') в app/, components/, lib/     → 13 шт.
-- Из списка сайта исключён create_car_v3: подача объявления идёт
-- только после входа по SMS (components/SellForm.tsx — «Сессия обязана
-- быть: без неё RLS отклонит и загрузку фото, и create_car_v3»),
-- поэтому он относится к authenticated, а не к anon.
--
-- ЧТО НАМЕРЕННО НЕ ТРОГАЕМ: расширения в public (PostGIS и остальные
-- три), политики storage.objects, 9 пар permissive-политик.
--
-- ВСЁ ОДНОЙ ТРАНЗАКЦИЕЙ: при ошибке не применится ничего.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- ШАГ 1. Снять EXECUTE с PUBLIC.
-- ------------------------------------------------------------
-- Важно: revoke от PUBLIC не затрагивает права, выданные ролям явно
-- (owner, service_role), — снимается только неявное разрешение,
-- унаследованное всеми ролями сразу.
--
-- Функции расширений (PostGIS ~900 шт) тоже попадают под ALL
-- FUNCTIONS. Для них revoke безвреден: PostGIS-функции вызываются
-- внутри наших запросов от имени владельца запроса, а не напрямую
-- клиентом по REST. Прямой вызов ST_* через /rest/v1/rpc нигде в
-- проекте не используется.
revoke execute on all functions in schema public from public;

-- anon и authenticated лишаем всего скопом: ниже выдадим точечно.
-- Так исключается «забытая» функция, оставшаяся доступной с прошлых
-- миграций.
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;

-- ТРИГГЕРНЫЕ ФУНКЦИИ (15 шт: set_updated_at, tg_push_on_message,
-- notify_on_kyc_status, handle_new_user и т.д.) грантов НЕ требуют и
-- ниже не перечислены. Их вызывает СУБД при срабатывании триггера, а
-- не клиент по REST; проверка EXECUTE в этом пути не применяется.
-- Поэтому revoke выше их работу не ломает.


-- ------------------------------------------------------------
-- ШАГ 2а. ГРАНТЫ ДЛЯ anon — публичный каталог, SEO, контактные формы.
-- ------------------------------------------------------------
-- Это ровно те функции, что нужны сайту без авторизации: выдача
-- каталога и карточек, справочники марок/моделей/городов, sitemap,
-- контактная форма и лид дилеру, плюс квота на отправку OTP
-- (вызывается ДО входа, иначе войти невозможно).

grant execute on function public.car_matches_filters(public.cars, jsonb) to anon;
grant execute on function public.f_car_site_url(uuid) to anon;
grant execute on function public.f_site_base_url() to anon;
grant execute on function public.f_slugify(text) to anon;
grant execute on function public.get_car_brands() to anon;
grant execute on function public.get_car_details(uuid) to anon;
grant execute on function public.get_car_images(uuid) to anon;
grant execute on function public.get_car_models(uuid, text) to anon;
grant execute on function public.get_dealer_profile(uuid) to anon;
grant execute on function public.get_search_total_count(text, text, double precision, double precision, double precision, text, text, text, integer, integer, integer, numeric, numeric, text, text, text) to anon;
grant execute on function public.get_seller_listings(uuid, text, integer, integer) to anon;
grant execute on function public.get_similar_cars(uuid, integer, text) to anon;
grant execute on function public.get_site_brands(text) to anon;
grant execute on function public.get_site_cities(text) to anon;
grant execute on function public.get_site_models(text, text) to anon;
grant execute on function public.get_site_stats() to anon;
grant execute on function public.get_sitemap_cars(integer, integer, text) to anon;
grant execute on function public.rpc_check_otp_quota(text) to anon;
grant execute on function public.search_cars_advanced(text, text, double precision, double precision, double precision, text, text, text, integer, integer, integer, numeric, numeric, text, text, text, integer, integer, integer, boolean, text) to anon;
grant execute on function public.search_cars_public(text, text, text, text, integer, integer, integer, numeric, numeric, text, text, text, text, integer, integer, text, integer, boolean) to anon;
grant execute on function public.search_cars_v2(text) to anon;
grant execute on function public.search_cars_with_links(text, text, double precision, double precision, double precision, text, text, text, integer, integer, integer, numeric, numeric, text, text, text, integer, integer, integer, boolean) to anon;
grant execute on function public.submit_contact_message(text, text, text, text, uuid, text) to anon;
grant execute on function public.submit_dealer_lead(text, text, text, text, text, text) to anon;
grant execute on function public.track_listing_event(uuid, text) to anon;


-- ------------------------------------------------------------
-- ШАГ 2б. ГРАНТЫ ДЛЯ authenticated — пользовательские операции.
-- ------------------------------------------------------------
-- Всё, что вызывает приложение после входа: подача и редактирование
-- объявлений, кабинет, баланс, чаты, избранное, сохранённые поиски,
-- пуш-токены. Публичные функции каталога здесь тоже перечислены —
-- авторизованный пользователь пользуется теми же экранами.
--
-- Права администратора НЕ выдаются отдельной ролью: approve_car,
-- reject_car и credit_gift доступны authenticated, но внутри себя
-- проверяют is_admin() и падают с исключением для обычного
-- пользователя. Это существующий контракт приложения, менять его в
-- рамках этой миграции не будем.

grant execute on function public.activate_promotion(uuid, integer) to authenticated;
grant execute on function public.approve_car(uuid) to authenticated;
grant execute on function public.create_car_v2(text, text, text, integer, integer, numeric, text, text, double precision, double precision, text[], body_type, transmission_type, fuel_type, text, text) to authenticated;
grant execute on function public.create_car_v3(text, text, text, integer, integer, numeric, numeric, numeric, text, text, double precision, double precision, text[], body_type, transmission_type, fuel_type, text, text) to authenticated;
grant execute on function public.credit_gift(uuid, numeric, text, text) to authenticated;
grant execute on function public.get_balance(uuid) to authenticated;
grant execute on function public.get_car_brands() to authenticated;
grant execute on function public.get_car_details(uuid) to authenticated;
grant execute on function public.get_car_images(uuid) to authenticated;
grant execute on function public.get_car_models(uuid, text) to authenticated;
grant execute on function public.get_dealer_profile(uuid) to authenticated;
grant execute on function public.get_my_listings_stats() to authenticated;
grant execute on function public.get_my_saved_searches() to authenticated;
grant execute on function public.get_my_stats_totals() to authenticated;
grant execute on function public.get_search_total_count(text, text, double precision, double precision, double precision, text, text, text, integer, integer, integer, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.get_seller_listings(uuid, text, integer, integer) to authenticated;
grant execute on function public.get_similar_cars(uuid, integer, text) to authenticated;
grant execute on function public.get_site_brands(text) to authenticated;
grant execute on function public.get_site_cities(text) to authenticated;
grant execute on function public.get_site_models(text, text) to authenticated;
grant execute on function public.get_site_stats() to authenticated;
grant execute on function public.get_sitemap_cars(integer, integer, text) to authenticated;
grant execute on function public.get_transactions(integer, integer) to authenticated;
grant execute on function public.get_unread_count() to authenticated;
grant execute on function public.get_vendor_balance(uuid) to authenticated;
grant execute on function public.hide_car(uuid) to authenticated;
grant execute on function public.hide_city(text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.reject_car(uuid, text) to authenticated;
grant execute on function public.save_search_from_filters(jsonb, text) to authenticated;
grant execute on function public.search_cars_advanced(text, text, double precision, double precision, double precision, text, text, text, integer, integer, integer, numeric, numeric, text, text, text, integer, integer, integer, boolean, text) to authenticated;
grant execute on function public.search_cars_public(text, text, text, text, integer, integer, integer, numeric, numeric, text, text, text, text, integer, integer, text, integer, boolean) to authenticated;
grant execute on function public.search_cars_v2(text) to authenticated;
grant execute on function public.spend_balance(numeric, text, uuid) to authenticated;
grant execute on function public.start_chat(uuid) to authenticated;
grant execute on function public.toggle_favorite(uuid) to authenticated;
grant execute on function public.toggle_saved_search(uuid) to authenticated;
grant execute on function public.track_listing_event(uuid, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
grant execute on function public.update_car_v2(uuid, text, text, text, integer, integer, numeric, text, text, double precision, double precision, text[], body_type, transmission_type, fuel_type, text, text) to authenticated;
grant execute on function public.update_seller_profile(text, text, text) to authenticated;


-- ------------------------------------------------------------
-- ШАГ 2б-бис. МОДУЛЬ АРЕНДЫ И KYC — грант сохраняем.
-- ------------------------------------------------------------
-- Эти функции имели grant to authenticated в прежних миграциях, но
-- через .rpc('…') в текущем коде клиентов НЕ вызываются: экраны аренды
-- и подачи документов в приложении ещё дорабатываются (бронирования
-- заводятся из FlutterFlow-прототипа, см. 0013/0019).
--
-- Оставляем им грант намеренно. Иначе миграция «безопасности» тихо
-- сломала бы модуль в тот момент, когда его экраны включат обратно, —
-- и связь между поломкой и этой миграцией искать было бы долго.
-- Все они защищены внутри: pay_booking сверяет customer_id с
-- auth.uid(), approve/reject_user_verification требуют is_admin().
--
-- ЕСЛИ модуль аренды решено закрыть окончательно — убрать этот блок
-- отдельной миграцией, осознанно, а не побочным эффектом.
grant execute on function public.approve_user_verification(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.complete_booking(uuid) to authenticated;
grant execute on function public.confirm_booking(uuid) to authenticated;
grant execute on function public.pay_booking(uuid) to authenticated;
grant execute on function public.reject_booking(uuid) to authenticated;
grant execute on function public.reject_user_verification(uuid, text) to authenticated;
grant execute on function public.submit_verification(text, text) to authenticated;

-- ------------------------------------------------------------
-- ШАГ 2в. СЛУЖЕБНЫЕ — только service_role и владелец БД.
-- ------------------------------------------------------------
-- Фоновые задачи (обработка очереди пушей, чистка журналов, снятие
-- истёкших продвижений). Вызываются планировщиком/Edge Function с
-- ключом service_role, клиентам не нужны никогда.
-- Явный revoke здесь — повтор шага 1, оставлен намеренно: так
-- назначение этих функций видно прямо в тексте миграции.

revoke execute on function public.claim_push_batch(integer) from anon, authenticated;
revoke execute on function public.cleanup_push_queue() from anon, authenticated;
revoke execute on function public.cleanup_view_log() from anon, authenticated;
revoke execute on function public.expire_promotions() from anon, authenticated;
revoke execute on function public.mark_push_sent(uuid, boolean, text) from anon, authenticated;
revoke execute on function public.rpc_cleanup_otp_log() from anon, authenticated;


-- ------------------------------------------------------------
-- ШАГ 3. DEFAULT PRIVILEGES — чтобы дыра не возобновилась.
-- ------------------------------------------------------------
-- Без этого шага любая функция, созданная будущей миграцией, снова
-- получит EXECUTE для PUBLIC, и через несколько релизов аудит
-- покажет ту же картину. Здесь мы меняем умолчание для объектов,
-- создаваемых ролью postgres (владелец миграций).
--
-- ВАЖНО для будущих миграций: после этой строки каждая новая
-- функция требует ЯВНОГО granta нужной роли, иначе не будет
-- вызываться клиентом. Это осознанный размен: явное лучше неявного.
alter default privileges in schema public
  revoke execute on functions from public;

commit;

-- ============================================================
-- ПОСЛЕ ПРИМЕНЕНИЯ
-- ============================================================
-- Прогнать supabase/checks/0065_grants_verify.sql и сверить с
-- прогоном ДО миграции.
-- ============================================================