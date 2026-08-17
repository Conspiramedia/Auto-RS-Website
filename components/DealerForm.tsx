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
import { getBrowserClient } from '@/lib/supabaseClient';
import { trackEvent } from '@/lib/analytics';
import { formatSerbianPhone, serbianPhoneToE164 } from '@/lib/inputFormat';
import { fieldClass, fieldClassTextarea } from './ui/Field';
import Button from './ui/Button';

type Props = {
  locale: Locale;
};

// Тексты ошибок по кодам, которые возвращает RPC.
const ERRORS: Record<Locale, Record<string, string>> = {
  sr: {
    invalid_company: 'Unesite naziv autosalona.',
    invalid_contact: 'Unesite ime kontakt osobe.',
    invalid_phone: 'Proverite broj telefona.',
    too_long: 'Neko od polja je predugačko.',
    rate_limited:
      'Već ste poslali zahtev sa ovog broja. Pokušajte ponovo sutra.',
    unknown: 'Došlo je do greške. Pokušajte ponovo.',
  },
  ru: {
    invalid_company: 'Укажите название автосалона.',
    invalid_contact: 'Укажите имя контактного лица.',
    invalid_phone: 'Проверьте номер телефона.',
    too_long: 'Одно из полей слишком длинное.',
    rate_limited:
      'С этого номера заявка уже отправлена. Попробуйте завтра.',
    unknown: 'Произошла ошибка. Попробуйте ещё раз.',
  },
};

export default function DealerForm({ locale }: Props) {
  const t = getT(locale);
  const supabase = getBrowserClient();

  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
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
        setError(ERRORS[locale][data.error] ?? ERRORS[locale].unknown);
        return;
      }

      // Только после подтверждения сервером, что заявка принята.
      trackEvent('dealer_lead_submitted');
      setSent(true);
    } catch {
      setError(ERRORS[locale].unknown);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-card border border-neutral-10 p-6 text-center">
        <h2 className="text-lg font-semibold">
          {locale === 'ru' ? 'Заявка отправлена' : 'Zahtev je poslat'}
        </h2>
        <p className="mt-2 text-neutral-60">
          {locale === 'ru'
            ? 'Свяжемся с вами в ближайшее время.'
            : 'Kontaktiraćemo vas u najkraćem roku.'}
        </p>
      </div>
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
        <label className="mb-1 block text-sm text-neutral-60">
          {locale === 'ru' ? 'Название автосалона' : 'Naziv autosalona'}
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
          <label className="mb-1 block text-sm text-neutral-60">
            {locale === 'ru' ? 'Контактное лицо' : 'Kontakt osoba'}
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
          <label className="mb-1 block text-sm text-neutral-60">
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
            placeholder="+381 6X XXX XXX"
            className={field}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-neutral-60">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            className={field}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-neutral-60">
            {t('filter_city')}
          </label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            maxLength={100}
            className={field}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-neutral-60">
          {locale === 'ru' ? 'Комментарий' : 'Komentar'}
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
        <p className="rounded-control bg-brand-red/10 px-3 py-2 text-sm text-brand-red">
          {error}
        </p>
      )}
    </form>
  );
}
