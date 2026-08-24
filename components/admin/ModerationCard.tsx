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
// (пробег, кузов, коробка) идёт компактной таблицей: оно нужно, чтобы
// сверить с фото, но само по себе решения не определяет.
//
// Фотографии — обычные <img>, а не next/image. Снимки лежат в Supabase
// Storage, их адреса динамические, и оптимизатор Next пропускал бы
// каждый через себя без пользы: карточку открывает один модератор
// несколько раз в день, а не тысячи посетителей.
// ============================================================

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

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
      {/* ---------- Слева: фотографии ---------- */}
      <div className="min-w-0">
        {car.photos.length === 0 ? (
          // Объявление без единого снимка — почти всегда отказ, и
          // сказать об этом надо прямо, а не пустым местом.
          <div className="rounded-card border border-error/30 bg-status-error px-6 py-12 text-center">
            <p className="font-semibold text-error">Фотографий нет</p>
            <p className="mt-1 text-caption text-neutral-70">
              Объявление без снимков публиковать нельзя.
            </p>
          </div>
        ) : (
          <>
            {/* Первое фото крупно: именно оно станет обложкой в
                каталоге, и именно к нему больше всего претензий —
                чужой снимок, не тот автомобиль, скриншот. */}
            <img
              src={car.photos[0].image_url}
              alt=""
              className="w-full rounded-card border border-neutral-10 object-cover"
            />

            {car.photos.length > 1 && (
              // Остальные — сеткой во всю ширину, а не лентой с
              // прокруткой: модератор должен окинуть взглядом весь
              // набор сразу, чтобы заметить разнобой (разные машины,
              // разные номера, разный фон).
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {car.photos.slice(1).map((photo) => (
                  <img
                    key={photo.order_index}
                    src={photo.image_url}
                    alt=""
                    className="aspect-[4/3] w-full rounded-control border border-neutral-10 object-cover"
                  />
                ))}
              </div>
            )}

            <p className="mt-2 text-micro text-neutral-50">
              Фотографий: {car.photos.length}
            </p>
          </>
        )}
      </div>

      {/* ---------- Справа: данные ---------- */}
      <div className="min-w-0">
        <h1 className="text-h3 font-semibold">
          {car.brand} {car.model}, {car.year}
        </h1>

        <p className="mt-1 text-caption text-neutral-60">
          {car.city} · подано {DATE_TIME.format(new Date(car.created_at))}
        </p>

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

        {/* Характеристики — компактной сеткой. */}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-2">
          <Field label="Пробег" value={formatMileage(car.mileage, L)} />
          <Field label="Кузов" value={labelBodyType(car.body_type, L)} />
          <Field label="Коробка" value={labelTransmission(car.transmission, L)} />
          <Field label="Топливо" value={labelFuel(car.fuel, L)} />
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
            исправленному, либо пропускает то же нарушение. */}
        {car.moderation_history.length > 0 && (
          <div className="mt-4">
            <p className="text-micro text-neutral-50">История модерации</p>
            <ul className="mt-2 space-y-2">
              {car.moderation_history.map((event, i) => {
                const rejected = event.action === 'car_rejected';
                // payload — свободный jsonb из журнала: у отклонения
                // там reason. Читаем аккуратно: строка или ничего.
                const reason =
                  typeof event.payload?.reason === 'string'
                    ? event.payload.reason
                    : null;

                return (
                  <li
                    key={`${event.created_at}-${i}`}
                    className="rounded-control border border-neutral-10 p-2 text-caption"
                  >
                    <span
                      className={
                        rejected ? 'font-medium text-error' : 'font-medium text-success'
                      }
                    >
                      {rejected ? 'Отклонено' : 'Одобрено'}
                    </span>
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
