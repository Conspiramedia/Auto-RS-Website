'use client';

// ============================================================
// RS AUTO — Вход по SMS-коду для кабинета.
// ============================================================
// Client Component: вход невозможен без состояния (номер, код, таймер
// повторной отправки) и без обращения к Supabase из браузера.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ КОМПОНЕНТ, А НЕ ПЕРЕИСПОЛЬЗОВАНИЕ SellForm.
// В SellForm вход — четвёртый шаг подачи объявления: он вплетён в
// загрузку фотографий и вызов create_car_v3, и вытащить его целиком
// нельзя, не разломав форму. Общими вынесены ровно те части, где
// расхождение поведения было бы багом: тексты ошибок и задержка
// повторной отправки (lib/otp.ts), проверка суточной квоты, маска
// номера (lib/inputFormat.ts) и приём политики (lib/consent.ts).
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
import Button from './ui/Button';
import Card from './ui/Card';
import CloseButton from './ui/CloseButton';
import { fieldClass } from './ui/Field';
import { trackEvent } from '@/lib/analytics';
import { acceptPolicy, hasAcceptedPolicyHere, migrateGuestConsent } from '@/lib/consent';
import {
  formatSerbianPhone,
  isValidSerbianPhone,
  SERBIAN_PHONE_PREFIX,
  serbianPhoneToE164,
} from '@/lib/inputFormat';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { RESEND_DELAY_SEC, humanOtpError } from '@/lib/otp';
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
};

export default function AuthGate({ locale, redirectTo, title, closeHref }: Props) {
  const t = getT(locale);
  const router = useRouter();
  const supabase = getBrowserClient();

  // Поле стартует с кодом страны: набирать «+381» руками незачем.
  const [phone, setPhone] = useState(SERBIAN_PHONE_PREFIX);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  // Номер, на который реально ушёл код, в формате E.164. Держим отдельно
  // от поля ввода: verifyOtp обязан получить ТОТ ЖЕ номер, что и
  // signInWithOtp, иначе Supabase не найдёт код.
  const [sentTo, setSentTo] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // ---------- Отправка SMS-кода ----------
  // resend = true — повторная отправка на тот же номер: квота
  // проверяется так же, каждая SMS платная и считается сервером.
  async function sendCode(resend = false) {
    setError(null);
    setNotice(null);

    // Согласие — обязательное условие ДО отправки SMS, как в приложении:
    // аккаунт создаётся самим входом, поэтому политика принимается здесь.
    if (!agreed) {
      setError(t('legal_consent_required'));
      return;
    }

    // Фиксируем принятие текущей редакции. Пользователь пока гость —
    // на его uid согласие переедет после успешного входа.
    acceptPolicy(null);

    // Пустая строка означает, что номер не прошёл проверку: не сербский
    // мобильный. Отправлять SMS на такой номер нельзя — она не дойдёт,
    // но спишет суточную квоту.
    const e164 = serbianPhoneToE164(resend && sentTo ? sentTo : phone) ?? '';
    if (e164 === '') {
      setError(t('otp_err_phone'));
      return;
    }

    setBusy(true);
    try {
      // Квота проверяется ДО отправки: RPC сама пишет журнал и экономит
      // SMS. Лимит — 5 сообщений на номер за 24 часа (миграция 0035),
      // сервер здесь источник истины, клиент только показывает результат.
      const { data: quota, error: quotaError } = await supabase.rpc(
        'rpc_check_otp_quota',
        { p_phone: e164 },
      );

      if (quotaError) throw new Error(quotaError.message);

      if (quota && quota.allowed === false) {
        setError(t('otp_err_quota'));
        return;
      }

      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: e164,
      });
      if (otpError) throw new Error(otpError.message);

      setSentTo(e164);
      setCodeSent(true);
      setResendAt(Date.now() + RESEND_DELAY_SEC * 1000);
      if (resend) setNotice(t('otp_resent'));
    } catch (e) {
      setError(humanOtpError(e, t));
    } finally {
      setBusy(false);
    }
  }

  // Возврат к вводу номера — как «Изменить номер» в приложении.
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
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone: sentTo,
        token: code.trim(),
        type: 'sms',
      });

      if (verifyError) throw new Error(verifyError.message);
      if (!data.session) throw new Error(t('otp_err_failed'));

      // Согласие давалось гостем — переносим на созданный аккаунт,
      // чтобы при подаче объявления политику не спрашивали снова.
      if (data.user?.id) migrateGuestConsent(data.user.id);

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
        router.replace(localeHref(locale, redirectTo));
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
            <div>
              <label className="mb-1 block text-caption text-neutral-60">
                {t('my_auth_phone')}
              </label>
              {/* Маска «+381 6X XXX XXX(X)» — та же, что в приложении
                  (SerbianPhoneFormatter) и в форме подачи. */}
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(formatSerbianPhone(e.target.value))}
                placeholder="6X XXX XXX"
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
              onClick={() => sendCode()}
              // Проверка ПО СУЩЕСТВУ, а не на непустоту: в поле всегда
              // стоит код страны «+381 », и phone.trim() был бы истинным
              // ещё до единой введённой цифры.
              disabled={busy || !isValidSerbianPhone(phone) || !agreed}
              variant="info"
              fullWidth
            >
              {busy ? t('otp_sending') : t('my_auth_send')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-caption text-neutral-60">
              {t('otp_sent_to')} {sentTo}
            </p>

            <div>
              <label className="mb-1 block text-caption text-neutral-60">
                {t('my_auth_code')}
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
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
                {t('otp_change_number')}
              </button>
              <button
                type="button"
                onClick={() => sendCode(true)}
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
              disabled={busy || code.trim().length < 4}
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
