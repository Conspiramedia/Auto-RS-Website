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
// Радиус sm, а не control: на плашке высотой ~24px радиус 12 превращает
// её в капсулу, а нужен прямоугольник со скруглением.
// ============================================================

import type { ReactNode } from 'react';

type Tone = 'promoted' | 'rent' | 'sold' | 'new';

const TONES: Record<Tone, string> = {
  promoted: 'bg-brand-gold text-white',
  rent: 'bg-brand-blue text-white',
  sold: 'bg-brand-red text-white',
  new: 'bg-brand-green text-white',
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
