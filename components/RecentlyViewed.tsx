'use client';

// ============================================================
// RS AUTO — Недавно просмотренные объявления. Client Component.
// ============================================================
// История хранится в localStorage браузера и НИКУДА не отправляется:
// это личные данные о том, что человек смотрел, и держать их на сервере
// без входа было бы и лишним, и неприятным.
//
// ПОЧЕМУ СНИМОК КАРТОЧКИ, А НЕ СПИСОК ID: если хранить только
// идентификаторы, для отрисовки блока пришлось бы запрашивать данные
// с сервера при каждом заходе — то есть добавить сетевой запрос ради
// второстепенного блока. Вместо этого сохраняем минимум полей для
// карточки (марка, модель, цена, фото) прямо при просмотре.
//
// Устаревание данных допустимо: цена в блоке может отстать от реальной,
// поэтому карточка ведёт на страницу объявления, где всё актуально.
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

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const list = JSON.parse(raw) as RecentCar[];
      setItems(
        Array.isArray(list)
          ? list.filter((item) => item && item.id !== excludeId)
          : [],
      );
    } catch {
      // Битый JSON в хранилище (ручная правка, обрыв записи) — чистим,
      // чтобы блок не оставался сломанным навсегда.
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Хранилище недоступно — делать нечего.
      }
    }
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
        <h2 className="text-h3 font-semibold">{t('recent_title')}</h2>
        <Button variant="ghost" size="sm" onClick={clear}>
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
