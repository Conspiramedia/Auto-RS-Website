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
import MyTabs from '@/components/MyTabs';
import SignOutButton from '@/components/SignOutButton';
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
      {/* SmartBanner в кабинете не подключается принципиально, и дело не
          только в том, что он сейчас выключен: кабинет — рабочее место
          продавца, звать его отсюда в другой клиент неуместно. */}
      <SiteHeader locale={locale} pathname="/my" />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {user === null ? (
          <AuthGate locale={locale} />
        ) : (
          <>
            {/* Заголовок и выход в одной строке: выход — действие
                третьестепенное, поэтому уводится вправо и оформлен
                ссылкой, а не кнопкой-акцентом. */}
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-xl font-semibold sm:text-2xl">
                {t('my_title')}
              </h1>
              <SignOutButton locale={locale} />
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
