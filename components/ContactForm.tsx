'use client';

// ============================================================
// RS AUTO — Форма обратной связи. Client Component.
// ============================================================
// Отправляет данные в RPC submit_contact_message (миграция 0058).
// Валидация и ограничение частоты (3 обращения на адрес за 24 часа)
// выполняются на сервере; проверки здесь нужны только для того, чтобы
// подсказать человеку до отправки.
//
// Коды ошибок RPC совпадают с ключами словаря, поэтому текст берётся
// из dict и приходит на языке пользователя — второй таблицы переводов
// ошибок (как в DealerForm) здесь заводить не потребовалось.
// ============================================================

import { useState } from 'react';

import type { Locale } from '@/lib/i18n';
import { getT, type DictKey } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';
import { trackEvent } from '@/lib/analytics';
import Alert from './ui/Alert';
import { fieldClass, fieldClassTextarea } from './ui/Field';
import Button from './ui/Button';
import Card from './ui/Card';

type Props = {
  locale: Locale;
};

// Код ошибки RPC → ключ словаря.
const ERROR_KEY: Record<string, DictKey> = {
  invalid_name: 'contact_err_name',
  invalid_email: 'contact_err_email',
  invalid_message: 'contact_err_message',
  too_long: 'contact_err_too_long',
  rate_limited: 'contact_err_rate',
};

// Темы обращения. Значения совпадают с check-ограничением в БД.
const TOPICS = [
  { value: 'general', key: 'contact_topic_general' },
  { value: 'ad', key: 'contact_topic_ad' },
  { value: 'abuse', key: 'contact_topic_abuse' },
  { value: 'privacy', key: 'contact_topic_privacy' },
] as const satisfies readonly { value: string; key: DictKey }[];

export default function ContactForm({ locale }: Props) {
  const t = getT(locale);
  const supabase = getBrowserClient();

  const [topic, setTopic] = useState<string>('general');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  // Honeypot — то же назначение, что в форме подачи и заявке дилера.
  const [website, setWebsite] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Классы поля ввода — из общего паттерна (components/ui/Field).
  const field = fieldClass;
  const fieldTextarea = fieldClassTextarea;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Заполненный honeypot — бот. Показываем успех, ничего не отправляя:
    // молчаливый отказ не даёт скрипту понять, что его отсекли.
    if (website.trim() !== '') {
      setSent(true);
      return;
    }

    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc(
        'submit_contact_message',
        {
          p_name: name,
          p_email: email,
          p_message: message,
          p_topic: topic,
          p_car_id: null,
          p_locale: locale,
        },
      );

      if (rpcError) throw new Error(rpcError.message);

      if (data && data.ok === false) {
        setError(t(ERROR_KEY[data.error] ?? 'contact_err_unknown'));
        return;
      }

      // Событие ставится ТОЛЬКО после успешного ответа сервера: отправка
      // формы и принятое обращение — разные вещи, и считать нужно второе.
      // В свойствах — тема обращения: по ней видно, с чем чаще всего
      // приходят. Персональных данных не передаём.
      trackEvent('contact_submitted', { topic });
      setSent(true);
    } catch (e) {
      // В консоль — только текст ошибки: имя и почта отправителя это
      // персональные данные, и в логе браузера им не место.
      console.error('[RS Auto] Ошибка отправки обращения', {
        message: e instanceof Error ? e.message : String(e),
      });
      setError(t('contact_err_unknown'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Card className="text-center">
        <h2 className="text-h4 font-semibold">{t('contact_sent_title')}</h2>
        <p className="mt-2 text-neutral-60">{t('contact_sent_text')}</p>
      </Card>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-card border border-neutral-10 p-4 sm:p-6"
    >
      <h2 className="text-h4 font-semibold">{t('contact_form_title')}</h2>

      {/* Honeypot: скрыт от людей и скринридеров, виден ботам. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '-9999px',
          width: 1,
          height: 1,
          opacity: 0,
        }}
      />

      <div>
        <label className="mb-1 block text-caption text-neutral-60" htmlFor="topic">
          {t('contact_topic')}
        </label>
        <select
          id="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className={field}
        >
          {TOPICS.map((item) => (
            <option key={item.value} value={item.value}>
              {t(item.key)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-caption text-neutral-60" htmlFor="name">
            {t('contact_name')}
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            autoComplete="name"
            className={field}
          />
        </div>

        <div>
          <label className="mb-1 block text-caption text-neutral-60" htmlFor="email">
            {t('contact_email')}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={200}
            autoComplete="email"
            className={field}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-caption text-neutral-60" htmlFor="message">
          {t('contact_message')}
        </label>
        <textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          minLength={10}
          maxLength={4000}
          rows={6}
          className={fieldTextarea}
        />
      </div>

      <Button type="submit" disabled={busy} fullWidth>
        {t('contact_send')}
      </Button>

      {error && (
        <Alert tone="error">
          {error}
        </Alert>
      )}
    </form>
  );
}
