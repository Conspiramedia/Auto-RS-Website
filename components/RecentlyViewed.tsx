'use client';

// ============================================================
// RS AUTO — Недавно просмотренные объявления. Client Component.
// ============================================================
// История хранится в localStorage браузера и НИКУДА не отправляется:
// это личные данные о том, что человек смотрел, и держать их на сервере
// без входа было бы и лишним, и неприятным.
//
// ЗАЧЕМ СНИМОК КАРТОЧКИ: он даёт блоку отрисоваться сразу после
// гидратации, без ожидания сети. Но снимок — это только первый кадр:
// он устаревает с той секунды, как записан.
//
// ПОЧЕМУ ОДНОГО СНИМКА НЕ ХВАТАЛО. Раньше блок показывал сохранённые
// данные и никогда не сверялся с базой. Из-за этого снятое продавцом
// объявление продолжало висеть в «Недавно смотрели» — с прежней ценой,
// прежним фото и ссылкой на страницу «не найдено». То же с проданными,
// отклонёнными, просроченными и просто подешевевшими объявлениями.
//
// КАК ЧИНИМ: при монтировании блок спрашивает у базы, какие из
// сохранённых id ещё активны (RPC cars_by_ids_public, миграция 0142),
// и рисует ПРИШЕДШИЕ С СЕРВЕРА данные в порядке своей истории. Чего в
// ответе нет — из блока пропадает. Один запрос на четыре id.
//
// ХРАНИЛИЩЕ ПРИ ЭТОМ НЕ ЧИСТИМ, и это важно: тот же ключ читает метка
// «Просмотрено» на карточках каталога (ViewedBadge). Объявление может
// вернуться в каталог (продление, возврат из архива — 0070), и стирать
// факт «я это уже открывал» из-за временного состояния чужого
// объявления неправильно. Скрываем в блоке — да; забываем — нет.
//
// ОШИБКА СЕТИ НЕ ОБНУЛЯЕТ БЛОК: если запрос не удался, показываем
// снимки из хранилища. Устаревшая карточка лучше пустого места, а
// сверка повторится при следующем заходе.
//
// SSR НЕ ЛОМАЕТСЯ: до монтирования компонент возвращает null, поэтому
// серверная разметка и первый клиентский рендер совпадают (иначе React
// выдал бы ошибку гидратации).
// ============================================================

import { useEffect, useState } from 'react';

import CarCard from './CarCard';
import Button from './ui/Button';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';

const STORAGE_KEY = 'rsauto_recent_cars';

// Сколько объявлений держим. Четыре — ровно одна строка сетки на
// десктопе; больше превращает блок в «вторую ленту».
const MAX_ITEMS = 4;

// Снимок карточки. Набор полей совпадает с тем, что нужно CarCard:
// добавлять сюда лишнее — значит раздувать localStorage без пользы.
export type RecentCar = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  currency: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  is_for_sale: boolean;
  is_for_rent: boolean;
  city: string;
  photo_url: string | null;
};

// Строка ответа RPC cars_by_ids_public (миграция 0142). Функция
// отдаёт больше полей, чем нужно карточке (status, condition,
// availability, seller_kind): набор повторяет карточку каталога, и
// сужать его на бэкенде ради одного блока незачем. Здесь берём то,
// что рисует CarCard.
type FreshCar = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  currency: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  is_for_sale: boolean;
  is_for_rent: boolean;
  city: string;
  photo_url: string | null;
};

// ------------------------------------------------------------
// Запись просмотра. Вызывается со страницы объявления.
// ------------------------------------------------------------
export function rememberCar(car: RecentCar): void {
  if (typeof window === 'undefined') return;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list: RecentCar[] = raw ? JSON.parse(raw) : [];

    // Повторный просмотр поднимает объявление наверх, а не создаёт
    // дубль: список — это история, а не журнал посещений.
    const next = [car, ...list.filter((item) => item.id !== car.id)].slice(
      0,
      MAX_ITEMS,
    );

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage может быть недоступен: приватный режим Safari,
    // переполненная квота, отключённое хранилище. Блок второстепенный —
    // молча пропускаем, страница от этого не страдает.
  }
}

// ------------------------------------------------------------
// Проверка «объявление уже открывали». Используется меткой
// «Просмотрено» на карточке каталога (ViewedBadge).
//
// Вызывать только из эффекта клиентского компонента: на сервере
// localStorage нет, и до гидратации ответ всегда false.
// ------------------------------------------------------------
export function isCarViewed(id: string): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const list: RecentCar[] = JSON.parse(raw);
    return list.some((item) => item.id === id);
  } catch {
    // Хранилище недоступно или содержит мусор — метки просто не будет.
    return false;
  }
}

type Props = {
  locale: Locale;
  // Объявление, которое сейчас открыто: его из блока исключаем —
  // показывать ссылку на страницу, где человек находится, бессмысленно.
  excludeId?: string;
};

export default function RecentlyViewed({ locale, excludeId }: Props) {
  const t = getT(locale);
  const [items, setItems] = useState<RecentCar[]>([]);
  // Признак того, что компонент смонтирован на клиенте. До этого
  // рендерим null — см. пояснение про гидратацию в шапке файла.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Снимки из хранилища: порядок здесь — это история просмотров,
    // и именно он определяет порядок блока.
    let saved: RecentCar[] = [];

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const list = JSON.parse(raw) as RecentCar[];
      saved = Array.isArray(list)
        ? list.filter((item) => item && item.id && item.id !== excludeId)
        : [];
    } catch {
      // Битый JSON в хранилище (ручная правка, обрыв записи) — чистим,
      // чтобы блок не оставался сломанным навсегда.
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Хранилище недоступно — делать нечего.
      }
      return;
    }

    if (saved.length === 0) return;

    // Снимки показываем сразу: блок появляется без ожидания сети.
    setItems(saved);

    // Отменённый запрос не должен трогать состояние размонтированного
    // компонента: человек может уйти со страницы раньше ответа.
    let cancelled = false;

    void (async () => {
      try {
        const { data, error } = await getBrowserClient().rpc(
          'cars_by_ids_public',
          { p_ids: saved.map((item) => item.id) },
        );

        // Ошибка запроса — оставляем снимки (см. шапку файла).
        if (cancelled || error || !Array.isArray(data)) return;

        // Ответ приходит без порядка (функция его намеренно не задаёт),
        // поэтому раскладываем по id и обходим СВОЮ историю: сверху
        // остаётся то, что человек смотрел последним.
        const fresh = new Map<string, RecentCar>();
        for (const row of data as FreshCar[]) {
          fresh.set(row.id, {
            id: row.id,
            brand: row.brand,
            model: row.model,
            year: row.year,
            mileage: row.mileage,
            currency: row.currency,
            sale_price: row.sale_price,
            rent_price_daily: row.rent_price_daily,
            is_for_sale: row.is_for_sale,
            is_for_rent: row.is_for_rent,
            city: row.city,
            photo_url: row.photo_url,
          });
        }

        // Объявления, которых в ответе нет, — сняты, проданы, удалены
        // или ушли на модерацию: из блока они пропадают. Хранилище при
        // этом не трогаем — метка «Просмотрено» должна пережить и
        // снятие, и возврат объявления в каталог.
        setItems(
          saved
            .map((item) => fresh.get(item.id))
            .filter((item): item is RecentCar => item !== undefined),
        );
      } catch {
        // Сеть недоступна — блок остаётся на снимках.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [excludeId]);

  function clear() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // См. выше.
    }
    setItems([]);
  }

  if (!mounted || items.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 pb-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="whitespace-nowrap text-h3 font-semibold">{t('recent_title')}</h2>
        <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={clear}>
          {t('recent_clear')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {items.map((car) => (
          // mode="both": в истории соседствуют продажа и аренда, и цену
          // должно выбирать само объявление.
          <CarCard key={car.id} locale={locale} car={car} mode="both" />
        ))}
      </div>
    </section>
  );
}
