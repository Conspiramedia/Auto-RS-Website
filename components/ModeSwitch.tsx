// ============================================================
// RS AUTO — Переключатель витрин «Продажа | Аренда». Server Component.
// ============================================================
// Обычные ссылки, а не скрипт: витрины — это разные разделы сайта со
// своими адресами (/cars и /rent), и краулер должен видеть переход
// настоящей ссылкой.
//
// Переключение всегда ведёт в КОРЕНЬ раздела, а не переносит фильтры:
// у продажи и аренды разные диапазоны цен (12 000 € против 40 €/сутки),
// и перенесённый фильтр «до 15 000» в аренде дал бы пустую выдачу.
// ============================================================

import Link from 'next/link';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import type { ListingType } from '@/lib/types';

type Props = {
  locale: Locale;
  // Активная витрина. 'both' сюда не передаётся — у него нет своей страницы.
  active: Exclude<ListingType, 'both'>;
};

export default function ModeSwitch({ locale, active }: Props) {
  const t = getT(locale);

  const base =
    'rounded-control px-3 py-1.5 text-sm font-semibold transition-colors';

  return (
    <div
      className="inline-flex gap-1 rounded-control bg-black/[0.06] p-1"
      role="navigation"
      aria-label={`${t('mode_sale')} / ${t('mode_rent')}`}
    >
      <Link
        href={localeHref(locale, '/cars')}
        className={
          active === 'sale'
            ? `${base} bg-white text-brand-dark shadow-sm`
            : `${base} text-black/55 hover:text-brand-dark`
        }
        aria-current={active === 'sale' ? 'page' : undefined}
      >
        {t('mode_sale')}
      </Link>

      <Link
        href={localeHref(locale, '/rent')}
        className={
          active === 'rent'
            ? `${base} bg-white text-brand-dark shadow-sm`
            : `${base} text-black/55 hover:text-brand-dark`
        }
        aria-current={active === 'rent' ? 'page' : undefined}
      >
        {t('mode_rent')}
      </Link>
    </div>
  );
}
