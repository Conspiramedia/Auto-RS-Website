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
// Домен ещё не куплен, поэтому значение живёт в переменной окружения
// и меняется без правки кода.
export const siteBaseUrl = (
  process.env.NEXT_PUBLIC_SITE_BASE_URL ?? 'https://rsauto.placeholder'
).replace(/\/$/, '');
