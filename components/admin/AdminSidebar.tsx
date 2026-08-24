'use client';

// ============================================================
// RS AUTO — Навигация админ-комнаты. Client Component.
// ============================================================
// Клиентский он ровно по одной причине: подсветка активного пункта
// требует usePathname(). Данных здесь нет — счётчик очереди приходит
// пропом из layout, который читает его на сервере.
//
// МЁРТВЫХ ССЫЛОК НЕТ. Пункты «Объявления», «Пользователи» и «Журнал»
// появятся в своих пакетах (M5–M7) вместе со страницами. Показывать их
// заранее — значит отправлять модератора на 404 из собственного меню.
//
// Ссылки без префикса локали: раздел одноязычный, /ru/admin не
// существует, и localeHref здесь был бы не просто лишним, а вредным —
// он увёл бы модератора с русской cookie на несуществующий адрес.
// ============================================================

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Props = {
  // Число объявлений, ждущих проверки. Живое: layout динамический,
  // и цифра пересчитывается на каждом переходе внутри админки.
  queueCount: number;
};

// Пункты меню. Порядок = порядок работы модератора: сначала общая
// картина, затем очередь, ради которой он сюда и пришёл.
const ITEMS = [
  { href: '/admin', label: 'Дашборд' },
  { href: '/admin/queue', label: 'Очередь' },
] as const;

export default function AdminSidebar({ queueCount }: Props) {
  const pathname = usePathname();

  return (
    // Тёмная панель 220px на десктопе; ниже 1024px превращается в
    // горизонтальную строку над содержимым. Не «бургер»: пунктов два,
    // и прятать их за кнопкой значило бы добавить лишнее нажатие к
    // самому частому действию — переходу в очередь.
    <nav
      className="
        shrink-0 bg-brand-dark
        lg:sticky lg:top-0 lg:h-dvh lg:w-[220px]
      "
      aria-label="Разделы админки"
    >
      <div
        className="
          flex items-center gap-4 px-4 py-3
          lg:flex-col lg:items-stretch lg:gap-1 lg:px-3 lg:py-4
        "
      >
        {/* Заголовок раздела. На мобильном стоит в строке слева и
            работает как метка «где я», на десктопе — шапка панели. */}
        <span className="shrink-0 text-caption font-bold text-white lg:mb-3 lg:px-2">
          RS Auto · Админка
        </span>

        {ITEMS.map((item) => {
          // Точное сравнение для дашборда, префиксное для остальных:
          // /admin — префикс вообще всех адресов раздела, и startsWith
          // подсветил бы его на каждой странице.
          const active =
            item.href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={[
                'flex items-center justify-between gap-2 rounded-control px-3 py-2',
                'text-caption transition-colors duration-fast',
                active
                  ? 'bg-white/15 font-semibold text-white'
                  : 'text-on-dark-70 hover:bg-white/10 hover:text-white',
              ].join(' ')}
            >
              <span>{item.label}</span>

              {/* Счётчик только у очереди и только когда есть что
                  проверять: постоянный «0» перестаёт замечаться, и
                  появление первой единицы теряется. Золотой — цвет
                  статуса moderation на всём сайте. */}
              {item.href === '/admin/queue' && queueCount > 0 && (
                <span className="rounded-pill bg-brand-gold px-2 py-0.5 text-micro font-bold text-brand-dark">
                  {queueCount}
                </span>
              )}
            </Link>
          );
        })}

        {/* Выход из админки на сайт. Прижат к низу панели на десктопе:
            это не рабочий пункт, а дверь наружу. */}
        <Link
          href="/"
          className="
            ml-auto shrink-0 rounded-control px-3 py-2 text-caption
            text-on-dark-70 transition-colors duration-fast
            hover:bg-white/10 hover:text-white
            lg:ml-0 lg:mt-auto
          "
        >
          ← На сайт
        </Link>
      </div>
    </nav>
  );
}
