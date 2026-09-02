// ============================================================
// RS AUTO — Карточка объявления в кабинете владельца. Server Component.
// ============================================================
// Отличается от CarCard намеренно, и дело не в оформлении. В каталоге
// карточка продаёт: крупная фотография, цена, минимум текста. Здесь
// продавец УПРАВЛЯЕТ объявлением, и на первый план выходят статус,
// метрики и действия — то, чего в каталоге нет вовсе.
//
// Поэтому раскладка горизонтальная (фото слева, данные справа), как на
// экране my_cars приложения: у владельца объявлений единицы, и список
// строками читается быстрее сетки плиток.
//
// НА ДЕСКТОПЕ карточка стоит в сетке из двух-трёх колонок, и ширина
// колонки там около 360px — та же, что весь мобильный экран. Поэтому
// горизонтальная раскладка сохраняется на всех брейкпоинтах: делать
// внутри узкой колонки вертикальную плитку с фотографией во всю ширину
// значило бы растянуть карточку по высоте вдвое и уместить на экран
// втрое меньше объявлений.
//
// h-full нужен, чтобы карточки в одном ряду сетки были равной высоты:
// без него ряд выглядит рваным, когда у одного объявления есть причина
// отклонения или строка продвижения, а у соседнего нет.
//
// Карточка НЕ ссылка целиком: внутри живут кнопки действий, и вложенная
// в ссылку кнопка — ошибка разметки (интерактивный элемент внутри
// интерактивного). Ссылкой сделана только фотография с заголовком.
// ============================================================

import Image from 'next/image';
import Link from 'next/link';

import ListingActions from './ListingActions';
import StatusBadge from './StatusBadge';
import Alert from './ui/Alert';
import Badge from './ui/Badge';
import Card from './ui/Card';
import { formatDate, formatPrice, formatRentPrice } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import type { MyListing } from '@/lib/types';

type Props = {
  locale: Locale;
  listing: MyListing;
};

export default function MyListingCard({ locale, listing }: Props) {
  const t = getT(locale);

  // Объявление, снятое администратором (миграция 0089). Показывается
  // иначе, чем обычный архив, по существу дела: обычный архив продавец
  // создал сам и может отменить кнопкой, а этот — решение модератора,
  // которое кнопкой не отменяется. Карточка обязана объяснить разницу,
  // иначе продавец ищет исчезнувшую кнопку «Вернуть» и пишет в
  // поддержку с вопросом «почему не работает».
  const archivedByAdmin =
    listing.status === 'archived' && listing.archived_by === 'admin';

  // Активное объявление в последнюю неделю срока. Порог тот же, что у
  // серверного предупреждения (app_settings.listing_warn_days = 7):
  // продавец получает письмо и в тот же момент видит пометку в
  // кабинете — два канала об одном событии не должны расходиться.
  //
  // Значение зашито здесь константой, а не приходит с сервера: это
  // подсветка, а не бизнес-правило. Решение о скрытии принимает job,
  // и оно от этого числа не зависит.
  const EXPIRY_WARN_DAYS = 7;
  const expiringSoon =
    listing.status === 'active' &&
    listing.expires_at !== null &&
    new Date(listing.expires_at).getTime() - Date.now() <
      EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000;

  // Какую цену показывать. Объявление «только аренда» не имеет цены
  // продажи, и без этой проверки карточка написала бы «Цена по запросу»
  // там, где на самом деле указана суточная ставка.
  const rentOnly = listing.is_for_rent && !listing.is_for_sale;
  const price = rentOnly
    ? formatRentPrice(listing.rent_price_daily, listing.currency, locale)
    : formatPrice(listing.sale_price, listing.currency, locale);

  return (
    <Card padding="sm" className="flex h-full flex-col">
      <div className="flex gap-3">
        {/* Фотография ведёт на публичную карточку: продавцу важно
            видеть объявление глазами покупателя. */}
        <Link
          href={localeHref(locale, `/car/${listing.car_id}`)}
          className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-control bg-surface-muted sm:w-36"
        >
          {listing.photo_url ? (
            <Image
              src={listing.photo_url}
              alt={`${listing.brand} ${listing.model}`}
              fill
              sizes="(max-width: 640px) 112px, 144px"
              // Проданное притеняем — так же, как _Thumb в приложении:
              // завершённая сделка не должна выглядеть активной карточкой.
              className={`object-cover ${
                listing.status === 'sold' ? 'opacity-60' : ''
              }`}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-small text-neutral-30">
              {listing.brand}
            </div>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <Link
            href={localeHref(locale, `/car/${listing.car_id}`)}
            className="block font-semibold hover:underline"
          >
            {listing.brand} {listing.model}, {listing.year}
          </Link>

          <div className="mt-0.5 truncate text-caption text-neutral-60">
            {listing.city} · {price}
          </div>

          {/* Статус и промо — одной строкой, как в приложении.

              У снятого администратором вместо нейтрального «В архиве»
              стоит красная плашка: серый цвет читается как «я убрал
              объявление сам», а это не так. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {archivedByAdmin ? (
              <Badge tone="error">{t('my_status_archived_by_admin')}</Badge>
            ) : (
              <StatusBadge locale={locale} status={listing.status} />
            )}
            {listing.is_promoted && (
              <Badge tone="promoted">{t('car_promoted')}</Badge>
            )}
            {/* «Скоро истечёт» — только у активного и только внутри
                окна предупреждения. У истёкшего эту роль уже играет
                сам бейдж статуса, дублировать его нечем. */}
            {expiringSoon && (
              <Badge tone="warning">{t('my_expiring_soon')}</Badge>
            )}
          </div>

          {/* Дата окончания срока. Показывается у активного: продавцу
              нужно видеть её ЗАРАНЕЕ, а не узнавать о сроке в момент,
              когда объявление уже скрыто. */}
          {listing.status === 'active' && listing.expires_at && (
            <div className="mt-1 text-caption text-neutral-60">
              {t('my_expires_at').replace(
                '{date}',
                formatDate(listing.expires_at, locale),
              )}
            </div>
          )}

          {/* У истёкшего — объяснение и обещание, что ничего не
              потеряно. Без него продавец решит, что объявление удалено
              и придётся заводить заново. */}
          {listing.status === 'expired' && (
            <Alert tone="warning" className="mt-2">
              {t('my_expired_hint')}
            </Alert>
          )}

          {/* Причина отклонения. Без неё красный бейдж «Отклонено» —
              тупик: продавец не знает, что именно исправлять.
              Сервер отдаёт это поле только в статусе rejected. */}
          {listing.moderation_comment && (
            <Alert tone="error" className="mt-2">
              <span className="font-semibold">{t('my_rejected_reason')}:</span>{' '}
              {listing.moderation_comment}
            </Alert>
          )}

          {/* Причина снятия администратором + единственный доступный
              продавцу путь дальше. Кнопки «Вернуть» у такого объявления
              нет (ListingActions): решение администратора владелец
              прямым возвратом не отменяет. Зато замечание он может
              исправить сам — правка по существу отправляет объявление
              на повторную модерацию (update_car_v3, миграция 0090), и
              подсказка ведёт именно туда.

              Причина выводится, только если она есть: у архива времён
              до 0089 archived_by = null, и до этой ветки такой случай
              не доходит вовсе. */}
          {archivedByAdmin && (
            <Alert tone="error" className="mt-2">
              {listing.archived_reason && (
                <>
                  <span className="font-semibold">
                    {t('my_archived_reason')}:
                  </span>{' '}
                  {listing.archived_reason}{' '}
                </>
              )}
              {t('my_archived_fix_hint')}
            </Alert>
          )}
        </div>
      </div>

      {/* Метрики объявления — тот же набор и порядок, что в приложении:
          просмотры, избранное, контакты.
          mt-auto прижимает их вместе с действиями к низу карточки: в
          ряду сетки у соседей разное количество строк сверху, и без
          этого кнопки стояли бы на разной высоте.

          НА МОДЕРАЦИИ НЕ ПОКАЗЫВАЮТСЯ. Объявления ещё нет в выдаче,
          его физически некому просматривать, и три нуля подряд
          читаются как провал, а не как ожидание: продавец видит
          «0 просмотров» и делает вывод о площадке, хотя показывать
          объявление ещё не начинали. После одобрения строка появится
          вместе с первыми настоящими цифрами.

          mt-auto ЗДЕСЬ БОЛЬШЕ НЕ СТОИТ: он прижимал к низу карточки
          весь низ разом, а со скрытыми метриками ушёл бы вместе с
          ними, и кнопки у объявлений на проверке поехали бы вверх —
          в ряду сетки они встали бы на разной высоте с соседями.
          Теперь распорку держит обёртка действий ниже. */}
      {listing.status !== 'moderation' && (
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-neutral-10 pt-3">
        <Metric
          label={t('my_metric_views')}
          value={listing.views}
          icon={<IconEye />}
        />
        <Metric
          label={t('my_metric_favorites')}
          value={listing.favorites}
          icon={<IconHeart />}
        />
        <Metric
          label={t('my_metric_contacts')}
          value={listing.contacts}
          icon={<IconPhone />}
        />
      </div>
      )}

      {/* Срок продвижения — зелёным, рядом с действиями: продавцу нужно
          понимать, до какого числа объявление стоит в начале выдачи. */}
      {listing.is_promoted && listing.boosted_until && (
        <p className="mt-2 flex items-center gap-1.5 text-small text-brand-green">
          <IconRocket />
          {t('my_promoted_until')} {formatDate(listing.boosted_until, locale)}
        </p>
      )}

      {/* mt-auto перенесён сюда с блока метрик: он обязан работать
          независимо от того, показаны метрики или нет, иначе карточки
          на проверке встают в сетке выше соседних. */}
      <div className="mt-auto">
        <ListingActions
          locale={locale}
          carId={listing.car_id}
          status={listing.status}
          promoState={listing.promo_state}
          promoAvailableAt={listing.promo_available_at}
          archivedByAdmin={archivedByAdmin}
        />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Одна метрика: иконка + число + подпись.
// ------------------------------------------------------------
function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 text-caption">
      <span className="text-neutral-60">{icon}</span>
      <span className="font-semibold">{value}</span>
      <span className="text-neutral-60">{label}</span>
    </span>
  );
}

// ------------------------------------------------------------
// Иконки. Инлайновый SVG, а не иконочный шрифт или библиотека:
// их здесь четыре, и тянуть ради этого зависимость незачем.
// currentColor — цвет наследуется от родителя, поэтому иконка
// автоматически совпадает с цветом текста рядом.
// ------------------------------------------------------------
function IconEye() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1Z" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
    </svg>
  );
}

function IconRocket() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M4.5 16.5c-1.5 1.3-2 5.5-2 5.5s4.2-.5 5.5-2c.8-.9.8-2.2-.1-3a2.1 2.1 0 0 0-3.4-.5Z" />
      <path d="M12 15 9 12a15 15 0 0 1 9-9 15 15 0 0 1-3 9Z" />
      <path d="M9 12H5s.5-2.2 1.5-3S12 9 12 9" />
    </svg>
  );
}
