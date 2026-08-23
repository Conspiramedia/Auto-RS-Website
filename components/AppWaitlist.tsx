'use client';

// ============================================================
// RS AUTO — Заглушка «приложение в разработке» на /app.
// ============================================================
// Client Component: подписка на оповещение — это состояние поля,
// запроса и результата.
//
// ЧТО ЗДЕСЬ БЫЛО РАНЬШЕ. Две кнопки сторов, обе в никуда: приложение
// не опубликовано, ссылка на Google Play отдавала 404, а ссылка на
// App Store вела в поиск по названию — там человек находил что угодно,
// кроме RS Auto. Кнопка, которая выглядит как «скачать», но не даёт
// скачать, хуже честной надписи «делаем».
//
// ПОЧЕМУ ФОРМА, А НЕ ПРОСТО НАДПИСЬ. Обещание «сообщим, когда выйдет»
// без места, куда оставить контакт, — пустое: вход на площадку по
// SMS-коду, и почты пользователя у нас нет (см. миграцию 0076).
// Поле адреса превращает заглушку из отписки в рабочий лист ожидания.
//
// О ФОРМУЛИРОВКАХ. В тексте намеренно НЕ обещан пуш «всем
// пользователям»: пуш доставляется только на устройство с уже
// установленным приложением, а его как раз и нет. Тому, у кого есть
// аккаунт, придёт уведомление в кабинете; всем остальным — письмо.
// Обещать в интерфейсе недоставимый канал нельзя.
// ============================================================

import { useState } from 'react';

import Alert from './ui/Alert';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Card from './ui/Card';
import { fieldClass } from './ui/Field';
import { trackEvent } from '@/lib/analytics';
import type { DictKey } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';

// Коды ошибок RPC → ключи словаря. Тот же приём, что в ContactForm:
// сервер возвращает код, текст на языке пользователя подставляет сайт.
const ERROR_KEY: Record<string, DictKey> = {
  invalid_email: 'app_wait_err_invalid_email',
  rate_limited: 'app_wait_err_rate_limited',
};

export default function AppWaitlist({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const supabase = getBrowserClient();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'subscribe_app_waitlist',
        { p_email: email, p_locale: locale },
      );

      if (rpcError) throw new Error(rpcError.message);

      if (data && data.ok === false) {
        setError(t(ERROR_KEY[data.error] ?? 'app_wait_err_failed'));
        return;
      }

      // Событие — только после успешного ответа сервера: нажатие кнопки
      // и принятая подписка это разные вещи. Адрес в аналитику не
      // передаётся — это персональные данные.
      trackEvent('app_waitlist_subscribed', {});
      setDone(true);
    } catch (err) {
      // В консоль — только текст ошибки, без адреса.
      console.error('[RS Auto] Ошибка подписки на релиз приложения', {
        message: err instanceof Error ? err.message : String(err),
      });
      setError(t('app_wait_err_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-2">
      <div className="flex items-start gap-3">
        {/* Значок «в разработке» — вместо иконок сторов. Тон neutral:
            это состояние работы, а не награда и не предупреждение,
            и цветная плашка тянула бы взгляд без причины. */}
        <Badge tone="neutral" size="sm" className="mt-0.5 shrink-0">
          {t('app_soon_badge')}
        </Badge>

        <div className="min-w-0">
          <h2 className="text-h4 font-semibold">{t('app_soon_title')}</h2>
          <p className="mt-1 text-neutral-60">{t('app_soon_text')}</p>
        </div>
      </div>

      {done ? (
        // Успех заменяет форму целиком: оставлять поле с кнопкой после
        // подписки значит звать нажать ещё раз.
        <Alert tone="success" className="mt-4">
          {t('app_soon_done')}
        </Alert>
      ) : (
        <>
          <p className="mt-4 text-caption text-neutral-60">
            {t('app_soon_note')}
          </p>

          {/* Настоящая <form>: Enter в поле обязан отправлять подписку,
              а не перезагружать страницу. */}
          <form onSubmit={submit} className="mt-2 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="app-waitlist-email">
              {t('app_soon_email')}
            </label>
            <input
              id="app-waitlist-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              placeholder={t('app_soon_email')}
              className={`${fieldClass} sm:flex-1`}
            />
            {/* Синий, а не зелёный: зелёный акцент на сайте закреплён за
                публикацией объявления, подписка — вспомогательный шаг. */}
            <Button type="submit" variant="info" disabled={busy || email.trim() === ''}>
              {busy ? t('app_soon_sending') : t('app_soon_submit')}
            </Button>
          </form>

          {error && (
            <Alert tone="error" className="mt-2">
              {error}
            </Alert>
          )}
        </>
      )}
    </Card>
  );
}
