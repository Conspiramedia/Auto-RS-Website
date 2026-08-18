// ============================================================
// RS AUTO — Корневой layout.
// ============================================================
// Шрифт Montserrat подключается через next/font: он самохостится Next'ом,
// поэтому не требует запроса к Google Fonts в рантайме и не блокирует
// первую отрисовку. Подмножества latin + cyrillic обязательны — сайт
// двуязычный (sr latin + ru).
// ============================================================

import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';

import Analytics from '@/components/Analytics';
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
        {children}
        {/* Аналитика подключается последней и только при заданном
            домене (см. lib/analytics). Cookie не ставит — баннер
            согласия не требуется. */}
        <Analytics />
      </body>
    </html>
  );
}
