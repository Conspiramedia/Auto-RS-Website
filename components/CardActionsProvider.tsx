'use client';

// ============================================================
// RS AUTO — Состояние значков карточки на всю страницу.
// ============================================================
// ЗАЧЕМ КОНТЕКСТ. Значки на карточке (сердце, «три точки») нуждаются в
// сессии и в списке закладок. Спрашивать это в КАЖДОЙ карточке
// означало бы при 24 карточках в выдаче 24 вызова getSession и 24
// запроса за избранным — вместо одного и одного.
//
// СПИСОК ЗАКЛАДОК БЕРЁТСЯ ОДНИМ ЗАПРОСОМ и целиком: у избранного нет
// разумного верхнего предела в сотни тысяч строк, а колонок здесь
// ровно одна (car_id). Полторы сотни закладок — это несколько
// килобайт, и они дешевле, чем два десятка точечных проверок.
//
// СКРЫТИЕ КАРТОЧКИ ЖИВЁТ ЗДЕСЬ ЖЕ. Каталог рендерится на сервере и
// кэшируется, серверный рендер идёт БЕЗ сессии — значит, фильтрация
// скрытых объявлений в БД (search_cars_public учитывает hidden_cars с
// миграции 0031) на закэшированной странице не сработает. Поэтому
// скрытая карточка убирается из DOM здесь, в браузере, а RPC hide_car
// пишет решение в базу — чтобы объявление не вернулось при следующем
// заходе. Оба действия обязательны: одно даёт немедленный отклик,
// второе — постоянство.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { trackEvent } from '@/lib/analytics';
import { getBrowserClient } from '@/lib/supabaseClient';

type CardActionsValue = {
  // undefined — сессия ещё проверяется.
  signedIn: boolean | undefined;
  // Кто вошёл. Нужен странице объявления: у своего объявления значка
  // избранного быть не должно, а сравнить владельца не с чем, если
  // известен только факт входа. null — гость.
  userId: string | null;
  isFavorite: (carId: string) => boolean;
  toggleFavorite: (carId: string) => Promise<void>;
  hideCar: (carId: string) => Promise<void>;
  hideCity: (city: string) => Promise<void>;
  // Скрытые в этом сеансе: карточки убираются из списка сразу, не
  // дожидаясь перезагрузки.
  hiddenCars: ReadonlySet<string>;
  hiddenCities: ReadonlySet<string>;
};

// Значение по умолчанию описывает страницу БЕЗ провайдера: значки на
// ней просто не рисуются (signedIn остаётся undefined). Так карточку
// можно ставить где угодно, не оборачивая каждый список.
const FALLBACK: CardActionsValue = {
  signedIn: undefined,
  userId: null,
  isFavorite: () => false,
  toggleFavorite: async () => {},
  hideCar: async () => {},
  hideCity: async () => {},
  hiddenCars: new Set(),
  hiddenCities: new Set(),
};

const CardActionsContext = createContext<CardActionsValue>(FALLBACK);

export function useCardActions() {
  return useContext(CardActionsContext);
}

export default function CardActionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [userId, setUserId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [hiddenCars, setHiddenCars] = useState<Set<string>>(new Set());
  const [hiddenCities, setHiddenCities] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = getBrowserClient();
      const { data } = await supabase.auth.getSession();
      const authed = data.session != null;
      if (cancelled) return;
      setSignedIn(authed);
      setUserId(data.session?.user.id ?? null);

      // Гостю закладок нет по определению — запрос не делаем.
      if (!authed) return;

      // Политика favorites_select_own (0023, ужесточена в 0063) отдаёт
      // строки только их владельцу: фильтр по user_id здесь не нужен и
      // был бы дублированием правила, которое уже держит база.
      const { data: rows } = await supabase.from('favorites').select('car_id');

      if (!cancelled && rows) {
        setFavorites(new Set(rows.map((r) => r.car_id as string)));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isFavorite = useCallback(
    (carId: string) => favorites.has(carId),
    [favorites],
  );

  // Переключение закладки. Оптимистично: закладка — действие на один
  // тап, и, глядя на неизменившийся значок, человек нажмёт второй раз
  // и снимет то, что поставил.
  const toggleFavorite = useCallback(async (carId: string) => {
    let added = false;

    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(carId)) {
        next.delete(carId);
      } else {
        next.add(carId);
        added = true;
      }
      return next;
    });

    const { data, error } = await getBrowserClient().rpc('toggle_favorite', {
      p_car_id: carId,
    });

    if (error) {
      // Откат: сервер закладку не принял, и значок не должен
      // утверждать обратное.
      setFavorites((prev) => {
        const next = new Set(prev);
        if (added) next.delete(carId);
        else next.add(carId);
        return next;
      });
      return;
    }

    // RPC возвращает фактическое состояние — доверяем ему, а не своему
    // предположению: при гонке двух вкладок расходится именно оно.
    if (typeof data === 'boolean') {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (data) next.add(carId);
        else next.delete(carId);
        return next;
      });

      // Считаем только добавление: снятие закладки интереса не
      // выражает (см. lib/analytics, favorite_added).
      if (data) trackEvent('favorite_added', { guest: false });
    }
  }, []);

  // Скрытие объявления: сразу убираем из списка, параллельно пишем в
  // базу (см. шапку файла).
  const hideCar = useCallback(async (carId: string) => {
    setHiddenCars((prev) => new Set(prev).add(carId));

    const { error } = await getBrowserClient().rpc('hide_car', {
      p_car_id: carId,
    });

    // Откат при ошибке: карточка, исчезнувшая только в этой вкладке,
    // вернётся при перезагрузке и будет выглядеть как сбой.
    if (error) {
      setHiddenCars((prev) => {
        const next = new Set(prev);
        next.delete(carId);
        return next;
      });
    }
  }, []);

  const hideCity = useCallback(async (city: string) => {
    setHiddenCities((prev) => new Set(prev).add(city));

    // Город нормализуется на сервере (0031): двуалфавитность сербского
    // рынка означает, что «Beograd» и «Београд» — один город, и
    // решать это на клиенте нельзя.
    const { error } = await getBrowserClient().rpc('hide_city', {
      p_city: city,
    });

    if (error) {
      setHiddenCities((prev) => {
        const next = new Set(prev);
        next.delete(city);
        return next;
      });
    }
  }, []);

  const value = useMemo<CardActionsValue>(
    () => ({
      signedIn,
      userId,
      isFavorite,
      toggleFavorite,
      hideCar,
      hideCity,
      hiddenCars,
      hiddenCities,
    }),
    [
      signedIn,
      userId,
      isFavorite,
      toggleFavorite,
      hideCar,
      hideCity,
      hiddenCars,
      hiddenCities,
    ],
  );

  return (
    <CardActionsContext.Provider value={value}>
      {children}
    </CardActionsContext.Provider>
  );
}
