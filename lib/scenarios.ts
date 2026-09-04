// ============================================================
// RS AUTO — Сценарии работы с площадкой (шаги по ролям).
// ============================================================
// Вынесены из HowItWorksPageView, потому что используются ДВАЖДЫ:
// на /how-it-works (все четыре сценария) и на /sell (сценарий
// продавца — видимый список шагов над формой и разметка HowTo).
//
// Второй копии массива заводить нельзя: Google требует, чтобы шаги в
// разметке HowTo совпадали с видимым на странице текстом, и две копии
// разошлись бы при первой же правке формулировок — разметка /sell
// начала бы обещать не то, что написано на самой странице.
// ============================================================

import type { DictKey } from './i18n';

export type Scenario = {
  title: DictKey;
  steps: { title: DictKey; text: DictKey }[];
  // Действие в конце сценария: куда ведём человека дальше.
  ctaLabel: DictKey;
  ctaPath: string;
  // Акцентная кнопка только у сценария продавца: подача объявления —
  // главная бизнес-цель сайта, и второго яркого CTA на экране быть
  // не должно (правило бренда).
  ctaPrimary?: boolean;
};

export const SCENARIOS: Scenario[] = [
  {
    title: 'how_buyer_title',
    steps: [
      { title: 'how_buyer_1_title', text: 'how_buyer_1_text' },
      { title: 'how_buyer_2_title', text: 'how_buyer_2_text' },
      { title: 'how_buyer_3_title', text: 'how_buyer_3_text' },
    ],
    ctaLabel: 'home_all_cars',
    ctaPath: '/cars',
  },
  {
    title: 'how_seller_title',
    steps: [
      { title: 'how_seller_1_title', text: 'how_seller_1_text' },
      { title: 'how_seller_2_title', text: 'how_seller_2_text' },
      { title: 'how_seller_3_title', text: 'how_seller_3_text' },
    ],
    ctaLabel: 'home_hero_cta',
    ctaPath: '/sell',
    ctaPrimary: true,
  },
  // Аренда идёт ПОСЛЕ продажи: подача та же формой, отличается только
  // переключателем типа на первом шаге, — и человеку, прочитавшему
  // сценарий продавца, здесь остаётся понять одну разницу, а не
  // разбирать процесс заново.
  {
    title: 'how_rent_title',
    steps: [
      { title: 'how_rent_1_title', text: 'how_rent_1_text' },
      { title: 'how_rent_2_title', text: 'how_rent_2_text' },
      { title: 'how_rent_3_title', text: 'how_rent_3_text' },
    ],
    ctaLabel: 'how_rent_cta',
    ctaPath: '/sell',
  },
  {
    title: 'how_dealer_title',
    steps: [
      { title: 'how_dealer_1_title', text: 'how_dealer_1_text' },
      { title: 'how_dealer_2_title', text: 'how_dealer_2_text' },
      { title: 'how_dealer_3_title', text: 'how_dealer_3_text' },
    ],
    ctaLabel: 'dealers_cta',
    ctaPath: '/dealers',
  },
];

// Сценарий подачи объявления. Отдельный экспорт, потому что нужен
// обеим страницам по одному и тому же признаку — и повторять поиск по
// ctaPath в двух местах значило бы дать им разойтись.
//
// Найден он всегда (в массиве выше он есть), но тип остаётся
// необязательным: молча отдать пустую разметку лучше, чем уронить
// страницу подачи, если сценарий однажды переименуют.
export const SELLER_SCENARIO: Scenario | undefined = SCENARIOS.find(
  (s) => s.ctaPath === '/sell' && s.ctaPrimary === true,
);
