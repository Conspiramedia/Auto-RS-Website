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
//   active     → «Снять» (archived), «Продано» (sold), «Поднять»
//   archived   → «Вернуть» (active), но только если снял сам владелец
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
// СНЯТОЕ АДМИНИСТРАТОРОМ — ТОЛЬКО «РЕДАКТИРОВАТЬ» (миграции 0089,
// 0090). «Вернуть» не рисуется: сервер отклонит прямой возврат, потому
// что решение администратора владелец не отменяет. Но и тупика нет —
// правка по существу отправляет объявление на повторную модерацию, и
// это штатный путь обратно в выдачу. Причину снятия показывает
// карточка (MyListingCard), кнопка ведёт в форму правки.
//
// РАСКЛАДКА: кнопки идут СТОЛБЦОМ во всю ширину карточки, сверху вниз
// «Поднять», «Продано», «Редактировать», «Снять». Порядок — от того,
// что продавец делает чаще и охотнее, к тому, что убирает объявление
// из выдачи; «Снять» внизу, чтобы случайное нажатие по верхней кнопке
// не прятало объявление.
//
// ПОДТВЕРЖДЕНИЕ ДВУХШАГОВОЕ И ИНЛАЙНОВОЕ: нажатие подменяет столбец
// кнопок строкой «вопрос + Да/Отмена». Модальное окно ради одного
// вопроса перегрузило бы экран, а вот отменить случайное «Продано»
// продавец обязан успеть — статус меняет видимость в каталоге.
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
  // кнопку «Поднять» не показываем — продлевать нечего, срок и так
  // идёт, а повторное нажатие только запутает.
  isPromoted: boolean;
  // Объявление снято администратором (cars.archived_by = 'admin').
  // Отключает все действия — см. комментарий в шапке файла.
  // Необязательный: карточка кабинета передаёт его всегда, но пропс
  // со значением по умолчанию не заставляет менять прочие вызовы.
  archivedByAdmin?: boolean;
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
  archivedByAdmin = false,
}: Props) {
  const t = getT(locale);
  const [pending, startTransition] = useTransition();
  // Действие, ожидающее подтверждения. null — показан обычный ряд кнопок.
  const [confirming, setConfirming] = useState<StatusAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  // У снятого администратором нет НИ ОДНОГО действия смены статуса:
  // ни «Вернуть» (решение администратора владелец не отменяет), ни
  // «Продано» — матрица переходов из archived ведёт только в active,
  // и этот путь для него закрыт.
  const actions = archivedByAdmin ? [] : (ACTIONS[status] ?? []);
  // Продвигать можно только активное и только если промо не идёт —
  // те же условия проверяет activate_promotion на сервере.
  const canPromote = status === 'active' && !isPromoted;
  // Редактировать — рабочие статусы ПЛЮС админский архив: правка по
  // существу отправляет такое объявление на повторную модерацию
  // (update_car_v3, миграция 0090), и это единственный доступный
  // владельцу путь обратно в выдачу. Тот же список проверяют сама
  // RPC и страница правки: показывать кнопку, ведущую на 404, нельзя.
  //
  // СВОЙ архив в список не входит — его сначала возвращают в
  // публикацию кнопкой «Вернуть», которая для него работает.
  const canEdit =
    archivedByAdmin || ['moderation', 'active', 'rejected'].includes(status);

  // «Продано» выводится отдельной кнопкой: на экране оно стоит выше
  // «Редактировать», а в ACTIONS лежит рядом со «Снять» — там переходы
  // сгруппированы по исходному статусу, а не по порядку показа.
  const soldAction = actions.find((a) => a.target === 'sold') ?? null;
  const otherActions = actions.filter((a) => a.target !== 'sold');

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
        // КНОПКИ СТОЛБЦОМ ВО ВСЮ ШИРИНУ КАРТОЧКИ, а не рядом с
        // переносом. Ряд из четырёх кнопок в узкой колонке сетки
        // кабинета всё равно переносился, причём как придётся: на
        // 360px выходило «3 + 1», на планшете «2 + 2», и одно и то же
        // действие каждый раз оказывалось в новом месте. Столбец
        // одинаковых по ширине кнопок читается одинаково на всех
        // брейкпоинтах, и попасть пальцем в кнопку во всю ширину
        // заметно проще.
        //
        // ПОРЯДОК СВЕРХУ ВНИЗ: Поднять, Продано, Редактировать, Снять —
        // от того, что продавец делает чаще и охотнее, к тому, что
        // убирает объявление из выдачи. «Снять» внизу намеренно:
        // случайное нажатие на первую кнопку не должно прятать
        // объявление.
        //
        // Порядок задан здесь явно, а не берётся из ACTIONS: там
        // «Снять» и «Продано» лежат рядом как переходы из одного
        // статуса, а на экране они разнесены.
        <div className="flex flex-col gap-2">
          {/* Продвижение подтверждения не требует: оно ничего не
              ломает и пока бесплатно. Лишний вопрос здесь только
              мешал бы. */}
          {canPromote && (
            <Button
              size="sm"
              variant="secondary"
              fullWidth
              disabled={pending}
              onClick={() => run(() => promoteCar(carId))}
            >
              {pending ? t('my_action_busy') : t('my_action_promote')}
            </Button>
          )}

          {soldAction && (
            <Button
              size="sm"
              variant="secondary"
              fullWidth
              disabled={pending}
              onClick={() => {
                setError(null);
                setConfirming(soldAction);
              }}
            >
              {t(soldAction.labelKey)}
            </Button>
          )}

          {/* «Редактировать» — ссылка, а не кнопка: переход на другую
              страницу обязан оставаться настоящей ссылкой, тогда
              работают «назад», открытие в новой вкладке и
              предзагрузка Next. */}
          {canEdit && (
            <Button
              size="sm"
              variant="secondary"
              fullWidth
              href={localeHref(locale, `/my/listing/${carId}/edit`)}
            >
              {t('my_action_edit')}
            </Button>
          )}

          {/* Остальные переходы статуса — «Снять» и «Вернуть».
              Перечислять их поимённо незачем: в каждом статусе
              доступен ровно один, и порядок внутри списка роли не
              играет. */}
          {otherActions.map((action) => (
            <Button
              key={action.target}
              size="sm"
              variant="secondary"
              fullWidth
              disabled={pending}
              onClick={() => {
                setError(null);
                setConfirming(action);
              }}
            >
              {t(action.labelKey)}
            </Button>
          ))}
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
