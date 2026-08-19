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
// ПОСЛЕ УСПЕШНОГО ВХОДА — router.refresh(), а не переход по адресу.
// Сессия теперь живёт в cookie (lib/supabaseClient.ts), но серверный
// рендер этой страницы уже произошёл: без refresh пользователь увидел бы
// форму входа до следующей навигации. refresh перезапрашивает Server
// Component с новыми cookie, и на его месте отрисовывается кабинет.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import Button from './ui/Button';
import Card from './ui/Card';
import { fieldClass } from './ui/Field';
import { acceptPolicy, hasAcceptedPolicyHere, migrateGuestConsent } from '@/lib/consent';
import { formatSerbianPhone, serbianPhoneToE164 } from '@/lib/inputFormat';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { RESEND_DELAY_SEC, humanOtpError } from '@/lib/otp';
import { getBrowserClient } from '@/lib/supabaseClient';

type Props = {
  locale: Locale;
};

export default function AuthGate({ locale }: Props) {
  const t = getT(locale);
  const router = useRouter();
  const supabase = getBrowserClient();

  const [phone, setPhone] = useState('');
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

      // Сессия записана в cookie — просим сервер перерисовать страницу
      // уже от имени вошедшего пользователя.
      router.refresh();
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
        <div>
          <h1 className="text-xl font-semibold">{t('my_auth_title')}</h1>
          <p className="mt-1 text-sm text-neutral-60">{t('my_auth_lead')}</p>
        </div>

        {!codeSent ? (
          <>
            <div>
              <label className="mb-1 block text-sm text-neutral-60">
                {t('my_auth_phone')}
              </label>
              {/* Маска «+381 6X XXX XXX(X)» — та же, что в приложении
                  (SerbianPhoneFormatter) и в форме подачи. */}
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(formatSerbianPhone(e.target.value))}
                placeholder="+381 6X XXX XXX"
                className={fieldClass}
              />
            </div>

            {/* Согласие с условиями и политикой — ОБЯЗАТЕЛЬНО до кнопки
                «Получить код»: аккаунт создаётся самим входом по SMS.
                Ссылки открываются в новой вкладке, чтобы не потерять
                введённый номер. */}
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-neutral-70">
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
              disabled={busy || !phone.trim() || !agreed}
              variant="info"
              fullWidth
            >
              {busy ? t('otp_sending') : t('my_auth_send')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-60">
              {t('otp_sent_to')} {sentTo}
            </p>

            <div>
              <label className="mb-1 block text-sm text-neutral-60">
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
            <div className="flex items-center justify-between text-sm">
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
          <p className="rounded-control bg-brand-green/10 px-3 py-2 text-sm text-brand-green">
            {notice}
          </p>
        )}

        {error && (
          <p className="rounded-control bg-brand-red/10 px-3 py-2 text-sm text-brand-red">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
