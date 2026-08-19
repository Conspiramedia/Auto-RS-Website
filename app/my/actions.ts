'use server';

// ============================================================
// RS AUTO — Server Actions кабинета.
// ============================================================
// Выход выполняется НА СЕРВЕРЕ, а не в браузере. Причина в том, где
// теперь живёт сессия: она в cookie (lib/supabaseClient.ts), и удалить
// их обязан тот, кто может выставить заголовок Set-Cookie. Server
// Component этого не умеет — HTTP не разрешает менять заголовки после
// начала стриминга ответа, — а Server Action выполняется отдельным
// запросом, где ответ ещё формируется.
//
// Клиентский signOut() очистил бы состояние только в браузере: cookie
// остались бы, и следующий серверный рендер кабинета снова показал бы
// пользователя вошедшим.
// ============================================================

import { createServerClient } from '@supabase/ssr';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import type { Locale } from '@/lib/i18n';
import { localeHref } from '@/lib/i18n';
import { getServerClient } from '@/lib/supabaseServer';

export async function signOut(locale: Locale): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Не заданы NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  const cookieStore = await cookies();

  // Отдельный клиент, а не getServerClient из lib/supabaseServer.ts:
  // там setAll намеренно пуст (Server Component не может писать cookie),
  // и вызванный через него signOut удалил бы сессию на сервере Supabase,
  // но оставил бы cookie в браузере. Здесь запись работает по-настоящему.
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });

  // scope: 'local' — гасим сессию этого браузера, не трогая остальные
  // устройства. Выход на сайте не должен разлогинивать человека в
  // приложении: это один аккаунт, но разные клиенты.
  await supabase.auth.signOut({ scope: 'local' });

  // На главную своей локали: кабинет после выхода недоступен, а
  // оставлять пользователя на его адресе значило бы показать ему форму
  // входа вместо понятного места.
  redirect(localeHref(locale, '/'));
}

// ============================================================
// ДЕЙСТВИЯ НАД ОБЪЯВЛЕНИЕМ
// ============================================================
// Почему Server Actions, а не вызовы RPC из браузера. Список объявлений
// рендерится на сервере, и после смены статуса его нужно перерисовать.
// Server Action делает это одним запросом: вызывает RPC и тут же
// сбрасывает кэш маршрута через revalidatePath — клиенту не приходится
// сначала звать RPC, а потом отдельно просить refresh.
//
// Результат возвращается объектом { ok, error }, а не выбрасывается
// исключением: ошибка здесь ожидаема (сервер отклонил переход статуса)
// и должна показаться строкой под карточкой, а не рухнувшей страницей.
// Технический текст из Postgres наружу не отдаём — клиент показывает
// свою локализованную формулировку.

type ActionResult = { ok: boolean; error?: string };

// Пути кабинета в обеих локалях. Сбрасываем ОБА: продавец мог открыть
// список на сербской версии, а действие выполнить после переключения
// языка — устаревший кэш второй локали показал бы прежний статус.
function revalidateMy(): void {
  revalidatePath('/my');
  revalidatePath('/ru/my');
}

// ------------------------------------------------------------
// Смена статуса: снять / вернуть / отметить проданным.
// ------------------------------------------------------------
// Матрица допустимых переходов живёт в БД (миграция 0070,
// set_my_car_status) — здесь она сознательно НЕ дублируется. Клиент,
// проверяющий бизнес-правило самостоятельно, рано или поздно разойдётся
// с сервером; единственный источник истины — база.
export async function setCarStatus(
  carId: string,
  status: string,
): Promise<ActionResult> {
  const supabase = await getServerClient();

  const { error } = await supabase.rpc('set_my_car_status', {
    p_car_id: carId,
    p_status: status,
  });

  if (error) return { ok: false, error: error.message };

  revalidateMy();
  return { ok: true };
}

// ------------------------------------------------------------
// Продвижение объявления на 7 дней.
// ------------------------------------------------------------
// На текущем этапе бесплатно: activate_promotion пишет в кошелёк
// подарочную операцию на 0 EUR и баланс не трогает (миграция 0048).
// Когда подключат оплату, изменится ТОЛЬКО функция в базе — этот вызов
// останется прежним.
export async function promoteCar(carId: string): Promise<ActionResult> {
  const supabase = await getServerClient();

  const { error } = await supabase.rpc('activate_promotion', {
    p_car_id: carId,
    p_days: 7,
  });

  if (error) return { ok: false, error: error.message };

  revalidateMy();
  return { ok: true };
}

// ------------------------------------------------------------
// Сброс кэша кабинета после правки объявления.
// ------------------------------------------------------------
// Сохранение идёт из клиентского компонента (SellForm вызывает
// update_car_v3 напрямую — там же лежат файлы фотографий, которые надо
// сначала отправить в хранилище). Но список в /my отрисован НА СЕРВЕРЕ
// и закэширован, поэтому после правки он показал бы прежний статус:
// продавец сохранил изменения, вернулся в кабинет и увидел старый
// бейдж «Опубликовано» вместо «На проверке».
//
// revalidatePath умеет выполняться только на сервере, отсюда отдельное
// действие. Полезной работы оно не делает — только помечает кэш
// устаревшим.
export async function revalidateMyListings(): Promise<void> {
  revalidateMy();
}
