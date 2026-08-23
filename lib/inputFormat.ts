// ============================================================
// RS AUTO — Форматирование и валидация числового ввода.
// ============================================================
// ПЕРЕНОС ИЗ ПРИЛОЖЕНИЯ. Правила обязаны совпадать: продавец, подавший
// объявление в приложении и на сайте, должен вводить цену и телефон
// одинаково, а бэкенд получает одни и те же значения.
//
// Источники (D:\Project\Auto.RS):
//   lib/shared/utils/serbian_phone.dart      — SerbianPhoneFormatter,
//                                              serbianPhoneToE164,
//                                              serbianNationalDigits
//   lib/features/listings/screens/
//     create_car_screen.dart                 — _ThousandsFormatter
//
// Общий принцип из приложения: поле хранит и показывает ФОРМАТИРОВАННУЮ
// строку («12 500», «+381 60 123 4567»), а наружу отдаётся чистое число
// или E.164. Разделять эти два представления обязательно — иначе в БД
// уедет строка с пробелами.
// ============================================================

// ------------------------------------------------------------
// Числа с разделителем тысяч (цена, пробег, залог).
// ------------------------------------------------------------
// Перенос _ThousandsFormatter: оставляем только цифры и группируем по
// три справа налево. Разделитель — НЕРАЗРЫВНЫЙ пробел: обычный пробел
// в узком поле переносится, и «12 500» разрывается на две строки.
const THIN_SPACE = '\u00A0';

// Лимиты. Верхние границы намеренно щедрые — это защита от опечатки
// в десять знаков, а не бизнес-ограничение:
//   цена     — 9 999 999 € (дороже легкового автомобиля не бывает);
//   пробег   — 9 999 999 км;
//   залог    — та же граница, что у цены.
export const MAX_PRICE = 9_999_999;
export const MAX_MILEAGE = 9_999_999;

// Форматирование по мере ввода: «12500» → «12 500».
export function formatThousands(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits === '') return '';

  // Ведущие нули убираем: «007» — это 7. Иначе продавец может
  // отправить «0500» и получить цену 500 при видимом «0 500».
  const normalized = digits.replace(/^0+(?=\d)/, '');

  let out = '';
  for (let i = 0; i < normalized.length; i += 1) {
    if (i > 0 && (normalized.length - i) % 3 === 0) out += THIN_SPACE;
    out += normalized[i];
  }
  return out;
}

// Обратное преобразование для отправки на сервер: «12 500» → 12500.
// Пустая строка даёт null, а не 0: ноль в цене БД прочитает как
// «отдаю бесплатно», а в пробеге — как «новая машина».
export function parseThousands(formatted: string): number | null {
  const digits = formatted.replace(/[^0-9]/g, '');
  if (digits === '') return null;
  return Number(digits);
}

// Ввод числа с ограничением сверху. Возвращает готовое к показу
// значение — вызывается прямо в onChange.
export function handleNumberInput(raw: string, max: number): string {
  const value = parseThousands(raw);
  if (value === null) return '';
  // Превышение лимита не обрезаем молча до max, а отбрасываем последнюю
  // введённую цифру: пользователь видит, что поле перестало принимать
  // ввод, вместо того чтобы обнаружить подменённое число.
  if (value > max) return formatThousands(String(Math.floor(value / 10)));
  return formatThousands(String(value));
}

// ------------------------------------------------------------
// Год выпуска.
// ------------------------------------------------------------
// Ровно четыре цифры. Диапазон проверяется отдельно (validateYear),
// потому что «19» в процессе набора — ещё не ошибка.
export function handleYearInput(raw: string): string {
  return raw.replace(/[^0-9]/g, '').slice(0, 4);
}

// Проверка года. Границы те же, что в constraint chk_year таблицы cars:
// от 1900 до следующего года включительно.
export function validateYear(
  value: string,
  min: number,
  max: number,
): boolean {
  if (value.length !== 4) return false;
  const year = Number(value);
  return year >= min && year <= max;
}

// ------------------------------------------------------------
// Сербский телефон. Полный перенос serbian_phone.dart.
// ------------------------------------------------------------
// Национальная часть без кода страны и ведущего нуля: «6XXXXXXXX».
// Отбрасываем 00381 / 381 / ведущий 0, оставляем максимум 9 цифр.
export function serbianNationalDigits(raw: string): string {
  let digits = raw.replace(/[^0-9]/g, '');

  if (digits.startsWith('00381')) {
    digits = digits.slice(5);
  } else if (digits.startsWith('381')) {
    digits = digits.slice(3);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return digits.slice(0, 9);
}

// Стартовое значение поля телефона. Код страны стоит в поле СРАЗУ, а не
// подсказкой в placeholder: в Сербии он один на всех, и заставлять
// набирать его девять раз из десяти — лишняя работа. Пустое поле с
// подсказкой «+381 6X XXX XXX» вдобавок неоднозначно: часть людей
// набирает код страны сама, часть начинает с ведущего нуля.
//
// Экспортируется константой, потому что от неё зависят все три формы
// ввода телефона (вход, подача, заявка дилера) — расходиться им нельзя.
export const SERBIAN_PHONE_PREFIX = '+381 ';

// Маска ввода «+381 6X XXX XXX(X)»: пробелы после 2-й и 5-й цифры
// национальной части. Точная копия SerbianPhoneFormatter.
export function formatSerbianPhone(raw: string): string {
  const digits = serbianNationalDigits(raw);

  if (digits === '') {
    // Национальная часть пуста — оставляем в поле код страны, что бы
    // человек ни стирал. Раньше здесь возвращалась пустая строка (кроме
    // случая, когда набрано ровно «381»), и backspace на первой цифре
    // сносил префикс целиком: поле оказывалось пустым, а следующая
    // введённая цифра трактовалась как начало номера БЕЗ кода страны.
    return SERBIAN_PHONE_PREFIX;
  }

  let out = SERBIAN_PHONE_PREFIX;
  for (let i = 0; i < digits.length; i += 1) {
    if (i === 2 || i === 5) out += ' ';
    out += digits[i];
  }
  return out;
}

// Приведение к E.164 для Supabase Auth: «+3816XXXXXXXX».
// null — номер не похож на сербский мобильный. Требования из приложения:
// 8–9 цифр национальной части, первая цифра 6 (мобильные операторы).
export function serbianPhoneToE164(raw: string): string | null {
  const d = serbianNationalDigits(raw);
  if (d.length < 8 || d.length > 9) return null;
  if (!d.startsWith('6')) return null;
  return `+381${d}`;
}

// Валиден ли номер как сербский мобильный.
export function isValidSerbianPhone(raw: string): boolean {
  return serbianPhoneToE164(raw) !== null;
}
