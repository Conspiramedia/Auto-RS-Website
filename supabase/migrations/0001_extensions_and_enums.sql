-- ============================================================
-- AUTO.RS — Миграция 0001: Расширения и перечисляемые типы (ENUM)
-- Рынок: Сербия. Валюта БД по умолчанию: EUR. Кодировка: UTF-8.
-- ============================================================
-- Назначение файла: подключаем необходимые расширения PostgreSQL
-- и объявляем все ENUM-типы проекта. Это фундамент — выполняется
-- ПЕРВЫМ, до создания таблиц.
-- ============================================================

-- ---------- РАСШИРЕНИЯ ----------
-- uuid-ossp — генерация UUID (в Supabase обычно уже включено)
create extension if not exists "uuid-ossp";

-- btree_gist — необходим для составного GiST-индекса в EXCLUDE-констрейнте,
-- который физически запрещает пересечение дат аренды по одной машине.
create extension if not exists "btree_gist";

-- unaccent — снятие диакритики для нормализации сербского текста
-- (Đ, Č, Š, Ž → d, c, s, z). Используется в поиске по маркам/моделям/городам.
create extension if not exists "unaccent";

-- pg_trgm — триграммный поиск (нечёткое совпадение, LIKE/ILIKE по индексу).
-- Помогает при двуалфавитном поиске и опечатках.
create extension if not exists "pg_trgm";

-- postgis — геолокация и поиск по радиусу ("машины рядом в Белграде/Нови-Саде").
-- Требование CLAUDE.md по специфике авто-рынка Сербии.
create extension if not exists "postgis";


-- ============================================================
-- ПЕРЕЧИСЛЯЕМЫЕ ТИПЫ (ENUM)
-- Защищают БД от некорректных значений и удобно биндятся
-- в выпадающие списки (Dropdown) FlutterFlow.
-- ============================================================

-- Роль пользователя в системе
create type user_role as enum ('client', 'seller', 'admin');

-- Статус объявления:
--   moderation — по умолчанию сразу после создания (ждёт одобрения админом),
--   active     — одобрено админом (видно всем в поиске),
--   archived   — скрыто владельцем,
--   rejected   — отклонено модератором,
--   sold       — продано (для блока купли/продажи).
create type car_status as enum ('moderation', 'active', 'archived', 'rejected', 'sold');

-- Тип кузова
create type body_type as enum (
  'sedan', 'hatchback', 'suv', 'crossover', 'coupe',
  'wagon', 'minivan', 'pickup', 'convertible', 'van'
);

-- Тип коробки передач
create type transmission_type as enum ('manual', 'automatic', 'robot', 'variator');

-- Тип топлива
create type fuel_type as enum ('petrol', 'diesel', 'hybrid', 'electric', 'gas');

-- Статус брони:
--   pending   — заявка подана (даты НЕ блокируются),
--   confirmed — подтверждена владельцем (даты жёстко блокируются),
--   rejected  — отклонена владельцем,
--   cancelled — отменена клиентом,
--   completed — аренда завершена.
create type booking_status as enum ('pending', 'confirmed', 'rejected', 'cancelled', 'completed');

-- Валюта расчётов (по умолчанию EUR для рынка Сербии; RSD — для показа на клиенте)
create type currency_code as enum ('EUR', 'RSD');
