// ============================================================
// RS AUTO — Подсказки для строки поиска каталога.
// ============================================================
// ФАЙЛ СГЕНЕРИРОВАН. Не правьте его руками: следующая сборка перезапишет
// изменения. Источник — scripts/generate-suggestions.mjs, который берёт
// данные из RPC get_suggestion_seeds (миграция 0073).
//
// Обновление: node scripts/generate-suggestions.mjs
// Автоматически — из npm-скрипта prebuild перед next build.
//
// Сгенерировано: 2026-08-30
// Заготовок из базы: 38, фраз в файле: 38
// По видам: brand_model=29, brand_price=9
//
// В списке ТОЛЬКО фразы с маркой авто: «марка+модель» и «марка+цена».
// Голое топливо («Бензин», «Дизель») исключено — такая подсказка не
// сужает поиск и не отвечает на вопрос «что тут есть».
//
// ПОЧЕМУ ФАЙЛ ЛЕЖИТ В GIT. Сборка не должна зависеть от доступности
// базы в момент деплоя: если RPC недоступна, генератор оставляет этот
// файл нетронутым и сборка идёт со списком из прошлого запуска.
// ============================================================

import type { CatalogFilters } from './queries';

export type SearchSuggestion = {
  // Текст подсказки на обоих языках. Марка и модель — имена
  // собственные и совпадают, различается только слово «до» в
  // подсказках цены.
  text: { sr: string; ru: string };
  // Фильтры, которые применяются по клику. Готовые значения, а не
  // строка для разбора: клик уходит в существующий buildQuery, и
  // свободный текст в q не попадает.
  filters: Partial<CatalogFilters>;
};

export const SEARCH_SUGGESTIONS: SearchSuggestion[] = [
  {
    text: { sr: "Volkswagen do 9.000 €", ru: "Volkswagen до 9 000 €" },
    filters: {"brand":"Volkswagen","priceTo":9000},
  },
  {
    text: { sr: "Audi A3", ru: "Audi A3" },
    filters: {"brand":"Audi","model":"A3"},
  },
  {
    text: { sr: "Audi do 17.000 €", ru: "Audi до 17 000 €" },
    filters: {"brand":"Audi","priceTo":17000},
  },
  {
    text: { sr: "Volkswagen Golf", ru: "Volkswagen Golf" },
    filters: {"brand":"Volkswagen","model":"Golf"},
  },
  {
    text: { sr: "BMW do 3.000 €", ru: "BMW до 3 000 €" },
    filters: {"brand":"BMW","priceTo":3000},
  },
  {
    text: { sr: "Volkswagen Passat", ru: "Volkswagen Passat" },
    filters: {"brand":"Volkswagen","model":"Passat"},
  },
  {
    text: { sr: "Ford do 15.000 €", ru: "Ford до 15 000 €" },
    filters: {"brand":"Ford","priceTo":15000},
  },
  {
    text: { sr: "Alfa Romeo Junior", ru: "Alfa Romeo Junior" },
    filters: {"brand":"Alfa Romeo","model":"Junior"},
  },
  {
    text: { sr: "Mercedes-Benz do 4.500 €", ru: "Mercedes-Benz до 4 500 €" },
    filters: {"brand":"Mercedes-Benz","priceTo":4500},
  },
  {
    text: { sr: "Aston Martin DB12", ru: "Aston Martin DB12" },
    filters: {"brand":"Aston Martin","model":"DB12"},
  },
  {
    text: { sr: "Opel do 6.500 €", ru: "Opel до 6 500 €" },
    filters: {"brand":"Opel","priceTo":6500},
  },
  {
    text: { sr: "Audi A4", ru: "Audi A4" },
    filters: {"brand":"Audi","model":"A4"},
  },
  {
    text: { sr: "Peugeot do 11.500 €", ru: "Peugeot до 11 500 €" },
    filters: {"brand":"Peugeot","priceTo":11500},
  },
  {
    text: { sr: "BMW Serija 3", ru: "BMW Serija 3" },
    filters: {"brand":"BMW","model":"Serija 3"},
  },
  {
    text: { sr: "Renault do 8.000 €", ru: "Renault до 8 000 €" },
    filters: {"brand":"Renault","priceTo":8000},
  },
  {
    text: { sr: "BMW X5", ru: "BMW X5" },
    filters: {"brand":"BMW","model":"X5"},
  },
  {
    text: { sr: "Škoda do 10.500 €", ru: "Škoda до 10 500 €" },
    filters: {"brand":"Škoda","priceTo":10500},
  },
  {
    text: { sr: "Citroën C4", ru: "Citroën C4" },
    filters: {"brand":"Citroën","model":"C4"},
  },
  {
    text: { sr: "Dacia Duster", ru: "Dacia Duster" },
    filters: {"brand":"Dacia","model":"Duster"},
  },
  {
    text: { sr: "Fiat Punto", ru: "Fiat Punto" },
    filters: {"brand":"Fiat","model":"Punto"},
  },
  {
    text: { sr: "Ford Fiesta", ru: "Ford Fiesta" },
    filters: {"brand":"Ford","model":"Fiesta"},
  },
  {
    text: { sr: "Ford Focus", ru: "Ford Focus" },
    filters: {"brand":"Ford","model":"Focus"},
  },
  {
    text: { sr: "Hyundai i30", ru: "Hyundai i30" },
    filters: {"brand":"Hyundai","model":"i30"},
  },
  {
    text: { sr: "Kia Ceed", ru: "Kia Ceed" },
    filters: {"brand":"Kia","model":"Ceed"},
  },
  {
    text: { sr: "Mercedes-Benz C klasa", ru: "Mercedes-Benz C klasa" },
    filters: {"brand":"Mercedes-Benz","model":"C klasa"},
  },
  {
    text: { sr: "Mercedes-Benz E klasa", ru: "Mercedes-Benz E klasa" },
    filters: {"brand":"Mercedes-Benz","model":"E klasa"},
  },
  {
    text: { sr: "Nissan Qashqai", ru: "Nissan Qashqai" },
    filters: {"brand":"Nissan","model":"Qashqai"},
  },
  {
    text: { sr: "Opel Astra", ru: "Opel Astra" },
    filters: {"brand":"Opel","model":"Astra"},
  },
  {
    text: { sr: "Opel Corsa", ru: "Opel Corsa" },
    filters: {"brand":"Opel","model":"Corsa"},
  },
  {
    text: { sr: "Peugeot 206", ru: "Peugeot 206" },
    filters: {"brand":"Peugeot","model":"206"},
  },
  {
    text: { sr: "Peugeot 308", ru: "Peugeot 308" },
    filters: {"brand":"Peugeot","model":"308"},
  },
  {
    text: { sr: "Renault Clio", ru: "Renault Clio" },
    filters: {"brand":"Renault","model":"Clio"},
  },
  {
    text: { sr: "Renault Megane", ru: "Renault Megane" },
    filters: {"brand":"Renault","model":"Megane"},
  },
  {
    text: { sr: "Seat Leon", ru: "Seat Leon" },
    filters: {"brand":"Seat","model":"Leon"},
  },
  {
    text: { sr: "Škoda Fabia", ru: "Škoda Fabia" },
    filters: {"brand":"Škoda","model":"Fabia"},
  },
  {
    text: { sr: "Škoda Octavia", ru: "Škoda Octavia" },
    filters: {"brand":"Škoda","model":"Octavia"},
  },
  {
    text: { sr: "Toyota Yaris", ru: "Toyota Yaris" },
    filters: {"brand":"Toyota","model":"Yaris"},
  },
  {
    text: { sr: "Volkswagen Polo", ru: "Volkswagen Polo" },
    filters: {"brand":"Volkswagen","model":"Polo"},
  },
];
