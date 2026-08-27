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
//
// ПРОВЕРКИ И ПЕРЕЖАТИЕ — ТЕ ЖЕ, ЧТО В PhotoPicker. Раньше здесь не было
// ни одной: атрибут accept — подсказка файловому диалогу, а не защита,
// и в бакет спокойно уходил 20-мегабайтный PNG, чтобы показаться
// в кружке 32px. Теперь файл проходит через preparePhoto: тип и размер
// проверяются, EXIF применяется однократно, на выходе JPEG.
//
// Длинная сторона у аватара та же 1600px, что у фотографий объявления.
// Отдельная константа под 512 (как maxWidth в profile_screen.dart)
// не заводится намеренно: один конвейер на оба сценария проще, чем два
// почти одинаковых, а разницу в вес добирает next/image — он всё равно
// отдаёт кружок по sizes="96px".
//
// ------------------------------------------------------------
// ЛОГОТИП САЛОНА — ВТОРАЯ КАРТИНКА, А НЕ ЗАМЕНА АВАТАРУ
// ------------------------------------------------------------
// До этой правки logo_url заполнить с сайта было НЕЛЬЗЯ вовсе: поля
// не существовало, а saveProfile читал текущее значение из базы и
// возвращал его же в RPC, лишь бы не затереть (см. app/my/actions.ts).
// В проде это давало logo_url = NULL у единственного салона, из-за
// чего пустовал и логотип на витрине, и поле logo в JSON-LD AutoDealer.
//
// Загрузка идёт тем же путём, что аватар: прямо в бакет 'avatars', в
// папку uid (политика avatars_insert_own, 0038 — писать можно только
// к себе). Имя файла ПОСТОЯННОЕ и ОТЛИЧАЕТСЯ от аватарного —
// logo.jpg против avatar.jpg: клади мы их под одним именем, загрузка
// логотипа затирала бы фотографию человека, и наоборот.
//
// Поле показывается ТОЛЬКО дилеру. Причина не косметическая:
// update_seller_profile (0043) при seller_kind = 'private' затирает
// logo_url безусловно, поэтому у частника поле обещало бы сохранение,
// которого не произойдёт.
// ============================================================

import Image from 'next/image';
import { useRef, useState, useTransition } from 'react';

import { saveContactEmail, saveProfile } from '@/app/my/actions';
import {
  ACCEPT_ATTR,
  PhotoPrepareError,
  preparePhoto,
} from '@/lib/imagePrepare';
import Alert from './ui/Alert';
import Button from './ui/Button';
import Card from './ui/Card';
import { fieldClass } from './ui/Field';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { supabaseErrorText } from '@/lib/otp';
import { getBrowserClient } from '@/lib/supabaseClient';
import type { MyProfile } from '@/lib/types';

type Props = {
  locale: Locale;
  profile: MyProfile;
};

export default function ProfileForm({ locale, profile }: Props) {
  const t = getT(locale);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(profile.full_name ?? '');
  // Почта уведомлений. Вход на площадку идёт по SMS, поэтому у
  // большинства продавцов адрес пуст (profiles.email = NULL, миграция
  // 0035) — и решение модерации отправить некуда. Поле сделано
  // редактируемым именно ради этого канала.
  const [email, setEmail] = useState(profile.email ?? '');
  const [sellerKind, setSellerKind] = useState(profile.seller_kind);
  const [companyName, setCompanyName] = useState(profile.company_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [logoUrl, setLogoUrl] = useState(profile.logo_url);

  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Загрузка картинки профиля в бакет 'avatars'. Одна функция на
  // аватар и логотип: различаются они только именем файла и тем, куда
  // положить результат, — а весь остальной путь (пережатие, разбор
  // причины отказа, сессия, upsert, метка времени против кэша) у них
  // общий. Вторая копия этого кода разошлась бы с первой при первой
  // же правке конвейера подготовки.
  async function uploadImage(
    picked: File,
    fileName: 'avatar.jpg' | 'logo.jpg',
    apply: (url: string) => void,
  ) {
    setError(null);
    setUploading(true);

    try {
      // Пережатие ДО обращения к сети: незачем открывать сессию и
      // занимать канал, если файл всё равно будет отклонён.
      let file: File;
      try {
        file = await preparePhoto(picked);
      } catch (e) {
        // Причина отказа важна: «включите Наиболее совместимый» —
        // это инструкция, а «не удалось загрузить» — тупик.
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

      // Расширение всегда .jpg: preparePhoto перекодирует любой вход
      // в JPEG. Прежний вариант брал его из имени исходного файла,
      // и после смены png → jpg в бакете оставался осиротевший
      // avatar.png, который никто уже не показывал.
      const path = `${auth.user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (uploadError) throw new Error(supabaseErrorText(uploadError));

      const { data: pub } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      // Метка времени обходит кэш браузера: путь при замене картинки
      // не меняется, и без неё показывалась бы прежняя.
      apply(`${pub.publicUrl}?v=${Date.now()}`);
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
        logoUrl,
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
              {/* У аккаунта без номера (вход по почте) подсказка про
                  «номер для входа» была бы неверной: входят не им. */}
              {t(profile.phone ? 'profile_phone_hint' : 'profile_phone_none')}
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

              {/* ЛОГОТИП САЛОНА. Стоит здесь, а не в правой колонке
                  рядом с аватаром, намеренно: это поле витрины
                  компании, и оно принадлежит блоку салона вместе с
                  названием. В колонке аккаунта логотип читался бы как
                  вторая аватарка того же человека.
                  Квадратный, а не круглый: логотипы делают в прямо-
                  угольнике, и круглая маска срезала бы им углы. */}
              <div className="mt-3">
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
                        // unoptimized по той же причине, что у аватара:
                        // к адресу добавляется метка времени, и
                        // оптимизатор кэшировал бы каждую версию.
                        unoptimized
                      />
                    ) : (
                      // Заглушка — первая буква названия, как в
                      // DealerTile админки и в шапке витрины: пустой
                      // серый квадрат читается как незагрузившаяся
                      // картинка, а не как «логотипа пока нет».
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
                      if (file) void uploadImage(file, 'logo.jpg', setLogoUrl);
                      e.target.value = '';
                    }}
                  />

                  {/* ОДНА КНОПКА, ДВЕ ПОДПИСИ. Логотипа нет —
                      «Загрузить логотип», логотип есть — «Заменить
                      логотип». Действие одно и то же: открыть файловый
                      диалог и перезаписать logo.jpg, которого в бакете
                      всегда ровно один.

                      КНОПКИ «УБРАТЬ» ЗДЕСЬ НЕТ НАМЕРЕННО. Логотип
                      салона — не украшение, а то, по чему покупатель
                      узнаёт салон в каталоге и на витрине; сценария
                      «хочу остаться совсем без логотипа» у салона
                      нет, а нужную картинку меняет замена. Если
                      логотип всё же понадобится снять, это делает
                      переключение типа продавца на «Частное лицо»:
                      update_seller_profile (0043) затирает logo_url
                      сама. */}
                  <div className="flex min-w-0 flex-wrap gap-2">
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
                </div>

                <p className="mt-2 text-small text-neutral-50">
                  {t('profile_logo_hint')}
                </p>
              </div>

            </div>
          )}

          {/* ПЕРЕХОД НА ВИТРИНУ — КНОПКА, А НЕ ССЫЛКА, И СТОИТ ЗДЕСЬ.
              Раньше это была текстовая ссылка внутри блока полей
              салона — то есть в середине формы, между логотипом и
              кнопкой сохранения. Дилер, посмотревший «как меня видят
              покупатели», уходил со страницы, не нажав «Сохранить», и
              терял правки: ссылка была расположена так, будто она
              часть заполнения профиля.

              Теперь это пара кнопок в конце формы: сначала переход на
              витрину, под ним — сохранение. Оба действия одинаковой
              ширины и вида, так что читаются как завершение работы с
              экраном, а не как поле в её середине.

              Вариант info (синий), а не primary: зелёный на сайте
              занят главным действием, и здесь главное — «Сохранить».
              Синий отдан связи и вспомогательным переходам («Написать»,
              «Отправить код») — переход на витрину ровно из этого
              разряда. Правило бренда: один акцент на экране.

              Button с href рендерится настоящей ссылкой <Link>, а не
              кнопкой с onClick: витрину нужно уметь открыть в новой
              вкладке — именно так дилер и сравнивает её с формой, не
              теряя несохранённое.

              ВЕДЁТ В РЕДАКТОР ВИТРИНЫ (/my/showcase), а не сразу на
              публичную страницу. Там наверху стоит живое превью
              карточки салона и оттуда же есть переход на саму
              витрину — то есть маршрут ничего не потерял, зато
              продавец сначала попадает туда, где витрину можно
              изменить. Прежняя ссылка вела на готовую страницу, и
              как её править, экран не объяснял никак. */}
          {sellerKind === 'dealer' && (
            <Button
              href={localeHref(locale, '/my/showcase')}
              variant="info"
              fullWidth
            >
              {t('profile_showcase')} →
            </Button>
          )}

          <Button onClick={submit} disabled={pending || uploading} fullWidth>
            {pending ? t('profile_saving') : t('profile_save')}
          </Button>

          {saved && !error && (
            <Alert tone="success">
              {t('profile_saved')}
            </Alert>
          )}

          {error && (
            <Alert tone="error">
              {error}
            </Alert>
          )}
        </div>
      </Card>

      {/* Правая колонка — аватар. На десктопе стоит сбоку: это не
          редактируемое поле формы, а сведения об аккаунте, и мешать
          его с полями ввода незачем. На мобильном уходит вниз. */}
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
              accept={ACCEPT_ATTR}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadImage(file, 'avatar.jpg', setAvatarUrl);
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
      </div>
    </div>
  );
}
