// ============================================================
// RS AUTO — Proxy: язык не сбрасывается + продление сессии кабинета.
// ============================================================
// ДВЕ ЗАДАЧИ, и обе обязаны решаться ДО рендера страницы:
//   1. Выбранный язык не сбрасывается (было и раньше, описано ниже).
//   2. Токен сессии Supabase продлевается и записывается в ответ.
//      Это единственное место, где запись возможна: Server Component
//      кабинета не может выставить Set-Cookie (HTTP не разрешает это
//      после начала стриминга), поэтому без шага здесь сессия
//      протухала бы через час и продавца выбрасывало бы из /my.
// ============================================================
// Файл называется proxy.ts, а не middleware.ts: в Next 16 конвенция
// middleware объявлена устаревшей и сборка выдаёт предупреждение.
// Поведение и API прежние.
// ============================================================
// Задача одна: пользователь, выбравший русский, при заходе на адрес БЕЗ
// префикса (прямая ссылка, закладка, переход из поиска, ручной ввод)
// обязан попасть на /ru/*, а не на сербское зеркало.
//
// Как это работает:
//   1. Переход на /ru/* — запоминаем выбор в cookie NEXT_LOCALE.
//      Cookie ставится ИМЕННО здесь, а не в переключателе языка: тот
//      сделан обычными <a href> без JS (нужно для hreflang и краулера),
//      и записать cookie ему нечем.
//   2. Заход на путь без префикса при cookie 'ru' — 307 на /ru/<путь>
//      с сохранением строки запроса (фильтры каталога живут в ней).
//
// Почему НЕ по Accept-Language: сербский — основной рынок и живёт в
// корне; уводить туда всех, у кого в браузере не сербский, значило бы
// отдавать краулеру и большинству посетителей редиректы вместо страниц.
// Cookie ставится только явным действием пользователя — переходом на
// русское зеркало, поэтому редирект получает лишь тот, кто язык выбрал.
//
// Редирект 307 (временный): постоянный 301 браузеры и поисковики
// кэшируют, и после смены языка пользователь остался бы заперт на
// прежнем зеркале.
// ============================================================

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_PARAM,
  isLocale,
} from '@/lib/i18n';

// Префиксы не-локализованных локалей: '/ru'. Сербский живёт в корне и
// префикса не имеет, поэтому в список не попадает.
const PREFIXED = LOCALES.filter((l) => l !== DEFAULT_LOCALE);

// ------------------------------------------------------------
// Продление сессии Supabase.
// ------------------------------------------------------------
// Вызывается для КАЖДОГО ответа, который отдаёт proxy (включая
// редиректы смены языка): протухший токен нужно обновить независимо от
// того, куда пользователь идёт.
//
// getUser(), а не getSession(): именно обращение к серверу Supabase
// запускает обновление access-токена по refresh-токену. getSession лишь
// прочитал бы cookie и вернул просроченные данные, ничего не продлив.
//
// Результат нам не нужен — важен побочный эффект: библиотека кладёт
// обновлённые cookie в ответ через setAll. Решение «пускать или нет»
// принимает сама страница кабинета через lib/supabaseServer.ts.
//
// Гостя это не затрагивает: без cookie сессии getUser вернёт ошибку,
// мы её проглотим, и ответ уйдёт без единого Set-Cookie.
async function refreshSession(
  request: NextRequest,
  response: NextResponse,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Без переменных окружения proxy обязан продолжить работу: язык —
  // задача независимая, и ронять на ней весь сайт нельзя.
  if (!url || !key) return;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // Пишем в ДВА места. В response — чтобы браузер получил обновлённый
      // токен. В request — чтобы дальнейшая обработка ЭТОГО же запроса
      // (рендер страницы серверным клиентом) увидела уже свежее значение,
      // а не старое из входящих заголовков.
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }

        // Ответ, устанавливающий cookie авторизации, не должен попадать
        // в кэш CDN: иначе токен одного пользователя будет отдан
        // другому. Заголовки приходят от библиотеки готовыми.
        for (const [header, headerValue] of Object.entries(headers)) {
          response.headers.set(header, headerValue);
        }
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // Сеть недоступна или токен нерабочий — не повод отдавать
    // пользователю ошибку вместо страницы. Останется гостем.
  }
}

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Путь уже несёт префикс локали — фиксируем выбор в cookie и пропускаем.
  for (const code of PREFIXED) {
    if (pathname === `/${code}` || pathname.startsWith(`/${code}/`)) {
      const response = NextResponse.next();
      // Перезаписываем только при реальной смене: лишний Set-Cookie на
      // каждой странице мешает кэшированию ответа на CDN.
      if (request.cookies.get(LOCALE_COOKIE)?.value !== code) {
        response.cookies.set(LOCALE_COOKIE, code, {
          path: '/',
          maxAge: LOCALE_COOKIE_MAX_AGE,
          sameSite: 'lax',
        });
      }
      await refreshSession(request, response);
      return response;
    }
  }

  const saved = request.cookies.get(LOCALE_COOKIE)?.value;

  // ЯВНЫЙ выбор сербского из переключателя языка. Без этого маркера
  // ссылка «SR» была бы нерабочей: путь у сербского зеркала без
  // префикса, и правило ниже немедленно вернуло бы пользователя на /ru,
  // из которого он только что вышел. Маркер убираем из адреса тем же
  // редиректом, чтобы он не попал в закладки и не размножил URL.
  if (request.nextUrl.searchParams.get(LOCALE_PARAM) === DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.searchParams.delete(LOCALE_PARAM);

    const response = NextResponse.redirect(url, 307);
    response.cookies.set(LOCALE_COOKIE, DEFAULT_LOCALE, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
    });
    await refreshSession(request, response);
    return response;
  }

  // Путь без префикса — это сербское зеркало. Если пользователь ранее
  // выбрал другой язык, уводим на его зеркало, сохраняя путь и фильтры.
  if (isLocale(saved) && saved !== DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = `/${saved}${pathname === '/' ? '' : pathname}`;
    url.search = search;

    const response = NextResponse.redirect(url, 307);
    await refreshSession(request, response);
    return response;
  }

  // Ветка по умолчанию: сербское зеркало без смены языка.
  const response = NextResponse.next();
  await refreshSession(request, response);
  return response;
}

export const config = {
  // Middleware не должен трогать статику, файловые роуты метаданных и
  // .well-known: AASA и assetlinks.json обязаны отдаваться как есть,
  // иначе сломается проверка связи домена с приложением.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|\\.well-known|.*\\..*).*)',
  ],
};
