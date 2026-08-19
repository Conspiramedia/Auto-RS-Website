'use client';

// ============================================================
// RS AUTO — Форма объявления: подача и редактирование. Client Component.
// ============================================================
// ОДНА форма на два сценария (mode):
//   'create' — подача нового объявления с /sell;
//   'edit'   — правка своего объявления из кабинета
//              (/my/listing/[id]/edit).
//
// Почему один компонент, а не два. Поля, пикеры, маски, валидация и
// правила цен совпадают полностью: разошедшись на две формы, они
// разъехались бы при первой же правке — например, новое поле появилось
// бы только при подаче, и отредактировать его стало бы невозможно.
//
// Различия ровно три, и все они локальны:
//   1. в edit нет шага входа по SMS — сессия уже есть;
//   2. поля предзаполняются из get_car_details + get_car_images;
//   3. вызывается update_car_v3 вместо create_car_v3.
//
// Порядок шагов: Автомобиль → Детали → Фото → Контакты (вход по SMS).
// Вход намеренно последний: заставлять человека авторизоваться до того,
// как он что-то ввёл, — верный способ потерять продавца на первом экране.
// В режиме edit последнего шага нет: форма заканчивается фотографиями.
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
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { revalidateMyListings } from '@/app/my/actions';
import { getBrowserClient } from '@/lib/supabaseClient';
import { trackEvent } from '@/lib/analytics';
import {
  acceptPolicy,
  hasAcceptedPolicyHere,
  migrateGuestConsent,
} from '@/lib/consent';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { BRANDS, CITIES, YEAR_MIN, yearMax } from '@/lib/referenceData';
import {
  MAX_MILEAGE,
  MAX_PRICE,
  formatSerbianPhone,
  handleNumberInput,
  parseThousands,
  serbianPhoneToE164,
  validateYear,
} from '@/lib/inputFormat';
import { BODY_TYPES, FUELS, TRANSMISSIONS } from '@/lib/types';
import ListPicker, { type PickerOption } from './ListPicker';
import PhotoPicker, { type PhotoItem } from './PhotoPicker';
import CloseButton from './ui/CloseButton';
import { fieldClass, fieldClassTextarea } from './ui/Field';
import { RESEND_DELAY_SEC, humanOtpError } from '@/lib/otp';
import Button from './ui/Button';
import Card from './ui/Card';
import { SkeletonBox } from './ui/Skeleton';

type Props = {
  locale: Locale;
  // 'create' по умолчанию — страница подачи /sell не передаёт режим.
  mode?: 'create' | 'edit';
  // Идентификатор редактируемого объявления. Обязателен при mode='edit'
  // и не используется при подаче.
  carId?: string;
};

// Максимум фотографий — как в приложении (AppConstants.maxCarImages).
// Десять, а не пятнадцать: столько же принимает форма подачи
// в приложении, и лимит обязан совпадать в обоих клиентах —
// ограничения на стороне БД нет, проверка целиком клиентская.
const MAX_PHOTOS = 10;

// Годы выпуска для пикера: свежие сверху, как в приложении.
// Считается один раз при загрузке модуля — список не меняется в течение
// сессии, и пересобирать его на каждый рендер незачем.
const YEARS: string[] = Array.from(
  { length: yearMax() - YEAR_MIN + 1 },
  (_, i) => String(yearMax() - i),
);

export default function SellForm({
  locale,
  mode = 'create',
  carId,
}: Props) {
  const t = getT(locale);
  const router = useRouter();
  const supabase = getBrowserClient();

  const isEdit = mode === 'edit';

  const [step, setStep] = useState(1);
  // Загрузка исходных данных объявления в режиме правки. true на старте
  // только для edit: при подаче грузить нечего, и форма показывается
  // сразу.
  const [loading, setLoading] = useState(isEdit);
  // Ушло ли объявление на повторную модерацию после сохранения. Нужно
  // экрану успеха: решение принимает СЕРВЕР (сравнивает контент), и
  // угадывать его на клиенте нельзя.
  const [movedToModeration, setMovedToModeration] = useState(false);
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

  // Шаг 3: фотографии. Набор смешанный: при подаче это только выбранные
  // файлы, при правке — ещё и уже загруженные снимки объявления
  // (см. PhotoItem в PhotoPicker).
  const [files, setFiles] = useState<PhotoItem[]>([]);
  // Прогресс отправки фотографий в хранилище, 0..100. Считается по
  // числу загруженных файлов, а не по байтам: Supabase Storage не
  // отдаёт события прогресса отдельного запроса, а по файлам
  // индикатор всё равно движется предсказуемо.
  const [uploadProgress, setUploadProgress] = useState(0);

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
  //
  // Начальное значение подставляется из localStorage в useEffect ниже:
  // при первом рендере обращаться к нему нельзя (форма рендерится и на
  // сервере), а расхождение разметки сервера и клиента ломает гидрацию.
  const [agreed, setAgreed] = useState(false);

  // Уже вошедший продавец. Сессия Supabase живёт между визитами
  // (persistSession в lib/supabaseClient), и человеку, подающему второе
  // объявление, незачем снова получать SMS: код нужен для СОЗДАНИЯ
  // сессии, а она уже есть.
  //
  // null — проверка ещё идёт: до её конца шаг 4 не показывает ни блок
  // входа, ни кнопку публикации, иначе на долю секунды мелькнёт
  // «Отправить код» у того, кто давно вошёл.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  // Обратный отсчёт до повторной отправки. Задержка общая с входом в
  // кабинет (lib/otp.ts): расхождение здесь означало бы, что одна и та
  // же квота SMS расходуется по разным правилам на разных экранах.
  // Хранится момент, когда отправка снова разрешена: при возврате на
  // вкладку из фона таймер по «оставшимся секундам» отстал бы, а по
  // метке времени пересчёт всегда верный.
  const [resendAt, setResendAt] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  // Сообщение об успешной повторной отправке (в приложении — снек).
  const [notice, setNotice] = useState<string | null>(null);

  // Открытие формы подачи — вершина воронки продавца. Считается один
  // раз за монтирование: пустой список зависимостей, а не при каждом
  // шаге, иначе одна подача давала бы четыре события.
  useEffect(() => {
    trackEvent('sell_start');
  }, []);

  // Определение уже вошедшего продавца и ранее принятой политики.
  // Оба факта живут на устройстве и читаются ТОЛЬКО на клиенте.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      const uid = data.session?.user.id ?? null;
      setSignedIn(uid !== null);

      // Согласие могло быть дано ещё гостем — переносим на аккаунт,
      // иначе тот же человек увидит непринятый чекбокс.
      if (uid) migrateGuestConsent(uid);
      // Проверяем и аккаунт, и гостя: документы принимаются один раз
      // на устройстве, а не при каждом входе. Без гостевой ветки
      // продавец без активной сессии снова видел пустой чекбокс.
      setAgreed(hasAcceptedPolicyHere(uid));
    })();

    return () => {
      cancelled = true;
    };
    // supabase — синглтон, ссылка стабильна: эффект выполняется однажды.
  }, [supabase]);

  // ------------------------------------------------------------
  // Режим правки: предзаполнение формы данными объявления.
  // ------------------------------------------------------------
  // Два запроса идут ПАРАЛЛЕЛЬНО (Promise.all): карточка и её фотографии
  // независимы, и последовательное ожидание удвоило бы время до
  // появления формы.
  //
  // Права проверяет сервер: get_car_details отдаёт непубличные статусы
  // только владельцу и админу (миграция 0048). Страница дополнительно
  // сверяет user_id и отдаёт 404 на чужое объявление — здесь это уже
  // гарантировано, поэтому форма просто показывает то, что пришло.
  useEffect(() => {
    if (!isEdit || !carId) return;

    let cancelled = false;

    (async () => {
      const [detailsResult, imagesResult] = await Promise.all([
        supabase.rpc('get_car_details', { p_car_id: carId }),
        supabase.rpc('get_car_images', { p_car_id: carId }),
      ]);

      if (cancelled) return;

      const car = (detailsResult.data ?? [])[0] as
        | Record<string, unknown>
        | undefined;

      if (detailsResult.error || !car) {
        setError(t('edit_err_load'));
        setLoading(false);
        return;
      }

      // Тип сделки. Объявление «и продажа, и аренда» (такие создавало
      // приложение через v2) приводим к продаже: форма сайта предлагает
      // только один тип, а продажа — основная сделка такой карточки.
      setListingType(car.is_for_rent && !car.is_for_sale ? 'rent' : 'sale');

      setBrand((car.brand as string) ?? '');
      setModel((car.model as string) ?? '');
      setYear(car.year != null ? String(car.year) : '');
      setCity((car.city as string) ?? '');
      setBodyType((car.body_type as string) ?? '');
      setTransmission((car.transmission as string) ?? '');
      setFuel((car.fuel as string) ?? '');
      setDescription((car.description as string) ?? '');

      // Числовые поля хранят ФОРМАТИРОВАННУЮ строку («12 500»): их
      // читает parseThousands при отправке. Поэтому и предзаполняем
      // через тот же форматтер, иначе первая же правка поля сбила бы
      // разделители разрядов.
      setMileage(
        car.mileage != null
          ? handleNumberInput(String(car.mileage), MAX_MILEAGE)
          : '',
      );
      setPrice(
        car.sale_price != null
          ? handleNumberInput(String(Math.round(Number(car.sale_price))), MAX_PRICE)
          : '',
      );
      setRentPrice(
        car.rent_price_daily != null
          ? handleNumberInput(
              String(Math.round(Number(car.rent_price_daily))),
              MAX_PRICE,
            )
          : '',
      );
      setDeposit(
        car.deposit_amount != null && Number(car.deposit_amount) > 0
          ? handleNumberInput(
              String(Math.round(Number(car.deposit_amount))),
              MAX_PRICE,
            )
          : '',
      );

      // Существующие фотографии в порядке order_index — его задаёт RPC.
      // Ошибку выборки фото не считаем фатальной: текстовые поля уже
      // загружены, и правка описания не должна срываться из-за картинок.
      if (!imagesResult.error) {
        const urls = (imagesResult.data ?? []) as { image_url: string }[];
        setFiles(
          urls.map((row): PhotoItem => ({ kind: 'url', url: row.image_url })),
        );
      }

      // Список моделей выбранной марки: без него пикер модели окажется
      // пустым, и продавец не сможет сменить модель, не выбрав марку
      // заново.
      if (car.brand) {
        const { data: models } = await supabase.rpc('get_car_models', {
          p_brand_name: car.brand as string,
        });
        if (!cancelled) {
          setModelList((models ?? []) as { id: string; name: string }[]);
        }
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // t стабильна для локали, supabase — синглтон: эффект выполняется
    // один раз на объявление.
  }, [isEdit, carId, supabase, t]);

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
  const fieldTextarea = fieldClassTextarea;

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

  // Нормализация номера в E.164 живёт в lib/inputFormat — это дословный
  // перенос serbian_phone.dart из приложения. Своя реализация здесь была
  // слабее: она принимала любой набор из 9–15 цифр, поэтому «+38112345»
  // (не мобильный) и номер чужой страны проходили проверку, а SMS
  // уходила в никуда, списывая квоту.
  function normalizePhone(raw: string): string {
    return serbianPhoneToE164(raw) ?? '';
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

    // Фиксируем принятие текущей редакции. Пока пользователь — гость;
    // на его uid согласие переедет после успешного входа.
    acceptPolicy(null);

    const e164 = normalizePhone(resend && sentTo ? sentTo : phone);

    // Пустая строка означает, что номер не прошёл проверку приложения:
    // не сербский мобильный (нужно 8–9 цифр национальной части,
    // начинающихся с 6). Отправлять SMS на такой номер нельзя —
    // она не дойдёт, но спишет суточную квоту продавца.
    if (e164 === '') {
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

      // Продавец дошёл до подтверждения номера — ключевая точка воронки:
      // разрыв между sell_start и otp_sent показывает, где теряются люди.
      // Повторную отправку не считаем: это то же самое событие воронки.
      // Номер телефона в аналитику НЕ передаётся.
      if (!resend) trackEvent('otp_sent', { listing_type: listingType });

      // Запускаем отсчёт до следующей отправки.
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

      // 1) Вход. У продавца, подающего не первое объявление, сессия уже
      // есть — SMS не нужна вовсе: код служит для СОЗДАНИЯ сессии, а не
      // для подтверждения каждой публикации. Лишний verifyOtp здесь
      // отклонялся бы (кода нет) и жёг суточную квоту в пять SMS.
      let uid: string | undefined;
      // Телефон для объявления. У гостя это номер, на который ушёл код;
      // у вошедшего — номер его аккаунта: поле ввода ему не показывается,
      // и брать оттуда нечего, а create_car_v3 требует непустой телефон
      // (constraint cars_contact_phone_serbian).
      let contactPhone = e164;

      // В режиме правки шага входа нет вовсе: в кабинет пускает только
      // серверная проверка сессии (app/my/layout), поэтому здесь она
      // заведомо есть. Ветка signedIn ниже обрабатывает и этот случай —
      // берёт uid и телефон из текущей сессии.
      if (isEdit || signedIn) {
        const { data: current } = await supabase.auth.getSession();
        uid = current.session?.user.id;
        contactPhone = current.session?.user.phone
          ? `+${current.session.user.phone.replace(/^\+/, '')}`
          : '';
        if (!contactPhone) throw new Error(t('otp_err_failed'));
      } else {
        const { data: auth, error: verifyError } =
          await supabase.auth.verifyOtp({
            phone: e164,
            token: code.trim(),
            type: 'sms',
          });
        if (verifyError) throw new Error(verifyError.message);
        if (!auth.session) throw new Error(t('otp_err_failed'));
        uid = auth.user?.id;

        // Согласие давалось гостем — переносим на созданный аккаунт,
        // чтобы при следующей подаче политику не спрашивали снова.
        if (uid) migrateGuestConsent(uid);
      }

      // Сессия обязана быть: без неё RLS отклонит и загрузку фото,
      // и create_car_v3 — объявление осталось бы без владельца.
      if (!uid) {
        throw new Error(t('otp_err_failed'));
      }

      setPhoneVerified(true);
      // Дальше начинается загрузка фотографий: если что-то упадёт,
      // отчёт об ошибке должен назвать именно этот шаг.
      stage = 'upload';

      // 2) Фотографии. Массив photoUrls собирается В ПОРЯДКЕ, который
      // продавец задал в PhotoPicker: первая ссылка становится обложкой
      // объявления в каталоге.
      //
      // При правке набор смешанный. Уже загруженные снимки берём по
      // готовому адресу — заново отправлять их в хранилище незачем:
      // это лишний трафик и дубли одного файла в бакете. Грузятся
      // только те, что продавец добавил сейчас.
      const photoUrls: string[] = [];
      setUploadProgress(0);

      // Прогресс считаем по НОВЫМ файлам: существующие не грузятся, и
      // включать их в знаменатель значило бы показать «50%» там, где
      // работы нет вовсе.
      const toUpload = files.filter((item) => item.kind === 'file').length;
      let uploaded = 0;

      for (const [i, item] of files.entries()) {
        if (item.kind === 'url') {
          photoUrls.push(item.url);
          continue;
        }

        const file = item.file;
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        // Путь ОБЯЗАН начинаться с uid: политика car_images_insert_own
        // разрешает запись только в свою папку.
        const path = `${uid}/${Date.now()}_${i}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('car-images')
          .upload(path, file, { upsert: false });
        if (uploadError) throw new Error(uploadError.message);

        const { data: pub } = supabase.storage
          .from('car-images')
          .getPublicUrl(path);
        photoUrls.push(pub.publicUrl);

        // Прогресс после КАЖДОГО файла: при десяти снимках это
        // единственная обратная связь на протяжении десятков секунд.
        uploaded += 1;
        setUploadProgress(Math.round((uploaded / toUpload) * 100));
      }

      stage = 'create';

      // 3) Запись. Обе функции — create_car_v3 (0055) и update_car_v3
      // (0067) — принимают ОДИНАКОВЫЙ набор полей с раздельными ценами
      // продажи и аренды. Поэтому параметры собираются один раз, а
      // отличается только имя RPC и добавленный при правке p_car_id.
      //
      // Прежняя update_car_v2 принимала одну цену и при 'both'
      // копировала её в обе колонки — ровно та ошибка, ради которой
      // появилась v3.
      const payload = {
        p_listing_type: listingType,
        p_brand: brand.trim(),
        p_model: model.trim(),
        p_year: Number(year),
        // ВАЖНО: поля цен и пробега хранят ФОРМАТИРОВАННУЮ строку
        // («12 500»), поэтому наружу они идут через parseThousands.
        // Number('12 500') вернул бы NaN, и объявление ушло бы без цены.
        // Пустые необязательные поля уходят как null, а не как 0:
        // ноль пробега БД поймёт как «новая машина».
        p_mileage: parseThousands(mileage),
        // Цена продажи нужна только продающим объявлениям, суточная
        // ставка — только сдающимся. Лишние значения не отправляем,
        // чтобы в базе не осталось цены от неактуального типа.
        p_sale_price:
          listingType === 'sale' ? parseThousands(price) : null,
        p_rent_price_daily:
          listingType === 'rent' ? parseThousands(rentPrice) : null,
        p_deposit_amount:
          listingType === 'rent' ? (parseThousands(deposit) ?? 0) : 0,
        p_currency: 'EUR',
        p_city: city.trim(),
        p_lat: null,
        p_lng: null,
        p_photo_urls: photoUrls,
        p_body_type: bodyType || null,
        p_transmission: transmission || null,
        p_fuel: fuel || null,
        p_description: description.trim() || null,
        p_phone: contactPhone,
      };

      if (isEdit) {
        const { data, error: updateError } = await supabase.rpc(
          'update_car_v3',
          { p_car_id: carId, ...payload },
        );
        if (updateError) throw new Error(updateError.message);

        // Ушло ли объявление на повторную проверку, решает СЕРВЕР:
        // он сравнивает новый контент со старым (миграция 0067).
        // Клиент только читает результат — повторять это сравнение
        // здесь значило бы завести второй источник истины.
        const updated = (data ?? [])[0] as { status?: string } | undefined;
        setMovedToModeration(updated?.status === 'moderation');

        // Список в кабинете отрисован на сервере и закэширован: без
        // сброса продавец вернулся бы к прежнему бейджу статуса.
        await revalidateMyListings();
      } else {
        const { error: createError } = await supabase.rpc(
          'create_car_v3',
          payload,
        );
        if (createError) throw new Error(createError.message);

        // Целевое действие сайта: объявление создано и ушло на
        // модерацию. Число фотографий — полезный признак качества
        // подачи, по нему видно, доходят ли продавцы до шага с фото.
        trackEvent('listing_submitted', {
          listing_type: listingType,
          photos: photoUrls.length,
        });
      }

      setDone(true);
    } catch (e) {
      // В консоль — только шаг и текст ошибки. Ни uid, ни номер телефона
      // сюда не пишутся: консоль браузера доступна расширениям, а это
      // персональные данные продавца.
      console.error('[RS Auto] Ошибка публикации объявления', {
        stage,
        message: e instanceof Error ? e.message : String(e),
      });

      setError(humanOtpError(e, t));
    } finally {
      setBusy(false);
    }
  }

  // ---------- Загрузка объявления в режиме правки ----------
  // Скелет вместо пустой карточки: форма из десятка полей появляется
  // не мгновенно, и подсказка о том, что данные едут, избавляет от
  // ощущения сломанной страницы.
  if (loading) {
    return (
      <Card>
        <p className="text-center text-neutral-60">{t('edit_loading')}</p>
        <div className="mt-4 space-y-3">
          <SkeletonBox className="h-11 w-full" />
          <SkeletonBox className="h-11 w-full" />
          <SkeletonBox className="h-11 w-2/3" />
        </div>
      </Card>
    );
  }

  // ---------- Экран успеха ----------
  if (done) {
    // После ПРАВКИ возвращаем в кабинет: продавец пришёл оттуда, туда
    // же ему и нужно — увидеть объявление в списке с новым статусом.
    // Текст зависит от того, ушло ли объявление на повторную проверку:
    // это решил сервер, сравнив контент (миграция 0067), и сообщить об
    // этом честно важнее, чем показать одинаковое «Сохранено».
    if (isEdit) {
      return (
        <Card padding="none" className="p-6 text-center">
          <h2 className="text-xl font-semibold">
            {movedToModeration
              ? t('edit_done_moderation_title')
              : t('edit_done_title')}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-neutral-60">
            {movedToModeration
              ? t('edit_done_moderation_text')
              : t('edit_done_text')}
          </p>

          <div className="mt-6">
            <Button size="lg" href={localeHref(locale, '/my')}>
              {t('edit_back_to_list')}
            </Button>
          </div>
        </Card>
      );
    }

    return (
      // После ПОДАЧИ ведём в каталог: объявление ещё на модерации и в
      // кабинете показать нечего, кроме бейджа «На проверке», а вот
      // посмотреть площадку в этот момент самое время.
      <Card padding="none" className="p-6 text-center">
        <h2 className="text-xl font-semibold">{t('sell_success_title')}</h2>
        <p className="mx-auto mt-2 max-w-md text-neutral-60">
          {t('sell_success_text')}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" href={localeHref(locale, '/cars')}>
            {t('nf_catalog')}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            href={localeHref(locale, '/my')}
          >
            {t('edit_back_to_list')}
          </Button>
        </div>
      </Card>
    );
  }

  // Год проверяется по диапазону (1900 … следующий год) — теми же
  // границами, что constraint chk_year в БД. Раньше достаточно было
  // любого непустого значения, и «12» проходило дальше, а объявление
  // отклонялось уже сервером после отправки SMS.
  const canNext1 =
    brand.trim() &&
    model.trim() &&
    validateYear(year, YEAR_MIN, yearMax()) &&
    city.trim();
  // Вошедшему продавцу код не нужен — публиковать можно сразу.
  // Гостю по-прежнему нужен отправленный и введённый код.
  const canSubmit = signedIn || (codeSent && code.trim().length >= 4);

  // Проверка шага «Детали». Дублирует серверную валидацию create_car_v3
  // намеренно: сервер — источник истины, но сообщить об ошибке до
  // загрузки фотографий и отправки SMS гораздо дешевле для пользователя.
  function validateDetails(): string | null {
    const needsRent = listingType === 'rent';

    // Сравнения идут по РАСПАРСЕННОМУ значению: поля хранят строку
    // с разделителями тысяч, и Number('12 500') дал бы NaN, из-за чего
    // проверка «> 0» молча пропустила бы что угодно.
    if (needsRent) {
      const rent = parseThousands(rentPrice);
      if (rent === null) return t('sell_err_rent_price');
      if (rent <= 0) return t('sell_err_price_positive');
    }

    // Цена продажи может отсутствовать («Договорная»), но если указана —
    // должна быть положительной. Отрицательной она быть не может в
    // принципе: поле принимает только цифры.
    if (listingType === 'sale') {
      const sale = parseThousands(price);
      if (sale !== null && sale <= 0) return t('sell_err_price_positive');
    }

    return null;
  }

  // Переход с шага фотографий на шаг контактов.
  function goToContacts() {
    if (files.length === 0) {
      setError(t('sell_err_photos_required'));
      return;
    }
    setError(null);
    setStep(4);
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
    <Card>
      {/* Шапка формы: счётчик шагов слева, выход справа.
          Крестик нужен именно здесь: подача — длинная форма на
          отдельной странице, и до появления кнопки единственным
          способом «передумать» была кнопка «Назад» браузера, которая
          на первом шаге уводила вообще с сайта. Уход ведёт в каталог,
          а не history.back(): на /sell часто приходят по прямой ссылке
          из шапки, и возвращать человека в пустую историю незачем.
          Ничего не отправлено — закрытие проходит без последствий. */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="text-sm text-neutral-50">
          {/* В режиме правки шага входа нет — всего три. */}
          {t('sell_step')} {step} / {isEdit ? 3 : 4}
        </div>
        <CloseButton
          // При правке закрытие возвращает в кабинет, откуда продавец
          // пришёл; при подаче — в каталог: на /sell часто попадают по
          // прямой ссылке из шапки, и возвращать в пустую историю
          // незачем.
          onClick={() =>
            router.push(localeHref(locale, isEdit ? '/my' : '/cars'))
          }
          label={t('common_close')}
          // Отрицательные отступы возвращают знак к краю карточки:
          // у кнопки область 40px ради попадания пальцем, и без сдвига
          // она визуально отступала бы от угла сильнее заголовка.
          className="-mr-2 -mt-2 shrink-0"
        />
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
            {/* Год — ВЫБОР ИЗ СПИСКА, как в приложении
                (create_car_screen.dart): свежие годы сверху, диапазон
                тот же 1900…текущий+1, что и constraint chk_year в БД.
                Ручной ввод здесь ничего не давал: значение всё равно
                обязано попасть в этот диапазон, а опечатку вроде «20222»
                приходилось ловить проверкой уже после ввода.
                Поиск в списке оставлен: годов больше сотни, и мотать
                до 1998-го колесом дольше, чем набрать его. */}
            <ListPicker
              locale={locale}
              name="year"
              label={t('filter_year')}
              options={YEARS.map((y): PickerOption => ({ value: y, label: y }))}
              value={year}
              onChange={setYear}
            />
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

          <Button disabled={!canNext1} onClick={() => setStep(2)} fullWidth>
            {t('sell_next')}
          </Button>
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
                type="text"
                inputMode="numeric"
                value={price}
                onChange={(e) =>
                  setPrice(handleNumberInput(e.target.value, MAX_PRICE))
                }
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
                  type="text"
                  inputMode="numeric"
                  value={rentPrice}
                  onChange={(e) =>
                    setRentPrice(handleNumberInput(e.target.value, MAX_PRICE))
                  }
                  required
                  className={field}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-neutral-60">
                  {t('sell_deposit')}, €
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={deposit}
                  onChange={(e) =>
                    setDeposit(handleNumberInput(e.target.value, MAX_PRICE))
                  }
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
              type="text"
              inputMode="numeric"
              value={mileage}
              onChange={(e) =>
                setMileage(handleNumberInput(e.target.value, MAX_MILEAGE))
              }
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
              placeholder={t('car_description_hint')}
              className={fieldTextarea}
            />
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(1)}>
              {t('sell_back')}
            </Button>
            {/* flex-1: «Далее» занимает всё оставшееся место — главное
                действие шага должно быть заметно шире «Назад». */}
            <Button onClick={goToPhotos} className="flex-1">
              {t('sell_next')}
            </Button>
          </div>
        </div>
      )}

      {/* ---------- Шаг 3: фотографии ---------- */}
      {step === 3 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{t('sell_step_photos')}</h2>

          <PhotoPicker
            locale={locale}
            files={files}
            onChange={setFiles}
            maxPhotos={MAX_PHOTOS}
          />

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(2)}>
              {t('sell_back')}
            </Button>
            {/* Без единой фотографии дальше не пускаем: объявление без
                снимков в каталоге показывается серой заглушкой и почти
                не получает откликов. Проверка именно здесь, а не при
                отправке, — иначе продавец узнал бы о ней после ввода
                телефона и SMS-кода.

                В режиме правки это последний шаг: входить некуда,
                поэтому кнопка сразу сохраняет. */}
            {isEdit ? (
              <Button onClick={submit} disabled={busy} className="flex-1">
                {busy ? t('edit_saving') : t('edit_submit')}
              </Button>
            ) : (
              <Button onClick={goToContacts} className="flex-1">
                {t('sell_next')}
              </Button>
            )}
          </div>

          {/* Предупреждение о повторной модерации. Тон warning — тот же
              золотой, что у бейджа «На проверке» в кабинете: цвет
              предупреждения совпадает с цветом статуса, который
              наступит после сохранения. */}
          {isEdit && (
            <p className="rounded-control bg-warning/10 px-3 py-2 text-caption text-warning">
              {t('edit_moderation_warning')}
            </p>
          )}

          {/* Прогресс отправки новых фотографий. При правке загрузка
              начинается сразу по нажатию «Сохранить», и без индикатора
              кнопка выглядит зависшей. */}
          {isEdit && busy && files.some((item) => item.kind === 'file') && (
            <div>
              <div className="flex items-center justify-between text-caption text-neutral-60">
                <span>{t('sell_photos_uploading')}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-pill bg-surface-muted">
                <div
                  className="h-full rounded-pill bg-brand-green transition-[width] duration-normal ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
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

          {/* Телефон спрашиваем только у гостя: у вошедшего он уже
              привязан к аккаунту, и вводить его заново незачем. */}
          {signedIn === false && (
            <div>
              <label className="mb-1 block text-sm text-neutral-60">
                {t('sell_phone')}
              </label>
              {/* Маска «+381 6X XXX XXX(X)» — та же, что в приложении
                  (SerbianPhoneFormatter). Форматирование идёт по мере
                  набора, наружу уходит E.164. */}
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(formatSerbianPhone(e.target.value))}
                placeholder="+381 6X XXX XXX"
                className={field}
                disabled={codeSent}
              />
            </div>
          )}

          {/* Проверка сессии ещё идёт: не показываем ничего, иначе
              у вошедшего продавца на долю секунды мелькнёт блок
              «Отправить код», которого он не должен видеть вовсе. */}
          {signedIn === null ? null : signedIn ? (
            <>
              {/* Продавец уже вошёл — публикуем без SMS. Код нужен для
                  создания сессии, а она есть и живёт между визитами
                  (persistSession). Требовать SMS на каждое объявление
                  значило бы жечь суточную квоту в пять сообщений
                  и заставлять человека ждать на ровном месте. */}
              <Button onClick={submit} disabled={busy} fullWidth>
                {busy ? t('otp_verifying') : t('sell_submit')}
              </Button>

              {/* Прогресс отправки фотографий: у вошедшего публикация
                  начинается сразу с загрузки, и без индикатора кнопка
                  выглядит зависшей. */}
              {busy && files.length > 0 && (
                <div>
                  <div className="flex items-center justify-between text-caption text-neutral-60">
                    <span>{t('sell_photos_uploading')}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-pill bg-surface-muted">
                    <div
                      className="h-full rounded-pill bg-brand-green transition-[width] duration-normal ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : !codeSent ? (
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

              <Button
                onClick={() => sendCode()}
                // Кнопка неактивна без согласия: отправлять SMS раньше
                // принятия документов нельзя.
                disabled={busy || !phone.trim() || !agreed}
                variant="info"
                fullWidth
              >
                {busy ? t('otp_sending') : t('sell_send_code')}
              </Button>
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

              <Button
                onClick={submit}
                disabled={busy || !canSubmit}
                fullWidth
              >
                {busy
                  ? phoneVerified
                    ? t('sell_submit')
                    : t('otp_verifying')
                  : t('sell_submit')}
              </Button>

              {/* Прогресс отправки фотографий. Загрузка идёт ПОСЛЕ
                  подтверждения кода (нужна сессия для RLS), то есть
                  на этом шаге, а не на шаге выбора файлов. Без него
                  публикация 15 снимков выглядит как зависшая кнопка. */}
              {busy && phoneVerified && files.length > 0 && (
                <div>
                  <div className="flex items-center justify-between text-caption text-neutral-60">
                    <span>{t('sell_photos_uploading')}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-pill bg-surface-muted">
                    <div
                      className="h-full rounded-pill bg-brand-green transition-[width] duration-normal ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <Button variant="secondary" onClick={() => setStep(3)} fullWidth>
            {t('sell_back')}
          </Button>
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
    </Card>
  );
}
