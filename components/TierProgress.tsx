// ============================================================
// RS AUTO — Прогресс до следующего уровня продавца (0143/0144).
// ============================================================
// Источник — RPC get_my_tier_progress(). Она отдаёт ЧИСЛА, а фразу
// собирает этот компонент: текст живёт в словаре сайта в двух локалях,
// и собирать его в базе значило бы держать переводы в двух местах.
//
// ПОЧЕМУ ЗДЕСЬ, А НЕ В ПРОФИЛЕ. Уровень зарабатывается объявлениями и
// продажами, и смотрит на него продавец там же, где ведёт список
// объявлений. В профиле лежат имя, телефон и настройки — прогресс
// оказался бы разделён с тем, что на него влияет.
//
// БЛОК МОЛЧИТ, КОГДА СКАЗАТЬ НЕЧЕГО. Ни строки на высшем уровне
// (расти некуда) и ни строки при ошибке запроса: пустая рамка с
// прочерками читалась бы как поломка кабинета, хотя список объявлений
// рядом работает.
// ============================================================

import TierBadge from '@/components/ui/TierBadge';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import type { TierProgress as TierProgressData } from '@/lib/types';
import { toSellerTier } from '@/lib/types';

type Props = {
  locale: Locale;
  data: TierProgressData | null;
};

// Заголовок «До серебра:» по НОМЕРУ СЛЕДУЮЩЕЙ ступени. Отдельная
// функция, потому что ключей три, а условие одно.
function nextTierKey(next: number) {
  if (next === 3) return 'tier_next_gold' as const;
  if (next === 2) return 'tier_next_silver' as const;
  return 'tier_next_bronze' as const;
}

export default function TierProgress({ locale, data }: Props) {
  if (!data) return null;

  const t = getT(locale);
  const tier = toSellerTier(data.tier);
  const isDealer = data.is_dealer;

  // Штраф показываем всегда, когда он действует: без объяснения
  // понижение выглядит как сбой, и продавец идёт в поддержку.
  const penalty =
    data.penalty_until && new Date(data.penalty_until) > new Date()
      ? t('tier_penalty').replace(
          '{date}',
          formatDate(data.penalty_until, locale),
        )
      : null;

  // Высший уровень: остаётся плашка и короткая строка, что расти
  // некуда. Прогресса нет, и рисовать пустое место незачем.
  const atMax = data.next_tier === null;

  // Салон на серебре: золото ему НАЗНАЧАЕТ площадка, и оба остатка
  // приходят null. Показать «ещё 0 объявлений» здесь было бы враньём —
  // объявления на это не влияют вовсе.
  const manualNext =
    !atMax && data.cars_left === null && data.sales_left === null;

  // Части фразы «ещё X объявлений или Y продаж». Ноль в остатке
  // означает, что условие уже выполнено по этой ветке, и печатать её
  // не нужно: строка «ещё 0 продаж» читается как насмешка.
  const parts: string[] = [];
  if (data.cars_left !== null && data.cars_left > 0) {
    parts.push(t('tier_progress_cars').replace('{n}', String(data.cars_left)));
  }
  if (data.sales_left !== null && data.sales_left > 0) {
    parts.push(
      t('tier_progress_sales').replace('{n}', String(data.sales_left)),
    );
  }

  return (
    <div className="rounded-card border border-neutral-10 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Уровень 0 плашки не получает — TierBadge вернёт null, и
            строка начнётся сразу с прогресса. Подпись «без уровня»
            здесь была бы обидной и ничего не сообщала. */}
        <TierBadge locale={locale} tier={tier} isDealer={isDealer} size="sm" />

        <span className="text-small text-neutral-60">
          {atMax ? (
            t('tier_max')
          ) : manualNext ? (
            t('tier_dealer_gold_manual')
          ) : (
            <>
              <span className="font-semibold text-neutral-70">
                {t(nextTierKey(data.next_tier ?? 1))}
              </span>{' '}
              {parts.join(` ${t('tier_progress_or')} `)}
            </>
          )}
        </span>
      </div>

      {penalty && (
        <p className="mt-2 text-caption text-error">{penalty}</p>
      )}
    </div>
  );
}
