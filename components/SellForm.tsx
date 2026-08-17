'use client';

// ============================================================
// RS AUTO — Пошаговая форма подачи объявления. Client Component.
// ============================================================
// Порядок шагов: Автомобиль → Детали → Фото → Контакты (вход по SMS).
// Вход намеренно последний: заставлять человека авторизоваться до того,
// как он что-то ввёл, — верный способ потерять продавца на первом экране.
//
// Путь публикации (согласован с приложением, миграции 0035/0036/0040):
//   1. rpc_check_otp_quota(phone) — суточная квота SMS (5 на номер);
//   2. signInWithOtp / verifyOtp  — вход по телефону;
//   3. загрузка фото в бакет car-images, папка {uid}/… (требование RLS);
//   4. create_car_v2(...)          — создание объявления.
// Объявление создаётся со статусом 'moderation' (default в таблице cars) и
// появляется в каталоге только после approve_car администратором.
// ============================================================

import { useState } from 'react';

import { getBrowserClient } from '@/lib/supabaseClient';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { BODY_TYPES, FUELS, TRANSMISSIONS } from '@/lib/types';
import type { SiteBrand } from '@/lib/types';

type Props = {
  locale: Locale;
  brands: SiteBrand[];
};

// Максимум фотографий — как в приложении (AppConstants.maxCarImages).
const MAX_PHOTOS = 15;

export default function SellForm({ locale, brands }: Props) {
  const t = getT(locale);
  const supabase = getBrowserClient();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Тип объявления. Определяет, какие поля цен показываются и что
  // уходит в create_car_v3. По умолчанию продажа — самый частый случай.
  const [listingType, setListingType] = useState<'sale' | 'rent' | 'both'>(
    'sale',
  );

  // Шаг 1–2: данные автомобиля.
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [price, setPrice] = useState('');
  const [rentPrice, setRentPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [mileage, setMileage] = useState('');
  const [city, setCity] = useState('');
  const [bodyType, setBodyType] = useState('');
  const [transmission, setTransmission] = useState('');
  const [fuel, setFuel] = useState('');
  const [description, setDescription] = useState('');

  // Шаг 3: фотографии.
  const [files, setFiles] = useState<File[]>([]);

  // Шаг 4: телефон и код.
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  // Honeypot: поле скрыто от человека и пустое у него всегда. Заполненное
  // значение — признак бота, и такую отправку мы молча не публикуем.
  const [website, setWebsite] = useState('');

  const field =
    'w-full rounded-control border border-black/15 px-3 py-2.5 outline-none focus:border-brand-primary';

  // Нормализация номера в E.164: пробелы, скобки и дефисы убираем, иначе
  // квота по номеру и вход посчитают «+381 60 123» и «+38160123» разными.
  function normalizePhone(raw: string): string {
    const digits = raw.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) return digits;
    // Локальный сербский формат 06x… → +381 6x…
    if (digits.startsWith('0')) return `+381${digits.slice(1)}`;
    return `+${digits}`;
  }

  // ---------- Отправка SMS-кода ----------
  async function sendCode() {
    setError(null);
    const e164 = normalizePhone(phone);

    if (e164.length < 9) {
      setError(
        locale === 'ru' ? 'Проверьте номер телефона' : 'Proverite broj telefona',
      );
      return;
    }

    setBusy(true);
    try {
      // Квота проверяется ДО отправки: RPC сама пишет журнал и экономит SMS.
      const { data: quota, error: quotaError } = await supabase.rpc(
        'rpc_check_otp_quota',
        { p_phone: e164 },
      );

      if (quotaError) throw new Error(quotaError.message);

      if (quota && quota.allowed === false) {
        setError(
          locale === 'ru'
            ? 'Превышен суточный лимит SMS на этот номер. Попробуйте завтра.'
            : 'Prekoračen je dnevni limit SMS poruka za ovaj broj. Pokušajte sutra.',
        );
        return;
      }

      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: e164,
      });
      if (otpError) throw new Error(otpError.message);

      setCodeSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ---------- Подтверждение кода и публикация ----------
  async function submit() {
    setError(null);

    // Бот заполнил скрытое поле — показываем «успех», но ничего не создаём.
    // Молчаливый отказ не даёт скрипту понять, что его отсекли.
    if (website.trim() !== '') {
      setDone(true);
      return;
    }

    setBusy(true);
    try {
      const e164 = normalizePhone(phone);

      // 1) Вход по коду из SMS.
      const { data: auth, error: verifyError } = await supabase.auth.verifyOtp({
        phone: e164,
        token: code.trim(),
        type: 'sms',
      });
      if (verifyError) throw new Error(verifyError.message);

      const uid = auth.user?.id;
      if (!uid) throw new Error('Не удалось получить идентификатор пользователя');

      // 2) Загрузка фотографий. Путь ОБЯЗАН начинаться с uid: политика
      // car_images_insert_own разрешает запись только в свою папку.
      const photoUrls: string[] = [];
      for (const [i, file] of files.entries()) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${uid}/${Date.now()}_${i}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('car-images')
          .upload(path, file, { upsert: false });
        if (uploadError) throw new Error(uploadError.message);

        const { data: pub } = supabase.storage
          .from('car-images')
          .getPublicUrl(path);
        photoUrls.push(pub.publicUrl);
      }

      // 3) Создание объявления. create_car_v3 (миграция 0055) — у неё
      // РАЗДЕЛЬНЫЕ цены продажи и аренды и есть залог. Прежняя v2
      // принимала одну цену и при 'both' копировала её в обе колонки,
      // из-за чего цена продажи равнялась суточной ставке.
      const { error: createError } = await supabase.rpc('create_car_v3', {
        p_listing_type: listingType,
        p_brand: brand.trim(),
        p_model: model.trim(),
        p_year: Number(year),
        // Пустые необязательные поля уходят как null, а не как 0:
        // ноль пробега БД поймёт как «новая машина».
        p_mileage: mileage ? Number(mileage) : null,
        // Цена продажи нужна только продающим объявлениям, суточная
        // ставка — только сдающимся. Лишние значения не отправляем,
        // чтобы в базе не осталось цены от неактуального типа.
        p_sale_price:
          listingType !== 'rent' && price ? Number(price) : null,
        p_rent_price_daily:
          listingType !== 'sale' && rentPrice ? Number(rentPrice) : null,
        p_deposit_amount:
          listingType !== 'sale' && deposit ? Number(deposit) : 0,
        p_currency: 'EUR',
        p_city: city.trim(),
        p_lat: null,
        p_lng: null,
        p_photo_urls: photoUrls,
        p_body_type: bodyType || null,
        p_transmission: transmission || null,
        p_fuel: fuel || null,
        p_description: description.trim() || null,
        p_phone: e164,
      });
      if (createError) throw new Error(createError.message);

      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ---------- Экран успеха ----------
  if (done) {
    return (
      <div className="rounded-card border border-black/10 p-6 text-center">
        <h2 className="text-xl font-semibold">{t('sell_success_title')}</h2>
        <p className="mx-auto mt-2 max-w-md text-black/60">
          {t('sell_success_text')}
        </p>
      </div>
    );
  }

  const canNext1 = brand.trim() && model.trim() && year && city.trim();
  const canSubmit = codeSent && code.trim().length >= 4;

  // Проверка шага «Детали». Дублирует серверную валидацию create_car_v3
  // намеренно: сервер — источник истины, но сообщить об ошибке до
  // загрузки фотографий и отправки SMS гораздо дешевле для пользователя.
  function validateDetails(): string | null {
    const needsRent = listingType !== 'sale';

    if (needsRent) {
      if (!rentPrice.trim()) return t('sell_err_rent_price');
      if (Number(rentPrice) <= 0) return t('sell_err_price_positive');
      if (deposit.trim() && Number(deposit) < 0) return t('sell_err_deposit');
    }

    // Цена продажи может отсутствовать («Договорная»), но если указана —
    // должна быть положительной.
    if (listingType !== 'rent' && price.trim() && Number(price) <= 0) {
      return t('sell_err_price_positive');
    }

    return null;
  }

  // Переход со второго шага с проверкой.
  function goToPhotos() {
    const problem = validateDetails();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep(3);
  }

  return (
    <div className="rounded-card border border-black/10 p-4 sm:p-6">
      <div className="mb-4 text-sm text-black/50">
        {t('sell_step')} {step} / 4
      </div>

      {/* ---------- Шаг 1: автомобиль ---------- */}
      {step === 1 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{t('sell_step_car')}</h2>

          {/* Тип объявления — первый вопрос: от него зависит, какие поля
              цен появятся на следующем шаге. */}
          <div>
            <label className="mb-1 block text-sm text-black/60">
              {t('sell_type')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['sale', t('sell_type_sale')],
                  ['rent', t('sell_type_rent')],
                  ['both', t('sell_type_both')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setListingType(value)}
                  className={
                    listingType === value
                      ? 'rounded-control bg-brand-dark px-3 py-2.5 text-sm font-semibold text-white'
                      : 'rounded-control border border-black/15 px-3 py-2.5 text-sm hover:bg-black/[0.03]'
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-black/60">
              {t('filter_brand')}
            </label>
            {/* list даёт подсказки из справочника, но не запрещает ввести
                свою марку: справочник пополняется триггером по факту подачи. */}
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              list="brands-list"
              className={field}
            />
            <datalist id="brands-list">
              {brands.map((b) => (
                <option key={b.brand_slug} value={b.brand} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="mb-1 block text-sm text-black/60">
              {t('filter_model')}
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={field}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-black/60">
                {t('filter_year')}
              </label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                min={1900}
                max={new Date().getFullYear() + 1}
                className={field}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-black/60">
                {t('filter_city')}
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={field}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={!canNext1}
            onClick={() => setStep(2)}
            className="w-full rounded-control bg-brand-green px-4 py-3 font-semibold text-white disabled:opacity-40"
          >
            {t('sell_next')}
          </button>
        </div>
      )}

      {/* ---------- Шаг 2: детали ---------- */}
      {step === 2 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{t('sell_step_details')}</h2>

          {/* Цена продажи — только когда объявление продаётся.
              Пустое значение допустимо: это «Договорная». */}
          {listingType !== 'rent' && (
            <div>
              <label className="mb-1 block text-sm text-black/60">
                {t('sell_sale_price')}, €
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                min={0}
                placeholder={t('car_price_negotiable')}
                className={field}
              />
            </div>
          )}

          {/* Цена аренды и залог — только когда объявление сдаётся.
              Суточная ставка обязательна: без неё объявление аренды
              бессмысленно, и того же требует constraint в БД. */}
          {listingType !== 'sale' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-black/60">
                  {t('sell_rent_price')}, € *
                </label>
                <input
                  type="number"
                  value={rentPrice}
                  onChange={(e) => setRentPrice(e.target.value)}
                  min={1}
                  required
                  className={field}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-black/60">
                  {t('sell_deposit')}, €
                </label>
                <input
                  type="number"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  min={0}
                  placeholder="0"
                  className={field}
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm text-black/60">
              {t('car_mileage')}, {t('common_km')}
            </label>
            <input
              type="number"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              min={0}
              className={field}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm text-black/60">
                {t('filter_body')}
              </label>
              <select
                value={bodyType}
                onChange={(e) => setBodyType(e.target.value)}
                className={field}
              >
                <option value="">{t('filter_any')}</option>
                {Object.entries(BODY_TYPES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label[locale]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-black/60">
                {t('filter_transmission')}
              </label>
              <select
                value={transmission}
                onChange={(e) => setTransmission(e.target.value)}
                className={field}
              >
                <option value="">{t('filter_any')}</option>
                {Object.entries(TRANSMISSIONS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label[locale]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-black/60">
                {t('filter_fuel')}
              </label>
              <select
                value={fuel}
                onChange={(e) => setFuel(e.target.value)}
                className={field}
              >
                <option value="">{t('filter_any')}</option>
                {Object.entries(FUELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label[locale]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-black/60">
              {t('car_description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={6000}
              className={field}
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-control border border-black/15 px-4 py-3 font-semibold"
            >
              {t('sell_back')}
            </button>
            <button
              type="button"
              onClick={goToPhotos}
              className="flex-1 rounded-control bg-brand-green px-4 py-3 font-semibold text-white"
            >
              {t('sell_next')}
            </button>
          </div>
        </div>
      )}

      {/* ---------- Шаг 3: фотографии ---------- */}
      {step === 3 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{t('sell_step_photos')}</h2>

          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setFiles(picked.slice(0, MAX_PHOTOS));
            }}
            className={field}
          />
          <p className="text-sm text-black/50">
            {files.length} / {MAX_PHOTOS}
          </p>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-control border border-black/15 px-4 py-3 font-semibold"
            >
              {t('sell_back')}
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="flex-1 rounded-control bg-brand-green px-4 py-3 font-semibold text-white"
            >
              {t('sell_next')}
            </button>
          </div>
        </div>
      )}

      {/* ---------- Шаг 4: контакты и вход по SMS ---------- */}
      {step === 4 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{t('sell_step_contact')}</h2>

          {/* Honeypot. Скрыт от пользователя и от скринридеров, но виден
              ботам, которые заполняют все поля формы подряд. */}
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
            <label className="mb-1 block text-sm text-black/60">
              {t('sell_phone')}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+381 6X XXX XXXX"
              className={field}
              disabled={codeSent}
            />
          </div>

          {!codeSent ? (
            <button
              type="button"
              onClick={sendCode}
              disabled={busy || !phone.trim()}
              className="w-full rounded-control bg-brand-blue px-4 py-3 font-semibold text-white disabled:opacity-40"
            >
              {t('sell_send_code')}
            </button>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm text-black/60">
                  {t('sell_code')}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={field}
                />
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={busy || !canSubmit}
                className="w-full rounded-control bg-brand-green px-4 py-3 font-semibold text-white disabled:opacity-40"
              >
                {t('sell_submit')}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setStep(3)}
            className="w-full rounded-control border border-black/15 px-4 py-3 font-semibold"
          >
            {t('sell_back')}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-control bg-brand-red/10 px-3 py-2 text-sm text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}
