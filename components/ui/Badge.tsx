// ============================================================
// RS AUTO — Бейдж состояния объявления.
// ============================================================
// Небольшая плашка поверх фотографии или рядом с заголовком. Роли
// закреплены за цветами и менять их произвольно нельзя — пользователь
// узнаёт статус по цвету раньше, чем читает слово:
//   promoted — золотой, продвигаемое объявление (VIP);
//   rent     — синий, аренда в смешанном фиде;
//   sold     — красный, продано;
//   new      — зелёный, зарезервирован под «новое поступление».
//
// СТАТУСЫ ОБЪЯВЛЕНИЯ В КАБИНЕТЕ (компонент StatusBadge) используют
// семантические тона ниже. Они названы по РОЛИ, а не по цвету, и
// повторяют _StatusChip приложения (my_cars_screen.dart) один в один:
//   warning — на проверке;
//   success — опубликовано;
//   error   — отклонено;
//   dark    — продано;
//   neutral — в архиве.
// Тон 'sold' (красный) к статусу «продано» отношения не имеет: он для
// плашки поверх фотографии в каталоге, где красный читается как стоп-
// сигнал «уже не купить». В списке владельца та же машина — законченная
// сделка, а не проблема, поэтому там нейтральный тёмный.
//
// Радиус sm, а не control: на плашке высотой ~24px радиус 12 превращает
// её в капсулу, а нужен прямоугольник со скруглением.
// ============================================================

import type { ReactNode } from 'react';

type Tone =
  | 'promoted'
  | 'rent'
  | 'sold'
  | 'new'
  | 'warning'
  | 'success'
  | 'error'
  | 'dark'
  | 'neutral';

const TONES: Record<Tone, string> = {
  promoted: 'bg-brand-gold text-white',
  rent: 'bg-brand-blue text-white',
  sold: 'bg-brand-red text-white',
  new: 'bg-brand-green text-white',
  // Статусы объявления в кабинете.
  warning: 'bg-warning text-white',
  success: 'bg-success text-white',
  error: 'bg-error text-white',
  dark: 'bg-brand-dark text-white',
  // Архив — единственный тон без заливки: архивное объявление не
  // требует внимания, и цветная плашка тянула бы взгляд туда, где
  // ничего делать не нужно.
  neutral: 'bg-surface-muted text-neutral-60',
};

type Props = {
  tone: Tone;
  children: ReactNode;
  className?: string;
};

export default function Badge({ tone, children, className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-1 text-small font-semibold ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
