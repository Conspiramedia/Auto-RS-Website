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
import { supabaseErrorText } from '@/lib/otp';
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
  invalid_tax_id: 'dealers_err_tax_id',
  invalid_reg_num: 'dealers_err_reg_num',
  too_long: 'dealers_err_too_long',
  rate_limited: 'dealers_err_rate',
};

// Длины реквизитов — те же, что в CHECK на dealer_leads и в
// проверках submit_dealer_lead (0102). Считаются ПО ЦИФРАМ: человек
// набирает PIB как «123 456 789», и RPC сама вычищает всё, кроме
// цифр, — придираться к пробелу незачем.
const TAX_ID_DIGITS = 9;
const REG_NUM_DIGITS = 8;

// Только цифры из введённого — для проверки длины на клиенте.
function digits(value: string): string {
  return value.replace(/\D/g, '');
}

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
  // Реквизиты компании. Те же поля, что в форме профиля
  // (DealerApplicationBlock), но здесь НЕОБЯЗАТЕЛЬНЫЕ: эта форма
  // открыта анониму и остаётся лидом — админ связывается сам, статус
  // по ней не выдаётся. Требовать выписку APR до первого разговора
  // значит терять салон на пороге.
  const [taxId, setTaxId] = useState('');
  const [regNum, setRegNum] = useState('');
  // siteUrl, а не website: имя website занято honeypot-полем ниже,
  // и переименовывать нужно именно новое — приманка обязана
  // называться так, как её ждут боты.
  const [siteUrl, setSiteUrl] = useState('');
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

    // Проверки реквизитов повторяют серверные (0102) намеренно:
    // источник истины остаётся в базе, а клиент избавляет от заведомо
    // напрасного запроса. Пустое поле пропускаем — оно необязательное,
    // придираемся только к набранному неверно.
    if (taxId.trim() !== '' && digits(taxId).length !== TAX_ID_DIGITS) {
      setError(t('dealers_err_tax_id'));
      return;
    }
    if (regNum.trim() !== '' && digits(regNum).length !== REG_NUM_DIGITS) {
      setError(t('dealers_err_reg_num'));
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
          // Реквизиты уходят КАК НАБРАНЫ: чистку от пробелов и дефисов
          // делает сама RPC (regexp_replace), повторять её здесь
          // значило бы держать это правило в двух местах.
          p_tax_id: taxId || null,
          p_reg_num: regNum || null,
          p_website: siteUrl || null,
        },
      );

      if (rpcError) throw new Error(supabaseErrorText(rpcError));

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

      {/* Реквизиты компании — тот же набор и тот же порядок, что в
          форме профиля (DealerApplicationBlock): человек, увидевший
          обе, не должен разбираться, чем они отличаются.
          Обязательными они здесь НЕ становятся — см. комментарий у
          состояния выше. Подпись под группой объясняет, зачем их
          спрашивают и что без них заявку тоже примут.
          items-start: у полей снизу подсказки разной высоты, и без
          выравнивания по верху сами поля разъехались бы. */}
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-caption text-neutral-60">
            {t('dealer_app_tax_id')}
          </label>
          {/* inputMode numeric, но type остаётся text: type=number на
              идентификаторе даёт стрелки прибавления и теряет ведущий
              ноль, а номер — не величина. Та же причина, что в форме
              профиля. */}
          <input
            type="text"
            inputMode="numeric"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            maxLength={20}
            placeholder="123456789"
            className={field}
          />
        </div>

        <div>
          <label className="mb-1 block text-caption text-neutral-60">
            {t('dealer_app_reg_num')}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={regNum}
            onChange={(e) => setRegNum(e.target.value)}
            maxLength={20}
            placeholder="12345678"
            className={field}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-caption text-neutral-60">
          {t('dealer_app_website')}
        </label>
        <input
          type="url"
          inputMode="url"
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
          maxLength={200}
          className={field}
        />
        <p className="mt-1 text-small text-neutral-60">
          {t('dealers_details_hint')}
        </p>
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
