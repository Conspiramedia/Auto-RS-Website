'use client';

// ============================================================
// RS AUTO — Вход / ссылка в кабинет в шапке. Client Component.
// ============================================================
// ПОЧЕМУ КЛИЕНТСКИЙ, а не серверный. Каталог и карточки объявлений
// кэшируются (revalidate 300–3600) — на них держится SEO. Чтение cookie
// сессии в серверном компоненте шапки перевело бы КАЖДУЮ страницу сайта
// в динамический рендер и обнулило бы этот кэш: цена одной ссылки —
// потеря статики на всём сайте.
//
// Поэтому сервер рисует шапку без блока входа, а состояние
// подставляется после гидратации. Разметки на сервере нет вовсе, значит
// и расхождения гидратации быть не может.
//
// ГОСТЮ — НИ ОДНОГО ЗАПРОСА. Сначала проверяется наличие сессии
// (локально, из cookie), и только у вошедшего запрашивается счётчик
// непрочитанных. Посетитель без аккаунта — большинство трафика, и
// тратить на него обращение к базе на каждой странице недопустимо.
//
// REALTIME НЕ ПОДКЛЮЧАЕТСЯ намеренно: постоянное соединение ради цифры
// в шапке — несоразмерная плата. Счётчик обновляется при переходах
// между страницами, этого достаточно; внутри чата свежесть обеспечит
// сам чат (Пакет 4).
// ============================================================

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref, stripLocale } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';

type Props = {
  locale: Locale;
};

export default function HeaderAuth({ locale }: Props) {
  const t = getT(locale);
  const pathname = usePathname();

  // null — проверка ещё идёт: до её конца не показываем ничего. Мелькнувшее
  // «Войти» у давно вошедшего продавца выглядит как разлогин.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = getBrowserClient();

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      const hasSession = data.session != null;
      setSignedIn(hasSession);

      // Ключевая экономия: гостю дальше ходить некуда.
      if (!hasSession) return;

      const { data: count, error } = await supabase.rpc('get_unread_count');
      if (cancelled || error) return;

      setUnread(typeof count === 'number' ? count : 0);
    })();

    return () => {
      cancelled = true;
    };
    // pathname в зависимостях — счётчик обновляется при переходах между
    // страницами: это и есть замена realtime, о которой сказано выше.
  }, [pathname]);

  if (signedIn === null) return null;

  // Гость: ссылка на страницу входа с адресом возврата. Текущий путь
  // передаём БЕЗ префикса локали — /login добавит его сам, иначе на
  // русской версии получился бы /ru/ru/….
  if (!signedIn) {
    const { path } = stripLocale(pathname);
    const back = path === '/login' ? '' : `?redirect=${encodeURIComponent(path)}`;

    return (
      <Link
        href={`${localeHref(locale, '/login')}${back}`}
        className="whitespace-nowrap text-caption font-medium text-neutral-60 transition-colors duration-fast ease-out hover:text-brand-primary"
      >
        {t('nav_login')}
      </Link>
    );
  }

  // Вошедший: ссылка в кабинет. Подпись скрыта на узких экранах —
  // там в шапке уже стоят язык, CTA подачи и бургер, и четвёртый
  // текстовый элемент выдавил бы CTA за край.
  return (
    <Link
      href={localeHref(locale, '/my')}
      className="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap text-caption font-medium text-neutral-60 transition-colors duration-fast ease-out hover:text-brand-primary"
    >
      <IconUser />
      <span className="hidden lg:inline">{t('nav_my')}</span>

      {/* Счётчик непрочитанных. Красный — роль «требует внимания»,
          та же, что у бейджа вкладки «Сообщения» в кабинете.
          99+ вместо трёхзначного числа: точное значение здесь не
          важно, а ширина шапки ограничена. */}
      {unread > 0 && (
        <span className="absolute -right-1.5 -top-1 min-w-[18px] rounded-pill bg-brand-red px-1 text-center text-small font-semibold leading-[18px] text-white lg:static lg:min-w-0 lg:px-1.5">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}

// Иконка кабинета. Инлайновый SVG: набора иконок в проекте нет,
// currentColor наследует цвет ссылки вместе с наведением.
function IconUser() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
