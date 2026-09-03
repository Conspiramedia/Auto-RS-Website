// ============================================================
// RS AUTO — Корневой layout.
// ============================================================
// Шрифт Montserrat подключается через next/font: он самохостится Next'ом,
// поэтому не требует запроса к Google Fonts в рантайме и не блокирует
// первую отрисовку. Подмножества latin + cyrillic обязательны — сайт
// двуязычный (sr latin + ru).
// ============================================================

import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';

import Analytics from '@/components/Analytics';
import CardActionsProvider from '@/components/CardActionsProvider';
import CookieBanner from '@/components/CookieBanner';
import GoogleAnalyticsGate from '@/components/GoogleAnalytics';
import { brand } from '@/lib/brand';
import { siteBaseUrl } from '@/lib/supabase';
import './globals.css';

const montserrat = Montserrat({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-montserrat',
  display: 'swap',
});

export const metadata: Metadata = {
  // metadataBase делает относительные URL в OG-тегах абсолютными —
  // без него соцсети не подтянут превью.
  metadataBase: new URL(siteBaseUrl),
  title: {
    default: `${brand.name} — automobili u Srbiji`,
    template: `%s | ${brand.name}`,
  },
  description: 'Kupovina i prodaja automobila u Srbiji.',

  // Иконки нарезаны из фирменного PNG. Пути статичные: файлы лежат в
  // public/ и отдаются с корня.
  icons: {
    // favicon.ico первым — старые браузеры берут именно его; PNG 32
    // рядом для тех, кто умеет лучше.
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    // iOS не читает manifest для экрана «Домой» — ему нужен именно
    // apple-touch-icon, иначе система нарисует скриншот страницы.
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },

  // ------------------------------------------------------------
  // Поведение iOS.
  // ------------------------------------------------------------
  // telephone: false — САМОЕ ЗАМЕТНОЕ здесь. Safari по умолчанию сам
  // ищет в тексте телефонные номера и превращает их в ссылки, а
  // распознаёт он их плохо: пробег «58 400» и год «2022» на карточке
  // объявления получали синее подчёркивание и вызов при нажатии.
  // Настоящий телефон продавца — отдельная кнопка со своим tel:,
  // автоопределение здесь только вредит.
  formatDetection: { telephone: false },

  appleWebApp: {
    // Подпись под иконкой, когда сайт добавлен на домашний экран.
    // Без неё iOS берёт <title> страницы, с которой сохраняли, —
    // на экране появлялось бы «Škoda Octavia — 12 500 €».
    title: brand.name,
    capable: true,
    // Строка состояния в цвет шапки: при запуске с домашнего экрана
    // белая полоса над сайтом выглядела бы обрезанным экраном.
    statusBarStyle: 'default',
  },
};

// ------------------------------------------------------------
// Viewport. Отдельный экспорт — требование Next: с 14-й версии эти
// поля вынесены из metadata, и заданные там они молча игнорируются.
// ------------------------------------------------------------
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Масштабирование НЕ запрещаем (нет maximum-scale и
  // user-scalable=no): запрет ломает доступность — человек со слабым
  // зрением не сможет увеличить текст объявления. Вёрстка сайта
  // адаптивна, и защищаться от зума ей не нужно.
  themeColor: brand.colors.primary,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // lang проставляется в layout'ах локалей; здесь значение по умолчанию —
  // сербский, так как он живёт в корне сайта.
  return (
    <html lang="sr-Latn" className={montserrat.variable}>
      <body>
        {/* Состояние значков карточки (избранное, скрытые объявления) —
            на весь сайт, а не на отдельный список. Карточки стоят в
            каталоге, на витринах марок и моделей, на главной, у
            салона и в блоке «похожие»: оборачивать каждый список
            порознь значило бы забыть про следующий.

            Один провайдер = один запрос сессии и один запрос за
            закладками на страницу, сколько бы карточек на ней ни было.
            Сам layout остаётся серверным: 'use client' стоит внутри
            провайдера, и в клиентский бандл уезжает только он. */}
        <CardActionsProvider>{children}</CardActionsProvider>

        {/* Баннер согласия на куки. В КОРНЕВОМ layout'е, а не в
            страницах: он обязан появиться на любом адресе сайта, в
            обоих языковых зеркалах, и дублировать его по страницам
            значило бы забыть про новую при следующей правке. Язык он
            определяет сам — из адреса (см. CookieBanner).

            Плашку рисует клиентский компонент, но сам layout остаётся
            серверным: 'use client' стоит внутри CookieBanner, и в
            клиентский бандл уезжает только он. */}
        <CookieBanner />

        {/* Аналитика подключается последней. Два слоя с разными
            правилами — см. lib/analytics:

            Plausible — при заданном домене и ВСЕГДА: куки не ставит,
            согласия не требует, поэтому считает и тех, кто отказался.

            GA4 — при заданном Measurement ID И данном согласии. Куки
            ставит, поэтому ждёт ответа в баннере выше; до ответа и
            при отказе скрипт не подключается вовсе. */}
        <Analytics />
        <GoogleAnalyticsGate />
      </body>
    </html>
  );
}
