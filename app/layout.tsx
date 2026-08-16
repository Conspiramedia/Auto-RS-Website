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
      <body>{children}</body>
    </html>
  );
}
