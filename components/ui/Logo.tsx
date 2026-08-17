// ============================================================
// RS AUTO — Логотип. ЕДИНСТВЕННОЕ место сборки знака.
// ============================================================
// Векторного логотипа у проекта пока НЕТ. Раньше знак собирался
// текстом в двух местах независимо — в шапке (название брендовым
// цветом) и в смарт-баннере (буквы «RS» в квадрате). Из-за этого
// подключение настоящего SVG означало бы правку в двух файлах,
// причём одно из них легко было бы забыть.
//
// КАК ПОДКЛЮЧИТЬ НАСТОЯЩИЙ ЛОГОТИП, когда дизайнер отдаст файл:
//   1. положить его в public/logo.svg;
//   2. в этом компоненте заменить текстовую разметку на
//      <Image src="/logo.svg" alt={brand.name} width={…} height={…} />
//      (next/image, priority — знак в шапке виден сразу);
//   3. больше НИЧЕГО не трогать: и шапка, и баннер получат его сами.
//
// Вариант mark — квадратный знак («RS») для тесных мест: смарт-баннер,
// аватар-заглушка. Вариант full — название целиком.
// ============================================================

import { brand } from '@/lib/brand';

type Props = {
  // full — название целиком (шапка, подвал);
  // mark — квадратный знак (смарт-баннер).
  variant?: 'full' | 'mark';
  // Инвертированный знак для тёмного фона (баннер, тёмная плашка).
  inverted?: boolean;
  className?: string;
};

export default function Logo({
  variant = 'full',
  inverted = false,
  className = '',
}: Props) {
  if (variant === 'mark') {
    return (
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-caption font-bold text-white ${className}`}
        style={{ background: brand.colors.primary }}
        aria-hidden="true"
      >
        RS
      </div>
    );
  }

  return (
    <span
      className={`shrink-0 font-bold ${className}`}
      // На тёмном фоне брендовый синий читается плохо, поэтому там
      // знак белый. Цвет берётся из токенов, а не из класса Tailwind:
      // при замене на SVG эта ветка уйдёт целиком.
      style={{ color: inverted ? '#FFFFFF' : brand.colors.primary }}
    >
      {brand.name}
    </span>
  );
}
