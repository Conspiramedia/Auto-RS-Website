'use client';

// ============================================================
// RS AUTO — Действия над своим объявлением.
// ============================================================
// Client Component: нужны состояние подтверждения и индикатор
// выполнения. Сама работа делается на сервере (app/my/actions.ts →
// RPC set_my_car_status / activate_promotion) — здесь только интерфейс.
//
// КАКИЕ ДЕЙСТВИЯ ДОСТУПНЫ, решает статус, и набор в точности повторяет
// матрицу переходов из миграции 0070:
//   active     → «Снять» (archived), «Продано» (sold), «Продвинуть»
//   archived   → «Вернуть» (active)
//   sold       → «Вернуть» (active)
//   moderation → «Снять» (archived)
//   rejected   → «Снять» (archived)
// Кнопка, которую сервер отклонит, не рисуется вовсе: показать её и
// получить ошибку в ответ — худший вид интерфейса. Но матрица здесь
// НЕ источник истины, а её отражение: решение всё равно принимает база.
//
// «Редактировать» в этом пакете намеренно отсутствует — редактирование
// приходит в Пакете 3 вместе с RPC update_car_v3. Кнопка, ведущая в
// никуда, хуже её отсутствия.
//
// ПОДТВЕРЖДЕНИЕ ДВУХШАГОВОЕ И ИНЛАЙНОВОЕ: нажатие подменяет ряд кнопок
// строкой «вопрос + Да/Отмена». Модальное окно ради одного вопроса
// перегрузило бы экран, а вот отменить случайное «Продано» продавец
// обязан успеть — статус меняет видимость объявления в каталоге.
// ============================================================

import { useState, useTransition } from 'react';

import { promoteCar, setCarStatus } from '@/app/my/actions';
import Button from './ui/Button';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

type Props = {
  locale: Locale;
  carId: string;
  status: string;
  // Действует ли продвижение прямо сейчас: у продвигаемого объявления
  // кнопку «Продвинуть» не показываем — продлевать нечего, срок и так
  // идёт, а повторное нажатие только запутает.
  isPromoted: boolean;
};

// Описание одного действия смены статуса.
type StatusAction = {
  // Целевой статус для RPC.
  target: string;
  labelKey: DictKey;
  confirmKey: DictKey;
};

// Какие действия доступны из каждого статуса. Пустой список означает,
// что делать нечего (например, статус, о котором клиент ещё не знает).
const ACTIONS: Record<string, StatusAction[]> = {
  active: [
    {
      target: 'archived',
      labelKey: 'my_action_archive',
      confirmKey: 'my_confirm_archive',
    },
    {
      target: 'sold',
      labelKey: 'my_action_sold',
      confirmKey: 'my_confirm_sold',
    },
  ],
  archived: [
    {
      target: 'active',
      labelKey: 'my_action_restore',
      confirmKey: 'my_confirm_restore',
    },
  ],
  sold: [
    {
      target: 'active',
      labelKey: 'my_action_restore',
      confirmKey: 'my_confirm_restore',
    },
  ],
  moderation: [
    {
      target: 'archived',
      labelKey: 'my_action_archive',
      confirmKey: 'my_confirm_archive',
    },
  ],
  rejected: [
    {
      target: 'archived',
      labelKey: 'my_action_archive',
      confirmKey: 'my_confirm_archive',
    },
  ],
};

export default function ListingActions({
  locale,
  carId,
  status,
  isPromoted,
}: Props) {
  const t = getT(locale);
  const [pending, startTransition] = useTransition();
  // Действие, ожидающее подтверждения. null — показан обычный ряд кнопок.
  const [confirming, setConfirming] = useState<StatusAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = ACTIONS[status] ?? [];
  // Продвигать можно только активное и только если промо не идёт —
  // те же условия проверяет activate_promotion на сервере.
  const canPromote = status === 'active' && !isPromoted;

  if (actions.length === 0 && !canPromote) return null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      // Текст ошибки от Postgres наружу не показываем: он технический и
      // по-английски. Пользователю — своя формулировка на его языке.
      if (!result.ok) setError(t('my_action_error'));
      setConfirming(null);
    });
  }

  return (
    <div className="mt-3">
      {confirming ? (
        // Шаг подтверждения. Вопрос и обе кнопки в одной строке:
        // выбор должен читаться целиком, без прокрутки взглядом.
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-neutral-70">
            {t(confirming.confirmKey)}
          </span>
          <Button
            size="sm"
            variant="dark"
            disabled={pending}
            onClick={() => run(() => setCarStatus(carId, confirming.target))}
          >
            {pending ? t('my_action_busy') : t('my_confirm_yes')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => setConfirming(null)}
          >
            {t('my_confirm_no')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/* Все действия оформлены вторичными: на карточке владельца
              нет «главного» действия, а зелёный акцент занят строкой
              продвижения. Ряд одинаковых по весу кнопок честно
              отражает, что выбор за продавцом. */}
          {actions.map((action) => (
            <Button
              key={action.target}
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setError(null);
                setConfirming(action);
              }}
            >
              {t(action.labelKey)}
            </Button>
          ))}

          {/* Продвижение подтверждения не требует: оно ничего не
              ломает и пока бесплатно. Лишний вопрос здесь только
              мешал бы. */}
          {canPromote && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => promoteCar(carId))}
            >
              {pending ? t('my_action_busy') : t('my_action_promote')}
            </Button>
          )}
        </div>
      )}

      {/* Условия продвижения — видимой строкой, а не подсказкой при
          наведении: на телефоне наведения нет вовсе, и продавец не
          узнал бы ни про бесплатность, ни про срок. */}
      {canPromote && !confirming && (
        <p className="mt-1.5 text-small text-neutral-50">
          {t('my_promote_days')}
        </p>
      )}

      {error && (
        <p className="mt-2 rounded-control bg-brand-red/10 px-3 py-2 text-caption text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}
