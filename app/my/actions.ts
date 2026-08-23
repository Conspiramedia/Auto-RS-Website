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

// ============================================================
// ЧАТ
// ============================================================
// Отправка и пометка прочтения идут через Server Actions, а не прямым
// вызовом из браузера, по той же причине, что и действия над
// объявлением: список диалогов отрисован на сервере, и после отправки
// его нужно перерисовать — иначе превью последнего сообщения и счётчик
// непрочитанных останутся прежними.
//
// Сама запись выполняется ОБЫЧНЫМ INSERT/UPDATE под RLS, без RPC:
//   * messages_insert_participant проверяет участие в чате, требует
//     sender_id = auth.uid() и запрещает писать тому, кто заблокировал
//     отправителя (миграция 0041);
//   * колоночный грант из 0069 разрешает менять только is_read.
// Бизнес-правил сверх этого у чата нет, поэтому заводить RPC значило бы
// плодить слой без содержания.

// Отправка сообщения. Пустые и пробельные строки не отправляем: пустое
// сообщение в ленте — мусор, который нельзя удалить.
export async function sendMessage(
  chatId: string,
  text: string,
): Promise<ActionResult> {
  const clean = text.trim();
  if (clean === '') return { ok: false };

  const supabase = await getServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false };

  const { error } = await supabase.from('messages').insert({
    chat_id: chatId,
    // sender_id обязан совпадать с auth.uid() — этого требует политика.
    sender_id: auth.user.id,
    text: clean,
  });

  if (error) return { ok: false, error: error.message };

  // Список диалогов: изменились превью и порядок сортировки.
  revalidatePath('/my/messages');
  revalidatePath('/ru/my/messages');
  return { ok: true };
}

// Пометка входящих сообщений прочитанными при открытии диалога.
// Обновляем ТОЛЬКО чужие: своё сообщение прочитанным помечает
// получатель, а не отправитель.
export async function markChatRead(chatId: string): Promise<void> {
  const supabase = await getServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;

  await supabase
    .from('messages')
    .update({ is_read: true })
    .eq('chat_id', chatId)
    .eq('is_read', false)
    .neq('sender_id', auth.user.id);

  // Счётчик непрочитанных в списке и в шапке должен погаснуть.
  revalidatePath('/my/messages');
  revalidatePath('/ru/my/messages');
}

// Начало диалога с продавцом по объявлению. Идемпотентно: start_chat
// возвращает существующий чат, если он уже создан (миграция 0016),
// поэтому двойное нажатие «Написать» не плодит диалоги.
export async function startChat(
  carId: string,
): Promise<{ ok: boolean; chatId?: string; error?: string }> {
  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('start_chat', {
    p_car_id: carId,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, chatId: data as string };
}

// ============================================================
// ПРОФИЛЬ
// ============================================================
// Сохранение идёт в ДВА приёма, и это не лишний шаг:
//
//   1. update_seller_profile(kind, company, logo) — RPC. Она проверяет
//      бизнес-правила: дилер обязан иметь название салона, а при
//      возврате в 'private' поля витрины очищаются, чтобы не осталось
//      мусора от прошлой роли (миграция 0043);
//   2. UPDATE profiles для имени и аватара — обычных полей без правил,
//      под политикой profiles_update_own. Заводить ради них RPC значило
//      бы создать функцию, которая ничего не проверяет.
//
// Телефон НЕ обновляем: он приходит из auth.users и служит логином,
// менять его через профиль нельзя — это смена способа входа.
export async function saveProfile(input: {
  fullName: string;
  sellerKind: string;
  companyName: string;
  avatarUrl: string | null;
}): Promise<ActionResult> {
  const supabase = await getServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false };

  // Логотип витрины на сайте пока не редактируется, но передать его
  // ОБЯЗАНЫ: update_seller_profile пишет logo_url безусловно
  // (logo_url = case when dealer then nullif(trim(p_logo_url), '') end),
  // и вызов с null стёр бы у дилера уже загруженный логотип.
  // Поэтому читаем текущее значение и возвращаем его же.
  const { data: current } = await supabase
    .from('profiles')
    .select('logo_url')
    .eq('id', auth.user.id)
    .maybeSingle();

  // Сначала роль продавца: если сервер отклонит её (дилер без названия),
  // остальное сохранять незачем — профиль остался бы изменённым наполовину.
  const { error: rpcError } = await supabase.rpc('update_seller_profile', {
    p_seller_kind: input.sellerKind,
    p_company_name: input.companyName.trim() || null,
    p_logo_url: (current?.logo_url as string | null) ?? null,
  });

  if (rpcError) return { ok: false, error: rpcError.message };

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: input.fullName.trim() || null,
      avatar_url: input.avatarUrl,
    })
    .eq('id', auth.user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/my/profile');
  revalidatePath('/ru/my/profile');
  return { ok: true };
}
