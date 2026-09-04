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
  // ------------------------------------------------------------
  // hover:* ТОЛЬКО ТАМ, ГДЕ КУРСОР ЕСТЬ.
  // ------------------------------------------------------------
  // Без этого флага hover:* — обычный :hover, а на телефоне он
  // ЗАЛИПАЕТ: браузер выставляет состояние по касанию и снимает его
  // лишь после тапа в другом месте. Пролистал ленту — карточки, по
  // которым прошёл палец, остались подсвеченными и с поднятой тенью.
  //
  // Флаг оборачивает каждую hover-утилиту в
  // @media (hover: hover) and (pointer: fine) — правило перестаёт
  // существовать для пальца и работает как прежде для мыши. Разом для
  // всех 77 hover-утилит проекта, что важнее ручной правки: следующий
  // hover:bg-* получит то же поведение сам.
  future: {
    hoverOnlyWhenSupported: true,
  },
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
        // Нейтральная шкала для тёмных подложек: text-on-dark-70.
        'on-dark': brand.onDark,
        // Подложки статусных сообщений: bg-status-error.
        status: brand.statusSurface,
        // Ступени платной метки (ui/VipBadge): bg-vip-surface на
        // капсуле, text-vip-gold на короне и подписи.
        vip: brand.vip,
        // Метрики кабинета (0141): text-metric-views на значке,
        // bg-metric-views-soft на круге под ним. Две группы в одной —
        // имя метрики у них общее и разъезжаться не должно.
        metric: {
          ...brand.metric,
          'listings-soft': brand.metricSurface.listings,
          'views-soft': brand.metricSurface.views,
          'favorites-soft': brand.metricSurface.favorites,
          'contacts-soft': brand.metricSurface.contacts,
        },
        // Выбранное состояние (вкладка, страница пагинации, вариант
        // сортировки, язык, состояние авто): border-selection,
        // bg-selection-surface, text-selection. Один приём на весь
        // сайт — см. brand.selection.
        selection: {
          DEFAULT: brand.selection.border,
          surface: brand.selection.surface,
        },
        // Состояние автомобиля (0138): bg-condition-damaged на бейдже,
        // bg-condition-damaged-soft под пояснительной плашкой.
        // Две группы в одной, потому что имя состояния у них общее и
        // разъезжаться они не должны.
        condition: {
          ...brand.condition,
          'damaged-soft': brand.conditionSurface.damaged,
          'parts-soft': brand.conditionSurface.parts,
          'no_docs-soft': brand.conditionSurface.no_docs,
          'for_export-soft': brand.conditionSurface.for_export,
        },
        // Заливки и состояния наведения.
        surface: brand.surface,
        // Палитра экрана переписки. Отдельная группа, потому что цвет
        // там означает принадлежность реплики, а не роль действия
        // (см. brand.chat). В разметке: bg-chat-surface,
        // bg-chat-bubble-peer, from-chat-accent-from.
        chat: {
          surface: brand.chat.surface,
          input: brand.chat.inputSurface,
          'bubble-peer': brand.chat.bubblePeer,
          // Концы градиента своего пузыря. Меняются на accentGreen
          // ровно здесь — разметка ссылается на имя, а не на цвет.
          'accent-from': brand.chat.accentBlue.from,
          'accent-to': brand.chat.accentBlue.to,
        },
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
        // Радиус пузыря сообщения — своя ступень вне шкалы
        // «контрол/контейнер»: см. brand.chat.bubbleRadius.
        bubble: brand.chat.bubbleRadius,
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
        // Тень своего пузыря: цветная под градиент (см. brand.chat).
        bubble: brand.chat.bubbleShadow,
      },

      maxWidth: {
        // Ширина ленты переписки на десктопе — токен, а не max-w-3xl
        // в разметке: значение подобрано под читаемость строки.
        chat: brand.chat.maxWidth,
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
        // Наведение на карточку каталога (подъём + тень + фото).
        hover: brand.motion.hover,
        // Появление блока при скролле и каскад героя.
        reveal: brand.motion.reveal,
      },

      // ------------------------------------------------------------
      // АНИМАЦИИ ПОЯВЛЕНИЯ И МИКРОИНТЕРАКЦИЙ.
      // ------------------------------------------------------------
      // ВСЕ кадры ниже трогают ТОЛЬКО transform и opacity — свойства,
      // которые браузер считает на композиторе, не пересчитывая
      // раскладку. Поэтому ни один из них не даёт layout shift: CLS
      // остаётся нулевым независимо от того, сколько элементов
      // анимируется одновременно.
      //
      // Исключение по форме, а не по сути — shimmer и road: там
      // двигается background-position, свойство фона. Оно тоже не
      // влияет на геометрию соседей, а перерисовку держит в пределах
      // самого элемента.
      //
      // Отключение при prefers-reduced-motion сделано ОДНИМ правилом
      // в app/globals.css, а не флагом у каждой утилиты: любая новая
      // анимация подпадает под запрет автоматически.
      keyframes: {
        // Появление снизу вверх. Конечное состояние — «как в вёрстке»,
        // поэтому элемент, у которого анимация не запустилась (скрипт
        // отвалился, старый браузер), обязан остаться видимым: это
        // обеспечивает fill-mode both вместе со стартовой прозрачностью
        // в самом keyframe, а не в базовом классе.
        'fade-up': {
          from: {
            opacity: '0',
            transform: `translate3d(0, ${brand.motion.revealShift}, 0)`,
          },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },

        // Перекрёстное затухание страницы при смене маршрута.
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },

        // Блик по метке VIP и по скелетону. Двигается только фон —
        // размеры элемента остаются прежними.
        shimmer: {
          from: { backgroundPosition: '-150% 0' },
          to: { backgroundPosition: '250% 0' },
        },

        // «Дорога» прогресс-бара: пунктир бежит слева направо.
        // Сдвиг ровно на период пунктира (см. .route-road в globals.css),
        // поэтому стык кадров невиден.
        road: {
          from: { backgroundPosition: '0 0' },
          to: { backgroundPosition: '24px 0' },
        },

        // Всплеск у сердечка: сама иконка коротко подрастает и
        // возвращается. Кривая задана раскладкой ключей, а не
        // timing-function, — так контролируется «перелёт» на 70%.
        'heart-pop': {
          '0%': { transform: 'scale(1)' },
          '35%': { transform: 'scale(0.86)' },
          '70%': { transform: 'scale(1.18)' },
          '100%': { transform: 'scale(1)' },
        },

        // Частица всплеска: вылетает из центра и гаснет. Направление
        // задаёт --burst-angle, расстояние — --burst-distance
        // (см. components/FavoriteBurst).
        'heart-particle': {
          '0%': {
            opacity: '1',
            transform:
              'rotate(var(--burst-angle)) translateX(0) scale(0.4)',
          },
          '60%': { opacity: '1' },
          '100%': {
            opacity: '0',
            transform:
              'rotate(var(--burst-angle)) translateX(var(--burst-distance)) scale(0.9)',
          },
        },
      },

      animation: {
        'fade-up': `fade-up ${brand.motion.reveal} ${brand.motion.easing} both`,
        'fade-in': `fade-in ${brand.motion.routeFade} ${brand.motion.easing} both`,
        // Скелетон: медленнее метки, потому что живёт дольше и не
        // должен мельтешить под текстом, который вот-вот появится.
        shimmer: `shimmer ${brand.motion.shimmer} ${brand.motion.easing} infinite`,
        // Раз в 6 секунд — блик, а не мигалка: метка стоит на карточке
        // рядом с десятком других, и частый проблеск читался бы шумом.
        'vip-shimmer': `shimmer ${brand.motion.vipShimmer} ${brand.motion.easing} infinite`,
        // linear обязателен: любое замедление на концах превратило бы
        // равномерное движение дороги в пульсацию.
        road: `road ${brand.motion.road} linear infinite`,
        'heart-pop': `heart-pop ${brand.motion.reveal} ${brand.motion.easing} both`,
        'heart-particle': `heart-particle ${brand.motion.reveal} ${brand.motion.easing} both`,
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
        hero: [brand.typography.hero.size, brand.typography.hero.lineHeight],
        display: [
          brand.typography.display.size,
          brand.typography.display.lineHeight,
        ],
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
