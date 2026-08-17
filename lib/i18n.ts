// ============================================================
// RS AUTO — Локализация сайта: sr (латиница) и ru.
// ============================================================
// Структура URL:
//   /            и /cars, /car/{id} …  — сербский (основной рынок)
//   /ru/         и /ru/cars, /ru/car/{id} … — русский
// Кириллической версии сербского НЕТ: одна латиница, а двуалфавитность
// решается нормализацией поиска на бэкенде (f_normalize), а не отдельными
// адресами — иначе получили бы дубли страниц с одинаковым содержимым.
// ============================================================

export const LOCALES = ['sr', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

// Сербский — язык по умолчанию, живёт в корне сайта без префикса.
export const DEFAULT_LOCALE: Locale = 'sr';

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

// Префикс пути для локали: у языка по умолчанию его нет.
export function localePrefix(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}

// Сборка внутренней ссылки с учётом локали.
// path всегда начинается со слэша: localeHref('ru', '/cars') → '/ru/cars'.
export function localeHref(locale: Locale, path: string): string {
  const clean = path === '/' ? '' : path;
  return `${localePrefix(locale)}${clean}` || '/';
}

// ------------------------------------------------------------
// Единая точка сборки внутренних адресов.
// ------------------------------------------------------------
// ПРАВИЛО ПРОЕКТА: ни один внутренний переход не собирает путь строкой.
// Любая ссылка, action формы, redirect и router.push обязаны проходить
// через localeHref/localePath — иначе с /ru/* пользователь молча
// проваливается на сербское зеркало (баг «язык сбрасывается»).

// Путь + query с префиксом локали. Отличается от localeHref тем, что
// принимает уже собранную строку запроса: каталог, фильтры и пагинация
// строят query отдельно (lib/searchParams), и склеивать её вручную в
// каждом компоненте — ровно тот источник ошибок, который мы убираем.
export function localePath(
  locale: Locale,
  path: string,
  query = '',
): string {
  return `${localeHref(locale, path)}${query}`;
}

// Снятие префикса локали с пути. Нужно там, где известен лишь полный
// адрес (например, usePathname в клиентских компонентах), а собрать
// ссылку требуется заново — для переключателя языка и hreflang.
export function stripLocale(pathname: string): {
  locale: Locale;
  path: string;
} {
  for (const code of LOCALES) {
    if (code === DEFAULT_LOCALE) continue;
    const prefix = `/${code}`;
    if (pathname === prefix) return { locale: code, path: '/' };
    if (pathname.startsWith(`${prefix}/`)) {
      return { locale: code, path: pathname.slice(prefix.length) };
    }
  }
  return { locale: DEFAULT_LOCALE, path: pathname || '/' };
}

// Имя cookie с выбранным языком. NEXT_LOCALE — конвенция Next.js;
// используем её, чтобы не плодить второе имя под ту же сущность.
export const LOCALE_COOKIE = 'NEXT_LOCALE';

// Срок жизни cookie — год: выбор языка не должен «протухать» между
// визитами, иначе вернувшийся русскоязычный пользователь снова
// попадёт на сербское зеркало.
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Маркер явного выбора языка в адресе. Нужен ровно одному месту —
// ссылке на сербскую версию в переключателе. Сербское зеркало живёт
// в корне без префикса, поэтому без маркера middleware не отличил бы
// «пользователь выбрал сербский» от «пользователь пришёл по старой
// ссылке» и вернул бы его на прежнее зеркало. Маркер снимается тем же
// редиректом и в адресной строке не остаётся.
export const LOCALE_PARAM = 'setlang';

// Ссылка переключателя языка. Для сербского добавляет маркер явного
// выбора, для остальных достаточно префикса пути — по нему middleware
// и запоминает язык.
export function localeSwitchHref(target: Locale, path: string): string {
  const href = localeHref(target, path);
  if (target !== DEFAULT_LOCALE) return href;

  const separator = href.includes('?') ? '&' : '?';
  return `${href}${separator}${LOCALE_PARAM}=${DEFAULT_LOCALE}`;
}

// Языковой тег для атрибута lang и hreflang.
// sr-Latn явно сообщает, что это сербский латиницей, — при одной латинской
// версии это снимает неоднозначность для поисковых систем.
export const HTML_LANG: Record<Locale, string> = {
  sr: 'sr-Latn',
  ru: 'ru',
};

// ------------------------------------------------------------
// Словарь интерфейса.
// ------------------------------------------------------------
// Плоская структура ключей: строки короткие, вложенность усложнила бы
// типизацию без выигрыша.
export const dict = {
  sr: {
    // Навигация и общее
    nav_catalog: 'Automobili',
    nav_sell: 'Prodaj auto',
    nav_dealers: 'Za autosalone',
    nav_app: 'Aplikacija',
    site_tagline: 'Kupovina i prodaja automobila u Srbiji',

    // Каталог
    catalog_title: 'Automobili na prodaju',
    catalog_filters: 'Filteri',
    catalog_sort: 'Sortiranje',
    catalog_reset: 'Poništi filtere',
    catalog_found: 'Pronađeno',
    catalog_apply: 'Prikaži rezultate',
    catalog_page: 'Strana',

    // Фильтры
    filter_brand: 'Marka',
    filter_model: 'Model',
    filter_city: 'Grad',
    filter_year: 'Godište',
    filter_price: 'Cena',
    filter_mileage: 'Kilometraža do',
    filter_body: 'Karoserija',
    filter_transmission: 'Menjač',
    filter_fuel: 'Gorivo',
    filter_from: 'od',
    filter_to: 'do',
    filter_any: 'Sve',
    filter_search: 'Pretraga',
    filter_search_ph: 'Marka, model ili grad',

    // Пустое состояние
    empty_title: 'Nismo pronašli nijedan oglas',
    empty_reason: 'Nijedan automobil ne odgovara zadatim filterima.',
    empty_reset: 'Poništi filtere',
    empty_notify: 'Obavesti me kada se pojavi',
    empty_notify_hint:
      'Sačuvajte pretragu u aplikaciji — poslaćemo obaveštenje čim se pojavi odgovarajući automobil.',

    // Карточка
    car_price_negotiable: 'Cena na upit',
    car_year: 'Godište',
    car_mileage: 'Kilometraža',
    car_body: 'Karoserija',
    car_transmission: 'Menjač',
    car_fuel: 'Gorivo',
    car_city: 'Grad',
    car_description: 'Opis',
    car_specs: 'Karakteristike',
    car_similar: 'Slični automobili',
    car_sold: 'Prodato',
    car_promoted: 'Izdvojeno',
    car_published: 'Objavljeno',
    car_share: 'Podeli',
    car_share_copied: 'Link je kopiran',
    car_seller: 'Prodavac',
    car_seller_dealer: 'Autosalon',
    car_seller_private: 'Privatno lice',
    car_contact_title: 'Kontakt sa prodavcem',
    car_contact_text:
      'Poruke i pozivi dostupni su u aplikaciji RS Auto — tako su vaši podaci zaštićeni.',
    car_open_in_app: 'Nastavi u aplikaciji',
    car_qr_hint: 'Skenirajte kod telefonom da otvorite oglas u aplikaciji',

    // Смарт-баннер
    banner_title: 'RS Auto',
    banner_text: 'Brže u aplikaciji',
    banner_open: 'Otvori',

    // Подача объявления
    sell_title: 'Prodajte automobil',
    sell_subtitle: 'Objavite oglas besplatno — bez instaliranja aplikacije.',
    sell_step: 'Korak',
    sell_next: 'Dalje',
    sell_back: 'Nazad',
    sell_submit: 'Objavi oglas',
    sell_step_car: 'Automobil',
    sell_step_details: 'Detalji',
    sell_step_photos: 'Fotografije',
    sell_step_contact: 'Kontakt',
    sell_phone: 'Broj telefona',
    sell_code: 'Kod iz SMS-a',
    sell_send_code: 'Pošalji kod',
    sell_confirm: 'Potvrdi',
    sell_success_title: 'Oglas je poslat na proveru',
    sell_success_text:
      'Nakon odobrenja moderatora oglas će se pojaviti u katalogu. O rezultatu ćemo vas obavestiti.',

    // Главная
    home_hero_title: 'Prodajte automobil u Srbiji',
    home_hero_text: 'Besplatno objavljivanje. Kupci vas kontaktiraju u aplikaciji.',
    home_hero_cta: 'Objavi oglas',
    home_fresh: 'Novi oglasi',
    home_brands: 'Popularne marke',
    home_all_cars: 'Svi automobili',

    // Дилеры
    dealers_title: 'Za autosalone',
    dealers_offer: 'Prva 3 meseca besplatno',
    dealers_cta: 'Pošalji zahtev',

    // Аренда
    nav_rent: 'Rent-a-car',
    mode_sale: 'Prodaja',
    mode_rent: 'Izdavanje',
    rent_title: 'Automobili za izdavanje',
    rent_per_day: 'dan',
    rent_price: 'Cena po danu',
    rent_deposit: 'Depozit',
    rent_deposit_none: 'Bez depozita',
    rent_terms: 'Uslovi izdavanja',
    rent_terms_text:
      'Depozit se vraća po vraćanju vozila bez oštećenja. Uslove osiguranja, kilometražu i minimalni period zakupa potvrdite sa vlasnikom u aplikaciji.',
    rent_also_sale: 'Ovaj automobil je i na prodaju',
    rent_also_rent: 'Ovaj automobil se može i iznajmiti',
    rent_empty_title: 'Nema automobila za izdavanje',
    rent_min_period: 'Minimalni period zakupa',
    rent_min_period_value: '1 dan',

    // Подача: тип объявления
    sell_type: 'Tip oglasa',
    sell_type_sale: 'Prodajem',
    sell_type_rent: 'Izdajem',
    sell_type_both: 'Prodajem i izdajem',
    sell_sale_price: 'Cena prodaje',
    sell_rent_price: 'Cena po danu',
    sell_deposit: 'Depozit',
    sell_err_rent_price: 'Za izdavanje je obavezna cena po danu.',
    sell_err_price_positive: 'Cena mora biti veća od nule.',
    sell_err_deposit: 'Depozit ne može biti negativan.',

    filter_listing_type: 'Tip oglasa',
    filter_type_all: 'Sve',
    catalog_mixed_title: 'Automobili u Srbiji',
    badge_rent: 'Izdavanje',

    // Пикер (выбор из списка)
    picker_search: 'Pretraga…',
    picker_custom: 'Unesi',
    picker_custom_hint: 'unesi svoje',
    picker_nothing: 'Nema rezultata',
    picker_model_no_brand: 'Prvo izaberite marku',
    picker_model_empty: 'Nema modela za ovu marku',

    // Страница 404
    nf_title: 'Stranica nije pronađena',
    nf_text:
      'Oglas je možda prodat i uklonjen, ili je adresa netačna. Pogledajte druge automobile u katalogu.',
    nf_catalog: 'Idi na katalog',
    nf_home: 'Na početnu',

    // Страница ошибки (500). Текст намеренно не объясняет причину:
    // посетителю нужен выход, а не диагноз. Техническая информация
    // остаётся в логах, в интерфейс не попадает.
    err_title: 'Nešto je pošlo naopako',
    err_text:
      'Stranica trenutno nije dostupna. Pokušajte da je osvežite — ako se greška ponovi, vratite se u katalog.',
    err_retry: 'Pokušaj ponovo',

    // Контакты
    nav_contact: 'Kontakt',
    contact_title: 'Kontakt',
    contact_subtitle:
      'Pišite nam — odgovaramo radnim danima. Za autosalone postoji poseban obrazac.',
    contact_details: 'Podaci o firmi',
    contact_email: 'E-pošta',
    contact_phone: 'Telefon podrške',
    contact_hours: 'Radno vreme',
    contact_hours_value: 'Radnim danima 09.00–17.00',
    contact_address: 'Adresa',
    contact_dealers_hint: 'Vi ste autosalon? Pošaljite zahtev na posebnoj stranici.',

    // Форма обратной связи
    contact_form_title: 'Napišite nam',
    contact_name: 'Ime',
    contact_message: 'Poruka',
    contact_topic: 'Tema',
    contact_topic_general: 'Opšte pitanje',
    contact_topic_ad: 'Pitanje o oglasu',
    contact_topic_abuse: 'Prijava zloupotrebe',
    contact_topic_privacy: 'Lični podaci',
    contact_send: 'Pošalji poruku',
    contact_sent_title: 'Poruka je poslata',
    contact_sent_text: 'Odgovorićemo na navedenu e-poštu u najkraćem roku.',
    contact_err_name: 'Unesite ime.',
    contact_err_email: 'Proverite e-poštu.',
    contact_err_message: 'Napišite poruku (najmanje 10 znakova).',
    contact_err_too_long: 'Neko od polja je predugačko.',
    contact_err_rate: 'Već ste poslali poruku. Pokušajte ponovo sutra.',
    contact_err_unknown: 'Došlo je do greške. Pokušajte ponovo.',

    // Согласие с условиями (перед отправкой SMS) — формулировки
    // приложения (features/legal), перенесённые на сайт.
    legal_terms_title: 'Uslovi korišćenja',
    legal_privacy_title: 'Politika privatnosti',
    legal_updated: 'Ažurirano',
    legal_consent_before:
      'Slanjem koda potvrđujem da imam 18 godina i prihvatam ',
    legal_consent_terms: 'Uslove korišćenja',
    legal_consent_and: ' i ',
    legal_consent_privacy: 'Politiku privatnosti',
    legal_consent_required:
      'Da biste dobili kod, potrebno je prihvatiti uslove i politiku privatnosti.',

    // OTP: повторная отправка и ошибки — тексты из приложения
    // (login_screen.dart), в обеих локалях.
    otp_sent_to: 'Kod smo poslali na broj',
    otp_resend: 'Pošalji ponovo',
    otp_resend_in: 'Pošalji ponovo',
    otp_resent: 'Kod je ponovo poslat',
    otp_change_number: 'Promeni broj',
    otp_sending: 'Šaljemo…',
    otp_verifying: 'Proveravamo kod…',
    otp_err_phone: 'Unesite ispravan broj telefona',
    otp_err_expired: 'Kod je istekao. Zatražite novi',
    otp_err_invalid: 'Pogrešan kod iz SMS-a',
    otp_err_failed: 'Nije uspelo potvrđivanje koda. Pokušajte ponovo',
    otp_err_quota:
      'Prekoračen je dnevni limit SMS poruka za ovaj broj. Pokušajte sutra.',

    // Общее
    common_all: 'Sve',
    common_more: 'Prikaži još',
    common_currency_eur: '€',
    common_km: 'km',
  },

  ru: {
    nav_catalog: 'Автомобили',
    nav_sell: 'Продать авто',
    nav_dealers: 'Автосалонам',
    nav_app: 'Приложение',
    site_tagline: 'Покупка и продажа автомобилей в Сербии',

    catalog_title: 'Автомобили на продажу',
    catalog_filters: 'Фильтры',
    catalog_sort: 'Сортировка',
    catalog_reset: 'Сбросить фильтры',
    catalog_found: 'Найдено',
    catalog_apply: 'Показать результаты',
    catalog_page: 'Страница',

    filter_brand: 'Марка',
    filter_model: 'Модель',
    filter_city: 'Город',
    filter_year: 'Год выпуска',
    filter_price: 'Цена',
    filter_mileage: 'Пробег до',
    filter_body: 'Кузов',
    filter_transmission: 'Коробка',
    filter_fuel: 'Топливо',
    filter_from: 'от',
    filter_to: 'до',
    filter_any: 'Все',
    filter_search: 'Поиск',
    filter_search_ph: 'Марка, модель или город',

    empty_title: 'Ничего не нашли',
    empty_reason: 'Ни один автомобиль не подходит под заданные фильтры.',
    empty_reset: 'Сбросить фильтры',
    empty_notify: 'Сообщить, когда появится',
    empty_notify_hint:
      'Сохраните поиск в приложении — пришлём уведомление, как только появится подходящий автомобиль.',

    car_price_negotiable: 'Цена договорная',
    car_year: 'Год выпуска',
    car_mileage: 'Пробег',
    car_body: 'Кузов',
    car_transmission: 'Коробка',
    car_fuel: 'Топливо',
    car_city: 'Город',
    car_description: 'Описание',
    car_specs: 'Характеристики',
    car_similar: 'Похожие автомобили',
    car_sold: 'Продано',
    car_promoted: 'Продвигается',
    car_published: 'Опубликовано',
    car_share: 'Поделиться',
    car_share_copied: 'Ссылка скопирована',
    car_seller: 'Продавец',
    car_seller_dealer: 'Автосалон',
    car_seller_private: 'Частное лицо',
    car_contact_title: 'Связь с продавцом',
    car_contact_text:
      'Сообщения и звонки доступны в приложении RS Auto — так ваши данные под защитой.',
    car_open_in_app: 'Продолжить в приложении',
    car_qr_hint: 'Отсканируйте код телефоном, чтобы открыть объявление в приложении',

    banner_title: 'RS Auto',
    banner_text: 'Быстрее в приложении',
    banner_open: 'Открыть',

    sell_title: 'Продайте автомобиль',
    sell_subtitle: 'Разместите объявление бесплатно — без установки приложения.',
    sell_step: 'Шаг',
    sell_next: 'Далее',
    sell_back: 'Назад',
    sell_submit: 'Опубликовать объявление',
    sell_step_car: 'Автомобиль',
    sell_step_details: 'Детали',
    sell_step_photos: 'Фотографии',
    sell_step_contact: 'Контакты',
    sell_phone: 'Номер телефона',
    sell_code: 'Код из SMS',
    sell_send_code: 'Отправить код',
    sell_confirm: 'Подтвердить',
    sell_success_title: 'Объявление отправлено на проверку',
    sell_success_text:
      'После одобрения модератором объявление появится в каталоге. О результате сообщим.',

    home_hero_title: 'Продайте автомобиль в Сербии',
    home_hero_text: 'Бесплатное размещение. Покупатели напишут вам в приложении.',
    home_hero_cta: 'Разместить объявление',
    home_fresh: 'Свежие объявления',
    home_brands: 'Популярные марки',
    home_all_cars: 'Все автомобили',

    dealers_title: 'Автосалонам',
    dealers_offer: 'Первые 3 месяца бесплатно',
    dealers_cta: 'Оставить заявку',

    // Аренда
    nav_rent: 'Аренда',
    mode_sale: 'Продажа',
    mode_rent: 'Аренда',
    rent_title: 'Автомобили в аренду',
    rent_per_day: 'сутки',
    rent_price: 'Цена за сутки',
    rent_deposit: 'Залог',
    rent_deposit_none: 'Без залога',
    rent_terms: 'Условия аренды',
    rent_terms_text:
      'Залог возвращается после сдачи автомобиля без повреждений. Условия страховки, лимит пробега и минимальный срок аренды уточните у владельца в приложении.',
    rent_also_sale: 'Этот автомобиль также продаётся',
    rent_also_rent: 'Этот автомобиль также сдаётся в аренду',
    rent_empty_title: 'Нет автомобилей в аренду',
    rent_min_period: 'Минимальный срок аренды',
    rent_min_period_value: '1 сутки',

    // Подача: тип объявления
    sell_type: 'Тип объявления',
    sell_type_sale: 'Продаю',
    sell_type_rent: 'Сдаю',
    sell_type_both: 'Продаю и сдаю',
    sell_sale_price: 'Цена продажи',
    sell_rent_price: 'Цена за сутки',
    sell_deposit: 'Залог',
    sell_err_rent_price: 'Для аренды обязательна цена за сутки.',
    sell_err_price_positive: 'Цена должна быть больше нуля.',
    sell_err_deposit: 'Залог не может быть отрицательным.',

    filter_listing_type: 'Тип объявления',
    filter_type_all: 'Всё',
    catalog_mixed_title: 'Автомобили в Сербии',
    badge_rent: 'Аренда',

    // Пикер (выбор из списка)
    picker_search: 'Поиск…',
    picker_custom: 'Указать',
    picker_custom_hint: 'ввод своего',
    picker_nothing: 'Ничего не найдено',
    picker_model_no_brand: 'Сначала выберите марку',
    picker_model_empty: 'Нет моделей для этой марки',

    // Страница 404
    nf_title: 'Страница не найдена',
    nf_text:
      'Возможно, объявление продано и снято, либо адрес указан неверно. Посмотрите другие автомобили в каталоге.',
    nf_catalog: 'Перейти в каталог',
    nf_home: 'На главную',

    // Страница ошибки (500). Текст намеренно не объясняет причину:
    // посетителю нужен выход, а не диагноз. Техническая информация
    // остаётся в логах, в интерфейс не попадает.
    err_title: 'Что-то пошло не так',
    err_text:
      'Страница сейчас недоступна. Попробуйте обновить её — если ошибка повторится, вернитесь в каталог.',
    err_retry: 'Попробовать снова',

    // Контакты
    nav_contact: 'Контакты',
    contact_title: 'Контакты',
    contact_subtitle:
      'Напишите нам — отвечаем по будням. Для автосалонов есть отдельная форма.',
    contact_details: 'Реквизиты',
    contact_email: 'Электронная почта',
    contact_phone: 'Телефон поддержки',
    contact_hours: 'Часы работы',
    contact_hours_value: 'По будням 09:00–17:00',
    contact_address: 'Адрес',
    contact_dealers_hint:
      'Вы автосалон? Оставьте заявку на отдельной странице.',

    // Форма обратной связи
    contact_form_title: 'Напишите нам',
    contact_name: 'Имя',
    contact_message: 'Сообщение',
    contact_topic: 'Тема',
    contact_topic_general: 'Общий вопрос',
    contact_topic_ad: 'Вопрос по объявлению',
    contact_topic_abuse: 'Жалоба на нарушение',
    contact_topic_privacy: 'Персональные данные',
    contact_send: 'Отправить сообщение',
    contact_sent_title: 'Сообщение отправлено',
    contact_sent_text: 'Ответим на указанную почту в ближайшее время.',
    contact_err_name: 'Укажите имя.',
    contact_err_email: 'Проверьте адрес электронной почты.',
    contact_err_message: 'Напишите сообщение (не короче 10 символов).',
    contact_err_too_long: 'Одно из полей слишком длинное.',
    contact_err_rate: 'Вы уже отправили сообщение. Попробуйте завтра.',
    contact_err_unknown: 'Произошла ошибка. Попробуйте ещё раз.',

    // Согласие с условиями (перед отправкой SMS) — формулировки
    // приложения (features/legal), перенесённые на сайт.
    legal_terms_title: 'Условия использования',
    legal_privacy_title: 'Политика конфиденциальности',
    legal_updated: 'Обновлено',
    legal_consent_before:
      'Отправляя код, подтверждаю, что мне есть 18 лет, и принимаю ',
    legal_consent_terms: 'Условия использования',
    legal_consent_and: ' и ',
    legal_consent_privacy: 'Политику конфиденциальности',
    legal_consent_required:
      'Чтобы получить код, примите условия и политику конфиденциальности.',

    // OTP: повторная отправка и ошибки — тексты из приложения
    // (login_screen.dart), в обеих локалях.
    otp_sent_to: 'Мы отправили код на номер',
    otp_resend: 'Отправить снова',
    otp_resend_in: 'Отправить снова',
    otp_resent: 'Код отправлен повторно',
    otp_change_number: 'Изменить номер',
    otp_sending: 'Отправляем…',
    otp_verifying: 'Проверяем код…',
    otp_err_phone: 'Введите корректный номер телефона',
    otp_err_expired: 'Срок действия кода истёк. Запросите новый',
    otp_err_invalid: 'Неверный код из SMS',
    otp_err_failed: 'Не удалось подтвердить код. Попробуйте ещё раз',
    otp_err_quota:
      'Превышен суточный лимит SMS на этот номер. Попробуйте завтра.',

    common_all: 'Все',
    common_more: 'Показать ещё',
    common_currency_eur: '€',
    common_km: 'км',
  },
} as const;

// Ключ словаря. sr и ru имеют одинаковый набор ключей, поэтому берём из sr.
export type DictKey = keyof typeof dict.sr;

// Переводчик для конкретной локали.
export function getT(locale: Locale) {
  return (key: DictKey): string => dict[locale][key];
}
