// ============================================================
// RS AUTO — Бейдж состояния автомобиля (миграция 0138).
// ============================================================
// ПОЧЕМУ ОТДЕЛЬНЫЙ КОМПОНЕНТ, А НЕ НОВЫЙ ТОН В ui/Badge.
// У Badge тона закреплены за ролями бренда (promoted — золотой,
// sold — зелёный) и берутся из четырёх семантических цветов. Состояний
// шесть, и цвета у них свои (см. группу condition в lib/brand.ts):
// пришлось бы завести пять тонов, которыми не пользуется никто, кроме
// этого бейджа, и правило «тон = роль в бренде» перестало бы
// выполняться. Отдельный компонент с собственной шкалой честнее.
//
// Каркас — тот же, что у Badge: rounded-sm, font-semibold, те же две
// ступени размера. Бейджи стоят в одном ряду с availability
// (см. CarCard) и обязаны выглядеть роднёй, а не двумя разными
// плашками.
//
// ЗНАЧОК ОБЯЗАТЕЛЕН. Бейджей в ряду бывает два, и различать их только
// по цвету нельзя: цвет — не единственный носитель смысла (WCAG 1.4.1),
// а на узкой карточке подпись ужимается сильнее значка.
//
// 'normal' бейджа не получает — компонент возвращает null. Это
// состояние по умолчанию у подавляющего большинства объявлений, и
// плашка о нём была бы шумом в каждой карточке.
// ============================================================

import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { DictKey } from '@/lib/i18n';
import { conditionStyle } from '@/lib/types';
import type { CarCondition } from '@/lib/types';
import { ConditionIcon } from './ConditionIcons';

type Size = 'xs' | 'sm' | 'md';

// Размеры повторяют Badge: xs — поверх фотографии в плитке каталога,
// sm — рядом с текстом, md — ключевой факт на странице объявления.
const SIZES: Record<Size, string> = {
  xs: 'gap-1 px-1.5 py-0.5 text-micro',
  sm: 'gap-1 px-2 py-1 text-small',
  md: 'gap-1.5 px-3 py-1 text-caption',
};

// Значок кегля подписи: на xs плашка узкая, и значок 16px съел бы
// половину карточки.
const ICON_SIZES: Record<Size, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
};

type Props = {
  locale: Locale;
  condition: CarCondition | string | null | undefined;
  size?: Size;
  className?: string;
  // Круг со значком без подписи — для плитки каталога.
  //
  // ЗАЧЕМ ОТДЕЛЬНЫЙ ВИД. На карточке 360px фотография выходит ~156px,
  // и полный бейдж «Битый / повреждённый» занимал заметную её часть.
  // В углу кадра значок работает как пометка, которую видно при
  // беглом просмотре ленты, а подробности человек читает уже на
  // странице объявления, где бейдж стоит с подписью у цены.
  //
  // Подпись при этом не пропадает: она уходит в aria-label и title,
  // то есть остаётся у скринридера и по наведению курсора.
  iconOnly?: boolean;
};

export default function ConditionBadge({
  locale,
  condition,
  size = 'sm',
  className = '',
  iconOnly = false,
}: Props) {
  // Неизвестное значение и 'normal' дают null — не рисуем ничего.
  // Мусор в поле возможен только в обход формы, и падать из-за него
  // карточка не должна.
  const style = conditionStyle(condition);
  if (!style) return null;

  const t = getT(locale);
  // Ключ подписи собирается по имени состояния. Набор ключей закрыт
  // (condition_damaged … condition_for_export), и conditionStyle выше
  // уже отсеял всё, чего в нём нет.
  const label = t(`condition_${condition}` as DictKey);

  // КРУГ ТОЛЬКО СО ЗНАЧКОМ. Геометрия повторяет метку «просмотрено»
  // (ViewedBadge): те же 24px и rounded-pill — в углу фотографии они
  // стоят рядом, и разный размер или скругление сразу выдали бы, что
  // элементы рисовались порознь.
  //
  // role="img" с aria-label: текста внутри нет, и без подписи пометка
  // осталась бы доступна только зрячим. title даёт её же по
  // наведению — значок молотка сам по себе не объясняет, битая машина
  // или разбирается на детали.
  if (iconOnly) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-pill ${style.badge} ${className}`}
      >
        <ConditionIcon
          condition={condition as CarCondition}
          className="h-3.5 w-3.5"
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-sm font-semibold ${SIZES[size]} ${style.badge} ${className}`}
    >
      <ConditionIcon
        condition={condition as CarCondition}
        className={`${ICON_SIZES[size]} shrink-0`}
      />
      {label}
    </span>
  );
}
