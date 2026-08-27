'use client';

// ============================================================
// RS AUTO — Редактор витрины салона. Client Component.
// ============================================================
// Экран /my/showcase: сверху ЖИВОЕ ПРЕВЬЮ широкой карточки салона,
// под ним поля, дальше кнопка сохранения. Список объявлений салона
// добавляет серверная страница ниже формы.
//
// ------------------------------------------------------------
// ПОЧЕМУ ПРЕВЬЮ ЧИТАЕТ ИЗ СОСТОЯНИЯ ФОРМЫ, А НЕ ИЗ БАЗЫ
// ------------------------------------------------------------
// Смысл экрана — показать результат ДО сохранения. Поэтому источник
// истины для превью один: React-state полей. Каждое нажатие клавиши
// перерисовывает карточку, и продавец видит, как обрежется описание
// и что останется пустым, ещё не нажав «Сохранить».
//
// Из этого следует важное требование к самой карточке
// (DealerShowcaseCard): она обязана быть чистым компонентом на props.
// Обращайся она к supabase сама — предпросмотр показывал бы
// СОХРАНЁННЫЕ данные, то есть ровно не то, ради чего он нужен.
//
// ------------------------------------------------------------
// ПРЕВЬЮ СТОИТ В НАСТОЯЩЕЙ СЕТКЕ КАТАЛОГА
// ------------------------------------------------------------
// Обёртка повторяет grid-cols-2 md:grid-cols-3 xl:grid-cols-4 —
// ту же, что в каталоге и на главной. Иначе карточка с col-span-2
// разъехалась бы: вне сетки эта ширина ничего не значит, и продавец
// увидел бы не то, что увидит покупатель.
//
// ------------------------------------------------------------
// ЛОГОТИП
// ------------------------------------------------------------
// Загрузка повторяет конвейер формы профиля: файл готовится
// preparePhoto (проверка типа и размера, EXIF, перекодирование в
// JPEG), затем кладётся в бакет 'avatars' под именем logo.jpg в
// папку uid — политика avatars_insert_own (0038) разрешает запись
// только к себе. Имя постоянное, поэтому к адресу добавляется метка
// времени: без неё браузер показал бы прежнюю картинку.
//
// Кнопки «Убрать» нет по той же причине, что в профиле: логотип —
// то, по чему покупатель узнаёт салон, и сценария «остаться совсем
// без логотипа» у компании нет.
// ============================================================

import Image from 'next/image';
import { useRef, useState, useTransition } from 'react';

import { saveShowcase } from '@/app/my/actions';
import DealerShowcaseCard from '@/components/DealerShowcaseCard';
import {
  ACCEPT_ATTR,
  PhotoPrepareError,
  preparePhoto,
} from '@/lib/imagePrepare';
import Alert from './ui/Alert';
import Button from './ui/Button';
import Card from './ui/Card';
import { fieldClass, fieldClassTextarea } from './ui/Field';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { supabaseErrorText } from '@/lib/otp';
import { getBrowserClient } from '@/lib/supabaseClient';
import type { MyProfile } from '@/lib/types';

// Границы длины — ТЕ ЖЕ, что в базе (CHECK и проверки внутри
// update_seller_profile, миграция 0095). Дублирование здесь осознанное:
// сервер остаётся источником истины и отклонит длинный текст в любом
// случае, а клиент показывает границу СРАЗУ — счётчиком под полем и
// атрибутом maxLength, вместо отказа после обращения к базе.
const MAX_DESCRIPTION = 1000;
const MAX_PHONE = 40;
const MAX_WEBSITE = 200;
const MAX_HOURS = 200;

type Props = {
  locale: Locale;
  profile: MyProfile;
  // Фотографии машин салона для миниатюр в превью. Приходят с сервера
  // готовыми адресами: превью обязано показывать НАСТОЯЩИЕ машины
  // продавца — на выдуманных заглушках он не увидит, как плитка
  // выглядит в реальности.
  previewPhotos: string[];
  // Число активных объявлений — крупная цифра карточки. Считается на
  // сервере тем же способом, что и в публичной выдаче.
  activeCars: number;
};

export default function ShowcaseForm({
  locale,
  profile,
  previewPhotos,
  activeCars,
}: Props) {
  const t = getT(locale);
  const logoRef = useRef<HTMLInputElement>(null);

  const [companyName, setCompanyName] = useState(profile.company_name ?? '');
  const [description, setDescription] = useState(profile.description ?? '');
  const [dealerPhone, setDealerPhone] = useState(profile.dealer_phone ?? '');
  const [website, setWebsite] = useState(profile.website ?? '');
  const [openingHours, setOpeningHours] = useState(profile.opening_hours ?? '');
  const [logoUrl, setLogoUrl] = useState(profile.logo_url);

  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Любая правка снимает отметку «сохранено»: иначе зелёная плашка
  // висела бы над уже изменённой формой и означала неправду.
  function edit<T>(apply: (value: T) => void) {
    return (value: T) => {
      apply(value);
      setSaved(false);
    };
  }

  async function uploadLogo(picked: File) {
    setError(null);
    setUploading(true);

    try {
      let file: File;
      try {
        file = await preparePhoto(picked);
      } catch (e) {
        // Причина отказа важна: «включите Наиболее совместимый» — это
        // инструкция, а «не удалось загрузить» — тупик.
        setError(
          e instanceof PhotoPrepareError && e.reason === 'heic'
            ? t('sell_err_photo_heic')
            : e instanceof PhotoPrepareError && e.reason === 'size'
              ? t('sell_err_photo_size')
              : e instanceof PhotoPrepareError && e.reason === 'type'
                ? t('sell_err_photo_type')
                : t('profile_avatar_error'),
        );
        return;
      }

      const supabase = getBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('no session');

      const path = `${auth.user.id}/logo.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (uploadError) throw new Error(supabaseErrorText(uploadError));

      const { data: pub } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      setLogoUrl(`${pub.publicUrl}?v=${Date.now()}`);
      setSaved(false);
    } catch {
      setError(t('profile_avatar_error'));
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    // Проверки повторяют серверные, чтобы сказать о проблеме сразу.
    // Сервер всё равно проверит сам — это не замена, а ускорение.
    if (companyName.trim() === '') {
      setError(t('profile_company_required'));
      return;
    }
    if (description.length > MAX_DESCRIPTION) {
      setError(t('showcase_err_description'));
      return;
    }
    if (dealerPhone.length > MAX_PHONE) {
      setError(t('showcase_err_phone'));
      return;
    }
    if (website.length > MAX_WEBSITE) {
      setError(t('showcase_err_website'));
      return;
    }
    if (openingHours.length > MAX_HOURS) {
      setError(t('showcase_err_hours'));
      return;
    }

    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await saveShowcase({
        companyName,
        logoUrl,
        description,
        dealerPhone,
        website,
        openingHours,
      });

      if (!result.ok) {
        setError(t('profile_error'));
        return;
      }

      setSaved(true);
    });
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------
          ЖИВОЕ ПРЕВЬЮ
          ------------------------------------------------------------
          Стоит первым и вне карточки-формы: это не поле, а результат.
          Сетка — настоящая каталожная, см. шапку файла. */}
      <section>
        <h2 className="mb-2 text-caption font-semibold text-neutral-60">
          {t('showcase_preview_label')}
        </h2>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          <DealerShowcaseCard
            locale={locale}
            preview
            dealer={{
              id: profile.id,
              name: companyName,
              city: profile.company_city,
              description,
              logoUrl,
              activeCars,
              previewPhotos,
            }}
          />
        </div>

        <p className="mt-2 text-small text-neutral-50">{t('showcase_intro')}</p>
      </section>

      {/* ------------------------------------------------------------
          ПОЛЯ
          ------------------------------------------------------------ */}
      <Card>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('profile_company')} *
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => edit(setCompanyName)(e.target.value)}
              className={fieldClass}
            />
          </div>

          {/* ОПИСАНИЕ — textarea, а не input: это две-три фразы, и
              однострочное поле пришлось бы прокручивать, чтобы
              перечитать написанное.
              Счётчик показывается ТОЛЬКО на подходе к границе
              (последние 100 символов): постоянный «0 / 1000» под
              каждым полем — шум, который читается как требование
              заполнить поле целиком. */}
          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('showcase_description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => edit(setDescription)(e.target.value)}
              rows={3}
              maxLength={MAX_DESCRIPTION}
              placeholder={t('showcase_ph_desc')}
              className={fieldClassTextarea}
            />
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-small text-neutral-50">
                {t('showcase_description_hint')}
              </p>
              {description.length > MAX_DESCRIPTION - 100 && (
                <span className="text-small text-neutral-50">
                  {description.length} / {MAX_DESCRIPTION}
                </span>
              )}
            </div>
          </div>

          {/* ГОРОД — ТОЛЬКО ЧТЕНИЕ. Его ставит администратор при
              заключении договора (миграция 0085), и
              update_seller_profile его не трогает вовсе. Показываем
              всё равно: город виден в плитке салона, и без строки в
              форме продавец не понял бы, откуда он взялся и к кому
              идти, если город изменился. */}
          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('showcase_city')}
            </label>
            <input
              type="text"
              value={profile.company_city ?? t('showcase_city_empty')}
              readOnly
              disabled
              className={`${fieldClass} bg-surface-muted text-neutral-60`}
            />
            <p className="mt-1 text-small text-neutral-50">
              {t('showcase_city_hint')}
            </p>
          </div>

          {/* ЛОГОТИП. Квадратный, а не круглый: логотипы делают в
              прямоугольнике, и круглая маска срезала бы им углы. */}
          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('profile_logo')}
            </label>

            <div className="flex items-center gap-3">
              <span className="relative size-16 shrink-0 overflow-hidden rounded-card border border-neutral-10 bg-surface-muted">
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                    // unoptimized: к адресу добавлена метка времени,
                    // и оптимизатор кэшировал бы каждую версию.
                    unoptimized
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-h3 font-bold text-neutral-30">
                    {(companyName.trim()[0] ?? 'A').toUpperCase()}
                  </span>
                )}
              </span>

              <input
                ref={logoRef}
                type="file"
                accept={ACCEPT_ATTR}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadLogo(file);
                  // Сброс значения: повторный выбор того же файла
                  // иначе не вызовет onChange.
                  e.target.value = '';
                }}
              />

              <Button
                variant="secondary"
                size="sm"
                disabled={uploading}
                onClick={() => logoRef.current?.click()}
              >
                {uploading
                  ? t('profile_saving')
                  : logoUrl
                    ? t('profile_logo_replace')
                    : t('profile_logo_change')}
              </Button>
            </div>

            <p className="mt-2 text-small text-neutral-50">
              {t('profile_logo_hint')}
            </p>
          </div>

          {/* ТЕЛЕФОН САЛОНА. Не путать с номером входа: тот показан в
              профиле только для чтения и служит логином. Здесь —
              публичный номер компании, который увидит покупатель. */}
          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('showcase_phone')}
            </label>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={dealerPhone}
              onChange={(e) => edit(setDealerPhone)(e.target.value)}
              maxLength={MAX_PHONE}
              placeholder="+381 11 123 456"
              className={fieldClass}
            />
            <p className="mt-1 text-small text-neutral-50">
              {t('showcase_phone_hint')}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('showcase_website')}
            </label>
            <input
              // type="url" даёт мобильной клавиатуре раскладку с «/»,
              // но проверку формата на браузер не перекладываем: он
              // валидирует поле только внутри <form> с submit, а
              // отправка здесь идёт по кнопке.
              type="url"
              inputMode="url"
              value={website}
              onChange={(e) => edit(setWebsite)(e.target.value)}
              maxLength={MAX_WEBSITE}
              placeholder="https://"
              className={fieldClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('showcase_hours')}
            </label>
            <input
              type="text"
              value={openingHours}
              onChange={(e) => edit(setOpeningHours)(e.target.value)}
              maxLength={MAX_HOURS}
              placeholder={t('showcase_hours_ph')}
              className={fieldClass}
            />
          </div>

          {/* Переход на публичную витрину — синяя кнопка НАД зелёным
              сохранением, тем же порядком, что в форме профиля:
              зелёный на сайте занят главным действием экрана, а
              главное здесь — сохранить. Настоящая ссылка (Button с
              href), чтобы витрину можно было открыть в новой вкладке
              и сравнить, не потеряв несохранённое. */}
          <Button
            href={localeHref(locale, `/dealer/${profile.id}`)}
            variant="info"
            fullWidth
          >
            {t('profile_showcase')} →
          </Button>

          <Button onClick={submit} disabled={pending || uploading} fullWidth>
            {pending ? t('profile_saving') : t('profile_save')}
          </Button>

          {saved && !error && <Alert tone="success">{t('profile_saved')}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Card>
    </div>
  );
}
