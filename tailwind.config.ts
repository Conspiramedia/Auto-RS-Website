import type { Config } from 'tailwindcss';
import { brand } from './lib/brand';

// ============================================================
// Tailwind получает цвета, радиусы и отступы ИЗ lib/brand.ts.
// Дублировать хексы здесь нельзя: бренд дорабатывается, и правка
// должна делаться ровно в одном месте.
// ============================================================
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: brand.colors.primary,
          green: brand.colors.green,
          blue: brand.colors.blue,
          red: brand.colors.red,
          dark: brand.colors.dark,
          gold: brand.colors.gold,
        },
      },
      borderRadius: {
        // Две ступени скругления: контролы и контейнеры.
        control: brand.radius.control,
        card: brand.radius.card,
      },
      fontFamily: {
        // Montserrat подключается в app/layout.tsx через next/font.
        sans: ['var(--font-montserrat)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
