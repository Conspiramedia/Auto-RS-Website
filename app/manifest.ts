// ============================================================
// RS AUTO — Web App Manifest. Генерируется на сервере.
// ============================================================
// Нужен для двух вещей: корректного добавления сайта на домашний экран
// (сербский рынок — преимущественно мобильный) и для того, чтобы
// браузер знал цвет темы при открытии.
//
// Иконки нарезаны из фирменного PNG приложения (знак на прозрачном
// фоне в корне D:/Project/Auto.RS) разовым скриптом на sharp; скрипт и
// зависимость удалены после нарезки. Файлы лежат в public/. Две пары:
//   any      — знак со своими скруглениями, для мест, где систему
//              устраивает картинка как есть;
//   maskable — фон растянут до краёв, арт в safe-zone 80%: Android и
//              часть браузеров обрезают иконку своей формой (круг,
//              сквиркл, капля), и без этой версии у знака срезались бы
//              углы вместе с фоном.
// ============================================================

import type { MetadataRoute } from 'next';

import { brand } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Имя без хвоста-описания: на домашнем экране и в списке
    // установленных приложений подпись обрезается, и «RS Auto»
    // должно читаться целиком.
    name: brand.name,
    short_name: brand.name,
    description: 'Kupovina i prodaja automobila u Srbiji.',
    start_url: '/',
    display: 'standalone',
    background_color: brand.colors.bg,
    // Цвет строки состояния — брендовый primary: он же фон иконки
    // на домашнем экране, поэтому запуск выглядит цельно.
    theme_color: brand.colors.primary,
    lang: 'sr-Latn',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
