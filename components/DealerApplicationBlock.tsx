'use client';

// ============================================================
// RS AUTO — Заявка на статус автосалона. Client Component.
// ============================================================
// ЧТО ЭТОТ БЛОК ЗАМЕНИЛ. На его месте стоял переключатель «Частное
// лицо | Автосалон»: две кнопки, любая нажимается кем угодно. Нажав
// вторую и вписав название, человек получал витрину в каталоге
// салонов, страницу /dealer/{id} и отметку «Автосалон» на своих
// объявлениях — то есть площадка от своего имени сообщала покупателю,
// что за объявлением стоит зарегистрированная компания, не проверив
// этого ни разу.
//
// Теперь статус выдаёт администратор по заявке с реквизитами
// (миграция 0100), а блок показывает одно из ЧЕТЫРЁХ состояний:
//
//   нет заявки  → приглашение и форма с реквизитами;
//   pending     → «отправлена, проверяем» (форма скрыта);
//   rejected    → причина отказа и кнопка «подать снова»;
//   approved    → подтверждение и, ниже, поля витрины.
//
// СОСТОЯНИЕ ОПРЕДЕЛЯЕТСЯ ПО ПОСЛЕДНЕЙ ЗАЯВКЕ, а не по seller_kind
// профиля: у отклонённого заявителя seller_kind так и остался
// 'private', и без заявки блок показал бы ему приглашение подать
// заново, умолчав, что предыдущую только что отклонили и объяснили
// почему.
//
// ПОЧЕМУ ЧАСТНИКУ ЗДЕСЬ НЕ НУЖНА КНОПКА «Я ЧАСТНОЕ ЛИЦО». Частное
// лицо — состояние по умолчанию: профиль заводится с seller_kind =
// 'private', и выбирать его не из чего. Кнопка обратного перехода
// нужна только салону, и она стоит в состоянии approved.
// ============================================================

import { useState, useTransition } from 'react';
import type { FocusEvent, MouseEvent, TouchEvent } from 'react';

import {
  submitDealerApplication,
  type DealerApplicationCode,
} from '@/app/my/actions';
import Alert from './ui/Alert';
import Button from './ui/Button';
import Card from './ui/Card';
import { fieldClass } from './ui/Field';
import ListPicker, { type PickerOption } from './ListPicker';
import { CITIES } from '@/lib/referenceData';
import {
  formatSerbianPhone,
  serbianNationalDigits,
  SERBIAN_PHONE_PREFIX,
} from '@/lib/inputFormat';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import type { DealerApplication } from '@/lib/types';
import { useDismissableLayer } from '@/lib/useDismissableLayer';
import { usePhoneCaret } from '@/lib/usePhoneCaret';

// Соответствие кода ошибки ключу словаря. Таблицей, а не цепочкой
// if: добавление новой причины отказа — одна строка здесь, а не
// ещё одна ветка в разметке.
const ERROR_KEYS: Record<DealerApplicationCode, DictKey> = {
  pending_exists: 'dealer_app_err_pending',
  already_dealer: 'dealer_app_err_already',
  tax_id: 'dealer_app_err_tax_id',
  reg_num: 'dealer_app_err_reg_num',
  company: 'dealer_app_err_company',
  city: 'dealer_app_err_city',
  person: 'dealer_app_err_person',
  phone: 'dealer_app_err_phone',
  email: 'dealer_app_err_email',
  too_long: 'dealer_app_err_long',
  auth: 'dealer_app_err_auth',
  unknown: 'dealer_app_err_unknown',
};

// Границы реквизитов. Те же, что в CHECK на dealer_applications и в
// проверках submit_dealer_application (0100): сервер отклонит
// неверное в любом случае, а эти числа нужны, чтобы сказать об этом
// сразу — атрибутом maxLength и неактивной кнопкой.
//
// Длина считается ПО ЦИФРАМ, а не по символам строки: человек
// набирает PIB как «123 456 789» или «123-456-789», и RPC сама
// вычищает из него всё, кроме цифр. Требовать девять символов подряд
// значило бы придираться к пробелу, который сервер и так выбросит.
const TAX_ID_DIGITS = 9;
const REG_NUM_DIGITS = 8;
const MAX_COMPANY = 120;
const MAX_COMMENT = 1000;

// Грубая проверка почты — ровно та же, что в submit_dealer_application
// (0103): «что-то, собака, что-то, точка, что-то». Строгую по RFC не
// строим намеренно — она отвергает валидные адреса чаще, чем ловит
// невалидные, а опечатку в домене всё равно поймает только письмо.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Только цифры из введённого — для проверки длины на клиенте.
function digits(value: string): string {
  return value.replace(/\D/g, '');
}

// Обрезка ввода по КОЛИЧЕСТВУ ЦИФР, а не по длине строки.
// Атрибут maxLength здесь не годится: он считает символы, и человек,
// набирающий PIB как «123 456 789», упёрся бы в предел на девятом
// символе — то есть на седьмой цифре. Поэтому лишние цифры режем
// сами, а разделители (пробелы, дефисы) оставляем как набраны:
// сервер их всё равно вычистит.
function clampDigits(value: string, max: number): string {
  let seen = 0;
  let out = '';
  for (const ch of value) {
    if (/\d/.test(ch)) {
      // Цифра сверх нормы — и она, и весь дальнейший ввод отбрасываются.
      if (seen === max) break;
      seen += 1;
    }
    out += ch;
  }
  return out;
}

type Props = {
  locale: Locale;
  // Последняя заявка пользователя или null, если он не подавал ни
  // одной. Читается на сервере (get_my_dealer_application) и
  // приходит готовой: блок не должен начинать жизнь с «загружаем».
  application: DealerApplication | null;
  // Текущий тип продавца из профиля. Нужен, чтобы отличить
  // действующего салона от заявителя с одобренной, но ещё не
  // применённой заявкой — второго не бывает (одобрение сразу ставит
  // seller_kind), но полагаться на это в разметке не стоит.
  sellerKind: string;
  // Возврат в «частное лицо». Обрабатывает родительская форма: это
  // обычное сохранение профиля с seller_kind = 'private', и второй
  // путь сохранения ради одной кнопки заводить незачем.
  onLeaveDealer: () => void;
};

export default function DealerApplicationBlock({
  locale,
  application,
  sellerKind,
  onLeaveDealer,
}: Props) {
  const t = getT(locale);

  // Каретка в поле телефона — только в конец номера, чтобы тап
  // в середину кода страны «+381 » не уводил туда цифры.
  const phoneCaret = usePhoneCaret();

  // Форма раскрыта. Свёрнутая по умолчанию: большинство продавцов —
  // частники, и восемь полей реквизитов, развёрнутых в профиле у
  // каждого, оттесняли бы вниз то, за чем в профиль заходят.
  const [open, setOpen] = useState(false);

  // Диалог отказа от статуса салона. Раньше здесь стоял
  // window.confirm — системное окно с одной строкой текста, которое
  // и выглядит чужим на сайте, и вмещает слишком мало: человек не
  // узнавал ни что витрину придётся заполнять заново, ни что за
  // возвратом статуса придётся идти к администратору с новой
  // заявкой (0129). Второе решает, нажмёт он или нет.
  const [leaveOpen, setLeaveOpen] = useState(false);

  // Esc, клик вне окна и блокировка прокрутки фона — общий хук, тот
  // же, что у остальных слоёв сайта.
  useDismissableLayer({ open: leaveOpen, onClose: () => setLeaveOpen(false) });

  const [companyName, setCompanyName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [regNum, setRegNum] = useState('');
  const [city, setCity] = useState('');
  const [person, setPerson] = useState('');
  // Поле стартует с кодом страны: набирать «+381» руками незачем.
  // Так же ведут себя подача объявления, вход и форма на /dealers —
  // расходиться этим четырём формам нельзя.
  const [phone, setPhone] = useState(SERBIAN_PHONE_PREFIX);
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [comment, setComment] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const status = application?.status ?? null;

  // ------------------------------------------------------------
  // СОСТОЯНИЕ 4: статус подтверждён.
  // ------------------------------------------------------------
  // Показывается действующему салону. Поля витрины стоят ниже, в
  // самой форме профиля, — этот блок только подтверждает право и
  // даёт от него отказаться.
  if (sellerKind === 'dealer') {
    return (
      <Card>
        <div className="space-y-3">
          <div>
            <p className="font-semibold text-success">
              {t('dealer_app_approved_title')}
            </p>
            <p className="mt-1 text-caption text-neutral-60">
              {t('dealer_app_approved_text')}
            </p>
          </div>

          {/* Отказ от статуса — вторичной кнопкой и с подробным
              диалогом. Цена ошибки высока: салон пропадёт из каталога
              витрин, поля витрины (обложка, слоган, часы, телефон)
              сервер затрёт при сохранении с seller_kind = 'private', а
              одобренная заявка закроется (withdrawn, миграция 0129) —
              за возвратом статуса придётся идти к администратору
              заново. Об этом человек обязан узнать ДО нажатия. */}
          {/* НА МОБИЛЬНОМ КНОПКА ПО ЦЕНТРУ, на десктопе слева. В узкой
              колонке текст блока занимает всю ширину, и короткая
              кнопка у левого края висела под ним без всякой опоры. На
              широком экране карточка сама узкая, и центрировать в ней
              нечего — левый край совпадает с началом текста. */}
          <div className="flex justify-center sm:justify-start">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLeaveOpen(true)}
            >
              {t('dealer_app_leave')}
            </Button>
          </div>

          {/* ------------------------------------------------------------
              ДИАЛОГ ОТКАЗА ОТ СТАТУСА.
              ------------------------------------------------------------
              Разметка повторяет диалог удаления аккаунта
              (DeleteAccountBlock): два разных модальных окна в одном
              кабинете читались бы как элементы разных продуктов.

              НАБОРА СЛОВА ЗДЕСЬ НЕТ, в отличие от удаления. Второй
              замок ставят там, где действие необратимо; отказ от
              статуса откатывается самим владельцем — заявка остаётся
              одобренной. Требовать за него ту же цену значило бы
              уравнять в глазах человека потерю витрины и потерю
              аккаунта.

              Поле подтверждения отсутствует, поэтому и автофокуса
              нет — диалог открывается целиком видимым и на мобильном
              не уезжает под клавиатуру. */}
          {leaveOpen && (
            <div
              className="fixed inset-0 z-modal flex items-end justify-center bg-surface-overlay p-0 sm:items-center sm:p-4"
              onClick={() => setLeaveOpen(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="leave-dealer-title"
                onClick={(e) => e.stopPropagation()}
                className="
                  max-h-[90dvh] w-full overflow-y-auto rounded-t-card bg-white p-4
                  sm:max-w-lg sm:rounded-card sm:p-6
                "
              >
                <h2
                  id="leave-dealer-title"
                  className="text-h3 font-semibold"
                >
                  {t('dealer_app_leave_confirm')}
                </h2>

                <p className="mt-3 text-caption font-medium">
                  {t('dealer_app_leave_what')}
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-caption text-neutral-60">
                  <li>{t('dealer_app_leave_item_card')}</li>
                  <li>{t('dealer_app_leave_item_page')}</li>
                  <li>{t('dealer_app_leave_item_showcase')}</li>
                </ul>

                {/* Что остаётся и как вернуться. Обе строки обязательны:
                    без первой человек боится за объявления, без второй
                    считает отказ окончательным. */}
                <p className="mt-3 text-micro text-neutral-50">
                  {t('dealer_app_leave_keep')}
                </p>
                <p className="mt-2 text-micro text-neutral-50">
                  {t('dealer_app_leave_back')}
                </p>

                {/* КНОПКИ ДЕЛЯТ ШИРИНУ ОКНА ПОРОВНУ. Прежде они
                    жались вправо и разъезжались по ширине текста:
                    «Отмена» выходила вдвое уже «Стать частным лицом»,
                    и пара читалась как случайная, а не как выбор из
                    двух равных вариантов.

                    flex-1 на обёртках, а не fullWidth на кнопках: тот
                    даёт w-full, что в flex-строке лишь растягивает
                    кнопку по её собственному содержимому. Ширину
                    поровну делят именно контейнеры.

                    На мобильном строка складывается в столбец
                    (flex-col-reverse), и каждая кнопка занимает всю
                    ширину — там делить нечего. */}
                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
                  <div className="flex-1">
                    <Button
                      variant="secondary"
                      fullWidth
                      onClick={() => setLeaveOpen(false)}
                    >
                      {t('dealer_app_leave_cancel')}
                    </Button>
                  </div>
                  <div className="flex-1">
                    <Button
                      variant="destructive"
                      fullWidth
                      onClick={() => {
                        setLeaveOpen(false);
                        onLeaveDealer();
                      }}
                    >
                      {t('dealer_app_leave_submit')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    );
  }

  // ------------------------------------------------------------
  // СОСТОЯНИЕ 2: заявка ждёт рассмотрения.
  // ------------------------------------------------------------
  // Формы здесь нет намеренно: вторую заявку база всё равно не
  // примет (уникальный индекс по pending), и показывать поля, чтобы
  // потом отказать, — обман.
  if (status === 'pending') {
    return (
      <Card>
        <div className="space-y-2">
          <p className="font-semibold">{t('dealer_app_pending_title')}</p>
          <p className="text-caption text-neutral-60">
            {t('dealer_app_pending_text')}
          </p>
          <p className="text-small text-neutral-50">
            {t('dealer_app_pending_since')}:{' '}
            {new Date(application!.created_at).toLocaleDateString(
              locale === 'ru' ? 'ru-RU' : 'sr-Latn-RS',
              { day: 'numeric', month: 'long', year: 'numeric' },
            )}
            {' · '}
            {application!.company_name}
          </p>
        </div>
      </Card>
    );
  }

  // ------------------------------------------------------------
  // ОТПРАВКА.
  // ------------------------------------------------------------
  function submit() {
    // Проверки повторяют серверные (0100) намеренно: источник истины
    // остаётся в базе, а клиент избавляет от заведомо напрасного
    // запроса и называет проблему у нужного поля.
    if (companyName.trim().length < 2) {
      setError(t('dealer_app_err_company'));
      return;
    }
    if (digits(taxId).length !== TAX_ID_DIGITS) {
      setError(t('dealer_app_err_tax_id'));
      return;
    }
    if (digits(regNum).length !== REG_NUM_DIGITS) {
      setError(t('dealer_app_err_reg_num'));
      return;
    }
    // Контакты обязательны с 0103. Проверяем в том же порядке, в
    // каком поля стоят в форме: человек читает ошибку и идёт к
    // первому незаполненному сверху, а не ищет его по всей форме.
    if (city.trim() === '') {
      setError(t('dealer_app_err_city'));
      return;
    }
    if (person.trim() === '') {
      setError(t('dealer_app_err_person'));
      return;
    }
    // Номер проверяем ПО ЦИФРАМ, а не на непустоту: в поле всегда
    // стоит код страны «+381 », и phone.trim() был бы истинным на
    // пустом номере — заявка ушла бы с одним кодом страны, который
    // сервер за пустой не считает. Та же причина, что в SellForm.
    if (serbianNationalDigits(phone) === '') {
      setError(t('dealer_app_err_phone'));
      return;
    }
    // Формат почты — тем же грубым правилом, что в RPC: строгая
    // проверка по RFC отвергает валидные адреса чаще, чем ловит
    // невалидные.
    if (!EMAIL_RE.test(email.trim())) {
      setError(t('dealer_app_err_email'));
      return;
    }

    setError(null);

    startTransition(async () => {
      const result = await submitDealerApplication({
        companyName,
        taxId,
        registrationNumber: regNum,
        companyCity: city,
        contactPerson: person,
        phone,
        email,
        website,
        comment,
      });

      if (!result.ok) {
        setError(t(ERROR_KEYS[result.code ?? 'unknown']));
        return;
      }

      // Успех не показываем строкой: revalidatePath в действии уже
      // перерисовал страницу, и блок вернётся сюда в состоянии
      // pending — оно и есть сообщение об успехе, причём стойкое, а
      // не исчезающее с перезагрузкой.
      setOpen(false);
    });
  }

  // Общая разметка поля: подпись сверху, необязательное — без
  // звёздочки. Локальная функция, а не отдельный компонент: она
  // нужна только здесь и ничем не отличается от полей выше по форме.
  function field(
    label: string,
    value: string,
    onChange: (v: string) => void,
    options?: {
      required?: boolean;
      hint?: string;
      maxLength?: number;
      // Предел по количеству цифр — для номеров фиксированной длины
      // (PIB, матични број). Работает вместе с maxLength, а не вместо:
      // тот держит общую длину строки с разделителями.
      maxDigits?: number;
      // Преобразование ввода на лету — маска телефона. Применяется
      // до maxDigits, но с ним же вместе не используется: номер
      // фиксированной длины и форматируемый номер — разные случаи.
      format?: (raw: string) => string;
      inputMode?: 'numeric' | 'tel' | 'url' | 'email';
      placeholder?: string;
      // Обработчики каретки из usePhoneCaret: ставят её в конец
      // значения при клике, тапе и фокусе. Передаются ТОЛЬКО полю
      // телефона — остальные поля обычные, и запрет ткнуть пальцем в
      // середину названия компании мешал бы правке.
      caret?: {
        onFocus: (e: FocusEvent<HTMLInputElement>) => void;
        onClick: (e: MouseEvent<HTMLInputElement>) => void;
        onTouchEnd: (e: TouchEvent<HTMLInputElement>) => void;
      };
    },
  ) {
    return (
      <div>
        <label className="mb-1 block text-caption text-neutral-60">
          {label}
          {options?.required ? ' *' : ''}
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(
              options?.format
                ? options.format(raw)
                : options?.maxDigits
                  ? clampDigits(raw, options.maxDigits)
                  : raw,
            );
            setError(null);
          }}
          {...(options?.caret ?? {})}
          maxLength={options?.maxLength}
          inputMode={options?.inputMode}
          placeholder={options?.placeholder}
          className={fieldClass}
        />
        {options?.hint && (
          <p className="mt-1 text-small text-neutral-50">{options.hint}</p>
        )}
      </div>
    );
  }

  return (
    <Card>
      <div className="space-y-3">
        {/* ------------------------------------------------------------
            СОСТОЯНИЕ 3: заявка отклонена.
            ------------------------------------------------------------
            Причина показывается ДОСЛОВНО, как её написал
            администратор. Тон error — это то, что нужно исправить,
            ровно как причина отклонения объявления у продавца.
            Без причины повторная подача превращается в угадывание. */}
        {status === 'rejected' && (
          <div>
            <p className="font-semibold text-brand-red">
              {t('dealer_app_rejected_title')}
            </p>
            {/* ДАТА РЕШЕНИЯ И НАЗВАНИЕ КОМПАНИИ — та же строка, что у
                заявки на рассмотрении выше. Блок висит в профиле,
                пока владелец не подаст новую, и через несколько дней
                отказ без даты читается как свежий: человек не
                понимает, вчерашнее это решение или трёхнедельное.
                Название компании отвечает на второй вопрос — какую
                именно заявку отклонили, если их было несколько.

                reviewed_at заполняется вместе со сменой статуса, но
                у заявок, отклонённых до появления колонки, он пуст —
                тогда строка не показывается вовсе, а не подставляет
                дату подачи вместо даты решения. */}
            {application?.reviewed_at && (
              <p className="mt-1 text-small text-neutral-50">
                {t('dealer_app_rejected_at')}:{' '}
                {/* С ВРЕМЕНЕМ, в отличие от даты подачи выше.
                    Заявку разбирают в тот же день, что и подали, и
                    одна дата не отвечала на вопрос «это до или после
                    того, как я дослал документы». toLocaleString
                    вместо toLocaleDateString: часовой пояс берётся
                    браузерный, то есть владелец видит время по
                    своим часам, а не по UTC из базы. */}
                {new Date(application.reviewed_at).toLocaleString(
                  locale === 'ru' ? 'ru-RU' : 'sr-Latn-RS',
                  {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  },
                )}
                {' · '}
                {application.company_name}
              </p>
            )}
            {application?.reject_reason && (
              <Alert tone="error" className="mt-2">
                <span className="font-medium">
                  {t('dealer_app_rejected_reason')}:
                </span>{' '}
                {application.reject_reason}
              </Alert>
            )}
          </div>
        )}

        {/* Приглашение. У отклонённого заголовок не повторяем — он уже
            стоит выше и говорит о состоянии заявки, а не о
            возможности её подать. */}
        {status !== 'rejected' && (
          <div>
            <p className="font-semibold">{t('dealer_app_title')}</p>
            <p className="mt-1 text-caption text-neutral-60">
              {t('dealer_app_intro')}
            </p>
          </div>
        )}

        {!open ? (
          /* На мобильном кнопка занимает всю ширину карточки: это
             единственное действие блока, и в узкой колонке короткая
             кнопка у левого края читается как случайная. С планшета
             ширина возвращается к содержимому — там она стоит в ряду
             с остальным и растягивать её незачем. Текст внутри и так
             по центру: justify-center лежит в базовых классах Button.
             Кнопки формы ниже ведут себя так же — во flex-col они
             растягиваются по ширине сами. */
          <Button
            variant="secondary"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => setOpen(true)}
          >
            {status === 'rejected'
              ? t('dealer_app_retry')
              : t('dealer_app_open')}
          </Button>
        ) : (
          <div className="space-y-3 border-t border-neutral-10 pt-3">
            {field(t('dealer_app_company'), companyName, setCompanyName, {
              required: true,
              maxLength: MAX_COMPANY,
            })}

            {/* Реквизиты — в одну строку с планшета: оба поля
                короткие и заполняются из одной выписки APR подряд,
                поэтому стоять им следует рядом.
                items-start: под обоими есть подсказка, но у длинного
                названия поля она переносится, и без выравнивания по
                верху сами поля разъехались бы по вертикали. */}
            <div className="grid items-start gap-3 sm:grid-cols-2">
              {field(t('dealer_app_tax_id'), taxId, setTaxId, {
                required: true,
                hint: t('dealer_app_tax_id_hint'),
                // inputMode numeric, но type остаётся text: type=number
                // на идентификаторе даёт стрелки прибавления и теряет
                // ведущий ноль, а номер — не величина.
                inputMode: 'numeric',
                // Больше девяти цифр набрать нельзя: подсказка под
                // полем обещает ровно девять, и поле обязано держать
                // слово, а не принимать лишнее до нажатия «Отправить».
                maxDigits: TAX_ID_DIGITS,
                maxLength: 20,
                placeholder: '123456789',
              })}
              {field(t('dealer_app_reg_num'), regNum, setRegNum, {
                required: true,
                hint: t('dealer_app_reg_num_hint'),
                inputMode: 'numeric',
                maxDigits: REG_NUM_DIGITS,
                maxLength: 20,
                placeholder: '12345678',
              })}
            </div>

            {/* Порядок полей ниже — эталонный: ровно в нём же стоит
                форма на /dealers (DealerForm). Человек, увидевший обе,
                не должен разбираться, чем они отличаются.
                Обязательно всё, кроме сайта: он есть не у каждого
                салона. Требование проверяет сервер (0103), звёздочка
                здесь только называет его заранее. */}
            <div className="grid items-start gap-3 sm:grid-cols-2">
              {/* Город — выбор из списка, как в форме на /dealers и в
                  остальных формах сайта. Свободный ввод давал
                  разнописания одного города («Beograd», «beograd»,
                  «Белград»), и салоны из одного места переставали
                  группироваться при разборе. allowCustom оставлен:
                  справочник покрывает не каждое село. */}
              <ListPicker
                locale={locale}
                name="dealer_app_city"
                placeholder={t('picker_choose')}
                label={`${t('dealer_app_city')} *`}
                options={CITIES.map((c): PickerOption => ({
                  value: c,
                  label: c,
                }))}
                value={city}
                allowCustom
                onChange={(v) => {
                  setCity(v);
                  setError(null);
                }}
              />
              {field(t('dealer_app_person'), person, setPerson, {
                required: true,
                maxLength: 120,
              })}
            </div>

            <div className="grid items-start gap-3 sm:grid-cols-2">
              {/* Маска «+381 6X XXX XXX(X)» — та же, что в подаче
                  объявления, на входе и в форме на /dealers. Номер
                  приводится к единому виду во время набора, а не
                  проверяется после. */}
              {field(t('dealer_app_phone'), phone, setPhone, {
                required: true,
                inputMode: 'tel',
                format: formatSerbianPhone,
                maxLength: 40,
                placeholder: '6X XXX XXX',
                // Каретка — в конец номера: тап в середину кода страны
                // уводил бы туда набранную цифру.
                caret: phoneCaret,
              })}
              {field(t('dealer_app_email'), email, setEmail, {
                required: true,
                inputMode: 'email',
                maxLength: 200,
              })}
            </div>

            {/* Сайт — единственное необязательное поле, поэтому стоит
                один в строке: в паре с обязательным звёздочка у
                соседа читалась бы как относящаяся к обоим. */}
            {field(t('dealer_app_website'), website, setWebsite, {
              inputMode: 'url',
              maxLength: 200,
            })}

            <div>
              <label className="mb-1 block text-caption text-neutral-60">
                {t('dealer_app_comment')}
              </label>
              <textarea
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  setError(null);
                }}
                maxLength={MAX_COMMENT}
                rows={3}
                placeholder={t('dealer_app_comment_ph')}
                className="
                  w-full rounded-control border border-neutral-15 px-3 py-2
                  text-caption outline-none focus:border-neutral-30
                "
              />
            </div>

            <p className="text-small text-neutral-50">
              * {t('dealer_app_required')}
            </p>

            {error && <Alert tone="error">{error}</Alert>}

            {/* Кнопки в обратном порядке на мобильном
                (flex-col-reverse): главное действие оказывается ближе
                к большому пальцу, а «Отмена» — выше. Тот же приём, что
                в диалогах админки. */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                disabled={pending}
              >
                {t('dealer_app_cancel')}
              </Button>
              <Button onClick={submit} disabled={pending}>
                {pending ? t('dealer_app_sending') : t('dealer_app_submit')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
