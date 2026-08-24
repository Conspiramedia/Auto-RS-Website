// ============================================================
// RS AUTO — Клиент Supabase для сайта.
// ============================================================
// Сайт работает ИСКЛЮЧИТЕЛЬНО под анонимным ключом (anon):
// весь публичный контент открыт политиками RLS и SECURITY DEFINER RPC,
// поэтому service_role здесь не нужен и намеренно не используется —
// сервисный ключ на фронте означал бы полный обход RLS.
//
// Требуемые переменные окружения (.env.local):
//   NEXT_PUBLIC_SUPABASE_URL       — URL проекта Supabase
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  — публичный anon-ключ
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Падаем на старте, а не при первом запросе: отсутствие ключей — ошибка
// конфигурации деплоя, и узнать о ней нужно сразу при сборке страницы,
// а не получить пустой каталог в проде.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Не заданы NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Скопируйте .env.example в .env.local и заполните значения.',
  );
}

// Клиент для серверных компонентов (SSR/SSG).
// persistSession: false — на сервере нет браузерного хранилища, а общий
// клиент между запросами не должен помнить чью-либо сессию: это привело бы
// к утечке состояния одного посетителя в рендер страницы другого.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Базовый адрес сайта. Нужен для canonical, OG-тегов и sitemap —
// все они требуют абсолютных URL.
//
// ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ для всего фронтенда: canonical, hreflang,
// og:image, sitemap.xml, robots.txt и JSON-LD берут базовый адрес
// только отсюда и не читают process.env напрямую.
//
// Источник значения — переменная окружения: при переезде на другой
// домен правится она, а не код. Значение в ?? — запасной вариант на
// случай, если переменную забыли задать в окружении сборки (или при
// локальном запуске без .env.local); оно совпадает с боевым доменом,
// чтобы такая ошибка не приводила к canonical и OG-ссылкам на
// несуществующий адрес.
//
// ВАЖНО: тот же адрес хранится на сервере в app_settings и участвует в
// сборке site_url (миграция 0048). При смене домена его нужно обновить
// и там: select public.set_site_base_url('https://новый-домен');
export const siteBaseUrl = (
  process.env.NEXT_PUBLIC_SITE_BASE_URL ?? 'https://rsauto.rs'
).replace(/\/$/, '');
