import type { Config } from 'tailwindcss';
import { brand } from './lib/brand';

// ============================================================
// Tailwind получает ВСЕ токены ИЗ lib/brand.ts.
// Дублировать значения здесь нельзя: бренд дорабатывается, и правка
// должна делаться ровно в одном месте — в lib/brand.ts.
//
// Что откуда берётся в разметке:
//   text-neutral-60      → цвет вторичного текста
//   border-neutral-10    → граница карточки
//   bg-surface-subtle    → подложка секции
//   shadow-card          → тень карточки
//   z-header             → слой шапки
//   rounded-control      → радиус кнопки
//   duration-fast        → длительность наведения
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
        // Нейтральная шкала. Числовые ключи повторяют прежние значения
        // прозрачности (text-black/60 → text-neutral-60), поэтому
        // перевод разметки на токены цвет не меняет.
        neutral: brand.neutral,
        // Заливки и состояния наведения.
        surface: brand.surface,
        // Семантические роли: bg-success читается лучше, чем bg-brand-green,
        // когда речь о статусе, а не о брендовом акценте.
        success: brand.semantic.success,
        warning: brand.semantic.warning,
        error: brand.semantic.error,
        info: brand.semantic.info,
      },

      borderRadius: {
        // Четыре ступени скругления: бейдж, контрол, контейнер, капсула.
        sm: brand.radius.sm,
        control: brand.radius.control,
        card: brand.radius.card,
        pill: brand.radius.pill,
      },

      // Отступы из брендовой сетки, кратной 4. Доступны как p-md, gap-lg,
      // mt-xl — рядом с числовой шкалой Tailwind, а не вместо неё:
      // переписывать все p-4 на p-md означало бы тронуть каждый файл
      // ради нулевого визуального эффекта.
      spacing: brand.spacing,

      boxShadow: {
        card: brand.shadow.card,
        dropdown: brand.shadow.dropdown,
        modal: brand.shadow.modal,
        sticky: brand.shadow.sticky,
      },

      zIndex: {
        header: String(brand.zIndex.header),
        'filter-sheet': String(brand.zIndex.filterSheet),
        modal: String(brand.zIndex.modal),
        tooltip: String(brand.zIndex.tooltip),
      },

      transitionDuration: {
        fast: brand.motion.fast,
        normal: brand.motion.normal,
      },

      transitionTimingFunction: {
        // Собственная кривая под тем же именем, что и дефолтная
        // ease-out Tailwind: значения совпадают, но источник — бренд.
        out: brand.motion.easing,
      },

      fontFamily: {
        // Montserrat подключается в app/layout.tsx через next/font.
        sans: ['var(--font-montserrat)', 'system-ui', 'sans-serif'],
      },

      // Типографская шкала: размер + межстрочный интервал одной парой.
      // Значения совпадают с дефолтами Tailwind, которые уже стояли
      // в разметке, поэтому text-h1 и text-3xl дают одинаковый результат.
      fontSize: {
        h1: [brand.typography.h1.size, brand.typography.h1.lineHeight],
        h2: [brand.typography.h2.size, brand.typography.h2.lineHeight],
        h3: [brand.typography.h3.size, brand.typography.h3.lineHeight],
        h4: [brand.typography.h4.size, brand.typography.h4.lineHeight],
        body: [brand.typography.body.size, brand.typography.body.lineHeight],
        caption: [
          brand.typography.caption.size,
          brand.typography.caption.lineHeight,
        ],
        small: [brand.typography.small.size, brand.typography.small.lineHeight],
        micro: [brand.typography.micro.size, brand.typography.micro.lineHeight],
      },
    },
  },
  plugins: [],
};

export default config;
