'use server';

// ============================================================
// RS AUTO — Server Actions админ-комнаты: решения модерации.
// ============================================================
// ПОЧЕМУ SERVER ACTIONS, А НЕ ВЫЗОВ RPC ИЗ БРАУЗЕРА. Очередь и карточка
// рендерятся на сервере. После решения список обязан перерисоваться, и
// Server Action делает это одним запросом: зовёт RPC и тут же помечает
// кэш маршрута устаревшим через revalidatePath. Клиентский вызов
// потребовал бы сначала дёрнуть RPC, потом отдельно попросить refresh —
// и между этими шагами модератор увидел бы уже разобранное объявление
// всё ещё в очереди.
//
// ВСЯ БИЗНЕС-ЛОГИКА ОСТАЁТСЯ В БАЗЕ. Здесь нет ни проверки прав, ни
// проверки статуса, ни валидации причины — всё это делают approve_car и
// reject_car (миграция 0078): is_admin() первой строкой, FOR UPDATE,
// проверка исходного статуса, длина причины. Дублировать правила на
// сервере сайта значило бы завести вторую их копию, которая рано или
// поздно разойдётся с первой.
//
// Результат — объект { ok, error }, а не исключение: отказ здесь
// ожидаем (объявление уже разобрал другой модератор) и должен
// показаться строкой в интерфейсе, а не рухнувшей страницей.
// ============================================================

import { revalidatePath } from 'next/cache';

import { getServerClient } from '@/lib/supabaseServer';

export type ModerationResult = {
  ok: boolean;
  // Готовый к показу текст. Технические подробности Postgres наружу
  // не отдаём — модератору они ничего не объясняют.
  error?: string;
  // Признак «объявление уже не на проверке»: его разобрал кто-то
  // другой, пока карточка была открыта. Интерфейс по нему не просто
  // показывает ошибку, а уводит обратно в очередь — оставаться на
  // карточке, где обе кнопки теперь бессмысленны, незачем.
  alreadyHandled?: boolean;
};

// Сбрасываем кэш и списка, и карточки: после решения устаревают оба.
// Дашборд тоже — на нём счётчики очереди и решений за сутки.
function revalidateAdmin(carId: string): void {
  revalidatePath('/admin');
  revalidatePath('/admin/queue');
  revalidatePath(`/admin/queue/${carId}`);
}

// ------------------------------------------------------------
// Разбор ошибки Postgres в понятный модератору текст.
// ------------------------------------------------------------
// ГОНКА МОДЕРАТОРОВ — главный случай, ради которого эта функция и
// написана. Двое открыли одну карточку из очереди; первый нажал
// «Одобрить», второй через секунду — «Отклонить». Второй запрос
// упирается в FOR UPDATE, дожидается коммита первого, видит статус
// active вместо moderation и падает с check_violation (23514).
//
// Технический текст «Объявление нельзя отклонить: текущий статус =
// active» показывать нельзя: модератор не обязан знать про статусы и
// решит, что сломалась админка. Ему нужно понять ровно одно — тут уже
// всё сделано, идите дальше.
function humanError(
  code: string | undefined,
  message: string,
): ModerationResult {
  // 23514 — check_violation: неверный исходный статус. Единственная
  // причина, по которой approve_car/reject_car его бросают при живом
  // объявлении, — статус уже сменили.
  if (code === '23514') {
    return {
      ok: false,
      alreadyHandled: true,
      error: 'Объявление уже обработал другой модератор.',
    };
  }

  // Причина короче 10 символов тоже приходит как check_violation, но
  // до сервера в норме не доходит: диалог не даёт отправить короткую.
  // Сюда она попадает, только если проверку обошли, — тогда честный
  // текст сервера уместнее выдуманного.
  if (message.includes('Причина отклонения')) {
    return { ok: false, error: message };
  }

  // 42501 — insufficient_privilege: флаг is_admin сняли, пока человек
  // работал. Продолжать нечего.
  if (code === '42501') {
    return {
      ok: false,
      error: 'Нет прав на модерацию. Обновите страницу и войдите заново.',
    };
  }

  // P0002 — no_data_found: объявление удалили.
  if (code === 'P0002') {
    return {
      ok: false,
      alreadyHandled: true,
      error: 'Объявление больше не существует.',
    };
  }

  return {
    ok: false,
    error: 'Не удалось выполнить действие. Попробуйте ещё раз.',
  };
}

// ------------------------------------------------------------
// Одобрить объявление.
// ------------------------------------------------------------
// approve_car (0078) в одной транзакции: проверяет права и статус,
// ставит active, чистит прежнюю причину, кладёт уведомление в
// колокольчик и пишет журнал. Письмо продавцу ставит триггер
// tg_email_on_car_moderation (0071) — на смене статуса, с локалью
// получателя и каноническим адресом из f_car_site_url. Отсюда писем
// не отправляем и очередь не трогаем.
export async function approveCar(carId: string): Promise<ModerationResult> {
  const supabase = await getServerClient();

  const { error } = await supabase.rpc('approve_car', { car_id: carId });

  if (error) return humanError(error.code, error.message);

  revalidateAdmin(carId);
  return { ok: true };
}

// ------------------------------------------------------------
// Отклонить объявление с причиной.
// ------------------------------------------------------------
// Причина уходит в reject_car как есть: сервер сам обрежет пробелы и
// проверит длину (0078). Обрезаем и здесь — не ради проверки, а чтобы
// не гонять на сервер строку из одних пробелов.
//
// Параметры названы car_id и comment — так их принимает функция, и так
// же её зовёт приложение. Переименовать их значило бы сломать Flutter.
export async function rejectCar(
  carId: string,
  reason: string,
): Promise<ModerationResult> {
  const supabase = await getServerClient();

  const { error } = await supabase.rpc('reject_car', {
    car_id: carId,
    comment: reason.trim(),
  });

  if (error) return humanError(error.code, error.message);

  revalidateAdmin(carId);
  return { ok: true };
}

// ------------------------------------------------------------
// Снять объявление с публикации или вернуть в выдачу.
// ------------------------------------------------------------
// admin_set_car_status (0080) в одной транзакции: проверяет права,
// матрицу переходов (только active↔archived) и длину причины, пишет
// журнал ПЕРЕД сменой статуса и кладёт уведомление в колокольчик.
// Письмо о снятии ставит триггер email_on_car_moderation — он
// отличает снятие администратором от снятия владельцем по свежей
// записи в журнале.
//
// Причина обязательна в обе стороны: снятие опубликованного
// объявления продавец обнаружит сам и без объяснения воспримет как
// поломку сайта.
export async function setCarStatusByAdmin(
  carId: string,
  status: 'archived' | 'active',
  reason: string,
): Promise<ModerationResult> {
  const supabase = await getServerClient();

  const { error } = await supabase.rpc('admin_set_car_status', {
    p_car_id: carId,
    p_status: status,
    p_reason: reason.trim(),
  });

  if (error) {
    // Причина короче 10 символов приходит тем же check_violation, что
    // и запрещённый переход, — различаем по тексту. Диалог не даёт
    // отправить короткую, так что сюда она попадает только в обход
    // интерфейса, и честный текст сервера уместнее выдуманного.
    if (error.code === '23514' && error.message.includes('Причина')) {
      return { ok: false, error: error.message };
    }
    return humanError(error.code, error.message);
  }

  revalidateAdmin(carId);
  // Списки объявлений и журнал тоже устарели: там изменились и
  // статус, и число записей.
  revalidatePath('/admin/listings');
  revalidatePath('/admin/log');

  return { ok: true };
}

// ============================================================
// ДЕЙСТВИЯ НАД АВТОСАЛОНОМ (0085)
// ============================================================
// Те же правила, что и у модерации выше: вся логика в базе, здесь
// только вызов и сброс кэша. Проверка прав, вида продавца, длины
// причины и запись в журнал — внутри admin_set_trusted и
// admin_block_dealer.

// Общий сброс кэша после действия над салоном. Затрагивает три
// экрана: окно самого салона, главную (там карточка салона со
// счётчиками и метка «без модерации») и журнал.
function revalidateDealer(userId: string): void {
  revalidatePath('/admin');
  revalidatePath(`/admin/dealers/${userId}`);
  revalidatePath('/admin/log');
}

// ------------------------------------------------------------
// Тумблер «публиковать без модерации».
// ------------------------------------------------------------
// Возвращает НОВОЕ состояние флага из ответа сервера, а не то, что
// предположил интерфейс. Разойдись они — админ видел бы включённый
// тумблер при выключенном праве, а это ровно та ошибка, которую
// нельзя допускать в разрешении публиковать без проверки.
export type TrustedResult =
  | { ok: true; trusted: boolean }
  | { ok: false; error: string };

export async function setDealerTrusted(
  userId: string,
  trusted: boolean,
): Promise<TrustedResult> {
  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('admin_set_trusted', {
    p_user_id: userId,
    p_trusted: trusted,
  });

  if (error) {
    if (error.code === '42501') {
      return {
        ok: false,
        error: 'Нет прав. Обновите страницу и войдите заново.',
      };
    }
    if (error.code === 'P0002') {
      return { ok: false, error: 'Салон больше не существует.' };
    }
    return { ok: false, error: 'Не удалось изменить флаг. Попробуйте ещё раз.' };
  }

  revalidateDealer(userId);

  return { ok: true, trusted: data === true };
}

// ============================================================
// ЗАЯВКИ АВТОСАЛОНОВ (0053)
// ============================================================
// Стадия обработки заявки: new → in_progress → done | rejected.
//
// ПОЧЕМУ ПРЯМОЙ UPDATE, А НЕ RPC — единственное место в этом файле,
// где бизнес-логики в базе нет и заводить её незачем. Смена стадии не
// имеет ни правил перехода, ни побочных действий: это пометка «я взял
// заявку в работу», а не решение модерации. RPC вокруг такого UPDATE
// была бы функцией, которая ничего не проверяет, — ровно тот случай,
// который в app/my/actions.ts описан как повод обойтись без неё.
//
// ЗАЩИТА — RLS, А НЕ ЭТОТ КОД. Политика dealer_leads_update_admin
// (0053) пропускает запись только при is_admin(); набор значений
// держит constraint chk_dealer_lead_status. Не-админ не изменит
// строку, даже вызвав действие напрямую: клиент здесь работает под
// сессией пользователя, а не под service-role.
export type LeadResult = { ok: boolean; error?: string };

const LEAD_STATUSES = ['new', 'in_progress', 'done', 'rejected'] as const;

export async function setLeadStatus(
  leadId: string,
  status: string,
): Promise<LeadResult> {
  // Значение проверяем ДО обращения к базе: иначе ошибка вернулась бы
  // текстом constraint'а из Postgres, а он ничего не объясняет.
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: 'Недопустимая стадия заявки.' };
  }

  const supabase = await getServerClient();

  // select() после update обязателен, и не ради данных: UPDATE, не
  // задевший ни одной строки, ошибки НЕ возвращает. Без него отказ
  // RLS (флаг is_admin сняли, пока экран был открыт) и удалённая
  // заявка выглядели бы как успешное сохранение, а интерфейс
  // показал бы новую стадию, которой в базе нет.
  const { data, error } = await supabase
    .from('dealer_leads')
    .update({ status })
    .eq('id', leadId)
    .select('id');

  if (error) {
    return { ok: false, error: 'Не удалось изменить стадию. Попробуйте ещё раз.' };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      error: 'Заявка не найдена или нет прав. Обновите страницу.',
    };
  }

  revalidatePath('/admin/leads');
  return { ok: true };
}

// ------------------------------------------------------------
// Блокировка салона.
// ------------------------------------------------------------
// Снимает флаг доверия и убирает активные объявления из выдачи —
// одной транзакцией на стороне базы. Возвращает число скрытых
// объявлений: интерфейсу нужно показать, что именно произошло
// («скрыто 12 объявлений»), а не просто «готово».
//
// Обратимо: объявления возвращаются существующей кнопкой на карточке
// каждого из них (admin_set_car_status, переход archived → active).
export type BlockResult =
  | { ok: true; hidden: number }
  | { ok: false; error: string };

export async function blockDealer(
  userId: string,
  reason: string,
): Promise<BlockResult> {
  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('admin_block_dealer', {
    p_user_id: userId,
    p_reason: reason.trim(),
  });

  if (error) {
    // Короткая причина приходит как check_violation. Диалог не даёт
    // её отправить, так что сюда она попадает только в обход
    // интерфейса — честный текст сервера уместнее выдуманного.
    if (error.code === '23514') {
      return { ok: false, error: error.message };
    }
    if (error.code === '42501') {
      return {
        ok: false,
        error: 'Нет прав. Обновите страницу и войдите заново.',
      };
    }
    if (error.code === 'P0002') {
      return { ok: false, error: 'Салон больше не существует.' };
    }
    return { ok: false, error: 'Не удалось заблокировать. Попробуйте ещё раз.' };
  }

  revalidateDealer(userId);
  // Списки объявлений устарели: часть строк сменила статус.
  revalidatePath('/admin/listings');

  return { ok: true, hidden: Number(data ?? 0) };
}

// ------------------------------------------------------------
// Отзыв статуса автосалона (миграция 0125).
// ------------------------------------------------------------
// ШАГ СТРОЖЕ БЛОКИРОВКИ, а не её разновидность. Блокировка оставляет
// продавца салоном: у него живёт витрина, он числится в каталоге, а
// его одобренная заявка позволяет вернуть публикацию. Отзыв забирает
// сам статус — заявки уходят в rejected, профиль становится частным,
// поля витрины затираются. Всё это делает admin_revoke_dealer одной
// транзакцией, здесь — только вызов и сброс кэша.
//
// Возвращает число скрытых объявлений, как blockDealer: интерфейсу
// нужно показать, что именно произошло.
//
// Обратимость несимметрична и это осознанно: объявления возвращаются
// администратором по одному (admin_set_car_status), а статус — только
// новой заявкой владельца, которую снова придётся одобрить.
export type RevokeResult =
  | { ok: true; hidden: number }
  | { ok: false; error: string };

export async function revokeDealer(
  userId: string,
  reason: string,
): Promise<RevokeResult> {
  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('admin_revoke_dealer', {
    p_user_id: userId,
    p_reason: reason.trim(),
  });

  if (error) {
    // check_violation здесь означает либо короткую причину, либо
    // «продавец уже не салон» — статус успел отозвать другой
    // администратор, пока окно было открыто. В обоих случаях текст
    // сервера точнее выдуманного: он называет настоящую причину
    // отказа, а не общее «попробуйте ещё раз».
    if (error.code === '23514') {
      return { ok: false, error: error.message };
    }
    if (error.code === '42501') {
      return {
        ok: false,
        error: 'Нет прав. Обновите страницу и войдите заново.',
      };
    }
    if (error.code === 'P0002') {
      return { ok: false, error: 'Профиль больше не существует.' };
    }
    return {
      ok: false,
      error: 'Не удалось отозвать статус. Попробуйте ещё раз.',
    };
  }

  revalidateDealer(userId);
  // Отзыв меняет больше, чем блокировка: продавец пропадает из списка
  // салонов админки и из каталога витрин, а его объявления сменили
  // статус. Профиль владельца тоже — в нём сменился тип продавца.
  revalidatePath('/admin/listings');
  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath('/dealers');
  revalidatePath('/ru/dealers');
  revalidatePath(`/dealer/${userId}`);
  revalidatePath(`/ru/dealer/${userId}`);
  revalidatePath('/my/profile');
  revalidatePath('/ru/my/profile');

  return { ok: true, hidden: Number(data ?? 0) };
}

// ------------------------------------------------------------
// Решение по заявке на статус автосалона (миграция 0100).
// ------------------------------------------------------------
// ОДНО ДЕЙСТВИЕ НА ОБА РЕШЕНИЯ, как и RPC под ним: разделение дало бы
// две функции, отличающиеся одним булевым аргументом.
//
// Одобрение — не пометка в таблице, а ВЫДАЧА ПРАВ: после него
// заявитель становится автосалоном, получает витрину в каталоге,
// страницу /dealer/{id} и подпись «Автосалон» на объявлениях. Всё это
// делает сама admin_review_dealer_application одной транзакцией, здесь
// повторных UPDATE нет.
//
// Отказ требует причины (10–1000 символов) — её проверяет база, и
// заявитель увидит текст в своём кабинете.
export async function reviewDealerApplication(
  applicationId: string,
  approve: boolean,
  reason?: string,
): Promise<ModerationResult> {
  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('admin_review_dealer_application', {
    p_id: applicationId,
    p_approve: approve,
    p_reason: reason?.trim() ?? null,
  });

  if (error) {
    // Заявку уже разобрал другой администратор, пока экран был
    // открыт. Тот же случай, что гонка модераторов в очереди
    // объявлений: сообщаем прямо и помечаем alreadyHandled, чтобы
    // интерфейс обновил список, а не оставил кнопки, которые теперь
    // ни на что не действуют.
    if (error.code === '23514' && error.message.includes('уже рассмотрена')) {
      return {
        ok: false,
        error: 'Заявку уже рассмотрел другой администратор.',
        alreadyHandled: true,
      };
    }
    // Короткая причина. Диалог не даёт её отправить, так что сюда она
    // попадает в обход интерфейса — честный текст сервера уместнее
    // выдуманного.
    if (error.code === '23514') {
      return { ok: false, error: error.message };
    }
    if (error.code === '42501') {
      return {
        ok: false,
        error: 'Нет прав. Обновите страницу и войдите заново.',
      };
    }
    if (error.code === 'P0002') {
      return { ok: false, error: 'Заявка не найдена.' };
    }
    return { ok: false, error: 'Не удалось сохранить решение. Попробуйте ещё раз.' };
  }

  // Пустой ответ означает, что RPC не вернула строку, — до сюда
  // такое доходить не должно (ошибку она бросает исключением), но
  // молча показывать успех на пустом результате нельзя.
  if (!data) {
    return { ok: false, error: 'Решение не сохранилось. Обновите страницу.' };
  }

  revalidatePath('/admin');
  revalidatePath('/admin/dealer-applications');

  // Одобрение завело нового салона: списки салонов и каталог витрин
  // устарели. Профиль заявителя тоже — в нём сменился тип продавца.
  if (approve) {
    revalidatePath('/admin/users');
    revalidatePath('/dealers');
    revalidatePath('/ru/dealers');
    revalidatePath('/my/profile');
    revalidatePath('/ru/my/profile');
  }

  return { ok: true };
}
