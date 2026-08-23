'use client';

// ============================================================
// RS AUTO — Вкладки кабинета.
// ============================================================
// Client Component ради ОДНОГО: подсветки активного раздела. Определить
// её можно только по текущему адресу (usePathname), а Server Component
// адреса не знает.
//
// Сами вкладки остаются настоящими ссылками <Link>: переход между
// разделами кабинета — навигация, а не действие на странице. Это даёт
// работающие «назад», открытие в новой вкладке и предзагрузку Next.
//
// ВИД. Тот же паттерн чипсов, что у сортировки каталога
// (components/SortSelect.tsx): скруглённый контрол, активный —
// bg-brand-dark, остальные — контурные со светлым наведением. Роль
// разделов повторяет нижнюю навигацию приложения (my_cars, chats,
// profile), поэтому и порядок тот же.
// ============================================================

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref, stripLocale } from '@/lib/i18n';

type Props = {
  locale: Locale;
};

export default function MyTabs({ locale }: Props) {
  const t = getT(locale);
  const pathname = usePathname();

  // Адрес без префикса локали: на /ru/my/messages сравнивать нужно
  // '/my/messages', иначе ни одна вкладка не подсветится на русской
  // версии сайта.
  const { path } = stripLocale(pathname);

  const tabs = [
    { href: '/my', label: t('my_tab_listings') },
    { href: '/my/messages', label: t('my_tab_messages') },
    // Уведомления стоят между сообщениями и профилем: это лента
    // системных событий, по смыслу ближе к переписке, чем к настройкам.
    // Именно здесь продавец видит решение модерации, если письмо не
    // дошло или почта в профиле не указана вовсе.
    { href: '/my/notifications', label: t('my_tab_notifications') },
    { href: '/my/profile', label: t('my_tab_profile') },
  ];

  return (
    // НА МОБИЛЬНОМ ВКЛАДОК НЕТ (hidden sm:flex). Разделы кабинета
    // теперь стоят отдельными пунктами в меню шапки, и на узком
    // экране лента чипсов их дублировала: четыре вкладки не влезали
    // в 360px, уезжали в горизонтальную прокрутку и съедали строку
    // над содержимым. Ориентир, ради которого они были нужны,
    // обеспечивает подсветка активного пункта в самом меню.
    //
    // С sm вкладки остаются: там они видны целиком и переключают
    // разделы в один клик, без открытия меню.
    //
    // overflow-x-auto нужен и на планшете: четыре чипса с сербскими
    // подписями на 768px уже на пределе ширины.
    <nav className="mt-4 hidden gap-2 overflow-x-auto pb-1 sm:flex">
      {tabs.map((tab) => {
        // Точное совпадение для '/my' и префикс для остальных: иначе
        // вкладка «Мои объявления» подсвечивалась бы всегда, ведь её
        // адрес — начало всех прочих.
        const active =
          tab.href === '/my'
            ? path === '/my'
            : path === tab.href || path.startsWith(`${tab.href}/`);

        return (
          <Link
            key={tab.href}
            href={localeHref(locale, tab.href)}
            // aria-current — единственный признак активного раздела для
            // скринридера: цвет фона он не читает.
            aria-current={active ? 'page' : undefined}
            className={[
              'shrink-0 rounded-control px-4 py-2.5 text-caption font-semibold transition-colors duration-fast ease-out',
              active
                ? 'bg-brand-dark text-white'
                : 'border border-neutral-15 bg-white hover:bg-surface-hover',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
