// ============================================================
// RS AUTO — Возврат из OAuth-провайдера: обмен кода на сессию.
// ============================================================
// Сюда браузер приходит после того, как человек подтвердил вход на
// стороне Google. Провайдер добавляет к адресу ?code=… — это ещё не
// сессия, а одноразовый код авторизации, который нужно обменять.
//
// ПОЧЕМУ ОБМЕН НА СЕРВЕРЕ, А НЕ В БРАУЗЕРЕ. У @supabase/ssr есть и
// клиентский путь (detectSessionInUrl: true, разбор адреса на
// странице), но он здесь не подходит по двум причинам:
//
//   1. Сессия нужна СЕРВЕРУ. Кабинет рендерится на сервере и читает
//      cookie (lib/supabaseServer.ts). Клиентский разбор записал бы
//      токен уже после того, как страница отрисовалась, и человек
//      увидел бы форму входа вместо кабинета — ровно та же беда, из-за
//      которой сессию в своё время перенесли из localStorage в cookie.
//   2. Код не должен попадать в историю браузера и в Referer. Здесь он
//      обменивается и немедленно заменяется редиректом на чистый адрес.
//
// Именно поэтому в браузерном клиенте detectSessionInUrl остаётся
// ВЫКЛЮЧЕННЫМ (lib/supabaseClient.ts): разбор адреса на клиенте не
// нужен, и включать его значило бы завести второй путь к сессии.
//
// ВТОРОЙ ПУТЬ АУТЕНТИФИКАЦИИ НЕ ЗАВОДИТСЯ. Правило площадки (см.
// components/AuthGate.tsx) соблюдено: сессию по-прежнему выдаёт
// GoTrue — здесь через exchangeCodeForSession. Своего обмена, своей
// таблицы токенов и своей выдачи сессии у сайта нет.
//
// ЭТОТ ФАЙЛ — ЕДИНСТВЕННЫЙ ОБРАБОТЧИК ВОЗВРАТА для обеих локалей.
// Адрес /auth/callback языкового префикса не имеет намеренно: он
// прописывается в консоли Google как Authorized redirect URI, и
// зеркало /ru/auth/callback потребовало бы второй записи там же —
// лишний адрес, который однажды забудут добавить. Язык человека
// приезжает отдельно, параметром ?locale=, и уже здесь превращается
// в правильный путь возврата.
// ============================================================

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { DEFAULT_LOCALE, isLocale, localeAwareHref } from '@/lib/i18n';

// Читает cookie запроса и обязан УМЕТЬ ПИСАТЬ: в route handler, в
// отличие от Server Component, Set-Cookie ещё разрешён — заголовки не
// отправлены. Поэтому обмен кода на сессию делается именно здесь.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get('code');
  const rawNext = searchParams.get('next');
  // ?? undefined — searchParams.get отдаёт null при отсутствии
  // параметра, а isLocale сужает тип только у string | undefined.
  const rawLocale = searchParams.get('locale') ?? undefined;

  // Язык, на котором человек нажал кнопку входа. Неизвестное значение
  // (подставили руками) молча заменяем основным: локаль участвует в
  // построении пути, и мусор в ней дал бы 404 после верного входа.
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  // Куда возвращать. Проверка ТА ЖЕ, что на странице входа
  // (components/pages/LoginPageView.tsx): принимаем только внутренний
  // путь. Без неё адрес возврата, подставленный в ссылку, превратил бы
  // callback в открытый редирект — переход на настоящий домен площадки
  // уводил бы на чужой сайт, и это классический вектор фишинга.
  const next = safeNext(rawNext);

  // Провайдер вернул ошибку вместо кода — человек нажал «Отмена» в
  // окне Google или отозвал доступ. Это не сбой: возвращаем его на
  // страницу входа без крика, пусть выберет другой способ.
  const providerError = searchParams.get('error');
  if (providerError || !code) {
    const back = new URL(localeAwareHref(locale, '/login'), origin);
    // Признак для формы входа: показать сообщение «вход через Google
    // не завершён». Текст живёт в словаре, а не в адресе.
    back.searchParams.set('oauth_error', providerError ?? 'no_code');
    if (rawNext) back.searchParams.set('redirect', rawNext);
    return NextResponse.redirect(back);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Не заданы NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      // ЗДЕСЬ ЗАПИСЬ РАБОТАЕТ — в этом всё отличие от
      // lib/supabaseServer.ts, где setAll намеренно заглушён. Route
      // handler выполняется до формирования ответа, поэтому библиотека
      // может положить cookie сессии, и следующий же запрос к кабинету
      // увидит вошедшего пользователя.
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const back = new URL(localeAwareHref(locale, '/login'), origin);
    back.searchParams.set('oauth_error', 'exchange');
    if (rawNext) back.searchParams.set('redirect', rawNext);
    return NextResponse.redirect(back);
  }

  // ЯЗЫК ПРОДАВЦА — В ПРОФИЛЬ (миграция 0121). То же самое делает
  // AuthGate после verifyOtp, и по той же причине: на profiles.locale
  // завязаны письма и причина отклонения объявления, а при NULL все
  // получают сербский. Вход через Google завершается ЗДЕСЬ, на
  // сервере, поэтому и вызов должен быть здесь — в AuthGate этот путь
  // просто не проходит.
  //
  // Ошибку глушим и не ждём успеха: язык писем не стоит того, чтобы
  // задерживать вход или ронять его при недоступной RPC. Ровно та же
  // трактовка, что в AuthGate.
  try {
    await supabase.rpc('set_profile_locale', { p_locale: locale });
  } catch {
    // Профиль останется с прежним языком — письма уйдут на сербском.
  }

  // Сессия в cookie. Уводим туда, куда человек шёл до входа.
  //
  // localeAwareHref, а не localeHref: у админки языковых зеркал нет, и
  // модератора, вошедшего с русской версии, обычный localeHref увёл бы
  // на несуществующий /ru/admin. Та же причина, что в AuthGate.
  return NextResponse.redirect(new URL(localeAwareHref(locale, next), origin));
}

// Разрешаем только путь внутри сайта: начинается с одного слэша и не с
// «//» (протокол-относительный адрес вида //evil.com браузер считает
// внешним). Повторяет safeRedirect со страницы входа — и повторяет
// намеренно: это проверка безопасности, и она обязана стоять в каждой
// точке, принимающей адрес снаружи, а не полагаться на то, что кто-то
// проверил раньше.
function safeNext(raw: string | null): string {
  if (!raw) return '/my';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/my';

  // Префикс локали снимаем: localeAwareHref добавит его сам, иначе на
  // русской версии получился бы путь вида /ru/ru/my.
  if (raw === '/ru') return '/';
  if (raw.startsWith('/ru/')) return raw.slice(3);

  return raw;
}
