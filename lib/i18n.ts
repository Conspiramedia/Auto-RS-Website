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
    feed_loading: 'Učitavanje…',

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
    // Подсказка в пустом поле описания. Три ориентира вместо общего
    // «расскажите об автомобиле»: продавец, глядя на пустое поле, чаще
    // всего не знает, с чего начать, и оставляет его пустым.
    car_description_hint: 'Stanje, oprema, istorija…',
    // Пометка у описания: текст написан продавцом и не переводится.
    // В сербской локали не показывается — площадка сербская, и текст
    // на сербском для местного пользователя ожидаем.
    car_description_original: 'na jeziku originala',
    car_specs: 'Karakteristike',
    car_similar: 'Slični automobili',
    car_sold: 'Prodato',
    car_promoted: 'Izdvojeno',
    car_viewed: 'Pregledano',
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
    home_hero_text: 'Besplatno objavljivanje. Kupci vam pišu direktno na sajtu.',
    home_hero_cta: 'Objavi auto',
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

    // ------------------------------------------------------------
    // Kabinet prodavca (/my). Sve stranice su noindex.
    // ------------------------------------------------------------
    // Nazivi sekcija prate ekrane aplikacije (my_cars, chats, profile):
    // dva klijenta — jedan proizvod, pa se i rečnik poklapa.
    my_title: 'Moj nalog',
    my_tab_listings: 'Moji oglasi',
    my_tab_messages: 'Poruke',
    my_tab_notifications: 'Obaveštenja',
    my_tab_profile: 'Profil',
    my_logout: 'Odjavi se',

    // Ulaz u kabinet. Kod se traži samo kada sesije nema: sesija živi
    // između poseta, kao i u aplikaciji.
    my_auth_title: 'Prijavite se',
    my_auth_lead:
      'Unesite broj telefona — poslaćemo vam kod u SMS-u. Isti nalog kao u aplikaciji.',
    my_auth_phone: 'Broj telefona',
    my_auth_code: 'Kod iz SMS-a',
    my_auth_send: 'Pošalji kod',
    my_auth_submit: 'Prijavi se',
    my_auth_checking: 'Proveravamo…',
    // Privremeni tekst sekcija koje stižu u sledećim paketima.
    my_soon: 'Ova sekcija je u pripremi i biće dostupna uskoro.',

    // Statusi oglasa — iste formulacije kao u aplikaciji
    // (app_strings.dart: statusModeration … statusSold).
    my_status_moderation: 'Na proveri',
    my_status_active: 'Objavljeno',
    my_status_archived: 'Arhivirano',
    my_status_rejected: 'Odbijeno',
    my_status_sold: 'Prodato',
    // Razlog odbijanja stiže iz moderation_comment.
    my_rejected_reason: 'Razlog odbijanja',

    // Metrike oglasa.
    my_metric_views: 'Pregledi',
    my_metric_favorites: 'U omiljenim',
    my_metric_contacts: 'Kontakti',

    // Radnje nad oglasom.
    my_action_archive: 'Skloni',
    my_action_restore: 'Vrati',
    my_action_sold: 'Prodato',
    my_action_promote: 'Promoviši',
    // Potvrda u dva koraka: pitanje + Da/Otkaži.
    my_confirm_archive: 'Skloniti oglas sa objave?',
    my_confirm_restore: 'Vratiti oglas u objavu?',
    my_confirm_sold: 'Označiti kao prodato?',
    my_confirm_yes: 'Da',
    my_confirm_no: 'Otkaži',
    my_action_busy: 'Čuvamo…',
    // Promocija je za sada besplatna (activate_promotion, 7 dana).
    my_promoted_until: 'Promoviše se do',
    my_promote_days: 'Besplatno, 7 dana u vrhu pretrage',

    // Zbirna statistika (get_my_stats_totals).
    my_totals_title: 'Ukupno',
    my_totals_listings: 'Oglasi',

    // Prazno stanje.
    my_empty_title: 'Još nemate oglase',
    my_empty_text: 'Postavite prvi oglas — prodaja počinje odavde.',
    my_empty_cta: 'Postavi oglas',

    // Greška radnje.
    my_action_error: 'Nije uspelo. Pokušajte ponovo.',

    // ------------------------------------------------------------
    // Izmena oglasa (/my/listing/[id]/edit).
    // ------------------------------------------------------------
    my_action_edit: 'Izmeni',
    edit_title: 'Izmena oglasa',
    edit_submit: 'Sačuvaj izmene',
    edit_saving: 'Čuvamo…',
    edit_loading: 'Učitavamo oglas…',
    edit_err_load: 'Nije uspelo učitavanje oglasa.',
    // Upozorenje iznad dugmeta: izmena sadržaja vraća oglas na proveru
    // i gasi promociju (migracija 0067).
    edit_moderation_warning:
      'Nakon izmene oglas ponovo ide na proveru, a aktivna promocija se gasi.',
    // Ekran nakon čuvanja.
    edit_done_moderation_title: 'Izmene su sačuvane',
    edit_done_moderation_text:
      'Oglas je poslat na ponovnu proveru i vratiće se u pretragu nakon odobrenja.',
    edit_done_title: 'Izmene su sačuvane',
    edit_done_text: 'Sadržaj oglasa se nije promenio, status je ostao isti.',
    edit_back_to_list: 'Moji oglasi',

    // ------------------------------------------------------------
    // Poruke (/my/messages).
    // ------------------------------------------------------------
    chat_empty_title: 'Još nema razgovora',
    chat_empty_text:
      'Kada vam kupac napiše povodom oglasa, razgovor će se pojaviti ovde.',
    chat_pick: 'Izaberite razgovor',
    chat_back: 'Svi razgovori',
    chat_placeholder: 'Poruka…',
    chat_send: 'Pošalji',
    chat_sending: 'Šaljemo…',
    chat_send_failed: 'Slanje nije uspelo',
    chat_blocked: 'Sagovornik je blokiran. Slanje poruka nije moguće.',
    chat_no_messages: 'Još nema poruka. Napišite prvu.',
    chat_about: 'Oglas',
    chat_today: 'Danas',
    chat_yesterday: 'Juče',
    chat_write: 'Pošalji poruku',

    // ------------------------------------------------------------
    // Obaveštenja (/my/notifications).
    // ------------------------------------------------------------
    // Naslov i tekst svakog obaveštenja dolaze IZ BAZE i pisani su na
    // ruskom: upisuju ih okidači zajednički sa aplikacijom (0024, 0039).
    // Ovde su prevedeni samo okvir ekrana i dugmad — zamena samih
    // tekstova zadire u aplikaciju i radi se posebnim zadatkom.
    notif_title: 'Obaveštenja',
    notif_empty_title: 'Još nema obaveštenja',
    notif_empty_text:
      'Ovde stižu odluke o oglasima i poruke od kupaca.',
    notif_mark_all: 'Označi sve kao pročitano',
    notif_marking: 'Čuvamo…',
    notif_open_listing: 'Otvori oglas',
    notif_open_chat: 'Otvori razgovor',
    notif_unread: 'Novo',
    notif_today: 'Danas',
    notif_yesterday: 'Juče',

    // ------------------------------------------------------------
    // Profil (/my/profile).
    // ------------------------------------------------------------
    profile_title: 'Profil',
    profile_name: 'Ime',
    profile_name_ph: 'Kako da vas oslovimo',
    profile_phone: 'Telefon',
    profile_phone_hint: 'Broj se koristi za prijavu i ne može se promeniti',
    profile_email: 'E-mail',
    // Podnaslov polja e-pošte. Prijava ide preko SMS-a, pa je adresa
    // prazna dok je vlasnik sam ne unese — a bez nje odluka moderacije
    // ne može da stigne nigde osim u kabinet.
    profile_email_hint:
      'Na ovu adresu šaljemo odluku o oglasu. Ostavite prazno ako ne želite e-poštu.',
    profile_email_invalid: 'Proverite adresu e-pošte',
    profile_email_taken: 'Ova adresa se već koristi na drugom nalogu',
    profile_avatar: 'Fotografija',
    profile_avatar_change: 'Promeni',
    profile_seller_kind: 'Tip prodavca',
    profile_private: 'Privatno lice',
    profile_dealer: 'Autosalon',
    profile_company: 'Naziv autosalona',
    profile_company_required: 'Unesite naziv autosalona',
    profile_showcase: 'Moja stranica',
    profile_balance: 'Stanje',
    profile_save: 'Sačuvaj',
    profile_saving: 'Čuvamo…',
    profile_saved: 'Promene su sačuvane',
    profile_error: 'Nije uspelo. Pokušajte ponovo.',
    profile_avatar_error: 'Nije uspelo učitavanje fotografije',

    // Общее
    // ------------------------------------------------------------
    // Навигация по контентным страницам.
    // ------------------------------------------------------------
    nav_about: 'O nama',
    nav_how: 'Kako funkcioniše',
    nav_faq: 'Česta pitanja',
    nav_menu: 'Meni',
    // Вход и кабинет: шапка, бургер, подвал, страница /login.
    nav_login: 'Prijava',
    nav_my: 'Moji oglasi',
    login_title: 'Prijava na nalog',
    nav_menu_close: 'Zatvori meni',
    // Закрытие смарт-баннера. Раньше строка была зашита по-сербски
    // прямо в компоненте и в русской локали читалась как чужая.
    banner_close: 'Zatvori',
    // Общие подписи закрытия для всех оверлеев: шторка фильтров,
    // список выбора, форма подачи, галерея объявления. Раньше в этих
    // местах стоял aria-label="×" — скринридер зачитывал имя символа
    // («знак умножения»), а не действие.
    common_close: 'Zatvori',
    // Возврат с карточки объявления назад к выдаче.
    common_back: 'Nazad',

    // ------------------------------------------------------------
    // /dealers — выгоды для автосалона.
    // ------------------------------------------------------------
    dealers_benefit_1_title: 'Prva 3 meseca besplatno',
    dealers_benefit_1_text:
      'Objavite ceo vozni park bez naknade i procenite rezultat.',
    dealers_benefit_2_title: 'Stranica autosalona',
    dealers_benefit_2_text:
      'Svi vaši automobili na jednom mestu, sa logotipom i nazivom salona.',
    dealers_benefit_3_title: 'Kupci iz cele Srbije',
    dealers_benefit_3_text:
      'Oglasi su vidljivi i na sajtu i u mobilnoj aplikaciji.',

    // Форма заявки автосалона.
    dealers_company: 'Naziv autosalona',
    dealers_contact: 'Kontakt osoba',
    dealers_comment: 'Komentar',
    dealers_sent_title: 'Zahtev je poslat',
    dealers_sent_text: 'Kontaktiraćemo vas u najkraćem roku.',
    dealers_err_company: 'Unesite naziv autosalona.',
    dealers_err_contact: 'Unesite ime kontakt osobe.',
    dealers_err_phone: 'Proverite broj telefona.',
    dealers_err_too_long: 'Neko od polja je predugačko.',
    dealers_err_rate:
      'Već ste poslali zahtev sa ovog broja. Pokušajte ponovo sutra.',
    dealers_err_unknown: 'Došlo je do greške. Pokušajte ponovo.',

    // ------------------------------------------------------------
    // /app — преимущества приложения.
    // ------------------------------------------------------------
    app_feature_1_title: 'Poruke i pozivi',
    app_feature_1_text:
      'Kontaktirajte prodavca direktno — bez deljenja ličnog broja.',
    app_feature_2_title: 'Obaveštenja',
    app_feature_2_text:
      'Sačuvajte pretragu i saznajte prvi kada se pojavi odgovarajući automobil.',
    app_feature_3_title: 'Sniženja cena',
    app_feature_3_text:
      'Obavestićemo vas kada prodavac snizi cenu automobila koji pratite.',

    // ------------------------------------------------------------
    // Страница продавца / автосалона.
    // ------------------------------------------------------------
    dealer_page_since: 'Na platformi od',
    dealer_page_active: 'Aktivnih oglasa',
    dealer_page_sold: 'Prodato',
    dealer_page_listings: 'Oglasi',
    dealer_page_sold_title: 'Nedavno prodato',
    dealer_page_empty_title: 'Nema aktivnih oglasa',
    dealer_page_empty_text:
      'Ovaj prodavac trenutno nema objavljenih automobila. Pogledajte druge oglase u katalogu.',
    dealer_page_meta_desc_prefix: 'Automobili prodavca',

    // ------------------------------------------------------------
    // Недавно просмотренные объявления.
    // ------------------------------------------------------------
    recent_title: 'Nedavno pregledano',
    recent_clear: 'Obriši istoriju',

    // ------------------------------------------------------------
    // Фотографии в форме подачи.
    // ------------------------------------------------------------
    sell_photos_add: 'Dodaj fotografije',
    sell_photos_hint:
      'JPG, PNG ili WebP, do 10 MB. Prva fotografija je naslovna.',
    sell_photos_cover: 'Naslovna',
    sell_photos_move_left: 'Pomeri levo',
    sell_photos_move_right: 'Pomeri desno',
    sell_photos_remove: 'Ukloni fotografiju',
    sell_photos_uploading: 'Otpremanje fotografija',
    sell_err_photos_required: 'Dodajte bar jednu fotografiju automobila.',
    sell_err_photo_type: 'Podržani su samo JPG, PNG i WebP formati.',
    sell_err_photo_size: 'Fotografija je prevelika — najviše 10 MB.',
    sell_err_photos_max: 'Najviše 15 fotografija.',

    // ------------------------------------------------------------
    // /about — о площадке.
    // ------------------------------------------------------------
    about_title: 'O nama',
    about_meta_desc:
      'RS Auto — platforma za kupovinu, prodaju i iznajmljivanje automobila u Srbiji. Oglasi su besplatni, kontakt sa prodavcem ide kroz aplikaciju.',
    about_lead:
      'RS Auto je tržište automobila u Srbiji. Povezujemo one koji prodaju ili iznajmljuju vozilo sa onima koji ga traže — bez posrednika i bez provizije na prodaju.',

    about_mission_title: 'Naša misija',
    about_mission_text:
      'Kupovina polovnog automobila je odluka od nekoliko hiljada evra, a najčešće se donosi na osnovu nepotpunih podataka. Trudimo se da oglas bude jasan: prava cena, stvarna kilometraža, fotografije vozila i grad u kome se nalazi. Što je oglas iskreniji, to je manje izgubljenog vremena na obe strane.',

    about_how_title: 'Kako je platforma uređena',
    about_how_1_title: 'Sajt i aplikacija — jedna baza',
    about_how_1_text:
      'Oglas postavljen na sajtu odmah je vidljiv i u aplikaciji, i obrnuto. Ne postoje dve odvojene ponude.',
    about_how_2_title: 'Provera pre objave',
    about_how_2_text:
      'Svaki oglas prolazi moderaciju. Vozila sa izmenjenim brojem šasije, lažnim cenama i prevarantski sadržaj se ne objavljuju.',
    about_how_3_title: 'Kontakt u aplikaciji',
    about_how_3_text:
      'Poruke i pozivi idu kroz aplikaciju, pa vaš lični broj telefona ne završi u bazama za neželjene pozive.',

    about_buyer_title: 'Za kupca',
    about_buyer_1: 'Pretraga po marki, modelu, godištu, ceni i gradu.',
    about_buyer_2:
      'Sačuvana pretraga sa obaveštenjem čim se pojavi odgovarajuće vozilo.',
    about_buyer_3: 'Obaveštenje kada prodavac snizi cenu praćenog automobila.',
    about_buyer_4: 'Kontakt sa prodavcem bez otkrivanja svog broja telefona.',

    about_seller_title: 'Za prodavca',
    about_seller_1: 'Objavljivanje oglasa je besplatno, bez provizije na prodaju.',
    about_seller_2: 'Oglas se postavlja sa sajta — bez instaliranja aplikacije.',
    about_seller_3: 'Isti oglas vide i posetioci sajta i korisnici aplikacije.',
    about_seller_4: 'Isticanje oglasa je opcija, a ne uslov za objavljivanje.',

    about_dealer_title: 'Za autosalone',
    about_dealer_1: 'Posebna stranica salona sa celim voznim parkom.',
    about_dealer_2: 'Prva 3 meseca bez naknade.',
    about_dealer_3: 'Oznaka „Autosalon“ na svakom oglasu.',
    about_dealer_4: 'Kupci iz cele Srbije, sa sajta i iz aplikacije.',

    about_cta_title: 'Imate automobil za prodaju?',
    about_cta_text: 'Objavite oglas za nekoliko minuta — besplatno.',

    // ------------------------------------------------------------
    // /how-it-works — как это работает.
    // ------------------------------------------------------------
    how_title: 'Kako funkcioniše',
    how_meta_desc:
      'Kako da kupite, prodate ili iznajmite automobil na RS Auto: korak po korak za kupce, prodavce i autosalone.',
    how_lead:
      'Tri scenarija — kupovina, prodaja i rad autosalona. Izaberite svoj i pratite korake.',

    how_buyer_title: 'Kupujem automobil',
    how_buyer_1_title: 'Pronađite vozilo',
    how_buyer_1_text:
      'Otvorite katalog i suzite izbor filterima: marka, model, godište, cena, kilometraža i grad. Rezultat se može podeliti linkom — filteri ostaju sačuvani u adresi.',
    how_buyer_2_title: 'Sačuvajte pretragu',
    how_buyer_2_text:
      'Ako trenutno nema odgovarajućeg vozila, sačuvajte pretragu u aplikaciji. Poslaćemo obaveštenje čim se pojavi automobil koji odgovara vašim uslovima — i kada prodavac snizi cenu.',
    how_buyer_3_title: 'Pišite prodavcu',
    how_buyer_3_text:
      'Poruke i pozivi idu kroz aplikaciju. Vaš broj telefona ostaje skriven, a cela prepiska je na jednom mestu.',

    how_seller_title: 'Prodajem automobil',
    how_seller_1_title: 'Postavite oglas',
    how_seller_1_text:
      'Popunite formu u četiri koraka: vozilo, detalji, fotografije i broj telefona. Broj se potvrđuje SMS kodom — to je istovremeno i vaša prijava, poseban nalog nije potreban.',
    how_seller_2_title: 'Sačekajte proveru',
    how_seller_2_text:
      'Oglas ide na moderaciju. Obično je gotova u toku dana. Nakon odobrenja pojavljuje se u katalogu sajta i u aplikaciji.',
    how_seller_3_title: 'Primajte poruke',
    how_seller_3_text:
      'Zainteresovani kupci pišu vam u aplikaciju, a vi dobijate push obaveštenje. Kada je vozilo prodato, označite oglas kao prodat.',

    how_dealer_title: 'Imam autosalon',
    how_dealer_1_title: 'Pošaljite zahtev',
    how_dealer_1_text:
      'Popunite kratak obrazac na stranici za autosalone: naziv salona, kontakt osoba i telefon. Javljamo se i dogovaramo detalje.',
    how_dealer_2_title: 'Dobijate stranicu salona',
    how_dealer_2_text:
      'Sva vaša vozila na jednom mestu, sa nazivom i logotipom salona. Svaki oglas nosi oznaku „Autosalon“ — kupci vide da imaju posla sa firmom.',
    how_dealer_3_title: 'Prva 3 meseca besplatno',
    how_dealer_3_text:
      'Testirajte platformu bez naknade i procenite rezultat. O uslovima nakon probnog perioda dogovaramo se pojedinačno.',

    how_step: 'Korak',

    // ------------------------------------------------------------
    // /faq — вопросы и ответы.
    // ------------------------------------------------------------
    faq_title: 'Česta pitanja',
    faq_meta_desc:
      'Odgovori na pitanja o objavljivanju oglasa, moderaciji, kontaktu sa prodavcem, iznajmljivanju i uslovima za autosalone na RS Auto.',
    faq_lead: 'Ako ne nađete odgovor, pišite nam preko stranice Kontakt.',
    faq_group_general: 'Opšte',
    faq_group_buyer: 'Za kupce',
    faq_group_seller: 'Za prodavce',
    faq_group_dealer: 'Za autosalone',
    faq_more_title: 'Niste našli odgovor?',
    faq_more_text: 'Pišite nam — odgovaramo radnim danima.',

    // ------------------------------------------------------------
    // Метаданные страниц (title/description для поиска).
    // ------------------------------------------------------------
    meta_home_title: 'Automobili u Srbiji — kupovina, prodaja i izdavanje',
    meta_home_desc:
      'Oglasi za automobile u Srbiji: prodaja i iznajmljivanje. Besplatno objavljivanje oglasa, pretraga po marki, modelu, gradu i ceni.',
    meta_catalog_desc:
      'Automobili u Srbiji: prodaja i izdavanje. Pretraga po marki, modelu, gradu i ceni.',
    meta_rent_desc:
      'Automobili za izdavanje u Srbiji: cena po danu, depozit i uslovi. Pretraga po marki, modelu i gradu.',
    meta_sell_desc:
      'Objavite oglas za prodaju automobila besplatno — bez instaliranja aplikacije. Potvrda broja SMS kodom.',
    meta_dealers_desc:
      'Postavite oglase vašeg autosalona na RS Auto. Prva 3 meseca besplatno.',
    meta_app_desc:
      'Aplikacija RS Auto: poruke sa prodavcem, obaveštenja o novim oglasima i sniženjima cena.',
    meta_contact_desc:
      'Kontaktirajte RS Auto: e-pošta, telefon podrške i obrazac za poruku.',
    meta_terms_desc:
      'Uslovi korišćenja platforme RS Auto — oglasi za prodaju i izdavanje automobila u Srbiji.',
    meta_privacy_desc:
      'Politika privatnosti RS Auto — kako obrađujemo i štitimo lične podatke korisnika.',

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
    feed_loading: 'Загружаем…',

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
    car_description_hint: 'Состояние, комплектация, история…',
    car_description_original: 'на языке оригинала',
    car_specs: 'Характеристики',
    car_similar: 'Похожие автомобили',
    car_sold: 'Продано',
    car_promoted: 'Продвигается',
    car_viewed: 'Просмотрено',
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
    home_hero_text: 'Бесплатное размещение. Покупатели напишут вам прямо на сайте.',
    home_hero_cta: 'Разместить авто',
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

    // ------------------------------------------------------------
    // Кабинет продавца (/my). Все страницы — noindex.
    // ------------------------------------------------------------
    // Названия разделов повторяют экраны приложения (my_cars, chats,
    // profile): два клиента — один продукт, поэтому и словарь совпадает.
    my_title: 'Мой кабинет',
    my_tab_listings: 'Мои объявления',
    my_tab_messages: 'Сообщения',
    my_tab_notifications: 'Уведомления',
    my_tab_profile: 'Профиль',
    my_logout: 'Выйти',

    // Вход в кабинет. Код запрашивается только когда сессии нет: она
    // живёт между визитами, как и в приложении.
    my_auth_title: 'Вход',
    my_auth_lead:
      'Введите номер телефона — пришлём код в SMS. Аккаунт тот же, что в приложении.',
    my_auth_phone: 'Номер телефона',
    my_auth_code: 'Код из SMS',
    my_auth_send: 'Получить код',
    my_auth_submit: 'Войти',
    my_auth_checking: 'Проверяем…',
    // Временный текст разделов, которые приходят в следующих пакетах.
    my_soon: 'Раздел готовится и появится в ближайшее время.',

    // Статусы объявления — те же формулировки, что в приложении
    // (app_strings.dart: statusModeration … statusSold).
    my_status_moderation: 'На проверке',
    my_status_active: 'Опубликовано',
    my_status_archived: 'В архиве',
    my_status_rejected: 'Отклонено',
    my_status_sold: 'Продано',
    // Причина отклонения приходит из moderation_comment.
    my_rejected_reason: 'Причина отклонения',

    // Метрики объявления.
    my_metric_views: 'Просмотры',
    my_metric_favorites: 'В избранном',
    my_metric_contacts: 'Контакты',

    // Действия над объявлением.
    my_action_archive: 'Снять',
    my_action_restore: 'Вернуть',
    my_action_sold: 'Продано',
    my_action_promote: 'Продвинуть',
    // Подтверждение в два шага: вопрос + Да/Отмена.
    my_confirm_archive: 'Снять объявление с публикации?',
    my_confirm_restore: 'Вернуть объявление в публикацию?',
    my_confirm_sold: 'Отметить проданным?',
    my_confirm_yes: 'Да',
    my_confirm_no: 'Отмена',
    my_action_busy: 'Сохраняем…',
    // Продвижение пока бесплатное (activate_promotion, 7 дней).
    my_promoted_until: 'Продвигается до',
    my_promote_days: 'Бесплатно, 7 дней в начале выдачи',

    // Сводная статистика (get_my_stats_totals).
    my_totals_title: 'Всего',
    my_totals_listings: 'Объявления',

    // Пустое состояние.
    my_empty_title: 'У вас пока нет объявлений',
    my_empty_text: 'Разместите первое — продажа начинается отсюда.',
    my_empty_cta: 'Подать объявление',

    // Ошибка действия.
    my_action_error: 'Не удалось. Попробуйте ещё раз.',

    // ------------------------------------------------------------
    // Редактирование объявления (/my/listing/[id]/edit).
    // ------------------------------------------------------------
    my_action_edit: 'Редактировать',
    edit_title: 'Редактирование объявления',
    edit_submit: 'Сохранить изменения',
    edit_saving: 'Сохраняем…',
    edit_loading: 'Загружаем объявление…',
    edit_err_load: 'Не удалось загрузить объявление.',
    // Предупреждение над кнопкой: правка контента возвращает объявление
    // на проверку и гасит продвижение (миграция 0067).
    edit_moderation_warning:
      'После изменений объявление снова уйдёт на проверку, а активное продвижение погаснет.',
    // Экран после сохранения.
    edit_done_moderation_title: 'Изменения сохранены',
    edit_done_moderation_text:
      'Объявление отправлено на повторную проверку и вернётся в выдачу после одобрения.',
    edit_done_title: 'Изменения сохранены',
    edit_done_text: 'Содержимое объявления не изменилось, статус остался прежним.',
    edit_back_to_list: 'Мои объявления',

    // ------------------------------------------------------------
    // Сообщения (/my/messages).
    // ------------------------------------------------------------
    chat_empty_title: 'Диалогов пока нет',
    chat_empty_text:
      'Когда покупатель напишет вам по объявлению, диалог появится здесь.',
    chat_pick: 'Выберите диалог',
    chat_back: 'Все диалоги',
    chat_placeholder: 'Сообщение…',
    chat_send: 'Отправить',
    chat_sending: 'Отправляем…',
    chat_send_failed: 'Не удалось отправить',
    chat_blocked: 'Собеседник заблокирован. Отправка сообщений недоступна.',
    chat_no_messages: 'Сообщений пока нет. Напишите первое.',
    chat_about: 'Объявление',
    chat_today: 'Сегодня',
    chat_yesterday: 'Вчера',
    chat_write: 'Написать сообщение',

    // ------------------------------------------------------------
    // Уведомления (/my/notifications).
    // ------------------------------------------------------------
    // Заголовок и текст каждого уведомления приходят ИЗ БАЗЫ и написаны
    // по-русски: их пишут триггеры, общие с приложением (0024, 0039).
    // Здесь переведён только каркас экрана и кнопки — подмена самих
    // текстов затрагивает приложение и делается отдельной задачей.
    notif_title: 'Уведомления',
    notif_empty_title: 'Уведомлений пока нет',
    notif_empty_text:
      'Сюда приходят решения по объявлениям и сообщения от покупателей.',
    notif_mark_all: 'Отметить все прочитанными',
    notif_marking: 'Сохраняем…',
    notif_open_listing: 'Открыть объявление',
    notif_open_chat: 'Открыть диалог',
    notif_unread: 'Новое',
    notif_today: 'Сегодня',
    notif_yesterday: 'Вчера',

    // ------------------------------------------------------------
    // Профиль (/my/profile).
    // ------------------------------------------------------------
    profile_title: 'Профиль',
    profile_name: 'Имя',
    profile_name_ph: 'Как к вам обращаться',
    profile_phone: 'Телефон',
    profile_phone_hint: 'Номер используется для входа и не меняется',
    profile_email: 'E-mail',
    // Подпись под полем почты. Вход идёт по SMS, поэтому адрес пуст,
    // пока владелец не укажет его сам, — а без адреса решение
    // модерации некуда отправить, кроме кабинета.
    profile_email_hint:
      'На этот адрес приходит решение по объявлению. Оставьте пустым, если письма не нужны.',
    profile_email_invalid: 'Проверьте адрес электронной почты',
    profile_email_taken: 'Эта почта уже используется другим аккаунтом',
    profile_avatar: 'Фотография',
    profile_avatar_change: 'Изменить',
    profile_seller_kind: 'Тип продавца',
    profile_private: 'Частное лицо',
    profile_dealer: 'Автосалон',
    profile_company: 'Название автосалона',
    profile_company_required: 'Укажите название автосалона',
    profile_showcase: 'Моя витрина',
    profile_balance: 'Баланс',
    profile_save: 'Сохранить',
    profile_saving: 'Сохраняем…',
    profile_saved: 'Изменения сохранены',
    profile_error: 'Не удалось. Попробуйте ещё раз.',
    profile_avatar_error: 'Не удалось загрузить фотографию',

    // ------------------------------------------------------------
    // Навигация по контентным страницам.
    // ------------------------------------------------------------
    nav_about: 'О нас',
    nav_how: 'Как это работает',
    nav_faq: 'Вопросы',
    nav_menu: 'Меню',
    // Вход и кабинет: шапка, бургер, подвал, страница /login.
    nav_login: 'Войти',
    nav_my: 'Мои объявления',
    login_title: 'Вход в кабинет',
    nav_menu_close: 'Закрыть меню',
    banner_close: 'Закрыть',
    common_close: 'Закрыть',
    common_back: 'Назад',

    // ------------------------------------------------------------
    // /dealers — выгоды для автосалона.
    // ------------------------------------------------------------
    dealers_benefit_1_title: 'Первые 3 месяца бесплатно',
    dealers_benefit_1_text:
      'Разместите весь автопарк без оплаты и оцените результат.',
    dealers_benefit_2_title: 'Страница автосалона',
    dealers_benefit_2_text:
      'Все ваши автомобили в одном месте, с логотипом и названием салона.',
    dealers_benefit_3_title: 'Покупатели со всей Сербии',
    dealers_benefit_3_text:
      'Объявления видны и на сайте, и в мобильном приложении.',

    // Форма заявки автосалона.
    dealers_company: 'Название автосалона',
    dealers_contact: 'Контактное лицо',
    dealers_comment: 'Комментарий',
    dealers_sent_title: 'Заявка отправлена',
    dealers_sent_text: 'Свяжемся с вами в ближайшее время.',
    dealers_err_company: 'Укажите название автосалона.',
    dealers_err_contact: 'Укажите имя контактного лица.',
    dealers_err_phone: 'Проверьте номер телефона.',
    dealers_err_too_long: 'Одно из полей слишком длинное.',
    dealers_err_rate: 'С этого номера заявка уже отправлена. Попробуйте завтра.',
    dealers_err_unknown: 'Произошла ошибка. Попробуйте ещё раз.',

    // ------------------------------------------------------------
    // /app — преимущества приложения.
    // ------------------------------------------------------------
    app_feature_1_title: 'Сообщения и звонки',
    app_feature_1_text:
      'Свяжитесь с продавцом напрямую — не раскрывая личный номер.',
    app_feature_2_title: 'Уведомления',
    app_feature_2_text:
      'Сохраните поиск и узнайте первым, когда появится подходящий автомобиль.',
    app_feature_3_title: 'Снижение цены',
    app_feature_3_text:
      'Сообщим, когда продавец снизит цену на отслеживаемый автомобиль.',

    // ------------------------------------------------------------
    // Страница продавца / автосалона.
    // ------------------------------------------------------------
    dealer_page_since: 'На площадке с',
    dealer_page_active: 'Активных объявлений',
    dealer_page_sold: 'Продано',
    dealer_page_listings: 'Объявления',
    dealer_page_sold_title: 'Недавно продано',
    dealer_page_empty_title: 'Нет активных объявлений',
    dealer_page_empty_text:
      'У этого продавца сейчас нет опубликованных автомобилей. Посмотрите другие объявления в каталоге.',
    dealer_page_meta_desc_prefix: 'Автомобили продавца',

    // ------------------------------------------------------------
    // Недавно просмотренные объявления.
    // ------------------------------------------------------------
    recent_title: 'Недавно просмотренные',
    recent_clear: 'Очистить историю',

    // ------------------------------------------------------------
    // Фотографии в форме подачи.
    // ------------------------------------------------------------
    sell_photos_add: 'Добавить фотографии',
    sell_photos_hint:
      'JPG, PNG или WebP, до 10 МБ. Первая фотография — главная.',
    sell_photos_cover: 'Главная',
    sell_photos_move_left: 'Сдвинуть влево',
    sell_photos_move_right: 'Сдвинуть вправо',
    sell_photos_remove: 'Удалить фотографию',
    sell_photos_uploading: 'Загрузка фотографий',
    sell_err_photos_required: 'Добавьте хотя бы одну фотографию автомобиля.',
    sell_err_photo_type: 'Поддерживаются только форматы JPG, PNG и WebP.',
    sell_err_photo_size: 'Фотография слишком большая — не больше 10 МБ.',
    sell_err_photos_max: 'Не больше 15 фотографий.',

    // ------------------------------------------------------------
    // /about — о площадке.
    // ------------------------------------------------------------
    about_title: 'О нас',
    about_meta_desc:
      'RS Auto — площадка для покупки, продажи и аренды автомобилей в Сербии. Объявления бесплатны, связь с продавцом — через приложение.',
    about_lead:
      'RS Auto — автомобильный маркетплейс в Сербии. Мы соединяем тех, кто продаёт или сдаёт машину, с теми, кто её ищет, — без посредников и без комиссии с продажи.',

    about_mission_title: 'Наша задача',
    about_mission_text:
      'Покупка подержанного автомобиля — решение на несколько тысяч евро, а принимается оно чаще всего по неполным данным. Мы добиваемся, чтобы объявление отвечало на главные вопросы сразу: настоящая цена, реальный пробег, фотографии машины и город, где она стоит. Чем честнее объявление, тем меньше потерянного времени у обеих сторон.',

    about_how_title: 'Как устроена площадка',
    about_how_1_title: 'Сайт и приложение — одна база',
    about_how_1_text:
      'Объявление, поданное на сайте, сразу видно в приложении, и наоборот. Двух разных витрин не существует.',
    about_how_2_title: 'Проверка до публикации',
    about_how_2_text:
      'Каждое объявление проходит модерацию. Машины с перебитыми номерами, выдуманными ценами и мошеннические тексты до каталога не доходят.',
    about_how_3_title: 'Связь — в приложении',
    about_how_3_text:
      'Сообщения и звонки идут через приложение, поэтому личный номер телефона не попадает в базы для спам-обзвона.',

    about_buyer_title: 'Покупателю',
    about_buyer_1: 'Поиск по марке, модели, году, цене и городу.',
    about_buyer_2:
      'Сохранённый поиск с уведомлением, как только появится подходящая машина.',
    about_buyer_3: 'Уведомление, когда продавец снизит цену на отслеживаемый автомобиль.',
    about_buyer_4: 'Связь с продавцом без раскрытия своего номера телефона.',

    about_seller_title: 'Продавцу',
    about_seller_1: 'Размещение объявления бесплатно, комиссии с продажи нет.',
    about_seller_2: 'Объявление подаётся с сайта — без установки приложения.',
    about_seller_3: 'Одно и то же объявление видят и посетители сайта, и пользователи приложения.',
    about_seller_4: 'Продвижение — возможность, а не условие публикации.',

    about_dealer_title: 'Автосалонам',
    about_dealer_1: 'Отдельная страница салона со всем автопарком.',
    about_dealer_2: 'Первые 3 месяца без оплаты.',
    about_dealer_3: 'Пометка «Автосалон» на каждом объявлении.',
    about_dealer_4: 'Покупатели со всей Сербии — с сайта и из приложения.',

    about_cta_title: 'Есть автомобиль на продажу?',
    about_cta_text: 'Разместите объявление за несколько минут — бесплатно.',

    // ------------------------------------------------------------
    // /how-it-works — как это работает.
    // ------------------------------------------------------------
    how_title: 'Как это работает',
    how_meta_desc:
      'Как купить, продать или сдать автомобиль на RS Auto: пошагово для покупателей, продавцов и автосалонов.',
    how_lead:
      'Три сценария — покупка, продажа и работа автосалона. Выберите свой и следуйте шагам.',

    how_buyer_title: 'Покупаю автомобиль',
    how_buyer_1_title: 'Найдите машину',
    how_buyer_1_text:
      'Откройте каталог и сузьте выбор фильтрами: марка, модель, год, цена, пробег и город. Результатом можно поделиться ссылкой — фильтры сохраняются в адресе.',
    how_buyer_2_title: 'Сохраните поиск',
    how_buyer_2_text:
      'Если подходящей машины сейчас нет, сохраните поиск в приложении. Пришлём уведомление, как только появится автомобиль под ваши условия, — и когда продавец снизит цену.',
    how_buyer_3_title: 'Напишите продавцу',
    how_buyer_3_text:
      'Сообщения и звонки идут через приложение. Ваш номер телефона остаётся скрытым, а вся переписка — в одном месте.',

    how_seller_title: 'Продаю автомобиль',
    how_seller_1_title: 'Подайте объявление',
    how_seller_1_text:
      'Заполните форму из четырёх шагов: автомобиль, детали, фотографии и телефон. Номер подтверждается кодом из SMS — это же и есть вход, отдельная регистрация не нужна.',
    how_seller_2_title: 'Дождитесь проверки',
    how_seller_2_text:
      'Объявление уходит на модерацию. Обычно она занимает до суток. После одобрения объявление появляется в каталоге сайта и в приложении.',
    how_seller_3_title: 'Получайте сообщения',
    how_seller_3_text:
      'Заинтересованные покупатели пишут вам в приложение, а вы получаете push-уведомление. Когда машина продана, отметьте объявление как проданное.',

    how_dealer_title: 'У меня автосалон',
    how_dealer_1_title: 'Оставьте заявку',
    how_dealer_1_text:
      'Заполните короткую форму на странице для автосалонов: название салона, контактное лицо и телефон. Мы свяжемся и обсудим детали.',
    how_dealer_2_title: 'Получаете страницу салона',
    how_dealer_2_text:
      'Все ваши машины в одном месте, с названием и логотипом салона. На каждом объявлении — пометка «Автосалон»: покупатели видят, что имеют дело с компанией.',
    how_dealer_3_title: 'Первые 3 месяца бесплатно',
    how_dealer_3_text:
      'Попробуйте площадку без оплаты и оцените результат. Условия после пробного периода обсуждаем индивидуально.',

    how_step: 'Шаг',

    // ------------------------------------------------------------
    // /faq — вопросы и ответы.
    // ------------------------------------------------------------
    faq_title: 'Вопросы и ответы',
    faq_meta_desc:
      'Ответы на вопросы о размещении объявлений, модерации, связи с продавцом, аренде и условиях для автосалонов на RS Auto.',
    faq_lead: 'Не нашли ответа — напишите нам через страницу «Контакты».',
    faq_group_general: 'Общее',
    faq_group_buyer: 'Покупателям',
    faq_group_seller: 'Продавцам',
    faq_group_dealer: 'Автосалонам',
    faq_more_title: 'Не нашли ответ?',
    faq_more_text: 'Напишите нам — отвечаем по будням.',

    // ------------------------------------------------------------
    // Метаданные страниц (title/description для поиска).
    // ------------------------------------------------------------
    meta_home_title: 'Автомобили в Сербии — покупка, продажа и аренда',
    meta_home_desc:
      'Объявления об автомобилях в Сербии: продажа и аренда. Бесплатное размещение объявлений, поиск по марке, модели, городу и цене.',
    meta_catalog_desc:
      'Автомобили в Сербии: продажа и аренда. Поиск по марке, модели, городу и цене.',
    meta_rent_desc:
      'Автомобили в аренду в Сербии: цена за сутки, залог и условия. Поиск по марке, модели и городу.',
    meta_sell_desc:
      'Разместите объявление о продаже автомобиля бесплатно — без установки приложения. Подтверждение номера кодом из SMS.',
    meta_dealers_desc:
      'Размещайте объявления вашего автосалона на RS Auto. Первые 3 месяца бесплатно.',
    meta_app_desc:
      'Приложение RS Auto: переписка с продавцом, уведомления о новых объявлениях и снижении цен.',
    meta_contact_desc:
      'Свяжитесь с RS Auto: электронная почта, телефон поддержки и форма обращения.',
    meta_terms_desc:
      'Условия использования платформы RS Auto — объявления о продаже и аренде автомобилей в Сербии.',
    meta_privacy_desc:
      'Политика конфиденциальности RS Auto — как мы обрабатываем и защищаем персональные данные пользователей.',

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

// Тип функции перевода. Нужен там, где переводчик передаётся аргументом
// в общий модуль (lib/otp.ts) — иначе такой модуль пришлось бы делать
// зависимым от локали или дублировать тексты.
export type Translate = ReturnType<typeof getT>;
