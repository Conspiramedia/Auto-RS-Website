/** @type {import('next').NextConfig} */

// ============================================================
// RS AUTO — Конфигурация Next.
// ============================================================

// Хост Supabase: нужен и для next/image, и для CSP. Считаем один раз —
// два независимых разбора одной переменной означали бы, что при смене
// проекта можно поправить одно место и забыть второе, и картинки молча
// перестали бы проходить политику безопасности.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : null;

// ------------------------------------------------------------
// Content-Security-Policy.
// ------------------------------------------------------------
// Разрешено ровно то, что сайту действительно нужно:
//
//   script-src 'unsafe-inline' и 'unsafe-eval' — требование Next:
//     рантайм App Router внедряет инлайновые скрипты гидратации
//     (self.__next_f.push(...)), а dev-сборка использует eval для
//     source maps. Убрать их можно только переходом на nonce, что
//     несовместимо со статически пререндеренными страницами (SSG),
//     а на них построены все SEO-страницы марок и моделей.
//
//   img-src data: и blob: — data: нужен QR-коду (генерируется в
//     data-URL библиотекой qrcode), blob: — превью выбранных фотографий
//     в форме подачи объявления.
//
//   connect-src Supabase — все RPC, авторизация по SMS и загрузка
//     фотографий в Storage идут прямо из браузера на домен проекта.
//
//   font-src 'self' data: — Montserrat самохостится через next/font,
//     внешние хосты шрифтов не нужны вовсе.
//
//   frame-ancestors 'none' — запрет встраивания сайта в чужой iframe;
//     это же дублирует X-Frame-Options для старых браузеров.
//
// object-src и base-uri закрыты полностью: плагинов на сайте нет,
// а подмена <base> — классический вектор увода ссылок формы подачи.
// Origin Supabase для CSP. Берётся ЦЕЛИКОМ из переменной окружения, а
// не склеивается как `https://` + хост.
//
// Прежняя склейка теряла две вещи — протокол и порт. На боевом проекте
// это не проявлялось: там адрес и так https на 443. А локальный стек
// (`supabase start`) живёт на http://127.0.0.1:54321, и CSP получал
// «https://127.0.0.1» — без порта и с чужим протоколом. Браузер блокировал
// КАЖДЫЙ запрос к базе с сообщением «Refused to connect», то есть
// локально не работали ни вход, ни подача объявления, ни каталог.
//
// new URL().origin отдаёт «протокол//хост:порт» ровно в том виде,
// который ожидает CSP.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : '';

// Тот же адрес, но по схеме WebSocket. Нужен Realtime-подписке чата
// (components/ChatRoom.tsx): она открывает
// wss://<проект>.supabase.co/realtime/v1/websocket.
//
// ОТДЕЛЬНАЯ ЗАПИСЬ ОБЯЗАТЕЛЬНА. CSP управляет WebSocket через
// connect-src, но сопоставляет источники ВМЕСТЕ СО СХЕМОЙ: запись
// https://*.supabase.co НЕ разрешает wss://*.supabase.co, хотя хост тот
// же. Без этой строки браузер отказывал в соединении, subscribe() падал
// с исключением, и страница диалога показывала экран ошибки — при том
// что сервер отдавал её со статусом 200.
//
// Схему выводим из origin, а не пишем 'wss' константой: локальный стек
// (`supabase start`) живёт на http://127.0.0.1:54321, и там WebSocket
// идёт по ws://, а не по wss://. Константа сломала бы чат локально.
const supabaseWsOrigin = supabaseOrigin
  ? supabaseOrigin.replace(/^http/, 'ws')
  : '';

// Источник скрипта аналитики. Добавляется в CSP только когда аналитика
// настроена: без переменной окружения скрипт не подключается вовсе,
// и открывать ему доступ незачем. Self-hosted установка Plausible
// задаётся той же переменной, поэтому origin вычисляется из неё, а не
// прописывается константой.
const plausibleOrigin = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN
  ? new URL(
      process.env.NEXT_PUBLIC_PLAUSIBLE_SRC ??
        'https://plausible.io/js/script.js',
    ).origin
  : '';

// ------------------------------------------------------------
// Источники GA4. Добавляются в CSP только при заданном Measurement ID —
// по тому же правилу, что и Plausible: нет ключа, нет и доступа.
// ------------------------------------------------------------
// Хостов ДВА, и они делают разное:
//   * googletagmanager.com — отдаёт сам gtag.js. Нужен в script-src;
//   * google-analytics.com — принимает события. Нужен в connect-src.
// Пропусти любой из них — GA4 молча не заработает: браузер заблокирует
// либо загрузку скрипта, либо отправку, и ошибка будет видна только
// в консоли посетителя.
//
// Регион-специфичные сборщики GA4 (region1.google-analytics.com и
// подобные) покрыты wildcard-записью: конкретный поддомен зависит от
// страны посетителя, и перечислить их списком нельзя.
const gaConfigured = Boolean(process.env.NEXT_PUBLIC_GA_ID);

const gaScriptOrigin = gaConfigured
  ? 'https://www.googletagmanager.com'
  : '';

const gaConnectOrigins = gaConfigured
  ? 'https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com'
  : '';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-eval' 'unsafe-inline'${plausibleOrigin ? ` ${plausibleOrigin}` : ''}${gaScriptOrigin ? ` ${gaScriptOrigin}` : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // Wildcard *.supabase.co оставлен вдобавок к конкретному origin:
  // фотографии старых объявлений могут отдаваться с других поддоменов
  // проекта (storage/CDN), и жёсткая привязка к одному хосту сломала бы
  // их показ. images.unsplash.com — источник демо-фотографий сида.
  // GA4 в части случаев отправляет событие не fetch-запросом, а
  // загрузкой пикселя (/collect?...). Без записи в img-src такие
  // отправки молча теряются — заметно это только по расхождению цифр.
  `img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com${supabaseOrigin ? ` ${supabaseOrigin}` : ''}${gaConnectOrigins ? ` ${gaConnectOrigins}` : ''}`,
  // connect-src нужен аналитике отдельно от script-src: события
  // отправляются fetch-запросом на /api/event того же origin.
  //
  // wss://*.supabase.co — Realtime-канал чата. Идёт рядом с https-записью,
  // а не вместо неё: по https работают RPC, авторизация и Storage, по
  // wss — только подписка на новые сообщения.
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${supabaseOrigin ? ` ${supabaseOrigin}` : ''}${supabaseWsOrigin ? ` ${supabaseWsOrigin}` : ''}${plausibleOrigin ? ` ${plausibleOrigin}` : ''}${gaConnectOrigins ? ` ${gaConnectOrigins}` : ''}`,
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  // Формы уходят только на свой домен: подача объявления и заявка
  // дилера отправляются через RPC, сторонних action быть не должно.
  "form-action 'self'",
].join('; ');

// Заголовки безопасности для всех ответов сайта.
const securityHeaders = [
  {
    // HSTS: два года, поддомены включены, preload — заявка в список
    // предзагрузки браузеров. Домен обязан быть доступен только по
    // HTTPS, иначе preload сделает сайт недоступным.
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    // Камера, микрофон и геолокация сайту не нужны: город продавец
    // выбирает из списка, фотографии приходят обычным файловым полем.
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  { key: 'Content-Security-Policy', value: csp },
];

const nextConfig = {
  images: {
    // Фотографии объявлений лежат в Supabase Storage (бакет car-images) и
    // отдаются с домена проекта. Хост берём из той же переменной окружения,
    // что и клиент, — второй источник истины для адреса приведёт к тому,
    // что при смене проекта картинки молча перестанут открываться.
    remotePatterns: supabaseHost
      ? [
          {
            protocol: 'https',
            hostname: supabaseHost,
            pathname: '/storage/v1/object/public/**',
          },
        ]
      : [],
  },

  async headers() {
    return [
      {
        // AASA обязан отдаваться как application/json и БЕЗ расширения .json —
        // иначе iOS не засчитает проверку связи домена и приложения.
        // Next по умолчанию отдал бы файл без расширения как text/plain.
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
      {
        // Заголовки безопасности — на все маршруты, включая статику и
        // файлы .well-known: HSTS обязан присутствовать в каждом ответе
        // домена, иначе браузер не зафиксирует политику.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
