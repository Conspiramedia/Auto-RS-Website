'use client';

// ============================================================
// RS AUTO — Форма заявки автосалона. Client Component.
// ============================================================
// Отправляет данные в RPC submit_dealer_lead (миграция 0053). Вся валидация
// и ограничение частоты выполняются на сервере; проверки здесь нужны только
// для быстрой подсказки пользователю.
// ============================================================

import { useState } from 'react';

import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { DictKey } from '@/lib/i18n';
import { CITIES } from '@/lib/referenceData';
import { getBrowserClient } from '@/lib/supabaseClient';
import { trackEvent } from '@/lib/analytics';
import {
  formatSerbianPhone,
  SERBIAN_PHONE_PREFIX,
  serbianPhoneToE164,
} from '@/lib/inputFormat';
import Alert from './ui/Alert';
import { fieldClass, fieldClassTextarea } from './ui/Field';
import Button from './ui/Button';
import Card from './ui/Card';
import ListPicker, { type PickerOption } from './ListPicker';

type Props = {
  locale: Locale;
};

// Код ошибки RPC → ключ словаря. Раньше здесь лежала своя таблица
// переводов на обе локали — вторая система локализации рядом с dict.
// Теперь как в ContactForm: одна таблица соответствий, тексты в словаре.
const ERROR_KEY: Record<string, DictKey> = {
  invalid_company: 'dealers_err_company',
  invalid_contact: 'dealers_err_contact',
  invalid_phone: 'dealers_err_phone',
  too_long: 'dealers_err_too_long',
  rate_limited: 'dealers_err_rate',
};

export default function DealerForm({ locale }: Props) {
  const t = getT(locale);
  const supabase = getBrowserClient();

  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  // Поле стартует с кодом страны: набирать «+381» руками незачем.
  const [phone, setPhone] = useState(SERBIAN_PHONE_PREFIX);
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [comment, setComment] = useState('');
  // Honeypot — то же назначение, что и в форме подачи объявления.
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

    // Заполненный honeypot — бот. Показываем успех, ничего не отправляя.
    if (website.trim() !== '') {
      setSent(true);
      return;
    }

    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc(
        'submit_dealer_lead',
        {
          p_company_name: company,
          p_contact_name: contact,
          // В базу уходит E.164 без пробелов: по этому же номеру
          // работает серверный лимит «3 заявки на номер», и «+381 60 …»
          // с пробелами считался бы отдельным номером при каждом
          // варианте расстановки пробелов.
          p_phone: serbianPhoneToE164(phone) ?? phone,
          p_email: email || null,
          p_city: city || null,
          p_comment: comment || null,
        },
      );

      if (rpcError) throw new Error(rpcError.message);

      if (data && data.ok === false) {
        setError(t(ERROR_KEY[data.error] ?? 'dealers_err_unknown'));
        return;
      }

      // Только после подтверждения сервером, что заявка принята.
      trackEvent('dealer_lead_submitted');
      setSent(true);
    } catch {
      setError(t('dealers_err_unknown'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Card className="text-center">
        <h2 className="text-h4 font-semibold">
          {t('dealers_sent_title')}
        </h2>
        <p className="mt-2 text-neutral-60">
          {t('dealers_sent_text')}
        </p>
      </Card>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-card border border-neutral-10 p-4 sm:p-6"
    >
      {/* Honeypot: скрыт от людей, виден ботам. */}
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
        <label className="mb-1 block text-caption text-neutral-60">
          {t('dealers_company')}
        </label>
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          required
          maxLength={200}
          className={field}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-caption text-neutral-60">
            {t('dealers_contact')}
          </label>
          <input
            type="text"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            required
            maxLength={200}
            className={field}
          />
        </div>

        <div>
          <label className="mb-1 block text-caption text-neutral-60">
            {t('sell_phone')}
          </label>
          {/* Та же маска, что в форме подачи и в приложении: заявка
              салона уходит в submit_dealer_lead, где номер проверяется
              сервером, и присылать туда произвольный текст незачем. */}
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(formatSerbianPhone(e.target.value))}
            required
            placeholder="6X XXX XXX"
            className={field}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-caption text-neutral-60">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            className={field}
          />
        </div>

        {/* Город — выбор из списка, как в остальных формах сайта и в
            приложении. Свободный ввод давал разнописания одного города
            («Beograd», «beograd», «Белград»), и заявки салонов из одного
            места переставали группироваться при разборе. */}
        <ListPicker
          locale={locale}
          name="dealer_city"
          label={t('filter_city')}
          options={CITIES.map((c): PickerOption => ({ value: c, label: c }))}
          value={city}
          allowCustom
          onChange={setCity}
        />
      </div>

      <div>
        <label className="mb-1 block text-caption text-neutral-60">
          {t('dealers_comment')}
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          maxLength={2000}
          className={fieldTextarea}
        />
      </div>

      <Button type="submit" disabled={busy} fullWidth>
        {t('dealers_cta')}
      </Button>

      {error && (
        <Alert tone="error">
          {error}
        </Alert>
      )}
    </form>
  );
}
