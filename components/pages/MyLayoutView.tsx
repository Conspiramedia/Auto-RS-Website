// ============================================================
// RS AUTO — Каркас кабинета продавца. Server Component.
// ============================================================
// Один компонент на обе локали: app/my/layout.tsx и app/ru/my/layout.tsx
// отличаются только значением locale. Тот же приём, что у остальных
// страниц сайта (components/pages/*), — разметка не дублируется.
//
// РЕШЕНИЕ О ДОСТУПЕ ПРИНИМАЕТСЯ ЗДЕСЬ, а не на каждой странице: если бы
// проверку делала каждая страница отдельно, любая забытая проверка в
// следующем пакете открыла бы чужие данные. Одна точка входа надёжнее.
//
// Гостю показывается форма входа НА МЕСТЕ содержимого, без редиректа на
// отдельный адрес. Так пользователь остаётся там, куда шёл (например, на
// ссылке из письма), и после входа сразу видит нужный экран.
//
// ВЁРСТКА повторяет внутренние страницы сайта: та же шапка и подвал, тот
// же контейнер max-w-6xl, та же ступень заголовка. Вкладки — существующий
// паттерн чипсов (как в SortSelect и FilterChips), активная тёмная.
// Разделы названы как экраны приложения (my_cars, chats, profile).
// ============================================================

import type { ReactNode } from 'react';

import AuthGate from '@/components/AuthGate';
import MyCloseButton from '@/components/MyCloseButton';
import MyHeaderBack from '@/components/MyHeaderBack';
import MyTabs from '@/components/MyTabs';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { getCurrentUser } from '@/lib/supabaseServer';

type Props = {
  locale: Locale;
  children: ReactNode;
};

export default async function MyLayoutView({ locale, children }: Props) {
  const t = getT(locale);

  // getCurrentUser сверяет токен с сервером Supabase, а не доверяет
  // содержимому cookie (см. lib/supabaseServer.ts).
  const user = await getCurrentUser();

  return (
    <>
      {/* pathname='auto' — путь берётся из usePathname на клиенте.
          Здесь НЕЛЬЗЯ передать конкретную строку: layout не знает, какая
          страница внутри него отрисована. Стояло '/my', и смена языка с
          любого раздела кабинета уводила в «Мои объявления» — из
          открытого диалога в том числе. См. LocaleSwitchHere. */}
      <SiteHeader locale={locale} pathname="auto" />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {user === null ? (
          <AuthGate locale={locale} />
        ) : (
          <>
            {/* Заголовок и управление в одной строке.

                ВЫХОДА ИЗ АККАУНТА ЗДЕСЬ НЕТ, и это не пропажа: красная
                ссылка «Выйти» стояла вплотную к названию раздела и
                читалась как действие над самим кабинетом («закрыть»,
                «удалить»). Единственное место выхода — пункт внизу
                меню шапки: там он в ряду навигации, где его и ищут, и
                случайно не нажимается по пути к вкладкам.

                min-w-0 у h1 — чтобы при нехватке места сжимался
                заголовок, а не контролы: название раздела человек и
                так видит, а промахнуться по ужатой кнопке нельзя. */}
            <div className="flex items-center justify-between gap-x-4">
              <h1 className="min-w-0 text-h2 font-bold sm:text-h1">
                {t('my_title')}
              </h1>

              {/* Справа — два контрола, и они решают РАЗНЫЕ задачи:
                    «←» водит внутри кабинета (из диалога к списку
                       диалогов) и виден только там;
                    «×» закрывает кабинет и уводит на главную —
                       он есть на каждом разделе.
                  Поэтому в открытом диалоге видны оба: это не
                  дублирование, а «назад» и «выход».

                  -mr-2 втягивает область нажатия крестика в боковой
                  отступ страницы, чтобы сам знак встал на одну
                  вертикаль с содержимым ниже — тот же приём, что на
                  справочных страницах. */}
              <div className="flex shrink-0 items-center gap-x-1">
                <MyHeaderBack locale={locale} />
                <MyCloseButton locale={locale} className="-mr-2" />
              </div>
            </div>

            <MyTabs locale={locale} />

            {/* 24px (spacing.lg) до содержимого — тот же вертикальный
                ритм, что между блоками на остальных страницах. */}
            <div className="mt-6">{children}</div>
          </>
        )}
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
