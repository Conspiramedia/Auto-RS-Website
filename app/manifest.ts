// ============================================================
// RS AUTO — Web App Manifest. Генерируется на сервере.
// ============================================================
// Нужен для двух вещей: корректного добавления сайта на домашний экран
// (сербский рынок — преимущественно мобильный) и для того, чтобы
// браузер знал цвет темы при открытии.
//
// ⚠️ Поле icons намеренно ПУСТОЕ: растровых иконок у проекта ещё нет
// (нужен logo.svg от дизайнера, см. components/ui/Logo.tsx). Ссылаться
// на несуществующие файлы нельзя — браузер и Lighthouse сообщат об
// ошибке загрузки, а это хуже, чем отсутствие иконок. Когда файлы
// появятся в public/, массив заполняется здесь.
// ============================================================

import type { MetadataRoute } from 'next';

import { brand } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${brand.name} — automobili u Srbiji`,
    short_name: brand.name,
    description: 'Kupovina i prodaja automobila u Srbiji.',
    start_url: '/',
    display: 'standalone',
    background_color: brand.colors.bg,
    // Цвет строки состояния. Тёмный нейтральный бренда: с ним шапка
    // сайта визуально продолжается в системную панель.
    theme_color: brand.colors.dark,
    lang: 'sr-Latn',
    icons: [],
  };
}
