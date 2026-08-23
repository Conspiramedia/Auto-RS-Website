'use client';

// ============================================================
// RS AUTO — Форма профиля. Client Component.
// ============================================================
// Состояние нужно всему: переключателю «частник / автосалон» (от него
// зависит поле названия), загрузке аватара и индикатору сохранения.
//
// АВАТАР загружается в бакет 'avatars' напрямую из браузера, а не через
// сервер: файл и так у пользователя, и гнать его через наш обработчик
// значило бы удвоить трафик без выигрыша. Путь ОБЯЗАН начинаться с uid —
// политика avatars_insert_own разрешает запись только в свою папку
// (миграция 0038).
//
// upsert: true и постоянное имя файла: аватар у пользователя один, и
// плодить в бакете старые копии при каждой замене незачем. Из-за этого
// адрес не меняется, и браузер показал бы кэшированную картинку —
// поэтому к ссылке добавляется метка времени.
// ============================================================

import Image from 'next/image';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';

import { saveContactEmail, saveProfile } from '@/app/my/actions';
import Button from './ui/Button';
import Card from './ui/Card';
import { fieldClass } from './ui/Field';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';
import type { MyProfile } from '@/lib/types';

type Props = {
  locale: Locale;
  profile: MyProfile;
  // Баланс кошелька. Только чтение: пополнение на сайте не подключено,
  // начисления делает администратор (миграция 0043).
  balance: number;
};

export default function ProfileForm({ locale, profile, balance }: Props) {
  const t = getT(locale);
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(profile.full_name ?? '');
  // Почта уведомлений. Вход на площадку идёт по SMS, поэтому у
  // большинства продавцов адрес пуст (profiles.email = NULL, миграция
  // 0035) — и решение модерации отправить некуда. Поле сделано
  // редактируемым именно ради этого канала.
  const [email, setEmail] = useState(profile.email ?? '');
  const [sellerKind, setSellerKind] = useState(profile.seller_kind);
  const [companyName, setCompanyName] = useState(profile.company_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);

  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function uploadAvatar(file: File) {
    setError(null);
    setUploading(true);

    try {
      const supabase = getBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('no session');

      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${auth.user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      const { data: pub } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      // Метка времени обходит кэш браузера: путь при замене аватара
      // не меняется, и без неё показывалась бы прежняя картинка.
      setAvatarUrl(`${pub.publicUrl}?v=${Date.now()}`);
      setSaved(false);
    } catch {
      setError(t('profile_avatar_error'));
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    // Дилер без названия салона: сервер такую запись отклонит
    // (update_seller_profile), но сказать об этом сразу честнее, чем
    // после обращения к базе.
    if (sellerKind === 'dealer' && companyName.trim() === '') {
      setError(t('profile_company_required'));
      return;
    }

    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await saveProfile({
        fullName,
        sellerKind,
        companyName,
        avatarUrl,
      });

      if (!result.ok) {
        setError(t('profile_error'));
        return;
      }

      // Почта сохраняется ВТОРЫМ вызовом и только если её изменили.
      // Отдельно — потому что правила другие: адрес обязан быть
      // уникальным среди заполненных и проходить проверку формата
      // (RPC set_my_contact_email, миграция 0071). Складывать их в
      // saveProfile значило бы либо потерять внятные коды ошибок, либо
      // тащить проверку уникальности в общий UPDATE профиля.
      //
      // Условие «изменили» важно: без него сохранение профиля с той же
      // почтой упиралось бы в собственную запись при проверке
      // занятости на каждом нажатии.
      if (email.trim() !== (profile.email ?? '')) {
        const emailResult = await saveContactEmail({
          email,
          locale,
        });

        if (!emailResult.ok) {
          setError(
            emailResult.code === 'taken'
              ? t('profile_email_taken')
              : emailResult.code === 'invalid'
                ? t('profile_email_invalid')
                : t('profile_error'),
          );
          return;
        }
      }

      setSaved(true);
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
      {/* Левая колонка — редактируемые поля. */}
      <Card>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('profile_name')}
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                setSaved(false);
              }}
              placeholder={t('profile_name_ph')}
              className={fieldClass}
            />
          </div>

          {/* Телефон и почта — только чтение. Телефон служит логином,
              его смена означала бы смену способа входа; почта приходит
              из auth.users и на сайте не редактируется. */}
          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('profile_phone')}
            </label>
            <input
              type="text"
              value={profile.phone ?? '—'}
              readOnly
              disabled
              className={`${fieldClass} bg-surface-muted text-neutral-60`}
            />
            <p className="mt-1 text-small text-neutral-50">
              {t('profile_phone_hint')}
            </p>
          </div>

          {/* Почта — РЕДАКТИРУЕМОЕ поле, в отличие от телефона выше.
              Телефон служит логином и меняться не может; почта же
              нигде для входа не используется, зато без неё продавцу
              некуда отправить решение модерации: при входе по SMS
              адрес пуст. Пустое значение допустимо и означает «письма
              не нужны» — уведомления в этом случае остаются только в
              кабинете. */}
          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('profile_email')}
            </label>
            <input
              // type="email" даёт мобильной клавиатуре раскладку с @,
              // но проверку формата на него НЕ перекладываем: браузер
              // валидирует поле только внутри <form> с submit, а здесь
              // отправка идёт по кнопке. Настоящая проверка — в RPC.
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSaved(false);
              }}
              placeholder="you@example.com"
              className={fieldClass}
            />
            <p className="mt-1 text-small text-neutral-50">
              {t('profile_email_hint')}
            </p>
          </div>

          {/* Тип продавца — сегмент из двух кнопок, тот же паттерн, что
              «Продажа | Аренда» в форме подачи. */}
          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('profile_seller_kind')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['private', t('profile_private')],
                  ['dealer', t('profile_dealer')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSellerKind(value);
                    setSaved(false);
                  }}
                  className={[
                    'h-11 rounded-control border text-caption font-semibold transition-colors duration-fast ease-out',
                    sellerKind === value
                      ? 'border-brand-dark bg-brand-dark text-white'
                      : 'border-neutral-15 bg-white hover:bg-surface-hover',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Название салона — только у дилера. У частника поле не
              показывается вовсе: сервер всё равно затрёт его при
              сохранении с seller_kind = 'private'. */}
          {sellerKind === 'dealer' && (
            <div>
              <label className="mb-1 block text-caption text-neutral-60">
                {t('profile_company')} *
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  setSaved(false);
                }}
                className={fieldClass}
              />

              {/* Ссылка на публичную витрину: дилеру важно видеть, как
                  его страницу видят покупатели. */}
              <Link
                href={localeHref(locale, `/dealer/${profile.id}`)}
                className="mt-2 inline-block text-caption font-semibold text-brand-blue hover:underline"
              >
                {t('profile_showcase')} →
              </Link>
            </div>
          )}

          <Button onClick={submit} disabled={pending || uploading} fullWidth>
            {pending ? t('profile_saving') : t('profile_save')}
          </Button>

          {saved && !error && (
            <p className="rounded-control bg-brand-green/10 px-3 py-2 text-caption text-brand-green">
              {t('profile_saved')}
            </p>
          )}

          {error && (
            <p className="rounded-control bg-brand-red/10 px-3 py-2 text-caption text-brand-red">
              {error}
            </p>
          )}
        </div>
      </Card>

      {/* Правая колонка — аватар и баланс. На десктопе стоит сбоку:
          это не редактируемые поля формы, а сведения об аккаунте, и
          мешать их с полями ввода незачем. На мобильном уходит вниз. */}
      <div className="space-y-4">
        <Card>
          <div className="flex flex-col items-center text-center">
            <span className="relative h-24 w-24 overflow-hidden rounded-pill bg-surface-muted">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt=""
                  fill
                  sizes="96px"
                  className="object-cover"
                  // unoptimized: к адресу добавляется метка времени,
                  // и оптимизатор Next кэшировал бы каждую версию
                  // отдельно, раздувая кэш ради одной картинки.
                  unoptimized
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-h2 font-semibold text-neutral-50">
                  {(fullName.trim()[0] ?? '?').toUpperCase()}
                </span>
              )}
            </span>

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadAvatar(file);
                // Сброс значения: повторный выбор того же файла иначе
                // не вызовет onChange.
                e.target.value = '';
              }}
            />

            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? t('profile_saving') : t('profile_avatar_change')}
            </Button>
          </div>
        </Card>

        {/* Баланс. Только чтение: пополнение на сайте не подключено,
            начисления делает администратор. */}
        <Card>
          <div className="text-caption text-neutral-60">
            {t('profile_balance')}
          </div>
          <div className="mt-1 text-h3 font-bold">
            {new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'sr-Latn-RS', {
              style: 'currency',
              currency: 'EUR',
              maximumFractionDigits: 2,
            }).format(balance)}
          </div>
        </Card>
      </div>
    </div>
  );
}
