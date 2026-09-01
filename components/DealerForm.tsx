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
  invalid_email: 'dealers_err_email',
  invalid_city: 'dealers_err_city',
  // Повторная подача (0104). Три разные причины, а не одна общая:
  // человеку важно знать, статус у него уже есть, заявка на
  // рассмотрении или лид ещё не разобран, — действия в этих случаях
  // разные.
  already_dealer: 'dealers_err_already_dealer',
  application_exists: 'dealers_err_application_exists',
  lead_exists: 'dealers_err_lead_exists',
  too_long: 'dealers_err_too_long',
  rate_limited: 'dealers_err_rate',
};

// Длины реквизитов — те же, что в CHECK на dealer_leads и в
// проверках submit_dealer_lead (0102). Считаются ПО ЦИФРАМ: человек
// набирает PIB как «123 456 789», и RPC сама вычищает всё, кроме
// цифр, — придираться к пробелу незачем.
const TAX_ID_DIGITS = 9;
const REG_NUM_DIGITS = 8;

// Грубая проверка почты — ровно та же, что в submit_dealer_lead
// (0103): строгую по RFC не строим, она отвергает валидные адреса
// чаще, чем ловит невалидные.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Только цифры из введённого — для проверки длины на клиенте.
function digits(value: string): string {
  return value.replace(/\D/g, '');
}

// Обрезка ввода по КОЛИЧЕСТВУ ЦИФР, а не по длине строки. Атрибут
// maxLength считает символы, и набирающий «123 456 789» упёрся бы
// в предел на седьмой цифре. Разделители сохраняем — их вычистит RPC.
// Парная функция стоит в DealerApplicationBlock: у форм заявки два
// набора состояния, но правило ввода реквизитов одно.
function clampDigits(value: string, max: number): string {
  let seen = 0;
  let out = '';
  for (const ch of value) {
    if (/\d/.test(ch)) {
      if (seen === max) break;
      seen += 1;
    }
    out += ch;
  }
  return out;
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

    // Проверки повторяют серверные (0103) намеренно: источник истины
    // остаётся в базе, а клиент избавляет от заведомо напрасного
    // запроса. Порядок — тот же, в каком поля стоят в форме: человек
    // читает ошибку и идёт к первому незаполненному сверху.
    if (digits(taxId).length !== TAX_ID_DIGITS) {
      setError(t('dealers_err_tax_id'));
      return;
    }
    if (digits(regNum).length !== REG_NUM_DIGITS) {
      setError(t('dealers_err_reg_num'));
      return;
    }
    if (city.trim() === '') {
      setError(t('dealers_err_city'));
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError(t('dealers_err_email'));
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

      {/* ПОРЯДОК ПОЛЕЙ — ЭТАЛОННЫЙ, взят из формы профиля
          (DealerApplicationBlock): название → PIB → матични број →
          город → контактное лицо → телефон → email → сайт →
          комментарий. Человек, увидевший обе формы, не должен
          разбираться, чем они отличаются, поэтому и подписи берутся
          из тех же ключей dealer_app_*, а не из своих.

          Обязательно всё, кроме сайта: он есть не у каждого салона.
          Требование проверяет сервер (0103), атрибут required и
          звёздочка здесь только называют его заранее. */}
      <div>
        <label className="mb-1 block text-caption text-neutral-60">
          {t('dealers_company')} *
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

      {/* items-start: под реквизитами стоит подсказка про APR, и без
          выравнивания по верху сами поля разъехались бы по вертикали. */}
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-caption text-neutral-60">
            {t('dealer_app_tax_id')} *
          </label>
          {/* inputMode numeric, но type остаётся text: type=number на
              идентификаторе даёт стрелки прибавления и теряет ведущий
              ноль, а номер — не величина. Та же причина, что в форме
              профиля. */}
          <input
            type="text"
            inputMode="numeric"
            value={taxId}
            // Больше девяти цифр не принимаем: подсказка обещает ровно
            // девять, и поле держит слово во время ввода, а не после
            // нажатия «Оставить заявку».
            onChange={(e) => setTaxId(clampDigits(e.target.value, TAX_ID_DIGITS))}
            required
            maxLength={20}
            placeholder="123456789"
            className={field}
          />
        </div>

        <div>
          <label className="mb-1 block text-caption text-neutral-60">
            {t('dealer_app_reg_num')} *
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={regNum}
            onChange={(e) => setRegNum(clampDigits(e.target.value, REG_NUM_DIGITS))}
            required
            maxLength={20}
            placeholder="12345678"
            className={field}
          />
        </div>
      </div>

      <p className="text-small text-neutral-50">{t('dealers_details_hint')}</p>

      <div className="grid items-start gap-3 sm:grid-cols-2">
        {/* Город — выбор из списка, как в остальных формах сайта.
            Свободный ввод давал разнописания одного города
            («Beograd», «beograd», «Белград»), и заявки салонов из
            одного места переставали группироваться при разборе. */}
        <ListPicker
          locale={locale}
          name="dealer_city"
          placeholder={t('picker_choose')}
          label={`${t('dealer_app_city')} *`}
          options={CITIES.map((c): PickerOption => ({ value: c, label: c }))}
          value={city}
          allowCustom
          onChange={setCity}
        />

        <div>
          <label className="mb-1 block text-caption text-neutral-60">
            {t('dealer_app_person')} *
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
      </div>

      <div className="grid items-start gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-caption text-neutral-60">
            {t('dealer_app_phone')} *
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

        <div>
          <label className="mb-1 block text-caption text-neutral-60">
            {t('dealer_app_email')} *
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={200}
            className={field}
          />
        </div>
      </div>

      {/* Сайт — единственное необязательное поле, поэтому стоит один в
          строке: в паре с обязательным звёздочка у соседа читалась бы
          как относящаяся к обоим. */}
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
