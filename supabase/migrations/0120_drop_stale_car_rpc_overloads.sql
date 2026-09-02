-- ============================================================
-- 0120 — УДАЛЕНИЕ УСТАРЕВШИХ ПЕРЕГРУЗОК create_car_v3/update_car_v3
-- ============================================================
-- ЧТО СЛОМАЛОСЬ. Подача объявления падала на последнем шаге:
--
--   PGRST203: Could not choose the best candidate function between
--   public.create_car_v3(… p_phone => text)
--   public.create_car_v3(… p_phone => text, p_is_on_order => boolean)
--
-- ПРИЧИНА — ОШИБКА В 0118 И 0119. Обе миграции добавляли новый
-- параметр через `create or replace function`. Для Postgres функция
-- опознаётся по ИМЕНИ И СПИСКУ ТИПОВ АРГУМЕНТОВ: добавление параметра
-- меняет сигнатуру, поэтому `create or replace` не заменил прежнюю
-- функцию, а СОЗДАЛ РЯДОМ НОВУЮ. Старая осталась жить.
--
-- В итоге в базе оказалось по три перегрузки каждой функции:
--   1) исходная (до 0118),
--   2) с p_is_on_order (0118),
--   3) с p_availability (0119).
--
-- PostgREST вызывает функции по именам параметров и при неоднозначном
-- совпадении отказывается выбирать — что и увидел продавец.
--
-- ПОЧЕМУ ЭТОГО НЕ СЛУЧИЛОСЬ С search_cars_public и get_car_details:
-- там менялся возвращаемый тип, Postgres потребовал явный drop
-- (SQLSTATE 42P13), и обе миграции его делали. У функций подачи
-- менялся только СПИСОК ПАРАМЕТРОВ — на это Postgres не ругается,
-- он просто заводит ещё одну функцию.
--
-- ЧТО ДЕЛАЕМ. Удаляем перегрузки 1 и 2, оставляя единственную
-- актуальную с p_availability. Клиенты, не передающие этот параметр
-- (мобильное приложение), продолжают работать: у p_availability стоит
-- `default null`, и вызов без него однозначно попадает в оставшуюся
-- функцию — неоднозначности больше нет, потому что кандидат один.
--
-- Права на оставшиеся функции не трогаем: drop удаляет только те, что
-- перечислены, а актуальная не пересоздаётся и свои grant сохраняет.
-- ============================================================

-- ------------------------------------------------------------
-- create_car_v3
-- ------------------------------------------------------------
-- Сигнатуры перечислены полностью: без списка типов Postgres не
-- поймёт, какую из трёх перегрузок удалять.

-- Исходная, до 0118.
drop function if exists public.create_car_v3(
  text, text, text, integer, integer, numeric, numeric, numeric, text,
  text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text
);

-- С флагом is_on_order (0118). Сама колонка уже удалена в 0119,
-- поэтому функция всё равно нерабочая.
drop function if exists public.create_car_v3(
  text, text, text, integer, integer, numeric, numeric, numeric, text,
  text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text, boolean
);


-- ------------------------------------------------------------
-- update_car_v3
-- ------------------------------------------------------------
drop function if exists public.update_car_v3(
  uuid, text, text, text, integer, integer, numeric, numeric, numeric,
  text, text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text
);

drop function if exists public.update_car_v3(
  uuid, text, text, text, integer, integer, numeric, numeric, numeric,
  text, text, double precision, double precision, text[],
  body_type, transmission_type, fuel_type, text, text, boolean
);
