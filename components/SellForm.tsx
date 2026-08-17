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

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { getBrowserClient } from '@/lib/supabaseClient';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { BRANDS, CITIES, YEAR_MIN, yearMax } from '@/lib/referenceData';
import { BODY_TYPES, FUELS, TRANSMISSIONS } from '@/lib/types';
import ListPicker, { type PickerOption } from './ListPicker';
import { fieldClass } from './ui/Field';

type Props = {
  locale: Locale;
};

// Максимум фотографий — как в приложении (AppConstants.maxCarImages).
const MAX_PHOTOS = 15;

export default function SellForm({ locale }: Props) {
  const t = getT(locale);
  const supabase = getBrowserClient();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Тип объявления. Определяет, какие поля цен показываются и что
  // уходит в create_car_v3. По умолчанию продажа — самый частый случай.
  // У объявления один тип сделки: продажа ИЛИ аренда. Вариант «и то и
  // другое» убран — одна машина, выставленная и на продажу, и в аренду,
  // подаётся двумя отдельными объявлениями. Защита от дублей это
  // разрешает: тип сделки входит в условие совпадения (миграция 0057).
  const [listingType, setListingType] = useState<'sale' | 'rent'>('sale');

  // Шаг 1–2: данные автомобиля.
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  // Модели выбранной марки. Грузятся из get_car_models — той же RPC,
  // что вызывает приложение, поэтому списки совпадают.
  const [modelList, setModelList] = useState<{ id: string; name: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
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
  // Номер, на который реально ушёл код, в формате E.164. Держим отдельно
  // от поля ввода: verifyOtp обязан получить ТОТ ЖЕ номер, что и
  // signInWithOtp, иначе Supabase не найдёт код.
  const [sentTo, setSentTo] = useState('');
  // Успешное подтверждение номера. Между verifyOtp и публикацией есть
  // загрузка фотографий — на это время пользователю нужен признак, что
  // код принят, иначе долгая загрузка выглядит как зависшая проверка.
  const [phoneVerified, setPhoneVerified] = useState(false);

  // Согласие с условиями и политикой. Без него код не отправляется —
  // тот же порядок, что в приложении (login_screen.dart: политика
  // принимается ДО sendOtp, а не после).
  const [agreed, setAgreed] = useState(false);

  // Обратный отсчёт до повторной отправки, 60 секунд — как в приложении.
  // Хранится момент, когда отправка снова разрешена: при возврате на
  // вкладку из фона таймер по «оставшимся секундам» отстал бы, а по
  // метке времени пересчёт всегда верный.
  const RESEND_DELAY_SEC = 60;
  const [resendAt, setResendAt] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  // Сообщение об успешной повторной отправке (в приложении — снек).
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (resendAt === 0) return;

    // Пересчёт остатка от метки времени. Один интервал на весь отсчёт.
    const tick = () => {
      const left = Math.ceil((resendAt - Date.now()) / 1000);
      setResendIn(left > 0 ? left : 0);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  // Honeypot: поле скрыто от человека и пустое у него всегда. Заполненное
  // значение — признак бота, и такую отправку мы молча не публикуем.
  const [website, setWebsite] = useState('');

  // Классы поля ввода — из общего паттерна (components/ui/Field).
  // Раньше эта строка была скопирована в четырёх формах.
  const field = fieldClass;

  // Выбор марки: сбрасывает модель и подтягивает её список — тот же
  // порядок действий, что в create_car_screen.dart приложения.
  async function handleBrandChange(next: string) {
    setBrand(next);
    setModel('');
    setModelList([]);

    if (!next) return;

    setLoadingModels(true);
    const { data, error: rpcError } = await supabase.rpc('get_car_models', {
      p_brand_name: next,
    });
    // Ошибку не показываем: модель — необязательное уточнение, и без
    // списка продавец сможет ввести своё значение через «Указать».
    setModelList(rpcError ? [] : ((data ?? []) as { id: string; name: string }[]));
    setLoadingModels(false);
  }

  // Нормализация номера в E.164: пробелы, скобки и дефисы убираем, иначе
  // квота по номеру и вход посчитают «+381 60 123» и «+38160123» разными.
  function normalizePhone(raw: string): string {
    const digits = raw.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) return digits;
    // Локальный сербский формат 06x… → +381 6x…
    if (digits.startsWith('0')) return `+381${digits.slice(1)}`;
    return `+${digits}`;
  }

  // Человеческие тексты типичных ошибок OTP — перенос _humanOtpError
  // из приложения (login_screen.dart). Supabase отдаёт эти сообщения
  // по-английски, и показывать их продавцу нельзя.
  function humanOtpError(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    const s = raw.toLowerCase();

    if (s.includes('expired')) return t('otp_err_expired');
    if (s.includes('invalid') || s.includes('incorrect')) {
      return t('otp_err_invalid');
    }
    // Серверный лимит Supabase на частоту отправки (отдельный от нашей
    // суточной квоты) — сообщаем как о лимите, а не англоязычной ошибкой.
    if (s.includes('rate limit') || s.includes('too many')) {
      return t('otp_err_quota');
    }
    return raw;
  }

  // ---------- Отправка SMS-кода ----------
  // resend = true — повторная отправка на уже подтверждённый номер:
  // квоту проверяем так же (каждая SMS платная и считается сервером).
  async function sendCode(resend = false) {
    setError(null);
    setNotice(null);

    // Согласие — обязательное условие ДО отправки SMS, как в приложении:
    // аккаунт создаётся самим входом, поэтому политика принимается здесь.
    if (!agreed) {
      setError(t('legal_consent_required'));
      return;
    }

    const e164 = normalizePhone(resend && sentTo ? sentTo : phone);

    // Сербский мобильный в E.164 — это +381 и 8–9 цифр номера, то есть
    // минимум 12 символов вместе с '+381'. Прежний порог в 9 символов
    // пропускал заведомо короткие номера, и SMS уходила в никуда,
    // списывая квоту.
    if (!/^\+\d{9,15}$/.test(e164)) {
      setError(t('otp_err_phone'));
      return;
    }

    setBusy(true);
    try {
      // Квота проверяется ДО отправки: RPC сама пишет журнал и экономит SMS.
      // Лимит — 5 SMS на номер за 24 часа (миграция 0035), сервер здесь
      // источник истины, клиент только показывает результат.
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
      // Запускаем отсчёт до следующей отправки.
      setResendAt(Date.now() + RESEND_DELAY_SEC * 1000);
      if (resend) setNotice(t('otp_resent'));
    } catch (e) {
      setError(humanOtpError(e));
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

    // Шаг, на котором находится публикация. Нужен единственному месту —
    // отчёту об ошибке в catch: по сообщению Supabase не всегда видно,
    // отклонён код, не прошла загрузка фото или упала сама RPC.
    // Персональные данные (uid, телефон) в лог не попадают.
    let stage: 'verify' | 'upload' | 'create' = 'verify';

    try {
      // Номер берём тот, на который реально ушёл код. Пересчитывать его
      // из поля ввода нельзя: пользователь мог поправить текст после
      // отправки, и verifyOtp ушёл бы с другим номером.
      const e164 = sentTo || normalizePhone(phone);

      // 1) Вход по коду из SMS.
      const { data: auth, error: verifyError } = await supabase.auth.verifyOtp({
        phone: e164,
        token: code.trim(),
        type: 'sms',
      });
      if (verifyError) throw new Error(verifyError.message);

      const uid = auth.user?.id;
      // Сессия обязана появиться: без неё RLS отклонит и загрузку фото,
      // и create_car_v3 — объявление осталось бы без владельца.
      if (!auth.session || !uid) {
        throw new Error(t('otp_err_failed'));
      }

      setPhoneVerified(true);
      // Дальше начинается загрузка фотографий: если что-то упадёт,
      // отчёт об ошибке должен назвать именно этот шаг.
      stage = 'upload';

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

      stage = 'create';

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
          listingType === 'sale' && price ? Number(price) : null,
        p_rent_price_daily:
          listingType === 'rent' && rentPrice ? Number(rentPrice) : null,
        p_deposit_amount:
          listingType === 'rent' && deposit ? Number(deposit) : 0,
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
      // В консоль — только шаг и текст ошибки. Ни uid, ни номер телефона
      // сюда не пишутся: консоль браузера доступна расширениям, а это
      // персональные данные продавца.
      console.error('[RS Auto] Ошибка публикации объявления', {
        stage,
        message: e instanceof Error ? e.message : String(e),
      });

      setError(humanOtpError(e));
    } finally {
      setBusy(false);
    }
  }

  // ---------- Экран успеха ----------
  if (done) {
    return (
      // Личного кабинета на сайте нет намеренно: управление объявлениями
      // живёт в приложении. Поэтому после подачи — экран модерации и
      // выход в каталог, а не «мои объявления».
      <div className="rounded-card border border-neutral-10 p-6 text-center">
        <h2 className="text-xl font-semibold">{t('sell_success_title')}</h2>
        <p className="mx-auto mt-2 max-w-md text-neutral-60">
          {t('sell_success_text')}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={localeHref(locale, '/cars')}
            className="rounded-control bg-brand-green px-5 py-3 font-semibold text-white"
          >
            {t('nf_catalog')}
          </Link>
          <Link
            href={localeHref(locale, '/app')}
            className="rounded-control border border-neutral-15 px-5 py-3 font-semibold"
          >
            {t('nav_app')}
          </Link>
        </div>
      </div>
    );
  }

  const canNext1 = brand.trim() && model.trim() && year && city.trim();
  const canSubmit = codeSent && code.trim().length >= 4;

  // Проверка шага «Детали». Дублирует серверную валидацию create_car_v3
  // намеренно: сервер — источник истины, но сообщить об ошибке до
  // загрузки фотографий и отправки SMS гораздо дешевле для пользователя.
  function validateDetails(): string | null {
    const needsRent = listingType === 'rent';

    if (needsRent) {
      if (!rentPrice.trim()) return t('sell_err_rent_price');
      if (Number(rentPrice) <= 0) return t('sell_err_price_positive');
      if (deposit.trim() && Number(deposit) < 0) return t('sell_err_deposit');
    }

    // Цена продажи может отсутствовать («Договорная»), но если указана —
    // должна быть положительной.
    if (listingType === 'sale' && price.trim() && Number(price) <= 0) {
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
    <div className="rounded-card border border-neutral-10 p-4 sm:p-6">
      <div className="mb-4 text-sm text-neutral-50">
        {t('sell_step')} {step} / 4
      </div>

      {/* ---------- Шаг 1: автомобиль ---------- */}
      {step === 1 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{t('sell_step_car')}</h2>

          {/* Тип объявления — первый вопрос: от него зависит, какие поля
              цен появятся на следующем шаге. */}
          <div>
            <label className="mb-1 block text-sm text-neutral-60">
              {t('sell_type')}
            </label>
            {/* Два варианта вместо трёх: у объявления один тип сделки.
                Машину, которую продают и сдают, подают двумя объявлениями. */}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['sale', t('sell_type_sale')],
                  ['rent', t('sell_type_rent')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setListingType(value)}
                  className={
                    listingType === value
                      ? 'rounded-control bg-brand-dark px-3 py-2.5 text-sm font-semibold text-white'
                      : 'rounded-control border border-neutral-15 px-3 py-2.5 text-sm hover:bg-surface-hover'
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Марка — выбор из полного справочника с поиском.
              allowCustom повторяет приложение (allowCustom: true в
              create_car_screen.dart): редкую марку можно добавить явным
              действием «Указать», справочник car_brands пополнит триггер. */}
          <ListPicker
            locale={locale}
            name="brand"
            label={t('filter_brand')}
            options={BRANDS.map((b): PickerOption => ({ value: b, label: b }))}
            value={brand}
            allowCustom
            onChange={handleBrandChange}
          />

          {/* Модель — каскадом от марки, как в приложении. */}
          <ListPicker
            locale={locale}
            name="model"
            label={t('filter_model')}
            options={modelList.map(
              (m): PickerOption => ({ value: m.name, label: m.name }),
            )}
            value={model}
            disabled={!brand || loadingModels}
            emptyHint={
              !brand
                ? t('picker_model_no_brand')
                : loadingModels
                  ? t('picker_search')
                  : t('picker_model_empty')
            }
            allowCustom
            onChange={setModel}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-neutral-60">
                {t('filter_year')}
              </label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                min={YEAR_MIN}
                max={yearMax()}
                className={field}
              />
            </div>
            {/* Город — тот же список, что в онбординге приложения.
                allowCustom оставлен, как в приложении: продавец может
                быть из города, которого нет в списке 18 крупных. */}
            <ListPicker
              locale={locale}
              name="city"
              label={t('filter_city')}
              options={CITIES.map((c): PickerOption => ({ value: c, label: c }))}
              value={city}
              allowCustom
              onChange={setCity}
            />
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
          {listingType === 'sale' && (
            <div>
              <label className="mb-1 block text-sm text-neutral-60">
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
          {listingType === 'rent' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-neutral-60">
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
                <label className="mb-1 block text-sm text-neutral-60">
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
            <label className="mb-1 block text-sm text-neutral-60">
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

          {/* Кузов, коробка и топливо — те же полные enum, что в
              приложении. Поиск не нужен: пунктов не больше десяти. */}
          <div className="grid grid-cols-3 gap-3">
            <ListPicker
              locale={locale}
              name="body_type"
              label={t('filter_body')}
              options={Object.entries(BODY_TYPES).map(
                ([key, labels]): PickerOption => ({
                  value: key,
                  label: labels[locale],
                }),
              )}
              value={bodyType}
              searchable={false}
              onChange={setBodyType}
            />

            <ListPicker
              locale={locale}
              name="transmission"
              label={t('filter_transmission')}
              options={Object.entries(TRANSMISSIONS).map(
                ([key, labels]): PickerOption => ({
                  value: key,
                  label: labels[locale],
                }),
              )}
              value={transmission}
              searchable={false}
              onChange={setTransmission}
            />

            <ListPicker
              locale={locale}
              name="fuel"
              label={t('filter_fuel')}
              options={Object.entries(FUELS).map(
                ([key, labels]): PickerOption => ({
                  value: key,
                  label: labels[locale],
                }),
              )}
              value={fuel}
              searchable={false}
              onChange={setFuel}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-neutral-60">
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
              className="rounded-control border border-neutral-15 px-4 py-3 font-semibold"
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
          <p className="text-sm text-neutral-50">
            {files.length} / {MAX_PHOTOS}
          </p>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-control border border-neutral-15 px-4 py-3 font-semibold"
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
            <label className="mb-1 block text-sm text-neutral-60">
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
            <>
              {/* Согласие с условиями и политикой — ОБЯЗАТЕЛЬНО до кнопки
                  «Получить код». Тот же порядок, что в приложении: аккаунт
                  создаётся самим входом по SMS, поэтому документы
                  принимаются здесь, а не после публикации.
                  Ссылки ведут на страницы сайта и открываются в новой
                  вкладке — иначе продавец потеряет заполненную форму. */}
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

              <button
                type="button"
                onClick={() => sendCode()}
                // Кнопка неактивна без согласия: отправлять SMS раньше
                // принятия документов нельзя.
                disabled={busy || !phone.trim() || !agreed}
                className="w-full rounded-control bg-brand-blue px-4 py-3 font-semibold text-white disabled:opacity-40"
              >
                {busy ? t('otp_sending') : t('sell_send_code')}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-60">
                {t('otp_sent_to')} {sentTo}
              </p>

              <div>
                <label className="mb-1 block text-sm text-neutral-60">
                  {t('sell_code')}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) =>
                    // Только цифры: в приложении поле кода тоже
                    // ограничено digitsOnly.
                    setCode(e.target.value.replace(/\D/g, ''))
                  }
                  className={field}
                />
              </div>

              {/* «Изменить номер» и «Отправить снова» — как в приложении.
                  Повторная отправка блокируется на 60 секунд: без таймера
                  продавец выжжет суточную квоту в пять SMS за минуту. */}
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

              <button
                type="button"
                onClick={submit}
                disabled={busy || !canSubmit}
                className="w-full rounded-control bg-brand-green px-4 py-3 font-semibold text-white disabled:opacity-40"
              >
                {busy
                  ? phoneVerified
                    ? t('sell_submit')
                    : t('otp_verifying')
                  : t('sell_submit')}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setStep(3)}
            className="w-full rounded-control border border-neutral-15 px-4 py-3 font-semibold"
          >
            {t('sell_back')}
          </button>
        </div>
      )}

      {/* Успешная повторная отправка. В приложении это зелёный снек;
          на сайте — та же роль, но без всплывающего слоя. */}
      {notice && !error && (
        <p className="mt-4 rounded-control bg-brand-green/10 px-3 py-2 text-sm text-brand-green">
          {notice}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-control bg-brand-red/10 px-3 py-2 text-sm text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}
