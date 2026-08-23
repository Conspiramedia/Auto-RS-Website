// ============================================================
// RS AUTO — Шапка сайта. Server Component (интерактива нет).
// ============================================================
// Состав намеренно минимальный: логотип, переключатель языка и CTA
// продавцу. На 360px это ровно то, что помещается в одну строку без
// переполнения.
//
// Тумблера «Продажа / Аренда» здесь НЕТ: тип объявления — это фильтр
// выдачи, а не раздел сайта, и живёт он в панели фильтров. Раньше он
// стоял в шапке и на узких экранах выдавливал CTA за край.
//
// На мобильном разделы живут в бургер-меню (MobileMenu), на десктопе —
// в самой шапке. В подвале они продублированы: это ещё и перелинковка
// для краулера с любой страницы сайта.
//
// Логотип рендерит components/ui/Logo — там же он и меняется, когда
// появится векторный файл. Здесь знак только вставляется в шапку.
// ============================================================

import Link from 'next/link';

import Logo from './ui/Logo';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import HeaderAuth from './HeaderAuth';
import LocaleSwitch from './LocaleSwitch';
import MobileMenu from './MobileMenu';
import Button from './ui/Button';

type Props = {
  locale: Locale;
  // Путь текущей страницы без префикса локали — нужен переключателю языка,
  // чтобы остаться на том же месте при смене языка.
  pathname: string;
};

export default function SiteHeader({ locale, pathname }: Props) {
  const t = getT(locale);

  return (
    <header className="sticky top-0 z-header border-b border-neutral-10 bg-white">
      {/* gap-2 на мобильных и gap-4 с sm: на 360px каждый пиксель между
          элементами решает, поместится CTA или уедет за край. */}
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 pl-3 pr-2 sm:gap-4 sm:pl-4 sm:pr-3">
        <Link href={localeHref(locale, '/')} className="shrink-0">
          <Logo className="text-caption sm:text-h4" />
        </Link>

        {/* Разделы сайта. Показываются только на десктопе (sm:flex):
            на мобильном места нет, там навигация живёт в подвале, а в
            шапке остаётся лого + язык + CTA. */}
        <nav className="hidden flex-1 items-center gap-5 text-caption sm:flex">
          <Link href={localeHref(locale, '/cars')} className="hover:underline">
            {t('nav_catalog')}
          </Link>
          <Link href={localeHref(locale, '/rent')} className="hover:underline">
            {t('nav_rent')}
          </Link>
          <Link href={localeHref(locale, '/dealers')} className="hover:underline">
            {t('nav_dealers')}
          </Link>
          <Link href={localeHref(locale, '/app')} className="hover:underline">
            {t('nav_app')}
          </Link>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
          <LocaleSwitch locale={locale} pathname={pathname} />

          {/* Вход или ссылка в кабинет. Клиентский компонент: сервер
              шапку без него рендерит, и кэш публичных страниц остаётся
              статическим (см. комментарий в HeaderAuth). */}
          <HeaderAuth locale={locale} />

          {/* Сильный CTA продавцу — главная бизнес-цель сайта, поэтому он
              единственный акцентный элемент в шапке.
              whitespace-nowrap обязателен: «Prodaj auto» в две строки
              ломает высоту шапки. */}
          <Button
            size="xs"
            href={localeHref(locale, '/sell')}
            className="whitespace-nowrap"
          >
            {t('nav_sell')}
          </Button>

          {/* Бургер — только на мобильном: на десктопе разделы стоят
              в самой шапке (nav выше). Стоит последним, у самого края:
              это край, до которого дотягивается большой палец, и меню
              не разрывает пару «язык + CTA». */}
          <MobileMenu locale={locale} />
        </div>
      </div>
    </header>
  );
}
