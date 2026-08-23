// ============================================================
// RS AUTO — Генератор подсказок для строки поиска каталога.
// ============================================================
// ЗАЧЕМ: строка поиска показывает вращающиеся фразы-подсказки
// («Volkswagen Golf», «Audi do 16.000 €»), собранные из РЕАЛЬНЫХ
// данных каталога. Подсказка, ведущая в пустую выдачу, хуже её
// отсутствия — человек решает, что поиск сломан.
//
// ТОЛЬКО ФРАЗЫ С МАРКОЙ. Голое топливо — «Бензин», «Дизель», «Газ» —
// из подсказок исключено. Такая фраза не подсказывает: она не сужает
// поиск до чего-то обозримого (дизелей в каталоге половина) и не
// отвечает на вопрос «что тут есть», ради которого строку и читают.
// Марка в подсказке делает обе эти работы сразу.
//
// Строки kind = 'fuel' RPC по-прежнему отдаёт — генератор их просто
// не читает. Миграция 0073 не переделывается: лишняя ветка в SQL
// стоит дешевле новой миграции ради удаления трёх строк выборки, а
// вид пригодится, если топливо вернут отдельным элементом фильтра.
//
// ЧТО ДЕЛАЕТ:
//   1. вызывает RPC get_suggestion_seeds (миграция 0073) — она отдаёт
//      сырые комбинации со счётчиками, но не готовые фразы;
//   2. склеивает из них текст на ОБОИХ языках и подбирает фильтры,
//      которые применятся по клику;
//   3. перемешивает виды так, чтобы в списке не шли подряд однотипные;
//   4. записывает lib/searchSuggestions.ts.
//
// ПОЧЕМУ НА СБОРКЕ, А НЕ В РАНТАЙМЕ. Страницы каталога кэшируются
// (revalidate = 120), поэтому запрос в рантайме всё равно замёрз бы в
// кэше вместе со страницей: свежести не дал бы, а нагрузку на базу дал
// бы на каждом холодном рендере. Плюс меняющийся между рендерами
// список ломал бы SSR — сервер и клиент разошлись бы в разметке.
// Фразы «Volkswagen Golf» устаревают месяцами, а не минутами.
//
// ПОЧЕМУ РЕЗУЛЬТАТ ЛЕЖИТ В GIT. Сборка не должна зависеть от того,
// доступна ли база в момент деплоя. Нет сети или упала RPC — скрипт
// оставляет прежний файл нетронутым и выходит с кодом 0, сборка идёт
// дальше со списком из предыдущего запуска.
//
// ПОЧЕМУ АНОНИМНЫЙ КЛЮЧ, А НЕ SERVICE_ROLE. Функция гранчена anon и
// отдаёт агрегаты по объявлениям, которые каталог и так показывает
// поимённо. Service_role в окружении сборки означал бы полный доступ к
// базе ради публичной по сути выборки.
//
// ЗАПУСК:
//   node scripts/generate-suggestions.mjs
//   node scripts/generate-suggestions.mjs --dry-run   (без записи)
//
// Вызывается автоматически из npm-скрипта prebuild перед next build.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Сколько фраз держим в файле. Больше — ротация становится незаметной
// (человек всё равно видит несколько за визит), меньше — подсказки
// начинают повторяться в одну сессию.
const TARGET_COUNT = 50;

// Пороги по видам заготовок. У каждого вида свой, потому что виды
// по-разному устойчивы к продаже отдельной машины: пара «марка+цена»
// переживает больше, чем конкретная «марка+модель», которая может
// уйти вся. Подробнее — в шапке миграции 0073.
const MIN_BRAND_MODEL = 1;
const MIN_BRAND = 2;

// Порог топлива — обязательный параметр сигнатуры RPC, хотя сами
// строки fuel мы больше не читаем. Значение намеренно недостижимо
// высокое: так база не тратит проход по объявлениям на выборку,
// которая всё равно будет отброшена.
const MIN_FUEL = 1000000;

// Сколько строк каждого вида запрашиваем у базы. С запасом к
// TARGET_COUNT: часть заготовок отсеется на валидации.
const LIMIT_PER_KIND = 60;

const DRY_RUN = process.argv.includes('--dry-run');

// Предлог «до» в подсказке цены. Отдельной константой, а не в шаблоне:
// это единственное слово интерфейса, которое генератор вставляет сам.
const UP_TO = { sr: 'do', ru: 'до' };

// Локали Intl — те же, что в lib/format.ts.
const INTL_LOCALE = { sr: 'sr-Latn-RS', ru: 'ru-RU' };

// ------------------------------------------------------------
// Загрузка .env.local. Своим парсером, а не зависимостью dotenv:
// файл простой, а лишний пакет ради трёх строк не нужен.
// Тот же приём, что в scripts/seed-demo-photos.mjs.
// ------------------------------------------------------------
function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Значение может быть в кавычках — снимаем их.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // Файла нет — на Vercel переменные приходят из окружения процесса.
  }
  return env;
}

// Цена в подписи: «16.000 €» на сербском, «16 000 €» на русском.
// Формат тот же, что у formatPrice в lib/format.ts, — подсказка не
// должна отличаться от цены, которую человек увидит на карточке.
function formatMoney(value, locale) {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

// ------------------------------------------------------------
// Заготовка → подсказка. Возвращает null, если строка не годится:
// пустые поля, незнакомое топливо, неположительная цена.
// ------------------------------------------------------------
// filters здесь — ключи CatalogFilters (lib/queries.ts). Подсказка
// несёт ГОТОВЫЕ фильтры, а не строку для парсинга: клик применяет их
// через существующий buildQuery, свободный текст в q не попадает.
function toSuggestion(row) {
  const brand = (row.brand ?? '').trim();
  const model = (row.model ?? '').trim();

  if (row.kind === 'brand_model') {
    if (!brand || !model) return null;
    const text = `${brand} ${model}`;
    return {
      // Марка и модель — имена собственные, они одинаковы на обоих
      // языках. Переводить «Golf» незачем и вредно: в объявлениях
      // написано именно так.
      text: { sr: text, ru: text },
      filters: { brand, model },
    };
  }

  if (row.kind === 'brand_price') {
    const price = Number(row.price_bucket);
    if (!brand || !Number.isFinite(price) || price <= 0) return null;
    return {
      text: {
        sr: `${brand} ${UP_TO.sr} ${formatMoney(price, 'sr')}`,
        ru: `${brand} ${UP_TO.ru} ${formatMoney(price, 'ru')}`,
      },
      filters: { brand, priceTo: price },
    };
  }

  // kind = 'fuel' отбрасывается БЕЗ предупреждения: это не сбой
  // данных, а сознательный отказ от вида (см. шапку файла). Warn на
  // каждой такой строке засорял бы вывод сборки ровно тем, что
  // работает как задумано.
  if (row.kind === 'fuel') return null;

  console.warn(`  · пропущен неизвестный kind «${row.kind}»`);
  return null;
}

// ------------------------------------------------------------
// Перемешивание видов «по кругу».
// ------------------------------------------------------------
// Простая сортировка по популярности выстроила бы сначала все пары
// «марка+модель», потом все цены, потом топливо — и первые показы
// подсказок оказались бы однотипными. Берём по одной штуке из каждого
// вида по очереди: список получается разнообразным с самого начала,
// а внутри вида порядок остаётся по популярности.
function interleave(groups) {
  const out = [];
  // Работаем с КОПИЯМИ: shift() опустошил бы исходные массивы, а по ним
  // выше считается статистика «по видам» для шапки файла — она молча
  // превратилась бы в нули.
  const queues = groups.filter((g) => g.length > 0).map((g) => [...g]);
  let index = 0;

  while (queues.some((q) => q.length > 0)) {
    const queue = queues[index % queues.length];
    if (queue.length > 0) out.push(queue.shift());
    index += 1;
  }

  return out;
}

// ------------------------------------------------------------
// Файл lib/searchSuggestions.ts.
// ------------------------------------------------------------
function renderFile(suggestions, meta) {
  const items = suggestions
    .map((s) => {
      const filters = JSON.stringify(s.filters);
      return (
        '  {\n' +
        `    text: { sr: ${JSON.stringify(s.text.sr)}, ru: ${JSON.stringify(s.text.ru)} },\n` +
        `    filters: ${filters},\n` +
        '  },'
      );
    })
    .join('\n');

  return `// ============================================================
// RS AUTO — Подсказки для строки поиска каталога.
// ============================================================
// ФАЙЛ СГЕНЕРИРОВАН. Не правьте его руками: следующая сборка перезапишет
// изменения. Источник — scripts/generate-suggestions.mjs, который берёт
// данные из RPC get_suggestion_seeds (миграция 0073).
//
// Обновление: node scripts/generate-suggestions.mjs
// Автоматически — из npm-скрипта prebuild перед next build.
//
// Сгенерировано: ${meta.generatedAt}
// Заготовок из базы: ${meta.seedCount}, фраз в файле: ${suggestions.length}
// По видам: ${meta.byKind}
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
${items}
];
`;
}

// ------------------------------------------------------------
// Основной ход.
// ------------------------------------------------------------
async function main() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const outPath = resolve(process.cwd(), 'lib/searchSuggestions.ts');

  if (!url || !key) {
    // Без ключей молча оставляем прежний файл: это нормальная ситуация
    // в окружении, где переменные не заданы (форк, CI без секретов).
    console.warn(
      '[suggestions] NEXT_PUBLIC_SUPABASE_URL / ANON_KEY не заданы — ' +
        'оставляю прежний lib/searchSuggestions.ts',
    );
    return;
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc('get_suggestion_seeds', {
    p_min_brand_model: MIN_BRAND_MODEL,
    p_min_brand: MIN_BRAND,
    p_min_fuel: MIN_FUEL,
    p_limit_per_kind: LIMIT_PER_KIND,
  });

  if (error) {
    // Ошибка RPC не должна ронять сборку: прежний список остаётся в
    // силе. Выходим с кодом 0 намеренно.
    console.warn(
      `[suggestions] RPC get_suggestion_seeds недоступна (${error.message}) — ` +
        'оставляю прежний lib/searchSuggestions.ts',
    );
    return;
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    console.warn(
      '[suggestions] база вернула ноль заготовок — оставляю прежний файл',
    );
    return;
  }

  // Раскладываем по видам, сохраняя порядок по популярности, который
  // задала сама RPC (order by count desc). Вид fuel в разбор не
  // попадает вовсе: toSuggestion вернёт по нему null.
  const byKind = { brand_model: [], brand_price: [] };
  for (const row of rows) {
    const suggestion = toSuggestion(row);
    if (suggestion && byKind[row.kind]) byKind[row.kind].push(suggestion);
  }

  // Цены первыми в круге: их заметно меньше, чем пар «марка+модель»,
  // и без приоритета они собрались бы в хвосте списка, куда ротация
  // за визит не доходит.
  const merged = interleave([byKind.brand_price, byKind.brand_model]).slice(
    0,
    TARGET_COUNT,
  );

  if (merged.length === 0) {
    console.warn(
      '[suggestions] ни одна заготовка не прошла валидацию — ' +
        'оставляю прежний файл',
    );
    return;
  }

  const meta = {
    generatedAt: new Date().toISOString().slice(0, 10),
    seedCount: rows.length,
    byKind: Object.entries(byKind)
      .map(([k, v]) => `${k}=${v.length}`)
      .join(', '),
  };

  const content = renderFile(merged, meta);

  console.log(
    `[suggestions] заготовок из базы: ${rows.length}, ` +
      `фраз собрано: ${merged.length} (${meta.byKind})`,
  );

  if (merged.length < TARGET_COUNT) {
    // Не ошибка: на молодом каталоге комбинаций объективно меньше.
    // Но знать об этом полезно — список наполнится сам по мере роста.
    console.log(
      `[suggestions] это меньше цели в ${TARGET_COUNT} — ` +
        'каталог пока невелик, список дополнится с ростом объявлений',
    );
  }

  console.log('[suggestions] примеры:');
  for (const s of merged.slice(0, 5)) {
    console.log(`  · ${s.text.sr}  |  ${s.text.ru}`);
  }

  if (DRY_RUN) {
    console.log('[suggestions] --dry-run: файл не записан');
    return;
  }

  writeFileSync(outPath, content, 'utf8');
  console.log(`[suggestions] записан ${outPath}`);
}

main().catch((e) => {
  // Любая неожиданная ошибка тоже не роняет сборку: подсказки —
  // украшение поиска, а не его условие.
  console.warn(`[suggestions] неожиданная ошибка: ${e?.message ?? e}`);
});
