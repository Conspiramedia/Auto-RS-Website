'use client';

// ============================================================
// RS AUTO — Кнопка «Войти через Google».
// ============================================================
// Client Component: нажатие уводит в OAuth-поток Supabase, а для этого
// нужен браузерный клиент и текущий адрес страницы.
//
// ЧТО ДЕЛАЕТ. Просит GoTrue выдать адрес авторизации Google и уводит
// туда браузер. Обратно человек возвращается на /auth/callback, где
// код меняется на сессию (app/auth/callback/route.ts).
//
// ВТОРОГО ПУТИ К СЕССИИ ЗДЕСЬ НЕТ — правило площадки соблюдено (см.
// components/AuthGate.tsx): сессию по-прежнему выдаёт GoTrue, сайт
// только начинает поток и принимает результат.
//
// ПОЧЕМУ БЕЛАЯ КНОПКА С РАМКОЙ (variant secondary). Это не оформительский
// выбор: правила бренда Google для кнопки входа разрешают белый или
// синий фирменный фон Google с их же логотипом. Перекрашивать её в
// брендовый синий площадки нельзя. Заодно она визуально отличается от
// синей «Войти» ниже — а это разные действия, и путать их не нужно.
//
// СОГЛАСИЕ С ДОКУМЕНТАМИ. Вход через Google создаёт аккаунт так же, как
// вход по коду, поэтому политику нужно принять до перехода — иначе
// человек заводил бы аккаунт, не увидев условий. Проверку делает
// родительский AuthGate: галочка живёт там, и дублировать её здесь
// значило бы показать две разные галочки в одной форме.
// ============================================================

import { useState } from 'react';

import Button from './ui/Button';
import { trackEvent } from '@/lib/analytics';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';

type Props = {
  locale: Locale;
  // Путь возврата ПОСЛЕ входа, без префикса локали. Уезжает в адрес
  // callback параметром next и возвращается оттуда редиректом.
  redirectTo?: string;
  // Форма занята другим действием (уходит код на почту) — кнопка
  // блокируется, чтобы человек не запустил два входа разом.
  disabled?: boolean;
  // Согласие с документами не отмечено. Отдельный признак от disabled:
  // причина другая, и родитель показывает по ней свой текст ошибки.
  onBlocked?: () => void;
  blocked?: boolean;
};

export default function GoogleSignInButton({
  locale,
  redirectTo,
  disabled,
  blocked,
  onBlocked,
}: Props) {
  const t = getT(locale);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    // Документы не приняты — не уводим человека к Google вовсе:
    // вернувшись, он всё равно упёрся бы в ту же галочку, уже имея
    // созданный аккаунт.
    if (blocked) {
      onBlocked?.();
      return;
    }

    setBusy(true);

    // Адрес возврата собирается ЗДЕСЬ, в браузере, из текущего
    // origin — а не берётся из переменной окружения. Причина
    // практическая: на preview-сборках и на localhost origin другой, и
    // зашитый боевой адрес уводил бы с них на прод, где сессии нет.
    const callback = new URL('/auth/callback', window.location.origin);
    if (redirectTo) callback.searchParams.set('next', redirectTo);
    // Язык нужен callback'у, чтобы вернуть человека на его зеркало:
    // сам адрес /auth/callback префикса локали не имеет (см.
    // комментарий в route.ts).
    callback.searchParams.set('locale', locale);

    trackEvent('login_google_start', { redirect: redirectTo ? 'yes' : 'no' });

    const supabase = getBrowserClient();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
        // skipBrowserRedirect: сами переводим браузер по адресу, чтобы
        // не зависеть от того, успеет ли библиотека сделать это до
        // размонтирования компонента.
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      // Молчать нельзя, но и показывать техническую ошибку незачем:
      // родитель покажет общий текст «вход не завершён».
      setBusy(false);
      onBlocked?.();
      return;
    }

    window.location.assign(data.url);
  }

  return (
    <Button
      onClick={signIn}
      disabled={disabled || busy}
      variant="secondary"
      fullWidth
    >
      <GoogleLogo />
      <span className="ml-2.5">{t('auth_google_btn')}</span>
    </Button>
  );
}

// Официальный четырёхцветный знак Google. Вставлен инлайном, а не
// картинкой из /public: логотип обязан приехать вместе с разметкой —
// отдельный запрос за иконкой на кнопке входа даёт мигание пустотой на
// медленной сети, а сама кнопка при этом уже кликабельна.
//
// aria-hidden: рядом стоит подпись «Войти через Google», и озвучивать
// знак отдельно значило бы прочитать слово «Google» дважды.
function GoogleLogo() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
