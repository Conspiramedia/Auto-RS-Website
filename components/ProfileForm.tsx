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

import { saveProfile } from '@/app/my/actions';
import {
  ACCEPT_ATTR,
  COVER_ASPECT,
  PhotoPrepareError,
  preparePhoto,
} from '@/lib/imagePrepare';
import DealerApplicationBlock from './DealerApplicationBlock';
import DeleteAccountBlock, {
  type DeleteConfirmKind,
} from './DeleteAccountBlock';
import ListPicker, { type PickerOption } from './ListPicker';
import Alert from './ui/Alert';
import Button from './ui/Button';
import Card from './ui/Card';
import { fieldClass } from './ui/Field';
import {
  SERBIAN_PHONE_PREFIX,
  buildOpeningHours,
  formatSerbianPhone,
  formatTime,
  isValidTime,
  parseOpeningHours,
  serbianContactPhoneToE164,
} from '@/lib/inputFormat';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { supabaseErrorText } from '@/lib/otp';
import { CITIES } from '@/lib/referenceData';
import { getBrowserClient } from '@/lib/supabaseClient';
import { usePhoneCaret } from '@/lib/usePhoneCaret';
import type { DealerApplication, MyProfile } from '@/lib/types';

// Границы длины полей витрины. Совпадают с CHECK на таблице profiles
// и проверками внутри update_seller_profile (миграция 0095): нарушение
// сервер отклонит в любом случае, а эти числа нужны, чтобы сказать об
// этом сразу — атрибутом maxLength и счётчиком под полем описания.
// Слоган (0098). 90 символов — не круглое число «на глаз», а
// вместимость строки под названием салона в плитке каталога: на самом
// узком экране (360px) туда помещаются две строки по ~44 символа.
// Совпадает с chk_profiles_tagline_len.
const MAX_TAGLINE = 90;
const MAX_PHONE = 40;
const MAX_HOURS = 200;

type Props = {
  locale: Locale;
  profile: MyProfile;
  // Последняя заявка на статус автосалона или null (миграция 0100).
  // Читается на сервере вместе с профилем и передаётся готовой: блок
  // заявки не должен начинать жизнь с «загружаем», а потом менять
  // состояние под руками у того, кто уже начал заполнять форму.
  application: DealerApplication | null;
  // Чем подтверждается удаление аккаунта (миграция 0128). Приходит с
  // сервера: почта есть не у всех, и решать это на клиенте нельзя —
  // см. шапку DeleteAccountBlock.
  deleteConfirmKind: DeleteConfirmKind;
};

export default function ProfileForm({
  locale,
  profile,
  application,
  deleteConfirmKind,
}: Props) {
  const t = getT(locale);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  // Каретка в полях телефона — только в конец номера. Два отдельных
  // экземпляра, по одному на поле: хук помнит запланированный кадр, и
  // общий на два поля отменял бы установку каретки во втором, если
  // человек перескочил из одного в другое быстрее кадра.
  const phoneCaret = usePhoneCaret();
  const dealerPhoneCaret = usePhoneCaret();

  const [fullName, setFullName] = useState(profile.full_name ?? '');
  // КОНТАКТНЫЙ ТЕЛЕФОН ВЛАДЕЛЬЦА. Поле стало редактируемым: пока
  // входом был SMS-код, номер служил логином и меняться не мог, но
  // после перехода на почтовый вход (0106) он — обычный контакт,
  // который показывается покупателю в объявлении. У аккаунта,
  // заведённого по почте, поле пустое, и заполнить его было негде:
  // единственным способом завести номер оставалась подача объявления.
  //
  // Маска та же, что в подаче и у телефона салона ниже: номер
  // приводится к «+381 6X XXX XXX» прямо во время набора.
  const [phone, setPhone] = useState(
    profile.phone ? formatSerbianPhone(profile.phone) : '',
  );
  // Почта уведомлений. Вход на площадку идёт по SMS, поэтому у
  // большинства продавцов адрес пуст (profiles.email = NULL, миграция
  // 0035) — и решение модерации отправить некуда. Поле сделано
  // редактируемым именно ради этого канала.
  const [sellerKind, setSellerKind] = useState(profile.seller_kind);
  const [companyName, setCompanyName] = useState(profile.company_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  // Поля витрины салона (миграция 0095). Наполняют плитку салона в
  // каталоге: описание и контакты стоят в её левом блоке, остальное —
  // в нижней строке. Показываются только дилеру.
  // ОПИСАНИЕ БОЛЬШЕ НЕ РЕДАКТИРУЕТСЯ. Поле убрано из формы: в плитке
  // каталога его место заняла обложка со слоганом, а на публичной
  // странице салона описание никогда и не выводилось — салон писал бы
  // текст, которого никто не увидит.
  //
  // Но ЗНАЧЕНИЕ ПРОДОЛЖАЕТ ПЕРЕДАВАТЬСЯ при сохранении, и это
  // обязательно: update_seller_profile перезаписывает профиль целиком
  // и затирает в NULL всё, что не пришло. Убери мы его из вызова —
  // первое же сохранение имени стёрло бы салонам описания, которые они
  // писали при прежней вёрстке. Данные лежат нетронутыми и ждут
  // решения, что с ними делать дальше.
  const description = profile.description ?? '';
  // ТЕЛЕФОН САЛОНА В ТОЙ ЖЕ МАСКЕ, ЧТО В ПОДАЧЕ ОБЪЯВЛЕНИЯ.
  // Прежде это было свободное поле, и салоны писали «011/123-456»,
  // «+381111234567», «011 123 456» — в плитках каталога такие номера
  // стоят рядом, и разнобой читался как небрежность площадки.
  // formatSerbianPhone держит единый вид «+381 11 123 456»,
  // SERBIAN_PHONE_PREFIX подставляет код страны сразу, чтобы его не
  // набирали вручную девять раз из десяти.
  const [dealerPhone, setDealerPhone] = useState(
    profile.dealer_phone ? formatSerbianPhone(profile.dealer_phone) : '',
  );
  // ЧАСЫ РАБОТЫ ВВОДЯТСЯ ДВУМЯ ПОЛЯМИ, а в базу уходят одной строкой
  // «Работаем с 9:00 до 19:00». Слова подставляются сами: пока это
  // была свободная строка, салоны писали «пн-пт 9-18», «09:00-20:00
  // без выходных», «звоните с утра» — и каталог выглядел лоскутным.
  //
  // Сохранённое значение разбирается обратно в пару полей: салон,
  // открывший форму, обязан видеть свои часы, а не пустоту.
  const [hoursFrom, setHoursFrom] = useState(
    () => parseOpeningHours(profile.opening_hours).from,
  );
  const [hoursTo, setHoursTo] = useState(
    () => parseOpeningHours(profile.opening_hours).to,
  );
  // Обложка и слоган витрины (миграция 0098). Обложка занимает верхнюю
  // половину плитки каталога, слоган стоит под названием салона.
  // ЛОГОТИП И САЙТ БОЛЬШЕ НЕ РЕДАКТИРУЮТСЯ. Оба поля убраны с сайта
  // целиком: логотип — из плитки каталога, шапки витрины и блока
  // продавца на карточке объявления, сайт — из плитки и витрины.
  // Показывать их негде, значит и просить салон заполнять незачем.
  //
  // Но ЗНАЧЕНИЯ ПРОДОЛЖАЮТ ПЕРЕДАВАТЬСЯ при сохранении, и это
  // обязательно: update_seller_profile перезаписывает профиль целиком
  // и затирает в NULL всё, что не пришло. Убери мы их из вызова —
  // первое же сохранение имени стёрло бы салонам логотипы и адреса,
  // загруженные при прежней вёрстке. Данные лежат нетронутыми.
  const logoUrl = profile.logo_url;
  const website = profile.website ?? '';
  const [coverUrl, setCoverUrl] = useState(profile.cover_url);
  const [tagline, setTagline] = useState(profile.tagline ?? '');
  // Город салона. РЕДАКТИРУЕТСЯ ВЛАДЕЛЬЦЕМ с миграции 0097: раньше его
  // проставлял только администратор при заключении договора (0085), и
  // поле стояло в форме серым. Пока город был внутренним, это годилось,
  // но теперь он показывается покупателю — в плитке салона и в шапке
  // публичной страницы, — и салон должен уметь заполнить его сам.
  const [companyCity, setCompanyCity] = useState(profile.company_city ?? '');

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
  // aspect — пропорция кадрирования. Передаётся только для обложки
  // (COVER_ASPECT): аватар и логотип сохраняют пропорции исходника,
  // их обрезает уже разметка — круглый аватар и object-contain у
  // логотипа. Обложке же обрезка нужна ДО сохранения, иначе салон
  // увидел бы в каталоге не тот кадр, который загружал.
  async function uploadImage(
    picked: File,
    fileName: 'avatar.jpg' | 'logo.jpg' | 'cover.jpg',
    apply: (url: string) => void,
    aspect?: number,
  ) {
    setError(null);
    setUploading(true);

    try {
      // Пережатие ДО обращения к сети: незачем открывать сессию и
      // занимать канал, если файл всё равно будет отклонён.
      let file: File;
      try {
        file = await preparePhoto(picked, aspect);
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

  // ------------------------------------------------------------
  // СОХРАНЕНИЕ С ЯВНЫМ ТИПОМ ПРОДАВЦА.
  // ------------------------------------------------------------
  // Тип принимается ПАРАМЕТРОМ, а не читается из состояния, ради
  // одного случая — отказа от статуса салона. Там setSellerKind
  // и сохранение идут подряд, а состояние React обновляется только
  // к следующему рендеру: прочитай функция sellerKind сама, она
  // отправила бы на сервер прежнее 'dealer' и отказ не сработал бы.
  //
  // Кнопка «Сохранить» зовёт submit() без аргумента — тогда берётся
  // текущее состояние, как и раньше.
  function submitWith(kind: string = sellerKind) {
    // Дилер без названия салона: сервер такую запись отклонит
    // (update_seller_profile), но сказать об этом сразу честнее, чем
    // после обращения к базе.
    if (kind === 'dealer' && companyName.trim() === '') {
      setError(t('profile_company_required'));
      return;
    }

    // Границы длины — ТЕ ЖЕ, что в базе (CHECK на profiles и проверки
    // внутри update_seller_profile, миграция 0095). Дублирование
    // осознанное: сервер остаётся источником истины и отклонит текст
    // в любом случае, а клиент говорит о проблеме сразу, не гоняя
    // запрос впустую.
    if (kind === 'dealer') {
      if (tagline.length > MAX_TAGLINE) {
        setError(t('showcase_err_tagline'));
        return;
      }
      if (dealerPhone.length > MAX_PHONE) {
        setError(t('showcase_err_phone'));
        return;
      }
      if (!isValidTime(hoursFrom) || !isValidTime(hoursTo)) {
        setError(t('showcase_err_hours_time'));
        return;
      }
    }

    // ТЕЛЕФОН ПРОВЕРЯЕТСЯ ПО ГРАНИЦЕ БАЗЫ, А НЕ ПО ГРАНИЦЕ ВХОДА.
    // serbianContactPhoneToE164 повторяет ограничение
    // cars_contact_phone_serbian: 8–9 цифр национальной части, первая
    // — 1, 2, 3 или 6. Городские номера проходят намеренно: соседняя
    // serbianPhoneToE164 режет их, потому что служит ВХОДУ (SMS-код на
    // номер офиса не придёт), а здесь SMS нет — по этому номеру
    // покупатель звонит, и у салона это чаще 011 или 021. Проверка
    // входа отказывала бы в номере, который база принимает.
    //
    // Сервер формат не проверяет намеренно (set_profile_phone, 0106),
    // так что без проверки здесь в профиль ушёл бы обрезанный номер —
    // и он же подставился бы в объявление, где ограничение отклонит
    // его уже невнятной ошибкой из PostgREST.
    //
    // Пустое поле допустимо: номер не обязателен, его спросят при
    // первой подаче. Пустым считается и поле с одним кодом страны —
    // человек открыл поле и передумал.
    //
    // В БАЗУ УХОДИТ E.164 БЕЗ ПРОБЕЛОВ («+381612345678»), а не то, что
    // видно в поле: подача объявления пишет в ту же колонку такой же
    // вид, и разнобой означал бы, что номер одного продавца лежит в
    // базе по-разному. Обратно в маску его превращает
    // formatSerbianPhone при чтении.
    const typed =
      phone.trim() === SERBIAN_PHONE_PREFIX.trim() ? '' : phone.trim();

    const phoneClean =
      typed === '' ? '' : (serbianContactPhoneToE164(typed) ?? '');

    if (typed !== '' && phoneClean === '') {
      setError(t('profile_phone_invalid'));
      return;
    }

    setError(null);
    setSaved(false);

    // Строка для базы собирается ЗДЕСЬ, а не в состоянии: она зависит
    // от локали, а та может смениться без перезагрузки формы.
    const openingHours = buildOpeningHours(hoursFrom, hoursTo, {
      from: t('showcase_hours_from'),
      to: t('showcase_hours_to'),
    });

    startTransition(async () => {
      const result = await saveProfile({
        fullName,
        phone: phoneClean,
        sellerKind: kind,
        companyName,
        avatarUrl,
        logoUrl,
        website,
        // Передаются ВСЕГДА, даже пустыми: update_seller_profile
        // перезаписывает профиль целиком, и непереданное поле она
        // затрёт в NULL (см. комментарий в saveProfile).
        description,
        dealerPhone,
        openingHours,
        companyCity,
        coverUrl,
        tagline,
      });

      if (!result.ok) {
        setError(t('profile_error'));
        return;
      }

      // ПОЧТА ЗДЕСЬ БОЛЬШЕ НЕ СОХРАНЯЕТСЯ.
      // Поле стало read-only (0106, см. разметку ниже): адрес служит
      // входом на сайт, и бесконтрольная смена была бы способом угона
      // аккаунта. RPC set_my_contact_email при этом ЖИВА и вызывается
      // из lib/profile — она понадобится, когда появится смена почты
      // с подтверждением нового адреса.

      setSaved(true);
    });
  }

  return (
    // ------------------------------------------------------------
    // ШИРИНА ФОРМЫ ЗАВИСИТ ОТ ТИПА ПРОДАВЦА.
    // ------------------------------------------------------------
    // У частного лица справа стоит карточка аватара, и две колонки
    // разбирают ширину контейнера между собой.
    //
    // У салона аватара нет, и без ограничения форма растягивалась на
    // все 1120px: поля ввода превращались в полосы через весь экран,
    // где короткое «RS Auto» терялось в пустоте. max-w-3xl (768px) —
    // ширина, на которой поле ещё читается как поле, а не как линейка.
    <div
      className={`grid gap-4 lg:items-start ${
        sellerKind === 'dealer' ? 'max-w-3xl' : 'lg:grid-cols-[1fr_320px]'
      }`}
    >
      {/* Левая колонка — редактируемые поля. */}
      <Card>
        <div className="space-y-3">
          {/* ИМЯ И ТЕЛЕФОН — ОДНА СТРОКА С ПЛАНШЕТА. Оба поля
              короткие: имя это одно-два слова, телефон фиксированной
              длины. По отдельной строке на каждое растягивало форму
              вниз пустотой.

              items-start: у телефона под полем есть подсказка, у
              имени нет, и без выравнивания по верху сами поля
              разъехались бы по вертикали. */}
          <div className="grid items-start gap-3 sm:grid-cols-2">
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

            {/* ТЕЛЕФОН РЕДАКТИРУЕТСЯ. Раньше поле стояло серым, а
                подпись объясняла, что номер служит логином и не
                меняется. С почтовым входом (0106) это перестало быть
                правдой: логин — адрес почты, а телефон стал контактом
                для покупателя, и владельцу нужно уметь его вписать,
                исправить и убрать. Почта рядом остаётся только для
                чтения — вот она вход и есть. */}
            <div>
              <label className="mb-1 block text-caption text-neutral-60">
                {t('profile_phone')}
              </label>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(formatSerbianPhone(e.target.value));
                  setSaved(false);
                }}
                onClick={phoneCaret.onClick}
                onTouchEnd={phoneCaret.onTouchEnd}
                onFocus={(e) => {
                  // Код страны появляется при первом касании пустого
                  // поля — как в подаче объявления: набирать «+381»
                  // вручную девять раз из десяти незачем.
                  if (phone === '') setPhone(SERBIAN_PHONE_PREFIX);
                  // Каретка — в конец номера. Хук вызывается ПОСЛЕ
                  // подстановки префикса: он ставит позицию кадром
                  // позже, когда значение уже обновилось.
                  phoneCaret.onFocus(e);
                }}
                onBlur={() => {
                  // Ушли, не набрав ни цифры — очищаем, чтобы поле не
                  // выглядело заполненным одним кодом страны.
                  if (phone.trim() === SERBIAN_PHONE_PREFIX.trim()) {
                    setPhone('');
                  }
                }}
                maxLength={MAX_PHONE}
                placeholder="+381 60 123 456"
                className={fieldClass}
              />
              <p className="mt-1 text-small text-neutral-50">
                {t('profile_phone_hint')}
              </p>
            </div>
          </div>

          {/* ПОЧТА БОЛЬШЕ НЕ РЕДАКТИРУЕТСЯ (миграция 0106).
              ------------------------------------------------------------
              Поле было свободно изменяемым, пока почта нигде не служила
              входом. С переходом сайта на почтовый вход это стало
              способом угона аккаунта: перехваченная на минуту чужая
              сессия (общий компьютер, незаблокированный телефон)
              позволяла вписать свой адрес — подтверждения не
              требовалось — и дальше входить в этот кабинет когда
              угодно. Владелец терял и объявления, и переписку.

              Именно это условие ставила миграция 0082: открывать
              почтовый вход всем можно только после того, как смена
              адреса перестанет быть бесконтрольной.

              Выбран запрет, а не подтверждение нового адреса кодом:
              подтверждение — отдельная работа с собственной миграцией
              (хранение ожидающего адреса, повторные отправки, сроки
              годности), а живых продавцов, которым нужно менять почту,
              пока нет. Заводится адрес при регистрации, меняется через
              поддержку. Полноценная смена с подтверждением остаётся
              задачей на потом. */}
          <div>
            <label className="mb-1 block text-caption text-neutral-60">
              {t('profile_email')}
            </label>
            <input
              type="text"
              value={profile.email ?? '—'}
              readOnly
              disabled
              className={`${fieldClass} bg-surface-muted text-neutral-60`}
            />
            <p className="mt-1 text-small text-neutral-50">
              {t('profile_email_locked')}
            </p>
          </div>

          {/* ------------------------------------------------------------
              ТИП ПРОДАВЦА — БОЛЬШЕ НЕ ПЕРЕКЛЮЧАТЕЛЬ (миграция 0100).
              ------------------------------------------------------------
              Здесь стоял сегмент из двух кнопок «Частное лицо |
              Автосалон», и нажатие второй выдавало витрину в каталоге
              салонов, страницу /dealer/{id} и отметку «Автосалон» на
              объявлениях — кому угодно, без единой проверки. Площадка
              подтверждала покупателю существование компании, ничего о
              ней не зная.
              Теперь статус выдаёт администратор по заявке с
              реквизитами, а блок ниже показывает, на какой стадии
              находится заявитель. Кнопки «я частное лицо» в нём нет:
              частник — состояние по умолчанию, выбирать его не из чего.

              ЗНАЧЕНИЕ sellerKind ПРОДОЛЖАЕТ УЧАСТВОВАТЬ В
              СОХРАНЕНИИ — оно приходит из профиля и уходит обратно в
              saveProfile без изменений. Меняет его ровно одно
              действие в интерфейсе: отказ от статуса салона
              (onLeaveDealer ниже). Обратный переход интерфейсом не
              предусмотрен вовсе — его делает одобрение заявки на
              стороне базы. */}
          <DealerApplicationBlock
            locale={locale}
            application={application}
            sellerKind={sellerKind}
            // Отказ от статуса: переводим форму в состояние частного
            // лица и сохраняем сразу, не дожидаясь кнопки «Сохранить».
            // Иначе человек, подтвердивший отказ в диалоге, увидел бы
            // блок салона на прежнем месте и решил, что отказ не
            // сработал.
            //
            // Поля витрины при этом обнулит сервер
            // (update_seller_profile затирает их при seller_kind =
            // 'private'), и повторять это на клиенте незачем.
            onLeaveDealer={() => {
              setSellerKind('private');
              setSaved(false);
              submitWith('private');
            }}
          />

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

              {/* ------------------------------------------------------------
                  ОБЛОЖКА ВИТРИНЫ (миграция 0098).
                  ------------------------------------------------------------
                  Занимает верхнюю половину плитки салона в каталоге.
                  Превью в пропорции 3:2 — той же, в которой кадр
                  хранится и в которой он лежит в плитке каталога.
                  Владелец видит ровно то, что увидит покупатель.

                  Кадрирование делается ПРИ ЗАГРУЗКЕ, а не на показе —
                  COVER_ASPECT передаётся в uploadImage. Иначе салон
                  сохранял бы снимок целиком, видел его здесь и лишь
                  потом обнаруживал в каталоге обрезок. */}
              <div className="mt-3">
                <label className="mb-1 block text-caption text-neutral-60">
                  {t('profile_cover')}
                </label>

                <span className="relative block aspect-[3/2] w-full overflow-hidden rounded-card border border-neutral-10 bg-surface-muted">
                  {coverUrl ? (
                    <Image
                      src={coverUrl}
                      alt=""
                      fill
                      sizes="(max-width: 767px) 100vw, 480px"
                      className="object-cover"
                      // unoptimized по той же причине, что у логотипа.
                      unoptimized
                    />
                  ) : (
                    // Пустая рамка с подписью, а не серая плита:
                    // владелец должен понимать, что место под обложку
                    // есть и оно пока не занято.
                    <span className="flex h-full w-full items-center justify-center px-4 text-center text-caption text-neutral-30">
                      {t('profile_cover_empty')}
                    </span>
                  )}
                </span>

                <input
                  ref={coverRef}
                  type="file"
                  accept={ACCEPT_ATTR}
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void uploadImage(
                        file,
                        'cover.jpg',
                        setCoverUrl,
                        COVER_ASPECT,
                      );
                    }
                    e.target.value = '';
                  }}
                />

                {/* ОДНА КНОПКА, ДВЕ ПОДПИСИ: обложки нет —
                    «Загрузить обложку», обложка есть — «Заменить
                    обложку». Действие одно и то же: открыть файловый
                    диалог и перезаписать cover.jpg, которого в бакете
                    всегда ровно один.

                    КНОПКИ «УБРАТЬ» НЕТ. Салон без обложки получает не
                    пустоту, а фирменный градиент — и в плитке
                    каталога, и в шапке витрины. То есть «убрать»
                    означало бы не «освободить место», а «поменять свою
                    фотографию на общий фон», чего никто не хочет
                    осознанно. Нужную картинку меняет замена. */}
                <div className="mt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={uploading}
                    onClick={() => coverRef.current?.click()}
                  >
                    {uploading
                      ? t('profile_saving')
                      : coverUrl
                        ? t('profile_cover_replace')
                        : t('profile_cover_change')}
                  </Button>
                </div>

                <p className="mt-2 text-small text-neutral-50">
                  {t('profile_cover_hint')}
                </p>
              </div>

              {/* ------------------------------------------------------------
                  ВИТРИНА САЛОНА: чем наполняется его карточка.
                  ------------------------------------------------------------
                  Поля стоят здесь, внутри блока дилера, сразу после
                  логотипа: всё это — сведения о КОМПАНИИ, и мешать их
                  с полями аккаунта (имя человека, почта, аватар) было
                  бы неверно. У частника блок не показывается вовсе —
                  update_seller_profile при seller_kind = 'private'
                  затирает эти поля, и форма обещала бы сохранение,
                  которого не произойдёт.

                  Подпись-разделитель нужна: без неё поля читались бы
                  продолжением настроек аккаунта, и салон не понимал
                  бы, что именно этот текст увидят покупатели. */}
              <div className="mt-4 border-t border-neutral-10 pt-4">
                <h3 className="font-semibold">{t('showcase_section')}</h3>
                <p className="mt-1 text-small text-neutral-50">
                  {t('showcase_section_hint')}
                </p>

                <div className="mt-3 space-y-3">
                  {/* СЛОГАН — одна строка, поэтому input, а не
                      textarea: 90 символов помещаются в поле целиком,
                      и прокручивать нечего.

                      Стоит ПЕРЕД описанием: в плитке каталога виден
                      именно он, тогда как описание там показывается
                      только у салона без обложки. Порядок полей в
                      форме повторяет порядок значимости в карточке. */}
                  <div>
                    <label className="mb-1 block text-caption text-neutral-60">
                      {t('showcase_tagline')}
                    </label>
                    <input
                      value={tagline}
                      onChange={(e) => {
                        setTagline(e.target.value);
                        setSaved(false);
                      }}
                      maxLength={MAX_TAGLINE}
                      placeholder={t('showcase_ph_tagline')}
                      className={fieldClass}
                    />
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-small text-neutral-50">
                        {t('showcase_tagline_hint')}
                      </p>
                      {/* Порог — 20 символов до конца, около трети
                          строки. От лимита 90 это заметная доля, но
                          поле короткое: подсказать о границе нужно
                          раньше, чем у описания на 1000 знаков. */}
                      {tagline.length > MAX_TAGLINE - 20 && (
                        <span className="text-small text-neutral-50">
                          {tagline.length} / {MAX_TAGLINE}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ГОРОД — ВЫБОР ИЗ СПИСКА, тот же ListPicker и тот
                      же справочник CITIES, что в форме подачи
                      объявления. Единый способ выбрать город на всём
                      сайте: продавец, уже подавший объявление, знает
                      этот пикер и не разбирается заново.

                      Раньше поле стояло disabled-инпутом: город
                      проставлял только администратор (0085). Пока
                      город был внутренним полем админки, это годилось,
                      но теперь его видит покупатель — в плитке салона
                      и в шапке витрины, — и салон, глядя на пустое
                      место в своей карточке, не мог его заполнить.
                      Миграция 0097 научила update_seller_profile
                      писать это поле.

                      allowCustom — как в подаче: справочник из 18
                      крупных городов подсказка, а не ограничение, и
                      салон из посёлка обязан вписать своё название.

                      Своей подписи <label> здесь нет: ListPicker
                      рендерит её сам, и вторая читалась бы как
                      дубль. */}
                  {/* ГОРОД И ТЕЛЕФОН — ОДНА СТРОКА С ПЛАНШЕТА.
                      Оба поля короткие: город это одно слово, телефон
                      — фиксированные пятнадцать знаков. По отдельной
                      строке на каждое растягивало форму вниз пустотой.

                      НА МОБИЛЬНОМ ОСТАЮТСЯ В СТОЛБИК, и это не
                      упрощение. На 360px форме достаётся 296px, при
                      делении пополам колонка выходит 140px, а
                      «+381 11 123 456» с полями требует ~159px — номер
                      обрезался бы прямо в поле ввода. С sm (640px)
                      колонка уже 280px и вмещает всё с запасом.

                      items-start: у полей подсказки разной длины
                      («Город показывается…» в одну строку, «Публичный
                      номер компании…» в две), и без выравнивания по
                      верху сами поля разъехались бы по вертикали. */}
                  <div className="grid items-start gap-4 sm:grid-cols-2">
                    <div>
                      <ListPicker
                        locale={locale}
                        name="company_city"
                        label={t('showcase_city')}
                        options={CITIES.map(
                          (c): PickerOption => ({ value: c, label: c }),
                        )}
                        value={companyCity}
                        placeholder={t('showcase_city_empty')}
                        allowCustom
                        onChange={(v) => {
                          setCompanyCity(v);
                          setSaved(false);
                        }}
                      />
                      <p className="mt-1 text-small text-neutral-50">
                        {t('showcase_city_hint')}
                      </p>
                    </div>

                    {/* ТЕЛЕФОН САЛОНА. Не путать с номером выше: тот
                        служит логином и не меняется. Здесь — публичный
                        номер компании, который увидит покупатель. */}
                    <div>
                      <label className="mb-1 block text-caption text-neutral-60">
                        {t('showcase_phone')}
                      </label>
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={dealerPhone}
                        onChange={(e) => {
                          // Маска та же, что в подаче объявления и на
                          // входе: номер приводится к «+381 11 123 456»
                          // прямо во время набора, а не проверяется
                          // после. Так салон физически не сохранит номер
                          // в чужом формате.
                          setDealerPhone(formatSerbianPhone(e.target.value));
                          setSaved(false);
                        }}
                        onClick={dealerPhoneCaret.onClick}
                        onTouchEnd={dealerPhoneCaret.onTouchEnd}
                        onFocus={(e) => {
                          // Код страны появляется при первом касании
                          // пустого поля: держать его там всегда значило
                          // бы, что «незаполненный телефон» выглядит
                          // как заполненный наполовину.
                          if (dealerPhone === '') {
                            setDealerPhone(SERBIAN_PHONE_PREFIX);
                          }
                          // Каретка — в конец. См. поле выше.
                          dealerPhoneCaret.onFocus(e);
                        }}
                        onBlur={() => {
                          // Ушли, не набрав ни цифры — очищаем поле,
                          // чтобы в базу не попал один код страны.
                          if (dealerPhone.trim() === SERBIAN_PHONE_PREFIX.trim()) {
                            setDealerPhone('');
                          }
                        }}
                        maxLength={MAX_PHONE}
                        placeholder="+381 11 123 456"
                        className={fieldClass}
                      />
                      <p className="mt-1 text-small text-neutral-50">
                        {t('showcase_phone_hint')}
                      </p>
                    </div>
                  </div>

                  {/* ЧАСЫ РАБОТЫ — ДВА ПОЛЯ ВРЕМЕНИ, а не свободная
                      строка. Слова «Работаем с» и «до» стоят в
                      разметке подписями и в поля не вводятся: салон
                      вписывает только время, а строка для каталога
                      собирается сама. Так все карточки в выдаче
                      выглядят одинаково, что бы ни набрал владелец.

                      Подпись показана ДО ввода, а не после: человек
                      видит будущую формулировку целиком и понимает,
                      что от него нужны две цифры, а не расписание.


                      Поле сайта, стоявшее здесь в паре с часами,
                      убрано вместе с адресом салона по всему сайту.
                      Часы остались одни, и сетка из двух колонок им
                      больше не нужна. */}
                  <div>
                    <label className="mb-1 block text-caption text-neutral-60">
                      {t('showcase_hours')}
                    </label>

                      {/* ОДНА СТРОКА: «Работаем с [9:00] до [19:00]».

                          Ширину полей приходится задавать двумя классами
                          сразу — !w-24 и shrink-0. Причина в fieldClass:
                          в нём есть w-full, и при равной специфичности
                          побеждает тот класс, что стоит позже в
                          сгенерированном CSS, а не в атрибуте. Обычный
                          w-24 проигрывал, поля растягивались на всю
                          ширину строки и разъезжались на две. `!`
                          поднимает приоритет до !important и снимает
                          спор однозначно.

                          shrink-0 держит ширину при нехватке места:
                          иначе flex сжал бы поля, и «19:00» обрезалось
                          бы посреди цифр.

                          ШИРИНА 72px ПОСЧИТАНА ПОД САМЫЙ УЗКИЙ ЭКРАН.
                          На 360px после полей страницы (32px) и
                          карточки (32px) остаётся 296px. Подписи
                          «Работаем с» и «до» занимают ~108px, три
                          зазора — 24px, значит на два поля есть 164px.
                          72px каждому оставляют запас в 20px, тогда как
                          w-24 (96px) переполняли строку на 28px — с них
                          поля и уезжали на второй ряд. Самому полю
                          хватает: «19:00» по центру занимает ~35px. */}
                      <div className="flex flex-nowrap items-center gap-2">
                        <span className="shrink-0 text-caption text-neutral-60">
                          {t('showcase_hours_from')}
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={hoursFrom}
                          onChange={(e) => {
                            setHoursFrom(formatTime(e.target.value));
                            setSaved(false);
                          }}
                          maxLength={5}
                          placeholder="9:00"
                          aria-label={t('showcase_hours_from')}
                          className={`${fieldClass} !w-[72px] shrink-0 text-center`}
                        />
                        <span className="shrink-0 text-caption text-neutral-60">
                          {t('showcase_hours_to')}
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={hoursTo}
                          onChange={(e) => {
                            setHoursTo(formatTime(e.target.value));
                            setSaved(false);
                          }}
                          maxLength={5}
                          placeholder="19:00"
                          aria-label={t('showcase_hours_to')}
                          className={`${fieldClass} !w-[72px] shrink-0 text-center`}
                        />
                      </div>

                    <p className="mt-1 text-small text-neutral-50">
                      {t('showcase_hours_hint')}
                    </p>
                  </div>
                </div>
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
              теряя несохранённое. */}
          {sellerKind === 'dealer' && (
            <Button
              href={localeHref(locale, `/dealer/${profile.id}`)}
              variant="info"
              fullWidth
            >
              {t('profile_showcase')} →
            </Button>
          )}

          <Button
            onClick={() => submitWith()}
            disabled={pending || uploading}
            fullWidth
          >
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

      {/* ------------------------------------------------------------
          ПРАВАЯ КОЛОНКА — АВАТАР. ТОЛЬКО У ЧАСТНОГО ЛИЦА.
          ------------------------------------------------------------
          На десктопе стоит сбоку: это не редактируемое поле формы, а
          сведения об аккаунте, и мешать его с полями ввода незачем.
          На мобильном уходит вниз.

          У САЛОНА АВАТАРА НЕТ. Его роль — «лицо продавца» — у компании
          закрывают логотип и обложка витрины, и оба уже стоят выше, в
          блоке витрины. Третья картинка рядом с ними ставила бы
          владельца перед вопросом, чем она отличается от логотипа, а
          ответа нет: нигде на сайте аватар салона не показывается.
          Единственное место, где он мог бы всплыть, — шапка витрины,
          и там он стоит запасным вариантом ПОСЛЕ логотипа
          (DealerShowcaseHero), то есть у салона с логотипом не
          используется вовсе.

          ЗНАЧЕНИЕ ПРИ ЭТОМ ПРОДОЛЖАЕТ СОХРАНЯТЬСЯ: avatarUrl уходит в
          saveProfile независимо от того, показана карточка или нет.
          Человек, который был частником и загружал аватар, не потеряет
          его при переключении в салон — и увидит снова, если
          переключится обратно. */}
      {sellerKind !== 'dealer' && (
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
      )}

      {/* ------------------------------------------------------------
          УДАЛЕНИЕ АККАУНТА (0126). ПОД ФОРМОЙ, ПО ЕЁ ШИРИНЕ.
          ------------------------------------------------------------
          Отдельной строкой сетки, а не внутри карточки с полями: это
          не поле профиля и не часть редактирования, а выход с
          площадки. Стоять вплотную к «Сохранить» оно не должно — см.
          шапку DeleteAccountBlock о цене промаха между двумя кнопками.

          ШИРИНА — ПЕРВАЯ КОЛОНКА, А НЕ ВСЯ СЕТКА. Раньше здесь стоял
          col-span-full, и у частного лица карточка растягивалась на
          обе колонки, залезая под аватар: её рамка была заметно шире
          формы над ней, и два блока читались как принадлежащие разным
          страницам. col-start-1 держит её ровно под карточкой полей.

          У салона колонка одна (max-w-3xl вместо сетки), и правило ни
          на что не влияет — ширина совпадает и там.

          Показывается всем, включая салоны: право на удаление аккаунта
          не зависит от вида продавца. Салон при этом теряет и статус —
          профиль обезличивается целиком. */}
      <div className="lg:col-start-1">
        {/* Почта и телефон — из ИСХОДНОГО профиля, не из состояния
            формы: сверять надо с тем, что лежит в базе, а не с тем,
            что человек только что напечатал в поле выше и ещё не
            сохранил. Иначе изменённый, но не сохранённый адрес
            принимался бы как подтверждение, а настоящий — нет. */}
        <DeleteAccountBlock
          locale={locale}
          kind={deleteConfirmKind}
          email={profile.email}
          phone={profile.phone}
        />
      </div>
    </div>
  );
}
