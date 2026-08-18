// ============================================================
// RS AUTO — Согласие с политикой: локальная фиксация.
// ============================================================
// Зеркало features/legal/consent_service.dart приложения, включая
// формат ключа и сравнение по ВЕРСИИ политики.
//
// Зачем вообще хранить. Согласие принимается перед отправкой SMS —
// то есть при КАЖДОМ входе. Пока факт принятия жил в useState формы,
// продавец, подающий второе объявление, снова видел непринятый чекбокс
// и снова не мог нажать кнопку, хотя документы уже принял.
//
// Почему localStorage, а не таблица в БД: аккаунт создаётся самим
// входом по SMS, а согласие даётся ДО него — записывать его в базу
// пока некуда. Ровно та же причина, что и в приложении
// (shared_preferences вместо колонки в profiles).
//
// Сравнение идёт по версии, а не по флагу: подняли текст политики —
// подняли kPolicyVersion, и согласие запрашивается заново.
// ============================================================

// Версия принятой редакции. ОБЯЗАНА совпадать с kPolicyVersion
// приложения (features/legal/policy_content.dart): документы одни
// и те же, и расхождение версий означало бы, что один клиент считает
// согласие действующим, а другой — устаревшим.
export const POLICY_VERSION = '2026-08-14.1';

const KEY_PREFIX = 'policy_accepted_version';

// Ключ включает идентификатор пользователя, чтобы согласие одного
// человека не переносилось на другого на общем устройстве.
// До входа пользователь — 'guest', как в приложении.
function key(userId?: string | null): string {
  return `${KEY_PREFIX}:${userId ? userId : 'guest'}`;
}

// Принята ли ТЕКУЩАЯ версия политики.
export function hasAcceptedPolicy(userId?: string | null): boolean {
  // Форма — Client Component, но рендерится и на сервере: без проверки
  // обращение к localStorage упало бы при серверном рендере.
  if (typeof window === 'undefined') return false;

  try {
    return localStorage.getItem(key(userId)) === POLICY_VERSION;
  } catch {
    // Приватный режим и запрет хранилища не должны ломать подачу:
    // не смогли прочитать — считаем, что согласия нет, и спросим.
    return false;
  }
}

// Зафиксировать согласие с текущей версией.
export function acceptPolicy(userId?: string | null): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(key(userId), POLICY_VERSION);
  } catch {
    // Не сохранилось — согласие просто спросят в следующий раз.
  }
}

// Перенести гостевое согласие на аккаунт после входа.
// Согласие даётся до создания аккаунта (под ключом 'guest'); после
// успешного входа копируем его на реальный uid, иначе тот же человек
// увидит непринятый чекбокс при следующей подаче.
export function migrateGuestConsent(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;

  try {
    if (localStorage.getItem(key(null)) === POLICY_VERSION) {
      localStorage.setItem(key(userId), POLICY_VERSION);
      localStorage.removeItem(key(null));
    }
  } catch {
    // См. выше: отказ хранилища не критичен.
  }
}
