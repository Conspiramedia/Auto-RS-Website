// ============================================================
// RS AUTO — Proxy: выбранный язык не сбрасывается.
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

export default function proxy(request: NextRequest) {
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
    return response;
  }

  // Путь без префикса — это сербское зеркало. Если пользователь ранее
  // выбрал другой язык, уводим на его зеркало, сохраняя путь и фильтры.
  if (isLocale(saved) && saved !== DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = `/${saved}${pathname === '/' ? '' : pathname}`;
    url.search = search;
    return NextResponse.redirect(url, 307);
  }

  return NextResponse.next();
}

export const config = {
  // Middleware не должен трогать статику, файловые роуты метаданных и
  // .well-known: AASA и assetlinks.json обязаны отдаваться как есть,
  // иначе сломается проверка связи домена с приложением.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|\\.well-known|.*\\..*).*)',
  ],
};
