'use client';

// ============================================================
// RS AUTO — Ссылка «Все чаты» в шапке кабинета.
// ============================================================
// Client Component по той же причине, что и MyTabs: показывать себя
// или нет, компонент решает по текущему адресу (usePathname), а
// Server Component адреса не знает.
//
// ПОЧЕМУ РЕШЕНИЕ ЗДЕСЬ, А НЕ В LAYOUT. Заголовок «Мой кабинет» рисует
// общий каркас (MyLayoutView) для всех страниц /my/*, а ссылка нужна
// ровно на одной — в открытом диалоге. Прокинуть её со страницы в
// каркас нельзя: в Next layout получает страницу через children и
// пропсов от неё не видит. Слот в каркасе решал бы задачу, но тогда
// каждая страница обязана была бы его заполнять (или помнить, что не
// должна). Проверка адреса в одном месте дешевле и не даёт ссылке
// протечь в «Мои объявления» или «Профиль».
//
// ГДЕ ПОКАЗЫВАЕТСЯ. Только /my/messages/<chatId> и только на мобильном
// (lg:hidden): с lg список диалогов стоит слева на самом экране, и
// ссылка «назад» вела бы туда, что и так видно. Сам список
// /my/messages — не диалог, там возвращаться некуда.
// ============================================================

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { Locale } from '@/lib/i18n';
import { getT, localeHref, stripLocale } from '@/lib/i18n';

type Props = {
  locale: Locale;
};

export default function MyHeaderBack({ locale }: Props) {
  const t = getT(locale);
  const pathname = usePathname();

  // Адрес без префикса локали: на /ru/my/messages/<id> сравнивать
  // нужно '/my/messages/<id>', иначе на русской версии ссылка не
  // появится вовсе.
  const { path } = stripLocale(pathname);

  // Открытый диалог — это /my/messages/<chatId>, то есть сегмент ПОСЛЕ
  // /my/messages. Проверяем именно наличие сегмента, а не startsWith:
  // сам список /my/messages под условие попадать не должен.
  const inChatRoom =
    path.startsWith('/my/messages/') && path.slice('/my/messages/'.length) !== '';

  if (!inChatRoom) return null;

  return (
    <Link
      href={localeHref(locale, '/my/messages')}
      className="shrink-0 text-caption font-semibold text-brand-blue transition-opacity duration-fast ease-out hover:opacity-80 lg:hidden"
    >
      ← {t('chat_back')}
    </Link>
  );
}
