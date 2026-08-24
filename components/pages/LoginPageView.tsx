// ============================================================
// RS AUTO — Страница входа /login. Server Component.
// ============================================================
// Общая для /login и /ru/login.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ СТРАНИЦА, если форма входа уже подставляется вместо
// содержимого кабинета. Кабинет — не единственное место, куда нужно
// войти: ссылка «Войти» стоит в шапке и в бургер-меню, и вести её в
// /my значило бы объяснять человеку, что «мои объявления» — это форма
// входа. Отдельный адрес честнее и, в отличие от кабинета, на него
// можно сослаться из письма или из ошибки доступа.
//
// ВОШЕДШИЙ СЮДА НЕ ПОПАДАЕТ: страница входа для того, у кого сессия
// уже есть, — тупик. Редиректим его туда, куда он шёл.
//
// ПАРАМЕТР ?redirect= — путь, на который вернуть после входа. Принимаем
// ТОЛЬКО внутренние пути (см. safeRedirect ниже): подставленный в
// адресную строку внешний адрес превратил бы страницу входа в открытый
// редирект, а это классический вектор фишинга — ссылка на настоящий
// домен, уводящая на чужой сайт.
// ============================================================

import { redirect } from 'next/navigation';

import AuthGate from '@/components/AuthGate';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import Logo from '@/components/ui/Logo';
import type { Locale } from '@/lib/i18n';
import { getT, localeAwareHref } from '@/lib/i18n';
import { getCurrentUser } from '@/lib/supabaseServer';

type Props = {
  locale: Locale;
  // Сырое значение ?redirect= из адресной строки.
  redirectParam?: string;
};

// Проверка адреса возврата. Разрешаем только путь внутри сайта:
// начинается с одного слэша и не с «//» (протокол-относительный адрес
// вида //evil.com браузер считает внешним).
function safeRedirect(raw: string | undefined): string {
  if (!raw) return '/my';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/my';

  // Префикс локали снимаем: AuthGate добавит его сам через localeHref,
  // иначе на русской версии получился бы путь вида /ru/ru/my.
  if (raw === '/ru') return '/';
  if (raw.startsWith('/ru/')) return raw.slice(3);

  return raw;
}

export default async function LoginPageView({
  locale,
  redirectParam,
}: Props) {
  const t = getT(locale);
  const target = safeRedirect(redirectParam);

  const user = await getCurrentUser();
  if (user) redirect(localeAwareHref(locale, target));

  return (
    <>
      <SiteHeader locale={locale} pathname="/login" />

      {/* На десктопе форма стоит по центру экрана, а не прижата к шапке:
          на странице больше ничего нет, и прижатый к верху блок оставлял
          бы под собой пустое поле в пол-экрана. min-h подобран так, что
          вместе с шапкой и подвалом заполняется первый экран. */}
      <main className="mx-auto flex min-h-[60vh] max-w-6xl flex-col items-center justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-md">
          {/* Логотип над карточкой: страница входа — единственная, куда
              можно попасть по прямой ссылке из письма, и она обязана
              сразу сообщать, куда человек пришёл. */}
          <div className="mb-6 flex justify-center">
            <Logo className="text-body sm:text-h4" />
          </div>

          {/* closeHref — выход для передумавшего. Ведёт на главную, а
              не «назад» в историю: сюда чаще всего попадают редиректом
              с закрытой страницы (кабинет, чат), и шаг назад вернул бы
              человека ровно на неё, а она снова отправила бы его на
              вход — петля. Главная — нейтральная точка, с которой
              открыты и каталог, и всё остальное, доступное без входа. */}
          <AuthGate
            locale={locale}
            redirectTo={target}
            title={t('login_title')}
            closeHref="/"
          />
        </div>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
