-- ============================================================
-- 0083. Боевой домен rsauto.rs
-- ============================================================
-- КОНТЕКСТ. Домен rsauto.rs куплен. До этой миграции базовый адрес
-- сайта на сервере хранился в app_settings.site_base_url со значением
-- временного адреса Vercel, а страховка внутри f_site_base_url()
-- указывала на несуществующий 'https://example.rs'.
--
-- Из этого адреса собираются:
--   * site_url объявления (f_car_site_url) — он же canonical карточки
--     и ссылка, которую шарит приложение;
--   * ссылки в письмах (Edge Function send-email читает ту же строку
--     app_settings, если не задан секрет SITE_BASE_URL).
--
-- Поэтому расхождение с NEXT_PUBLIC_SITE_BASE_URL на фронтенде даёт
-- две разные канонические ссылки на одно объявление — прямая потеря
-- SEO-веса и битые ссылки в письмах.
--
-- Миграция делает две вещи:
--   1) прописывает боевой домен в app_settings;
--   2) заменяет страховку в f_site_base_url() на тот же боевой домен,
--      чтобы удалённая строка настроек не приводила к ссылкам на
--      example.rs (домен нам не принадлежит).
--
-- Аддитивна и идемпотентна: сигнатуры функций не меняются, вызовы
-- приложения (f_car_site_url, get_car_details и прочие) не затронуты.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Боевой адрес в настройках
-- ------------------------------------------------------------
-- Тем же значением, что NEXT_PUBLIC_SITE_BASE_URL на Vercel.
-- Без завершающего слэша — его же ожидает f_site_base_url.
insert into public.app_settings (key, value, updated_at)
values ('site_base_url', 'https://rsauto.rs', now())
on conflict (key) do update
  set value = excluded.value, updated_at = now();


-- ------------------------------------------------------------
-- 2. Страховка внутри f_site_base_url()
-- ------------------------------------------------------------
-- Тело функции повторяет 0048 (rtrim снимает случайный завершающий
-- слэш), меняется только значение coalesce: example.rs → rsauto.rs.
create or replace function public.f_site_base_url()
returns text
language sql
stable
set search_path = public
as $$
  select rtrim(
    coalesce(
      (select s.value from public.app_settings s where s.key = 'site_base_url'),
      'https://rsauto.rs'          -- страховка, если строку удалили
    ),
    '/'
  );
$$;

comment on function public.f_site_base_url()
  is 'Базовый адрес сайта из app_settings, без завершающего слэша. Страховка — боевой домен rsauto.rs (0083)';

grant execute on function public.f_site_base_url() to anon, authenticated;
