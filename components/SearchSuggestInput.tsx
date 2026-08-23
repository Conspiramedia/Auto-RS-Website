'use client';

// ============================================================
// RS AUTO — Поле поиска с вращающимися подсказками. Client Component.
// ============================================================
// Поле свободного ввода в панели фильтров плюс ряд кликабельных
// подсказок под ним. Фразы берутся из lib/searchSuggestions.ts —
// файла, который собирается на сборке из живых данных каталога
// (scripts/generate-suggestions.mjs, RPC get_suggestion_seeds).
//
// ЗАЧЕМ ВРАЩАЮЩИЙСЯ ПЛЕЙСХОЛДЕР. Пустое поле «Поиск» не сообщает,
// ЧТО в него можно написать. Живая фраза из каталога отвечает на это
// без единого слова инструкции и заодно показывает, что на площадке
// действительно есть машины.
//
// ПОЧЕМУ КЛИЕНТСКИЙ КОМПОНЕНТ. Ротация — таймер и случайный выбор,
// то есть состояние, которого у сервера быть не может.
//
// ------------------------------------------------------------
// SSR И ГИДРАТАЦИЯ — главное ограничение этого компонента.
// ------------------------------------------------------------
// Сервер обязан отрисовать НЕЙТРАЛЬНЫЙ плейсхолдер («Марка, модель или
// город»), а не случайную фразу: случайное значение на сервере и на
// клиенте не совпадёт, и React сообщит о расхождении разметки. Поэтому
// первая подсказка появляется ТОЛЬКО после гидратации — тот же приём,
// что в components/ViewedBadge.tsx.
//
// ЧИПСЫ по той же причине рендерятся лишь на клиенте: их состав
// меняется вместе с ротацией.
//
// ------------------------------------------------------------
// ПУСТОЙ СПИСОК ПОДСКАЗОК — ШТАТНОЕ СОСТОЯНИЕ, А НЕ ОШИБКА.
// ------------------------------------------------------------
// После чистки демо-данных (docs/cleanup_demo.sql, пункт 5 RELEASE.md)
// каталог какое-то время будет почти пуст, и генератор соберёт мало
// фраз или ни одной. Компонент обязан вести себя так, будто подсказок
// и не задумывалось: статичный нейтральный плейсхолдер, никаких чипсов,
// никаких таймеров. Проверка стоит до всех эффектов.
// ============================================================

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { buildQuery } from '@/lib/searchParams';
import { SEARCH_SUGGESTIONS } from '@/lib/searchSuggestions';
import type { SearchSuggestion } from '@/lib/searchSuggestions';
import { fieldClassCompact } from './ui/Field';

// Как часто меняется подсказка. 5 секунд — компромисс: реже фраза не
// успевает смениться за время, пока человек смотрит на форму, чаще —
// мелькание, которое мешает читать собственный ввод.
const ROTATE_MS = 5000;

// Сколько чипсов показываем. Три помещаются в строку на 360px при
// коротких фразах и переносятся максимум на две строки при длинных.
const CHIP_COUNT = 3;

type Props = {
  locale: Locale;
  // Текущее значение фильтра q: поле остаётся управляемым формой
  // фильтров, как и было до появления подсказок.
  defaultValue?: string;
  // Куда ведут чипсы: '/cars' или '/rent'. Подсказки строятся по
  // объявлениям на продажу, но в разделе аренды клик обязан оставить
  // человека в аренде, а не выбросить в общий каталог.
  basePath?: string;
};

// Случайный индекс, отличный от текущего. Возврат той же фразы читался
// бы как «ротация сломалась»: человек видит неподвижное поле и не
// понимает, живое оно или нет.
function nextIndex(current: number, total: number): number {
  if (total <= 1) return 0;

  let candidate = Math.floor(Math.random() * total);
  // Максимум одна повторная попытка: цикл while здесь не нужен,
  // достаточно сдвинуть индекс на единицу по кругу.
  if (candidate === current) candidate = (candidate + 1) % total;
  return candidate;
}

export default function SearchSuggestInput({
  locale,
  defaultValue = '',
  basePath = '/cars',
}: Props) {
  const t = getT(locale);

  // Есть ли вообще что показывать. Считается один раз на модуле:
  // список статичен и внутри сессии не меняется.
  const total = SEARCH_SUGGESTIONS.length;
  const hasSuggestions = total > 0;

  // Индекс активной подсказки. null — до гидратации И при пустом
  // списке: в обоих случаях показываем нейтральный плейсхолдер.
  const [index, setIndex] = useState<number | null>(null);

  // Собственный ввод пользователя. Как только он непустой, ротация
  // останавливается: подсказка под набранным текстом отвлекает, а
  // плейсхолдер за ним всё равно не виден.
  const [value, setValue] = useState(defaultValue);

  // ------------------------------------------------------------
  // Запуск ротации после гидратации.
  // ------------------------------------------------------------
  useEffect(() => {
    if (!hasSuggestions) return;
    // Поле уже заполнено (человек вернулся к отфильтрованной выдаче) —
    // подсказки не нужны вовсе.
    if (value.trim() !== '') return;

    // Уважение к системной настройке «меньше движения»: показываем
    // одну фразу и не трогаем её больше. Полностью прятать подсказку
    // неправильно — она информативна сама по себе, движение в ней
    // вторично.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    setIndex((current) => (current === null ? nextIndex(-1, total) : current));

    if (reduced) return;

    const timer = window.setInterval(() => {
      setIndex((current) => nextIndex(current ?? -1, total));
    }, ROTATE_MS);

    return () => window.clearInterval(timer);
    // value в зависимостях намеренно: начав печатать, пользователь
    // останавливает таймер, стерев текст — запускает заново.
  }, [hasSuggestions, total, value]);

  const active: SearchSuggestion | null =
    index !== null && hasSuggestions ? SEARCH_SUGGESTIONS[index] : null;

  // Чипсы: активная подсказка и следующие за ней по кругу. Берутся от
  // активного индекса, поэтому ряд меняется вместе с плейсхолдером и
  // человек видит связь между ними.
  const chips: SearchSuggestion[] =
    index === null
      ? []
      : Array.from({ length: Math.min(CHIP_COUNT, total) }, (_, offset) => {
          return SEARCH_SUGGESTIONS[(index + offset) % total];
        });

  return (
    <div>
      <label
        className="mb-1 block text-caption text-neutral-60"
        htmlFor="catalog-q"
      >
        {t('filter_search')}
      </label>

      <input
        id="catalog-q"
        type="text"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        // До гидратации и при пустом списке — нейтральная подпись из
        // словаря. Она же остаётся, когда человек начал печатать.
        placeholder={active ? active.text[locale] : t('filter_search_ph')}
        className={fieldClassCompact}
      />

      {/* Ряд подсказок. Не рендерится вовсе, пока список пуст или
          гидратация не прошла: пустой контейнер сдвигал бы форму. */}
      {chips.length > 0 && value.trim() === '' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((suggestion, i) => (
            <Link
              // Индекс в ключе обязателен: одна и та же фраза может
              // попасть в ряд дважды, когда подсказок меньше трёх.
              key={`${suggestion.text.sr}-${i}`}
              // Клик — ГОТОВЫЕ ФИЛЬТРЫ, а не подстановка текста в поле.
              // Свободный текст в q не попадает: подсказка знает свои
              // brand/model/fuel/priceTo и уходит в тот же buildQuery,
              // которым пользуется вся выдача.
              href={`${localeHref(locale, basePath)}${buildQuery(
                suggestion.filters,
              )}`}
              className="inline-flex items-center whitespace-nowrap rounded-control border border-neutral-15 px-2.5 py-1 text-small text-neutral-60 transition-colors duration-fast ease-out hover:bg-surface-hover"
            >
              {suggestion.text[locale]}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
