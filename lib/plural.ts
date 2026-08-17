// ============================================================
// RS AUTO — Склонение существительных при числах.
// ============================================================
// «11 город» и «29 автомобили» — это не мелочь: на главной такие
// подписи стоят рядом с крупными цифрами и сразу выдают машинный текст.
//
// Русский и сербский относятся к одной славянской группе и используют
// ОДНО правило множественного числа (CLDR-категории one / few / many):
//   one  — 1, 21, 31, 101…       но НЕ 11
//   few  — 2-4, 22-24, 32-34…    но НЕ 12-14
//   many — 0, 5-20, 25-30, 11-14…
//
// Исключение 11-14 — то самое место, где ошибся исходный текст:
// 11 оканчивается на 1, но берёт форму «городов», а не «город».
//
// Intl.PluralRules даёт те же категории из данных CLDR, но собственная
// реализация здесь надёжнее: она не зависит от того, какие локали
// собраны в среде выполнения (на Vercel набор ICU может отличаться от
// локального Node), и её поведение видно прямо в коде.
// ============================================================

import type { Locale } from './i18n';

type PluralForms = {
  // 1 автомобиль / 1 automobil
  one: string;
  // 2 автомобиля / 2 automobila
  few: string;
  // 5 автомобилей / 5 automobila
  many: string;
};

// Категория по числу. Правило общее для ru и sr-Latn.
function pluralCategory(n: number): keyof PluralForms {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  // 11-14 всегда «many», несмотря на последнюю цифру.
  if (mod100 >= 11 && mod100 <= 14) return 'many';
  if (mod10 === 1) return 'one';
  if (mod10 >= 2 && mod10 <= 4) return 'few';
  return 'many';
}

// Выбор формы слова без самого числа.
export function pluralize(n: number, forms: PluralForms): string {
  return forms[pluralCategory(n)];
}

// Число вместе с нужной формой: «11 городов».
export function withPlural(n: number, forms: PluralForms): string {
  return `${n} ${pluralize(n, forms)}`;
}

// ------------------------------------------------------------
// Словари форм для существительных, которые встречаются с числами.
// ------------------------------------------------------------
// Сербские формы: automobil / automobila / automobila,
// grad / grada / gradova, marka / marke / marki, oglas / oglasa / oglasa.
const NOUNS = {
  car: {
    sr: { one: 'automobil', few: 'automobila', many: 'automobila' },
    ru: { one: 'автомобиль', few: 'автомобиля', many: 'автомобилей' },
  },
  brand: {
    sr: { one: 'marka', few: 'marke', many: 'marki' },
    ru: { one: 'марка', few: 'марки', many: 'марок' },
  },
  city: {
    sr: { one: 'grad', few: 'grada', many: 'gradova' },
    ru: { one: 'город', few: 'города', many: 'городов' },
  },
  listing: {
    sr: { one: 'oglas', few: 'oglasa', many: 'oglasa' },
    ru: { one: 'объявление', few: 'объявления', many: 'объявлений' },
  },
} as const;

export type NounKey = keyof typeof NOUNS;

// «29 автомобилей», «11 городов», «17 марок».
export function countNoun(
  n: number,
  noun: NounKey,
  locale: Locale,
): string {
  return withPlural(n, NOUNS[noun][locale]);
}

// Только слово, без числа — когда число выводится отдельным элементом
// (например, крупным шрифтом в блоке статистики).
export function nounFor(n: number, noun: NounKey, locale: Locale): string {
  return pluralize(n, NOUNS[noun][locale]);
}
