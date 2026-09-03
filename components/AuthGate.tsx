'use client';

// ============================================================
// RS AUTO — Вход по коду на почту.
// ============================================================
// Client Component: вход невозможен без состояния (адрес, код, таймер
// повторной отправки) и без обращения к Supabase из браузера.
//
// ПОЧЕМУ ПОЧТА, А НЕ SMS. Раньше здесь был выбор из двух способов, и
// основным считался SMS. Он убран: Twilio требует одобренного Primary
// Compliance Profile для сербских номеров, и до его получения код не
// уходил НИКОМУ — регистрация на сайте была закрыта полностью.
// Почтовый канал (миграция 0082) уже работал через Resend и был
// открыт всем профилям с почтой миграцией 0106.
//
// ТЕЛЕФОН НЕ ИСЧЕЗ ИЗ ПЛОЩАДКИ. Он перестал быть способом входа и
// остался контактом в объявлении: спрашивается один раз при подаче
// обычным полем, без кода, и сохраняется в профиль.
//
// ПРИЛОЖЕНИЕ ПРОДОЛЖАЕТ ЛОГИНИТЬ ПО SMS — у него свой клиент и свой
// провайдер, эта правка его не касается. Следствие, принятое
// осознанно: один человек, вошедший в приложении по телефону и на
// сайте по почте, получает два разных аккаунта.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ КОМПОНЕНТ, А НЕ ПЕРЕИСПОЛЬЗОВАНИЕ SellForm.
// В SellForm вход — четвёртый шаг подачи объявления: он вплетён в
// загрузку фотографий и вызов create_car_v3, и вытащить его целиком
// нельзя, не разломав форму. Общими вынесены ровно те части, где
// расхождение поведения было бы багом: тексты ошибок и задержка
// повторной отправки (lib/otp.ts) и приём политики (lib/consent.ts).
// Разметка совпадает с шагом 4 SellForm по токенам и порядку элементов.
//
// ПОСЛЕ УСПЕШНОГО ВХОДА — два разных исхода, отсюда проп redirectTo:
//
//   * без него (форма подставлена вместо содержимого кабинета) —
//     router.refresh(). Сессия живёт в cookie, но серверный рендер уже
//     произошёл: без refresh пользователь видел бы форму входа до
//     следующей навигации. refresh перезапрашивает Server Component
//     с новыми cookie, и на месте формы отрисовывается кабинет;
//
//   * с ним (отдельная страница /login) — переход по адресу. Оставаться
//     на /login после входа бессмысленно, а вернуть человека туда,
//     куда он шёл, — единственное правильное поведение.
//
// Компонент используется в двух местах и обязан выглядеть одинаково:
// на /login и внутри кабинета это одна и та же форма.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import Alert from './ui/Alert';
import GoogleSignInButton from './GoogleSignInButton';
import Button from './ui/Button';
import Card from './ui/Card';
import CloseButton from './ui/CloseButton';
import { fieldClass } from './ui/Field';
import { trackEvent } from '@/lib/analytics';
import { acceptPolicy, hasAcceptedPolicyHere, migrateGuestConsent } from '@/lib/consent';
import type { Locale } from '@/lib/i18n';
import { getT, localeAwareHref, localeHref } from '@/lib/i18n';
import {
  OTP_LEN,
  RESEND_DELAY_SEC,
  humanOtpError,
  isOtpComplete,
  supabaseErrorText,
} from '@/lib/otp';
import { getBrowserClient } from '@/lib/supabaseClient';

type Props = {
  locale: Locale;
  // Куда идти после успешного входа. Путь БЕЗ префикса локали:
  // префикс добавляется здесь через localeHref, иначе русский
  // пользователь после входа проваливался бы на сербское зеркало.
  // Не задан — остаёмся на месте и перерисовываем страницу.
  redirectTo?: string;
  // Заголовок над формой. На отдельной странице входа он свой
  // («Вход в кабинет»), внутри кабинета — общий.
  title?: string;
  // Куда уйти, если человек передумал входить. Путь БЕЗ префикса
  // локали. Задаётся ТОЛЬКО на отдельной странице /login: там форма —
  // это вся страница, и её можно покинуть. Внутри кабинета крестика
  // нет — за формой ничего не стоит, закрывать нечего.
  closeHref?: string;
  // Вход через Google не завершился, и callback вернул человека сюда
  // (app/auth/callback/route.ts). Признак приходит с сервера страницей
  // входа, а не читается здесь из адреса: разбор строки запроса в
  // клиентском компоненте разошёлся бы с серверным рендером.
  oauthFailed?: boolean;
};

export default function AuthGate({
  locale,
  redirectTo,
  title,
  closeHref,
  oauthFailed,
}: Props) {
  const t = getT(locale);
  const router = useRouter();
  const supabase = getBrowserClient();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  // Номер, на который реально ушёл код, в формате E.164. Держим отдельно
  // от поля ввода: verifyOtp обязан получить ТОТ ЖЕ номер, что и
  // signInWithOtp, иначе Supabase не найдёт код.
  const [sentTo, setSentTo] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Ошибка возврата из Google показывается сразу при открытии формы:
  // человек уже сделал попытку входа, и пустая форма без объяснения
  // выглядела бы так, будто нажатие не сработало.
  const [error, setError] = useState<string | null>(
    oauthFailed ? t('auth_google_failed') : null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  // Момент, когда повторная отправка снова разрешена. Храним метку
  // времени, а не остаток: при возврате на вкладку из фона счётчик
  // «оставшихся секунд» отстал бы, а пересчёт от метки всегда верен.
  const [resendAt, setResendAt] = useState(0);
  const [resendIn, setResendIn] = useState(0);

  // Согласие могло быть принято раньше — гостем или на этом же
  // устройстве при подаче объявления. Документы принимаются один раз,
  // поэтому читаем сохранённый признак. Только на клиенте: localStorage
  // на сервере нет, а расхождение разметки ломает гидрацию.
  useEffect(() => {
    setAgreed(hasAcceptedPolicyHere(null));
  }, []);

  useEffect(() => {
    if (resendAt === 0) return;

    const tick = () => {
      const left = Math.ceil((resendAt - Date.now()) / 1000);
      setResendIn(left > 0 ? left : 0);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  // ---------- Отправка кода на почту ----------
  // Отличается от SMS двумя вещами, и обе принципиальны.
  //
  // 1. Гейт. rpc_check_email_login (0082) отвечает нейтральным
  //    allowed=false и для несуществующего адреса, и для
  //    существующего пользователя без прав. Разные тексты
  //    превратили бы форму входа в способ выяснять, кто
  //    зарегистрирован на площадке.
  //
  // 2. Кто шлёт письмо. Код генерирует GoTrue, а доставляет наша
  //    Edge Function auth-email-hook через Resend — Send Email Hook
  //    настроен в Dashboard. Здесь мы только просим код: письмо
  //    уходит на стороне сервера, и клиент про него ничего не знает.
  //
  // ВТОРОЙ ПУТЬ АУТЕНТИФИКАЦИИ НЕ ЗАВОДИТСЯ: сессию, как и при SMS,
  // выдаёт verifyOtp. Своей таблицы кодов и своего обмена кода на
  // сессию у площадки нет.
  async function sendEmailCode(resend = false) {
    setError(null);
    setNotice(null);

    if (!agreed) {
      setError(t('legal_consent_required'));
      return;
    }
    acceptPolicy(null);

    const clean = (resend && sentTo ? sentTo : email).trim().toLowerCase();

    // Грубая проверка формы адреса — до запроса: незачем тратить
    // квоту на заведомую опечатку.
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(clean)) {
      setError(t('auth_email_invalid'));
      return;
    }

    setBusy(true);
    try {
      // Квота и гейт — ДО обращения к Auth. Отказ здесь означает, что
      // signInWithOtp не вызывается вовсе: код не генерируется, письмо
      // не уходит, GoTrue не тревожится.
      const { data: gate, error: gateError } = await supabase.rpc(
        'rpc_check_email_login',
        { p_email: clean },
      );

      if (gateError) throw new Error(supabaseErrorText(gateError));

      if (!gate || gate.allowed === false) {
        // Один текст на все причины отказа: нет такого адреса, нет
        // прав, исчерпана квота. Различать их — значит подсказывать.
        setError(t('auth_email_not_allowed'));
        return;
      }

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: clean,
        options: {
          // Аккаунт СОЗДАЁТСЯ, если его ещё нет: почта на сайте
          // одновременно и вход, и регистрация.
          //
          // Раньше здесь стоял false — наследство от 0082, где канал
          // был служебным входом администратора. Вместе с гейтом,
          // пускавшим только существующие профили, это давало
          // замкнутый круг: войти нельзя без аккаунта, а завести
          // аккаунт можно было только пройдя форму подачи объявления
          // до четвёртого шага. Миграция 0107 сняла проверку в гейте,
          // эта строка — вторую половину того же запрета.
          shouldCreateUser: true,
        },
      });
      if (otpError) throw new Error(supabaseErrorText(otpError));

      setSentTo(clean);
      setCodeSent(true);
      setResendAt(Date.now() + RESEND_DELAY_SEC * 1000);
      if (resend) setNotice(t('otp_resent'));
    } catch (e) {
      setError(humanOtpError(e, t));
    } finally {
      setBusy(false);
    }
  }

  // Возврат к вводу номера или адреса — «Изменить номер» в приложении.
  function changeNumber() {
    setCodeSent(false);
    setCode('');
    setSentTo('');
    setResendAt(0);
    setResendIn(0);
    setError(null);
    setNotice(null);
  }

  // ---------- Подтверждение кода ----------
  async function submit() {
    setError(null);
    setBusy(true);

    try {
      // Сессию выдаёт GoTrue через verifyOtp. Второго пути к сессии
      // у площадки нет намеренно.
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: sentTo,
        token: code.trim(),
        type: 'email',
      });

      if (verifyError) throw new Error(supabaseErrorText(verifyError));
      if (!data.session) throw new Error(t('otp_err_failed'));

      // Согласие давалось гостем — переносим на созданный аккаунт,
      // чтобы при подаче объявления политику не спрашивали снова.
      if (data.user?.id) migrateGuestConsent(data.user.id);

      // ЯЗЫК ПРОДАВЦА — В ПРОФИЛЬ (миграция 0121). На нём приходят
      // письма и причина отклонения объявления, а до этой правки поле
      // не заполнялось ни для кого: единственное место записи ушло
      // вместе с формой смены почты (0106), и все получали сербский по
      // умолчанию, даже войдя на русской версии.
      //
      // Вход — самое достоверное место: человек только что работал с
      // конкретной локалью, и гадать не приходится.
      //
      // Ошибку глушим и НЕ ждём ответа: язык писем не стоит того,
      // чтобы задерживать вход или ронять его при недоступной RPC.
      void supabase
        .rpc('set_profile_locale', { p_locale: locale })
        .then(undefined, () => undefined);

      // Вход состоялся. Свойство redirect показывает, пришёл ли человек
      // за конкретным действием (написать продавцу, открыть объявление)
      // или просто в кабинет: это разные сценарии, и в воронке их надо
      // различать. Событие ставится ДО перехода — router.replace
      // размонтирует компонент, и отправка после него не успела бы.
      trackEvent('login_success', { redirect: redirectTo ? 'yes' : 'no' });

      // Сессия записана в cookie.
      if (redirectTo) {
        // Отдельная страница входа: уводим туда, откуда пришёл
        // пользователь. replace, а не push: возврат «назад» на форму
        // входа после успешного входа — тупик.
        //
        // localeAwareHref, а не localeHref: у админки нет языковых
        // зеркал, и модератора с русской cookie обычный localeHref
        // увёл бы на несуществующий /ru/admin сразу после верно
        // введённого кода из SMS.
        router.replace(localeAwareHref(locale, redirectTo));
      } else {
        // Форма вместо содержимого кабинета: просим сервер
        // перерисовать страницу уже от имени вошедшего.
        router.refresh();
      }
    } catch (e) {
      setError(humanOtpError(e, t));
      setBusy(false);
    }
    // finally здесь намеренно нет: при успехе идёт refresh, и снимать
    // busy не нужно — иначе кнопка на мгновение станет активной прямо
    // перед заменой формы кабинетом.
  }

  return (
    <Card className="mx-auto max-w-md">
      <div className="space-y-3">
        {/* Крестик — в одну строку с заголовком, прижат к правому краю
            карточки. Отрицательные отступы -mr-2 -mt-2 втягивают его
            кликабельную область 40px в поле внутреннего отступа
            карточки: без них знак стоял бы заметно левее и ниже угла,
            потому что вокруг него есть свободное место кнопки.
            items-start — заголовок бывает в две строки на узком
            экране, и крестик обязан остаться у верхнего края. */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-h3 font-semibold">
              {title ?? t('my_auth_title')}
            </h1>
            <p className="mt-1 text-caption text-neutral-60">{t('my_auth_lead')}</p>
          </div>

          {closeHref && (
            <CloseButton
              // Уход со страницы входа — навигация, а не закрытие слоя,
              // поэтому push, а не replace: человек передумал, но
              // «назад» обязан вернуть его к форме, если он передумал
              // ещё раз. Кнопка блокируется, пока идёт запрос: код уже
              // ушёл в SMS, и уводить со страницы в этот момент значит
              // потерять его.
              onClick={() => router.push(localeHref(locale, closeHref))}
              disabled={busy}
              label={t('common_close')}
              className="-mr-2 -mt-2 shrink-0"
            />
          )}
        </div>

        {!codeSent ? (
          <>
            {/* ПЕРЕКЛЮЧАТЕЛЯ СПОСОБА ВХОДА БОЛЬШЕ НЕТ.
                Здесь стоял сегмент «Телефон | Почта». Вход по SMS с
                сайта убран: Twilio требует одобренного Compliance
                Profile для сербских номеров, и до его получения код не
                уходит НИКОМУ — воронка регистрации была закрыта
                полностью. Почтовый канал (0082) уже работал через
                Resend, и он стал единственным.

                Телефон при этом никуда не делся из площадки: он
                спрашивается при подаче объявления как контакт для
                покупателя — обычным полем, без кода подтверждения.

                Приложение продолжает логинить по SMS: там свой клиент
                и свой провайдер, эта правка его не касается. */}
            {/* GOOGLE — ПЕРВЫМ, ДО ПОЛЯ ПОЧТЫ.
                Порядок не косметический: вход одним нажатием быстрее
                цепочки «адрес → письмо → код из письма», и человеку,
                у которого есть аккаунт Google, незачем читать про
                второй способ. Поле почты остаётся для всех остальных —
                убирать его нельзя, иначе вход на площадку окажется
                привязан к одной внешней компании. */}
            <GoogleSignInButton
              locale={locale}
              redirectTo={redirectTo}
              disabled={busy}
              // Документы принимаются один раз и до создания аккаунта —
              // неважно, каким способом он создаётся. Галочка ниже
              // общая для обоих путей.
              blocked={!agreed}
              // Текст свой, не общий с кнопкой «Получить код»: в этом
              // пути кода нет вовсе, и «чтобы получить код» отсылало
              // бы к шагу, которого человек не увидит.
              onBlocked={() => setError(t('legal_consent_required_oauth'))}
              // Поток не удалось начать. Текст тот же, что при
              // возврате из Google без сессии: для человека это одна и
              // та же неудача, а разница между ними — техническая.
              onFailed={() => setError(t('auth_google_failed'))}
            />

            {/* Разделитель «или»: без него две кнопки подряд читаются
                как шаги одного действия, а это альтернативы. */}
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-neutral-15" />
              <span className="text-small text-neutral-60">{t('auth_or')}</span>
              <span className="h-px flex-1 bg-neutral-15" />
            </div>

            <div>
              <label className="mb-1 block text-caption text-neutral-60">
                {t('auth_email_label')}
              </label>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth_email_ph')}
                className={fieldClass}
              />
            </div>

            {/* Согласие с условиями и политикой — ОБЯЗАТЕЛЬНО до кнопки
                «Получить код»: аккаунт создаётся самим входом по SMS.
                Ссылки открываются в новой вкладке, чтобы не потерять
                введённый номер. */}
            <label className="flex cursor-pointer items-start gap-2.5 text-caption text-neutral-70">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-green"
              />
              <span>
                {t('legal_consent_before')}
                <Link
                  href={localeHref(locale, '/terms')}
                  target="_blank"
                  rel="noopener"
                  className="font-semibold text-brand-blue underline"
                >
                  {t('legal_consent_terms')}
                </Link>
                {t('legal_consent_and')}
                <Link
                  href={localeHref(locale, '/privacy')}
                  target="_blank"
                  rel="noopener"
                  className="font-semibold text-brand-blue underline"
                >
                  {t('legal_consent_privacy')}
                </Link>
                .
              </span>
            </label>

            {/* Синий, а не зелёный: вход — это связь и вспомогательный
                шаг, зелёный акцент на сайте закреплён за главным
                действием (публикация объявления). */}
            <Button
              onClick={() => sendEmailCode()}
              // Проверка ПО СУЩЕСТВУ, а не на непустоту: достаточно
              // наличия «@» — точную форму проверит sendEmailCode,
              // а сервер проверит ещё раз.
              disabled={busy || !agreed || !email.includes('@')}
              variant="info"
              fullWidth
            >
              {busy ? t('otp_sending') : t('my_auth_send')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-caption text-neutral-60">
              {t('auth_email_sent_to')}{' '}
              {sentTo}
            </p>

            <div>
              <label className="mb-1 block text-caption text-neutral-60">
                {t('auth_email_code')}
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                // Длина зависит от канала: SMS всегда 6, email-код
                // GoTrue настраивается и бывает длиннее (см. OTP_LEN).
                // Жёсткие 6 здесь молча обрезали длинный код из письма.
                maxLength={OTP_LEN.email.max}
                value={code}
                // Только цифры: в приложении поле кода тоже ограничено
                // digitsOnly.
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={fieldClass}
              />
            </div>

            {/* «Изменить номер» и «Отправить снова» — как в приложении и
                в форме подачи. Повтор блокируется на 60 секунд. */}
            <div className="flex items-center justify-between text-caption">
              <button
                type="button"
                onClick={changeNumber}
                disabled={busy}
                className="font-semibold text-brand-blue disabled:opacity-40"
              >
                {t(
                  'auth_email_change',
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  sendEmailCode(true)
                }
                disabled={busy || resendIn > 0}
                className="font-semibold text-brand-blue disabled:opacity-40"
              >
                {resendIn > 0
                  ? `${t('otp_resend_in')} (${resendIn})`
                  : t('otp_resend')}
              </button>
            </div>

            <Button
              onClick={submit}
              disabled={busy || !isOtpComplete(code, 'email')}
              variant="info"
              fullWidth
            >
              {busy ? t('otp_verifying') : t('my_auth_submit')}
            </Button>
          </>
        )}

        {/* Успех повторной отправки — в приложении это зелёный снек. */}
        {notice && !error && (
          <Alert tone="success">
            {notice}
          </Alert>
        )}

        {error && (
          <Alert tone="error">
            {error}
          </Alert>
        )}
      </div>
    </Card>
  );
}
