'use client';

// ============================================================
// RS AUTO — Действия над своим объявлением.
// ============================================================
// Client Component: нужны состояние подтверждения и индикатор
// выполнения. Сама работа делается на сервере (app/my/actions.ts →
// RPC set_my_car_status / activate_promotion) — здесь только интерфейс.
//
// ПРОДВИЖЕНИЕ. Кнопка «Поднять» видна у любого активного объявления,
// но сработает не всегда: правила из миграции 0092 требуют, чтобы
// объявлению было не меньше 15 дней и чтобы с прошлого подъёма прошло
// не меньше 30. Оба правила проверяет сервер; здесь кнопка по нажатию
// показывает подсказку с датой — «включено до …» или «будет доступно
// с …». Прятать кнопку в эти периоды было бы хуже: продавец не видел
// бы услуги вовсе и не знал, когда она появится.
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
import { formatDate } from '@/lib/format';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';

// Длительность продвижения. Совпадает с f_promo_duration() в базе
// (миграция 0092) и используется ровно для одного: показать дату
// окончания сразу после нажатия, не дожидаясь перерисовки карточки.
// Правило живёт на сервере — здесь только его отображение.
const PROMO_DAYS = 7;

type Props = {
  locale: Locale;
  carId: string;
  status: string;
  // ----------------------------------------------------------
  // Состояние продвижения (миграция 0092).
  // ----------------------------------------------------------
  // Считает сервер, здесь только показ. Кнопка «Поднять» видна ВСЕГДА,
  // пока объявление активно, — прятать её было хуже: продавец, чьё
  // объявление ещё молодое, не видел кнопки вовсе и не понимал, есть
  // ли услуга в природе и когда она появится. Теперь кнопка на месте,
  // а по нажатию объясняет, до какого числа продвижение уже работает
  // или с какого числа станет доступно.
  //   'available' | 'active' | 'too_young' | 'cooldown' | 'blocked'
  promoState: string;
  // Дата для подсказки: «включено до» у active, «доступно с» у
  // too_young и cooldown. null у available и blocked.
  promoAvailableAt: string | null;
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
  promoState,
  promoAvailableAt,
  archivedByAdmin = false,
}: Props) {
  const t = getT(locale);
  const [pending, startTransition] = useTransition();
  // Действие, ожидающее подтверждения. null — показан обычный ряд кнопок.
  const [confirming, setConfirming] = useState<StatusAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Подсказка по продвижению: и отказ («доступно с …»), и успех
  // («включено до …»). Одно состояние на оба случая — они никогда не
  // показываются одновременно, а тон плашки задаётся отдельно.
  const [promoNote, setPromoNote] = useState<
    { tone: 'success' | 'warning'; text: string } | null
  >(null);

  // У снятого администратором нет НИ ОДНОГО действия смены статуса:
  // ни «Вернуть» (решение администратора владелец не отменяет), ни
  // «Продано» — матрица переходов из archived ведёт только в active,
  // и этот путь для него закрыт.
  const actions = archivedByAdmin ? [] : (ACTIONS[status] ?? []);
  // Кнопка «Поднять» показывается у любого активного объявления,
  // независимо от того, доступно продвижение прямо сейчас или нет:
  // причину и дату она объясняет по нажатию (см. комментарий к
  // пропсам). У неактивного её нет вовсе — там продвижение
  // неприменимо, и сервер отказал бы по статусу.
  const showPromote = status === 'active' && !archivedByAdmin;
  // Дата подсказки в локальном формате. Считаем один раз здесь:
  // ниже она нужна в двух ветках.
  const promoDate = promoAvailableAt
    ? formatDate(promoAvailableAt, locale)
    : null;
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

  if (actions.length === 0 && !showPromote && !canEdit) return null;

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

  // ------------------------------------------------------------
  // Нажатие «Поднять».
  // ------------------------------------------------------------
  // Реакция зависит от состояния, которое посчитал сервер:
  //   active               — «Продвижение включено до …»;
  //   too_young / cooldown — «Поднять объявление будет доступно с …»;
  //   available            — продвигаем и показываем ту же строку
  //                          «включено до …», но уже как результат.
  //
  // Дата успеха считается на клиенте (сегодня + 7 дней), а не берётся
  // из ответа: promoteCar возвращает только признак успеха, а тянуть
  // ради одной строки полный объект объявления незачем — срок
  // фиксирован правилами и известен заранее. После revalidateMy
  // карточка всё равно перерисуется серверными данными.
  function onPromote() {
    setError(null);

    if (promoState === 'active' && promoDate) {
      setPromoNote({ tone: 'success', text: `${t('my_promote_done')} ${promoDate}` });
      return;
    }

    if ((promoState === 'too_young' || promoState === 'cooldown') && promoDate) {
      setPromoNote({ tone: 'warning', text: `${t('my_promote_wait')} ${promoDate}` });
      return;
    }

    setPromoNote(null);
    startTransition(async () => {
      const result = await promoteCar(carId);

      if (!result.ok) {
        setError(t('my_action_error'));
        return;
      }

      const until = new Date();
      until.setDate(until.getDate() + PROMO_DAYS);
      setPromoNote({
        tone: 'success',
        text: `${t('my_promote_done')} ${formatDate(until.toISOString(), locale)}`,
      });
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
          {showPromote && (
            <Button
              size="sm"
              variant="secondary"
              fullWidth
              disabled={pending}
              onClick={onPromote}
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
          узнал бы ни про бесплатность, ни про срок.
          Показываем только когда продвижение действительно доступно:
          у молодого объявления и внутри окна ожидания эта строка
          противоречила бы подсказке с датой. */}
      {showPromote && promoState === 'available' && !confirming && (
        <p className="mt-1.5 text-small text-neutral-50">
          {t('my_promote_days')}
        </p>
      )}

      {/* Подсказка по продвижению. role="status" внутри Alert читается
          скринридером при появлении — нажатие обязано о чём-то
          сообщить и незрячему пользователю тоже. */}
      {promoNote && !confirming && (
        <Alert tone={promoNote.tone} className="mt-2">
          {promoNote.text}
        </Alert>
      )}

      {error && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}
    </div>
  );
}
