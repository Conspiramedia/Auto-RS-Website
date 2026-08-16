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
    catalog_found: 'Pronađeno oglasa',
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
    catalog_found: 'Найдено объявлений',
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
