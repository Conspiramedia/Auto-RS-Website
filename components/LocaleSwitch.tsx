// ============================================================
// RS AUTO — Переключатель языка (sr ↔ ru). Server Component.
// ============================================================
// Реализован обычными ссылками, а не скриптом: переключение языка должно
// работать без JS и, главное, давать краулеру настоящие <a href> на
// альтернативную версию страницы — это часть связки с hreflang.
//
// Пользователь остаётся на той же странице: подставляется тот же путь
// с другим префиксом локали.
// ============================================================

import Link from 'next/link';

import type { Locale } from '@/lib/i18n';
import { LOCALES, localeSwitchHref } from '@/lib/i18n';

const LABEL: Record<Locale, string> = {
  sr: 'SR',
  ru: 'RU',
};

type Props = {
  locale: Locale;
  // Путь БЕЗ префикса локали, например '/cars' или '/car/{id}'.
  pathname: string;
};

export default function LocaleSwitch({ locale, pathname }: Props) {
  return (
    <div className="flex items-center gap-1 text-xs font-semibold">
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <Link
            key={code}
            // Выбор языка сохраняется в cookie (middleware). Для
            // сербского адрес несёт маркер явного выбора: его зеркало
            // живёт в корне без префикса, и иначе middleware вернул бы
            // пользователя на прежний язык.
            href={localeSwitchHref(code, pathname)}
            hrefLang={code}
            className={
              active
                ? 'rounded-control bg-brand-dark px-2 py-1 text-white'
                : 'rounded-control px-2 py-1 text-brand-dark/60 hover:text-brand-dark'
            }
            aria-current={active ? 'true' : undefined}
          >
            {LABEL[code]}
          </Link>
        );
      })}
    </div>
  );
}
