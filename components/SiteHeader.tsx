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
// Разделы сайта на десктопе стоят в самой шапке, на мобильном живут
// в меню (HeaderMenu). В подвале они продублированы: это ещё и
// перелинковка для краулера с любой страницы сайта.
//
// Личные страницы (объявления, сообщения, уведомления, профиль) —
// ТОЛЬКО в меню, на всех ширинах: отдельной иконки кабинета в шапке
// больше нет.
//
// Логотип рендерит components/ui/Logo — там же он и меняется, когда
// появится векторный файл. Здесь знак только вставляется в шапку.
// ============================================================

import Link from 'next/link';

import Logo from './ui/Logo';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import LocaleSwitch from './LocaleSwitch';
import HeaderMenu from './HeaderMenu';
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
          элементами решает, поместится CTA или уедет за край.
          Отступы px-4 — те же, что у контейнера содержимого на всех
          страницах: логотип обязан стоять на одной вертикали с
          заголовком страницы под ним. Раньше здесь было асимметричное
          pl-3 pr-2, и знак съезжал влево относительно контента.
          Справа те же 16px компенсируются внутренним отступом
          последнего элемента (бургер на мобильном, CTA на десктопе),
          поэтому визуальный зазор у края не удваивается: -mr-1.5
          подтягивает кнопку с её собственным padding обратно к краю. */}
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4">
        <Link href={localeHref(locale, '/')} className="shrink-0">
          <Logo className="text-body sm:text-h4" />
        </Link>

        {/* Разделы сайта. Показываются только на десктопе (sm:flex):
            на мобильном места нет, там навигация живёт в подвале, а в
            шапке остаётся лого + язык + CTA. */}
        <nav className="hidden flex-1 items-center gap-5 text-caption sm:flex">
          {/* nav_catalog_menu: в ряду с «Арендой» это выбор вида
              сделки. Название раздела (nav_catalog) остаётся в
              хлебных крошках и JSON-LD. */}
          <Link href={localeHref(locale, '/cars')} className="hover:underline">
            {t('nav_catalog_menu')}
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

        <div className="-mr-1.5 ml-auto flex shrink-0 items-center gap-1.5 sm:mr-0 sm:gap-3">
          <LocaleSwitch locale={locale} pathname={pathname} />

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

          {/* Меню — последним, у самого края: это край, до которого
              дотягивается большой палец.
              ОТДЕЛЬНОЙ ССЫЛКИ НА КАБИНЕТ В ШАПКЕ БОЛЬШЕ НЕТ. Раньше
              здесь стояла иконка человечка со счётчиком непрочитанных,
              и разделы кабинета были доступны только через неё —
              безымянный знак, за которым пряталась половина личных
              страниц. Теперь вход, кабинет и счётчик живут в меню:
              бейдж с общим числом непрочитанного висит на самой
              кнопке, а внутри цифры разложены по разделам.
              Меню показывается на ВСЕХ ширинах: на десктопе разделы
              сайта продублированы в nav выше, но личные страницы
              есть только здесь. */}
          <HeaderMenu locale={locale} />
        </div>
      </div>
    </header>
  );
}
