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
// Продление объявления на срок публикации.
// ------------------------------------------------------------
// Работает и для активного (продлить заранее), и для истёкшего
// (вернуть в каталог). Второе — основной сценарий: продавец приходит
// по ссылке из письма «объявление скрыто».
//
// Повторной модерации нет: содержимое не менялось, объявление уже
// проверено — то же правило, что при возврате из архива (0070).
// Срок считает база (триггер trg_cars_set_expiry), здесь его нет
// намеренно: два источника истины для даты разошлись бы.
export async function extendListing(carId: string): Promise<ActionResult> {
  const supabase = await getServerClient();

  const { error } = await supabase.rpc('extend_listing', {
    p_car_id: carId,
  });

  if (error) return { ok: false, error: error.message };

  revalidateMy();
  return { ok: true };
}

// ------------------------------------------------------------
// Массовое продление всех своих объявлений.
// ------------------------------------------------------------
// Для салона с десятками машин продление по одному — работа, которую
// никто делать не будет. Функция доступна любому владельцу, не только
// дилеру: частник с тремя объявлениями выигрывает ровно так же.
//
// Возвращает количество продлённых — кабинету нужно показать
// результат, а не просто отсутствие ошибки.
export async function extendAllListings(): Promise<
  ActionResult & { count?: number }
> {
  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('extend_my_listings');

  if (error) return { ok: false, error: error.message };

  revalidateMy();
  return { ok: true, count: typeof data === 'number' ? data : 0 };
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
  // Логотип салона. Приходит из формы (поле появилось вместе с этой
  // правкой). null означает «убрать логотип» — это осознанное
  // действие пользователя, а не «значение неизвестно».
  logoUrl: string | null;
  // ------------------------------------------------------------
  // ПОЛЯ ВИТРИНЫ САЛОНА (миграция 0095).
  // ------------------------------------------------------------
  // Наполняют плитку салона в каталоге и шапку его публичной
  // страницы. Приходят ВСЕГДА, даже пустыми строками, и это
  // принципиально: update_seller_profile перезаписывает профиль
  // целиком, поэтому непереданное поле она затрёт в NULL. Сделай мы
  // их необязательными — сохранение имени в профиле стирало бы салону
  // описание и часы работы.
  //
  // У частника поля не показываются и приходят пустыми: RPC при
  // seller_kind = 'private' всё равно затирает их сама.
  description: string;
  dealerPhone: string;
  website: string;
  openingHours: string;
  // Город салона. С миграции 0097 его пишет сам владелец — раньше
  // поле принадлежало только админке (0085).
  companyCity: string;
  // Обложка витрины (0098). null означает «убрать обложку» — то же
  // осознанное действие, что и у логотипа выше.
  coverUrl: string | null;
  // Слоган салона (0098). Как и прочие поля витрины, приходит всегда.
  tagline: string;
  // ------------------------------------------------------------
  // КОНТАКТНЫЙ ТЕЛЕФОН ВЛАДЕЛЬЦА (profiles.phone).
  // ------------------------------------------------------------
  // Не путать с dealerPhone выше: тот — публичный номер компании в
  // витрине салона, а этот принадлежит человеку и подставляется в
  // форму подачи объявления (get_profile_phone в SellForm).
  //
  // Раньше поле в профиле было серым: номер служил логином (вход по
  // SMS), и менять его значило менять способ входа. После перехода на
  // почтовый вход (0106) телефон перестал быть логином и стал обычным
  // контактом — но поле осталось нередактируемым, и продавец, вошедший
  // по почте, не мог вписать номер вовсе. Единственным способом
  // завести его была подача объявления.
  //
  // Пустая строка означает «убрать номер» — осознанное действие, как
  // у логотипа и обложки выше. RPC приравнивает её к NULL сама.
  phone: string;
}): Promise<ActionResult> {
  const supabase = await getServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false };

  // ЛОГОТИП ИДЁТ ИЗ ФОРМЫ. Раньше здесь стоял обходной приём: поля
  // логотипа на сайте не было, а update_seller_profile пишет logo_url
  // безусловно (logo_url = case when dealer then nullif(trim(
  // p_logo_url), '') end), поэтому вызов с null стирал бы уже
  // загруженный логотип — и приходилось читать текущее значение из
  // базы, чтобы вернуть его же. Лишний запрос на каждое сохранение
  // профиля и невозможность логотип поменять.
  //
  // Теперь форма присылает актуальное значение, и обходной SELECT
  // больше не нужен: пустая строка приравнивается к NULL самой RPC.
  //
  // Сначала роль продавца: если сервер отклонит её (дилер без названия),
  // остальное сохранять незачем — профиль остался бы изменённым наполовину.
  //
  // Пустая строка приравнивается к NULL самой RPC (nullif(trim(...))),
  // поэтому обрезкой на клиенте не занимаемся: правило «что считать
  // пустым» должно жить в одном месте, а не в двух.
  const { error: rpcError } = await supabase.rpc('update_seller_profile', {
    p_seller_kind: input.sellerKind,
    p_company_name: input.companyName.trim() || null,
    p_logo_url: input.logoUrl,
    p_description: input.description.trim() || null,
    p_dealer_phone: input.dealerPhone.trim() || null,
    p_website: input.website.trim() || null,
    p_opening_hours: input.openingHours.trim() || null,
    p_company_city: input.companyCity.trim() || null,
    p_cover_url: input.coverUrl,
    p_tagline: input.tagline.trim() || null,
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

  // ТЕЛЕФОН ПИШЕТСЯ ОТДЕЛЬНОЙ RPC, а не в UPDATE выше. Прямая запись
  // в profiles.phone из клиента потребовала бы политики RLS на UPDATE
  // колонки, а set_profile_phone (миграция 0106) — узкая definer-
  // функция, которая меняет ровно одно поле своей строки. Ей же
  // пользуется подача объявления, и правило «что считать пустым»
  // остаётся в одном месте.
  const { error: phoneError } = await supabase.rpc('set_profile_phone', {
    p_phone: input.phone.trim(),
  });

  if (phoneError) return { ok: false, error: phoneError.message };

  revalidatePath('/my/profile');
  revalidatePath('/ru/my/profile');
  // Витрина продавца тоже устарела: на ней показываются и название
  // салона, и логотип. Без сброса она держалась бы прежней до пяти
  // минут (revalidate = 300 в app/dealer/[id]/page.tsx), и продавец,
  // перейдя по ссылке «Моя витрина» сразу после сохранения, увидел бы
  // прежнюю картинку и решил, что загрузка не сработала.
  revalidatePath(`/dealer/${auth.user.id}`);
  revalidatePath(`/ru/dealer/${auth.user.id}`);
  // Каталог тоже: плитка салона показывает описание, город, часы и
  // телефон, а страницы выдачи кэшируются (revalidate = 120). Без
  // сброса салон правил бы витрину и не видел изменений там, ради
  // чего их и вносил.
  revalidatePath('/cars');
  revalidatePath('/ru/cars');
  revalidatePath('/all');
  revalidatePath('/ru/all');
  return { ok: true };
}

// ============================================================
// УВЕДОМЛЕНИЯ
// ============================================================
// Лента читается Server Component напрямую из таблицы notifications под
// политикой notifications_select_own (миграция 0024): RLS сама оставляет
// только свои записи, и RPC ради выборки заводить незачем.
//
// А вот пометка прочитанным идёт через Server Action, а не UPDATE из
// браузера, — по той же причине, что и markChatRead выше: после смены
// флага серверную ленту нужно перерисовать, иначе бейдж «Новое» висел
// бы до ручного обновления страницы.
//
// Фильтр по user_id в запросах ниже ИЗБЫТОЧЕН — политика
// notifications_update_own уже ограничивает строки владельцем. Он
// оставлен намеренно: это второй рубеж, и он делает намерение явным
// для того, кто будет читать код после нас.

// Пометить одно уведомление прочитанным. Вызывается при переходе по
// ссылке из ленты: человек открыл объявление или диалог — значит,
// уведомление своё дело сделало.
export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  const supabase = await getServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;

  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('user_id', auth.user.id)
    // Не переписываем уже прочитанные: лишний UPDATE поднял бы
    // строку в журнале репликации без единого изменения данных.
    .eq('is_read', false);

  revalidatePath('/my/notifications');
  revalidatePath('/ru/my/notifications');
}

// Пометить прочитанными все. Отдельное действие, а не цикл по ленте:
// один UPDATE вместо десятков запросов, и лента гаснет целиком.
export async function markAllNotificationsRead(): Promise<ActionResult> {
  const supabase = await getServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false };

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', auth.user.id)
    .eq('is_read', false);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/my/notifications');
  revalidatePath('/ru/my/notifications');
  return { ok: true };
}

// ------------------------------------------------------------
// Почта и язык уведомлений.
// ------------------------------------------------------------
// Вынесено из saveProfile в отдельное действие, потому что правила
// разные: имя и аватар — обычные поля, а почта обязана быть уникальной
// среди заполненных и проверяться на формат. Обе проверки живут в RPC
// set_my_contact_email (миграция 0071), здесь их копии нет.
//
// Коды ошибок разбираем по тексту сообщения Postgres: RPC бросает
// исключения с внятными формулировками, но показывать пользователю
// серверный текст нельзя — интерфейс двуязычный, а сообщения RPC
// написаны по-русски. Возвращаем код, а строку подбирает клиент.
export async function saveContactEmail(input: {
  email: string;
  locale: Locale;
}): Promise<{ ok: boolean; code?: 'invalid' | 'taken' | 'unknown' }> {
  const supabase = await getServerClient();

  const { error } = await supabase.rpc('set_my_contact_email', {
    p_email: input.email.trim(),
    // Язык писем проставляем по локали, на которой человек сейчас
    // работает: явного выбора языка уведомлений в интерфейсе нет, и
    // заводить его ради одного поля незачем.
    p_locale: input.locale,
  });

  if (error) {
    const message = error.message.toLowerCase();

    if (message.includes('уже использ')) {
      return { ok: false, code: 'taken' };
    }
    if (message.includes('некорректн') || message.includes('слишком длин')) {
      return { ok: false, code: 'invalid' };
    }
    return { ok: false, code: 'unknown' };
  }

  revalidatePath('/my/profile');
  revalidatePath('/ru/my/profile');
  return { ok: true };
}

// ============================================================
// ЗАЯВКА НА СТАТУС АВТОСАЛОНА (миграция 0100)
// ============================================================
// ЗАЧЕМ ВООБЩЕ ЗАЯВКА. До 0100 тип продавца был обычным полем формы:
// любой вошедший ставил себе «Автосалон», писал название и получал
// витрину в каталоге салонов, страницу /dealer/{id} и подпись
// «Автосалон» на объявлениях. Витрина салона — это обещание
// покупателю, что за объявлением стоит зарегистрированная компания,
// и выдаваться по нажатию кнопки она не может.
//
// ТЕКСТЫ ОШИБОК ПОДБИРАЕТ КЛИЕНТ, как и в saveContactEmail выше.
// Причина та же: RPC бросает исключения по-русски (их читает и
// администратор в логах), а интерфейс двуязычный — сербскому
// заявителю русская формулировка бесполезна. Поэтому наружу отдаём
// КОД, а строку под него берёт форма из своего словаря.
//
// Разбор по тексту сообщения, а не только по SQLSTATE: почти все
// проверки внутри RPC бросают check_violation (23514), и по одному
// коду не отличить «PIB не из девяти цифр» от «заявка уже подана».
export type DealerApplicationCode =
  | 'pending_exists'   // заявка уже ждёт рассмотрения
  | 'already_dealer'   // статус салона уже есть
  | 'tax_id'           // PIB не из 9 цифр
  | 'reg_num'          // матични број не из 8 цифр
  | 'company'          // название пустое или слишком длинное
  // Контактные поля стали обязательными в 0103: до неё заявка
  // принималась без города и телефона, и связаться по ней было не с кем.
  | 'city'             // город не указан
  | 'person'           // контактное лицо не указано
  | 'phone'            // телефон не указан
  | 'email'            // почта не указана или не похожа на адрес
  | 'too_long'         // прочие поля превысили длину
  | 'auth'             // сессия потерялась
  | 'unknown';

export async function submitDealerApplication(input: {
  companyName: string;
  taxId: string;
  registrationNumber: string;
  companyCity: string;
  contactPerson: string;
  phone: string;
  email: string;
  website: string;
  comment: string;
}): Promise<{ ok: boolean; code?: DealerApplicationCode }> {
  const supabase = await getServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, code: 'auth' };

  // Пустые строки превращаем в null: необязательным остаётся сайт, а
  // у обязательных полей null — это то, на что RPC и ругается. Писать
  // в базу '' вместо «не указано» значило бы отличать одно от другого
  // при каждом чтении.
  const orNull = (value: string) => value.trim() || null;

  const { error } = await supabase.rpc('submit_dealer_application', {
    p_company_name: input.companyName.trim(),
    // PIB и матични број уходят КАК НАБРАНЫ: чистку от пробелов и
    // дефисов делает сама RPC (regexp_replace). Повторять её здесь
    // значило бы завести второе место, где решают, что считать
    // цифрой реквизита.
    p_tax_id: input.taxId,
    p_registration_number: input.registrationNumber,
    p_company_city: orNull(input.companyCity),
    p_contact_person: orNull(input.contactPerson),
    p_phone: orNull(input.phone),
    p_website: orNull(input.website),
    p_comment: orNull(input.comment),
    p_email: orNull(input.email),
  });

  if (error) {
    const message = error.message.toLowerCase();

    if (message.includes('уже отправлена')) {
      return { ok: false, code: 'pending_exists' };
    }
    if (message.includes('уже есть статус')) {
      return { ok: false, code: 'already_dealer' };
    }
    if (message.includes('pib')) {
      return { ok: false, code: 'tax_id' };
    }
    if (message.includes('матични')) {
      return { ok: false, code: 'reg_num' };
    }
    if (message.includes('название автосалона')) {
      return { ok: false, code: 'company' };
    }
    // Обязательные контакты (0103). Проверяются ДО «слишком длин»:
    // сообщения о длине содержат название того же поля («Телефон
    // слишком длинный»), и общая ветка перехватывала бы их первой,
    // называя причиной длину вместо пустоты.
    if (message.includes('укажите город')) {
      return { ok: false, code: 'city' };
    }
    if (message.includes('укажите контактное лицо')) {
      return { ok: false, code: 'person' };
    }
    if (message.includes('укажите телефон')) {
      return { ok: false, code: 'phone' };
    }
    if (message.includes('укажите email') || message.includes('проверьте email')) {
      return { ok: false, code: 'email' };
    }
    if (message.includes('слишком длин')) {
      return { ok: false, code: 'too_long' };
    }
    if (error.code === '42501') {
      return { ok: false, code: 'auth' };
    }
    return { ok: false, code: 'unknown' };
  }

  // Профиль перерисовывается в обеих локалях: на нём стоит блок
  // заявки, и после отправки он обязан показать «на рассмотрении», а
  // не прежнюю форму с введёнными реквизитами.
  revalidatePath('/my/profile');
  revalidatePath('/ru/my/profile');
  // Дашборд админки: на нём счётчик ждущих заявок.
  revalidatePath('/admin');
  revalidatePath('/admin/dealer-applications');

  return { ok: true };
}
