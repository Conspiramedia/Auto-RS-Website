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
//   sold       → нет действий
//   moderation → «Снять» (archived)
//   rejected   → «Снять» (archived)
// Кнопка, которую сервер отклонит, не рисуется вовсе: показать её и
// получить ошибку в ответ — худший вид интерфейса. Но матрица здесь
// НЕ источник истины, а её отражение: решение всё равно принимает база.
//
// У ПРОДАННОГО ДЕЙСТВИЙ НЕТ. Переход sold → active база по-прежнему
// принимает, но кнопки «Вернуть» здесь нет намеренно: продажа — конец
// жизни объявления, а не временное состояние. Возврат в публикацию
// означал бы, что машину продали и продают снова тем же объявлением —
// с его счётчиком просмотров, датой подачи и перепиской. Если машина
// снова в продаже, это новое объявление.
//
// «Редактировать» доступно в тех же статусах, что принимает
// update_car_v3 (миграция 0067): moderation, active, rejected.
// У проданного и архивного его нет — такое объявление сначала
// возвращают в публикацию, иначе правка меняла бы условия
// завершённой сделки задним числом.
//
// ПОДТВЕРЖДЕНИЕ ДВУХШАГОВОЕ И ИНЛАЙНОВОЕ: нажатие подменяет ряд кнопок
// строкой «вопрос + Да/Отмена». Модальное окно ради одного вопроса
// перегрузило бы экран, а вот отменить случайное «Продано» продавец
// обязан успеть — статус меняет видимость объявления в каталоге.
// ============================================================

import { useState, useTransition } from 'react';

import { promoteCar, setCarStatus } from '@/app/my/actions';
import Alert from './ui/Alert';
import Button from './ui/Button';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

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
  // sold — намеренно пусто, см. комментарий в шапке файла.
  sold: [],
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
  // Редактировать — рабочие статусы. Тот же список в update_car_v3
  // и на странице правки: показывать кнопку, ведущую на 404, нельзя.
  const canEdit = ['moderation', 'active', 'rejected'].includes(status);

  if (actions.length === 0 && !canPromote && !canEdit) return null;

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
              отражает, что выбор за продавцом.

              «Редактировать» — первое: из всех действий над объявлением
              оно самое частое, особенно у отклонённых, где правка и
              есть единственный способ вернуться в выдачу.
              Это ссылка, а не кнопка: переход на другую страницу
              обязан оставаться настоящей ссылкой — работают «назад»,
              открытие в новой вкладке и предзагрузка Next. */}
          {canEdit && (
            <Button
              size="sm"
              variant="secondary"
              href={localeHref(locale, `/my/listing/${carId}/edit`)}
            >
              {t('my_action_edit')}
            </Button>
          )}

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
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}
    </div>
  );
}
