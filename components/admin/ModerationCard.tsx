// ============================================================
// RS AUTO — Карточка объявления для проверки. Server Component.
// ============================================================
// Только показ: галерея, поля, продавец, история решений. Кнопок здесь
// нет — их держит панель действий на странице, потому что им нужен
// клиент (обработчики, диалог, горячие клавиши), а всему остальному
// нет. Так клиентским остаётся минимум разметки.
//
// ЧТО ИМЕННО ПОКАЗЫВАЕМ И ПОЧЕМУ ИМЕННО ЭТО. Модератор отвечает на
// один вопрос: можно ли это публиковать. Значит на экране обязаны быть
// ровно те данные, по которым нарушение видно, — фотографии крупно,
// описание целиком (в нём прячут контакты и рекламу), телефон,
// заявленная цена и контекст доверия по продавцу. Всё остальное
// (пробег, кузов, коробка, объём) идёт компактной таблицей: оно нужно,
// чтобы сверить с фото, но само по себе решения не определяет.
//
// СОСТОЯНИЕ И ДОСТУПНОСТЬ (0140) стоят ОТДЕЛЬНОЙ ПЛАШКОЙ над
// таблицей, а не строкой в ней. Это заявление продавца о предмете
// сделки, и проверяется оно по описанию и фотографиям: «новая
// машина» в тексте при пометке «без документов» — типовой отказ, а
// «в пути» у частника — повод разобраться. Утонув в таблице рядом с
// коробкой передач, такое заявление осталось бы незамеченным.
//
// Обычная машина плашки не получает: 'normal' и 'in_stock' — значения
// по умолчанию, и сообщать о них нечего.
//
// Фотографии вынесены в ModerationGallery (Client): просмотр всего
// набора крупно требует переключения кадра, а это интерактив.
// ============================================================

import ActionLabel from './ActionLabel';
import ModerationGallery from './ModerationGallery';
import type { AdminCar } from '@/lib/types';
import {
  formatDeposit,
  formatMileage,
  formatPrice,
  labelBodyType,
  labelFuel,
  labelTransmission,
} from '@/lib/format';

// Админка одноязычна — русская. Форматтеры сайта требуют локаль,
// передаём её одним местом, чтобы не рассыпать 'ru' по всему файлу.
const L = 'ru' as const;

// Состояние автомобиля (0138, 0139). Подписи свои, а не из i18n
// сайта: админка одноязычна, и тянуть в неё словарь обеих локалей
// ради четырёх строк незачем.
//
// 'normal' в словаре НЕТ намеренно: обычная машина плашки не
// получает, и отсутствие ключа — это и есть признак «показывать
// нечего».
const CONDITION_LABEL: Record<string, string> = {
  damaged: 'Битый / повреждённый',
  parts: 'На запчасти / тотал',
  no_docs: 'Без документов',
  for_export: 'Только на экспорт',
};

// Доступность у салона (0119). 'in_stock' отсутствует по той же
// причине, что и 'normal' выше.
const AVAILABILITY_LABEL: Record<string, string> = {
  on_order: 'Под заказ',
  in_transit: 'В пути',
};

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Кто отправил объявление в архив (cars.archived_by, миграция 0089).
// Формулировки развёрнутые, а не 'admin'/'owner': карточку читает
// человек, и «снято администратором» отвечает на его вопрос сразу, без
// перевода кода в голове.
const ARCHIVED_BY_LABEL: Record<string, string> = {
  admin: 'снято администратором',
  owner: 'убрано самим продавцом',
  // Регламентные снятия. Значение заведено в enum заранее и сегодня не
  // проставляется ни одним путём — подпись готова к тому дню, когда
  // появится первый такой путь.
  system: 'снято автоматически',
};

// Пара «подпись — значение» в таблице характеристик.
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro text-neutral-50">{label}</dt>
      <dd className="mt-0.5 truncate text-caption">{value}</dd>
    </div>
  );
}

export default function ModerationCard({ car }: { car: AdminCar }) {
  // Продавец с историей отклонений требует другого внимания, чем тот,
  // кто подаёт впервые. Порог в одно отклонение намеренно низкий:
  // это подсказка «присмотритесь», а не обвинение.
  const risky = car.owner_rejected_count > 0;

  // Подписи заявленных состояний (0140). Значения по умолчанию
  // ('normal', 'in_stock') и неизвестные строки дают undefined —
  // плашка тогда не рисуется вовсе.
  const conditionLabel = car.condition
    ? CONDITION_LABEL[car.condition]
    : undefined;
  const availabilityLabel = car.availability
    ? AVAILABILITY_LABEL[car.availability]
    : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
      {/* ---------- Слева: фотографии ---------- */}
      {/* Галерея клиентская: модератору нужно посмотреть каждый снимок
          крупно, а переключение кадра — интерактив. Всё остальное на
          карточке остаётся серверным. */}
      <div className="min-w-0">
        <ModerationGallery photos={car.photos} />
      </div>

      {/* ---------- Справа: данные ---------- */}
      <div className="min-w-0">
        <h1 className="text-h3 font-semibold">
          {car.brand} {car.model}, {car.year}
        </h1>

        <p className="mt-1 text-caption text-neutral-60">
          {car.city} · подано {DATE_TIME.format(new Date(car.created_at))}
        </p>

        {/* ---------- Кто снял объявление (0089) ---------- */}
        {/* Блок стоит ВЫШЕ цен и характеристик намеренно: он меняет
            смысл всего остального. Объявление, снятое коллегой,
            модератор смотрит иначе, чем убранное самим продавцом, —
            в первом случае решение уже принято и его надо либо
            подтвердить, либо отменить, во втором решать нечего.

            Показывается только для архива: у активного объявления
            archived_by пуст (его чистит триггер), и пустая плашка
            «снял: никто» была бы шумом. */}
        {car.status === 'archived' && (
          <div
            className={[
              'mt-3 rounded-card border p-3',
              car.archived_by === 'admin'
                ? 'border-error/30 bg-status-error'
                : 'border-neutral-10',
            ].join(' ')}
          >
            <p className="text-micro text-neutral-50">Снято с публикации</p>
            <p
              className={[
                'mt-0.5 font-medium',
                car.archived_by === 'admin' ? 'text-error' : '',
              ].join(' ')}
            >
              {ARCHIVED_BY_LABEL[car.archived_by ?? ''] ??
                // Архив времён до 0089: авторство не фиксировалось.
                // Честнее сказать «неизвестно», чем молча показать
                // «продавцом» и ввести модератора в заблуждение.
                'автор снятия неизвестен (до миграции 0089)'}
            </p>
            {car.archived_reason && (
              <p className="mt-1 whitespace-pre-wrap break-words text-caption text-neutral-70">
                {car.archived_reason}
              </p>
            )}
          </div>
        )}

        {/* Цены. Показываем обе, если объявление и на продажу, и в
            аренду: заниженная цена — типовая причина отказа, и
            прятать одну из них под флагом нельзя. */}
        <div className="mt-4 rounded-card border border-neutral-10 p-3">
          {car.is_for_sale && (
            <p className="text-h4 font-bold">
              {formatPrice(car.sale_price, car.currency, L)}
            </p>
          )}
          {car.is_for_rent && (
            <p className={car.is_for_sale ? 'mt-1 text-caption' : 'text-h4 font-bold'}>
              {formatPrice(car.rent_price_daily, car.currency, L)} / сутки
              {car.deposit_amount > 0 && (
                <span className="text-neutral-60">
                  {' '}
                  · залог {formatDeposit(car.deposit_amount, car.currency, L)}
                </span>
              )}
            </p>
          )}
        </div>

        {/* ЗАЯВЛЕНИЕ ПРОДАВЦА О ПРЕДМЕТЕ СДЕЛКИ (0140) — см. шапку
            файла. Плашка янтарная, а не красная: это не нарушение,
            а факт, который модератор обязан сверить с описанием и
            фотографиями. Красный читался бы как «уже отклонено». */}
        {(conditionLabel || availabilityLabel) && (
          <div className="mt-4 rounded-card border border-warning bg-status-warning p-3">
            {conditionLabel && (
              <p className="font-semibold text-neutral-100">
                Состояние: {conditionLabel}
              </p>
            )}
            {availabilityLabel && (
              <p
                className={`${conditionLabel ? 'mt-1 ' : ''}font-semibold text-neutral-100`}
              >
                Наличие: {availabilityLabel}
              </p>
            )}
            <p className="mt-1 text-micro text-neutral-60">
              Сверьте с описанием и фотографиями.
            </p>
          </div>
        )}

        {/* Характеристики — компактной сеткой. */}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-2">
          <Field label="Пробег" value={formatMileage(car.mileage, L)} />
          <Field label="Кузов" value={labelBodyType(car.body_type, L)} />
          <Field label="Коробка" value={labelTransmission(car.transmission, L)} />
          <Field label="Топливо" value={labelFuel(car.fuel, L)} />
          {/* Объём (0133): у электромобилей его нет, и прочерк здесь
              честнее пропуска — модератор видит, что поле пустое, а
              не забытое. */}
          <Field
            label="Объём двигателя"
            value={car.engine_volume != null ? `${car.engine_volume} л` : '—'}
          />
          <Field
            label="Телефон в объявлении"
            value={car.contact_phone ?? '—'}
          />
          <Field label="Валюта" value={car.currency} />
        </dl>

        {/* Описание — ЦЕЛИКОМ, без сворачивания. Именно в нём прячут
            контакты, рекламу сторонних площадок и признаки схем, а
            текст под «показать ещё» модератор не раскрывает. */}
        <div className="mt-4">
          <p className="text-micro text-neutral-50">Описание</p>
          {car.description ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-caption">
              {car.description}
            </p>
          ) : (
            <p className="mt-1 text-caption text-neutral-40">не заполнено</p>
          )}
        </div>

        {/* ---------- Продавец ---------- */}
        <div className="mt-6 rounded-card border border-neutral-10 p-3">
          <p className="text-micro text-neutral-50">Продавец</p>
          <p className="mt-0.5 font-medium">{car.owner_name ?? 'без имени'}</p>
          <p className="mt-0.5 break-all text-caption text-neutral-60">
            {car.owner_email}
            {car.owner_phone ? ` · ${car.owner_phone}` : ''}
          </p>
          <p className="mt-0.5 text-micro text-neutral-50">
            На площадке с {DATE_TIME.format(new Date(car.owner_created_at))}
            {' · '}
            язык писем: {car.owner_locale === 'ru' ? 'русский' : 'сербский'}
          </p>

          {/* Контекст доверия. Красным — только когда отклонения
              действительно есть: постоянная цветная плашка перестала
              бы читаться как сигнал. */}
          <p
            className={[
              'mt-2 text-caption',
              risky ? 'font-medium text-error' : 'text-neutral-60',
            ].join(' ')}
          >
            Объявлений: {car.owner_listings_total}
            {' · '}
            отклонено сейчас: {car.owner_rejected_count}
          </p>
        </div>

        {/* ---------- История решений ---------- */}
        {/* Блок появляется только когда история есть: пустой заголовок
            «История» на первом заходе объявления — шум.
            Зачем он нужен: объявление приходит на повторную проверку
            после правки, и модератор обязан видеть, за что его
            отклонили в прошлый раз. Иначе он либо придирается к уже
            исправленному, либо пропускает то же нарушение.

            С 0089 сюда попадают все события журнала по объявлению, а
            не только решения модерации. Причина та же: снятие с
            публикации и возврат из архива — часть той же истории, и
            спор «кто вернул объявление в выдачу» разбирается именно
            по этому списку. */}
        {car.moderation_history.length > 0 && (
          <div className="mt-4">
            <p className="text-micro text-neutral-50">История модерации</p>
            <ul className="mt-2 space-y-2">
              {car.moderation_history.map((event, i) => {
                // payload — свободный jsonb из журнала: у отклонения
                // и у снятия там reason. Читаем аккуратно: строка или
                // ничего.
                const reason =
                  typeof event.payload?.reason === 'string'
                    ? event.payload.reason
                    : null;

                return (
                  <li
                    key={`${event.created_at}-${i}`}
                    className="rounded-control border border-neutral-10 p-2 text-caption"
                  >
                    {/* Подпись берём из общего словаря журнала, а не
                        из тернарника «отклонено/одобрено». После 0089
                        в историю попадают ВСЕ события по объявлению —
                        снятие, возврат администратором, возврат
                        владельцем, — и деление надвое показывало бы
                        «Одобрено» там, где объявление на самом деле
                        сняли с публикации. */}
                    <ActionLabel action={event.action} />
                    <span className="text-neutral-60">
                      {' · '}
                      {event.actor_name}
                      {' · '}
                      {DATE_TIME.format(new Date(event.created_at))}
                    </span>
                    {reason && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-neutral-70">
                        {reason}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
