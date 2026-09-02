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
// Ссылка с учётом ОДНОЯЗЫЧНЫХ разделов.
// ------------------------------------------------------------
// Админка (/admin) живёт вне языковой машинерии: раздел только
// русский, зеркала /ru/admin не существует, и proxy.ts исключает его
// из локального редиректа.
//
// Отсюда проблема, которую решает эта функция: страница входа
// принимает ?redirect= и после успешного входа зовёт
// localeHref(locale, target). Для модератора с русской cookie это
// превращало /admin в /ru/admin — то есть в 404 сразу после
// правильно введённого кода из SMS. Ошибка выглядела бы как «админка
// не пускает», хотя вход прошёл.
//
// Проверяем префиксом, а не точным равенством: под /admin лежат
// /admin/queue, /admin/listings и остальные разделы, и все они
// одноязычные по той же причине.
export function localeAwareHref(locale: Locale, path: string): string {
  if (path === '/admin' || path.startsWith('/admin/')) return path;
  return localeHref(locale, path);
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
    //
    // ДВА КЛЮЧА НА ОДИН РАЗДЕЛ /cars — намеренно, у них разные роли:
    //   nav_catalog — НАЗВАНИЕ РАЗДЕЛА: хлебные крошки и JSON-LD
    //     («Automobili / BMW»). Здесь нужно имя того, что внутри;
    //     «Prodaja / BMW» в крошке читается как обрывок фразы, а в
    //     разметке для поисковика хуже описывает содержимое страницы.
    //   nav_catalog_menu — ПУНКТ МЕНЮ рядом с «Аренда». Там это выбор
    //     вида сделки, и пара «Prodaja / Iznajmljivanje» противопостав-
    //     ляется явно, тогда как «Automobili / Iznajmljivanje» выглядит
    //     как разные основания деления: в аренде тоже автомобили.
    nav_catalog: 'Automobili',
    nav_catalog_menu: 'Prodaja',
    // Корень хлебных крошек. Используется ТОЛЬКО в JSON-LD
    // BreadcrumbList: в видимой навигации ссылка на главную — это
    // логотип в шапке, и дублировать её текстом незачем. Google
    // считает цепочку от главной полной, а начатую с раздела —
    // обрезанной: без первого звена он не понимает, что /cars/bmw
    // лежит внутри сайта, а не является отдельной точкой входа.
    nav_home: 'Početna',
    // Пункт меню и подпись витрины /all — смешанной выдачи «продажа
    // и аренда вместе». В сегменте типа то же состояние называется
    // короче (filter_type_all, «Sve»): там рядом стоят «Prodaja» и
    // «Izdavanje», и слово «automobili» повторялось бы трижды.
    nav_all_cars: 'Svi automobili',
    nav_sell: 'Prodaj auto',
    // Дательный падеж, не именительный: /dealers — предложение
    // салонам с формой заявки, а НЕ каталог салонов. «Autosaloni»
    // обещало список компаний, которого на странице нет.
    nav_dealers: 'Autosalonima',
    nav_install: 'Brzi pristup',
    // «Поделиться» в меню. share_text — подпись, с которой ссылка
    // уходит в мессенджер; она же становится текстом сообщения, если
    // получатель откроет его до подгрузки превью.
    nav_share: 'Podeli sajt',
    share_text: 'RS Auto — prodaja i iznajmljivanje automobila u Srbiji',
    // Запасной путь, когда системного меню шаринга нет (десктоп без
    // Web Share API): ссылку кладём в буфер и говорим об этом.
    share_copied: 'Link je kopiran',
    site_tagline: 'Prodaja i iznajmljivanje automobila u Srbiji',

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
    empty_notify_hint:
      'Sačuvajte link ove pretrage — filteri ostaju u adresi, pa novu ponudu proveravate u jednom kliku.',

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

    // Oglas povučen sa objave. Stranica se prikazuje umesto gole 404
    // kada je oglas arhiviran, odbijen ili vraćen na proveru: link iz
    // Google pretrage mora da vodi negde, a ne u prazno.
    // Formulacija namerno ne otkriva RAZLOG: posetiocu je svejedno da
    // li je oglas arhiviran ili odbijen na moderaciji, a druga
    // varijanta bi odala odluku moderatora trećem licu.
    car_gone_title: 'Oglas nije dostupan',
    car_gone_text:
      'Ovaj oglas je povučen sa objave ili je na proveri. Možda je automobil već prodat.',
    car_gone_similar: 'Pogledajte slične automobile',
    car_gone_badge: 'Nije dostupno',
    car_promoted: 'Izdvojeno',
    car_viewed: 'Pregledano',
    car_published: 'Objavljeno',
    car_share: 'Podeli',
    car_share_copied: 'Link je kopiran',
    car_seller: 'Prodavac',
    car_seller_dealer: 'Autosalon',
    car_seller_private: 'Privatno lice',
    car_contact_title: 'Kontakt sa prodavcem',
    car_qr_hint: 'Skenirajte kod telefonom da otvorite oglas na telefonu',
    // Подпись под QR на главной. Код ведёт в КАТАЛОГ, а не на главную:
    // читатель уже понял, что за площадка, и открывать ему на телефоне
    // тот же экран незачем.
    home_qr_hint: 'Skenirajte kod da otvorite katalog na telefonu',


    // Подача объявления
    sell_title: 'Prodajte automobil',
    sell_subtitle: 'Objavite oglas besplatno — direktno sa sajta, za nekoliko minuta.',
    sell_step: 'Korak',
    sell_next: 'Dalje',
    sell_back: 'Nazad',
    sell_submit: 'Objavi oglas',
    sell_step_car: 'Automobil',
    sell_step_details: 'Detalji',
    sell_step_photos: 'Fotografije',
    sell_step_contact: 'Kontakt',

    // Upozorenje o sopstvenom sličnom oglasu (nivo 1 zaštite od
    // duplikata). Ovo je UPOZORENJE, ne zabrana: prodavac sme da
    // nastavi. Naziv automobila se dodaje zasebno u JSX — rečnik nema
    // interpolaciju.
    sell_dup_title: 'Već imate oglas za ovaj automobil',
    sell_dup_open: 'Otvori postojeći oglas',
    sell_dup_ignore: 'Ipak objavi novi',
    sell_dup_moderation: 'na proveri',
    sell_phone: 'Broj telefona',
    // Сверка номера перед публикацией. Кодом телефон больше не
    // подтверждается, и это единственная проверка перед тем, как он
    // уйдёт в объявление: опечатку заметит только сам продавец.
    sell_phone_confirm_title: 'Proverite broj telefona',
    sell_phone_confirm_text:
      'Kupci će zvati na ovaj broj. Proverite da li je tačan — kasnije ga menjate u oglasu.',
    sell_phone_confirm_edit: 'Izmeni',
    sell_phone_confirm_ok: 'Tačno',
    // Подпись под полем почты в форме подачи. Объясняет разницу между
    // двумя контактами на одном экране: телефон видит покупатель,
    // почту не видит никто — она нужна только для входа.
    sell_email_hint: 'Na ovu adresu šaljemo kod za prijavu. Kupci je ne vide.',
    sell_code: 'Kod iz e-pošte',
    sell_send_code: 'Pošalji kod',
    sell_confirm: 'Potvrdi',
    sell_success_title: 'Oglas je poslat na proveru',
    sell_success_text:
      'Nakon odobrenja moderatora oglas će se pojaviti u katalogu. O rezultatu ćemo vas obavestiti.',

    // Главная
    home_hero_title: 'Prodaja i iznajmljivanje automobila u Srbiji',
    home_hero_text: 'Besplatno objavljivanje. Kupci vam pišu direktno na sajtu.',
    home_hero_cta: 'Objavi auto',
    home_fresh: 'Novi oglasi',
    home_brands: 'Popularne marke',
    // SEO-абзац под чипсами марок. Перечисляет те же восемь марок
    // словами: поисковику нужен связный текст, а не только ссылки,
    // и человеку он объясняет, что за списком стоит.
    home_brands_text:
      'Najtraženije marke automobila na tržištu Srbije. Na RS Auto pronađite oglase za polovne i nove automobile privatnih prodavaca i salona: Volkswagen, BMW, Audi, Mercedes-Benz, Škoda, Opel, Renault i Fiat. Izaberite marku — katalog prikazuje aktuelne oglase sa cenom, fotografijama i kontaktom prodavca.',
    home_all_cars: 'Svi automobili',
    // Призыв под блоком «Zašto RS Auto». Отдельный ключ, а не
    // home_hero_cta: там короткое «Objavi auto» рядом со второй
    // кнопкой, здесь кнопка одна и может позволить себе полную форму.
    home_why_cta: 'Postavi oglas',
    // Призыв в карточке «Budite prvi prodavac». Называет бесплатность
    // прямо: карточка зовёт первых продавцов на пустой каталог, и
    // отсутствие платы — главный довод согласиться.
    home_sell_free_cta: 'Objavite besplatno',

    // «Zašto RS Auto» — четыре причины. Про рекламу говорим как о работе
    // в процессе, без дат и обещаний охвата.
    home_why_title: 'Zašto RS Auto',
    home_why_free_title: 'Besplatno objavljivanje',
    home_why_free_text:
      'Objavljivanje i kontakt sa kupcima ne naplaćujemo. Bez provizije od prodaje.',
    home_why_audience_title: 'Dve publike odjednom',
    home_why_audience_text:
      'Srpski i ruski u jednom oglasu — prevod interfejsa radi sajt, vi pišete na svom jeziku.',
    home_why_direct_title: 'Direktan kontakt',
    home_why_direct_text:
      'Kupac piše ili zove vas lično. Bez posrednika i bez provizije od prodaje.',
    home_why_growth_title: 'Pripremamo oglašavanje',
    home_why_growth_text:
      'Platforma se pokreće — radimo na dovođenju kupaca. Rani oglasi startuju bez konkurencije.',

    // Пустая витрина свежих объявлений: платформа запускается, объявлений
    // ещё нет. Не «ništa nije pronađeno» (это про сбой поиска), а
    // приглашение стать первым.
    home_fresh_empty_title: 'Budite prvi prodavac',
    // Про рекламу — «pripremamo» (готовим), без сроков и без цифр охвата:
    // это факт о нашей работе, а не обещание трафика тому, кто на него
    // рассчитывает, размещая автомобиль. Ту же осторожность держит
    // карточка home_why_growth_text.
    home_fresh_empty_text:
      'Katalog se tek puni i prvi oglasi dobijaju svu pažnju kupaca. Pripremamo reklamne kampanje — oglasi postavljeni sada dočekaće prvi talas kupaca već na vrhu liste.',

    // ------------------------------------------------------------
    // SEO-текст под витриной свежих объявлений.
    // ------------------------------------------------------------
    // Три абзаца, отвечающие поисковику и человеку на вопрос «что это
    // за площадка»: чем занимается, где работает, что делать дальше.
    // Стоит на главной ПОД первым экраном — там, где его прочтёт
    // заинтересовавшийся, а не тот, кто пришёл за конкретной машиной.
    home_seo_title: 'RS Auto — prodaja i iznajmljivanje automobila u Srbiji',
    home_seo_p1:
      'RS Auto je oglasnik za prodaju i iznajmljivanje automobila u Srbiji. Privatni prodavci i auto-saloni objavljuju oglase besplatno, a kupci pregledaju ponude na srpskom i ruskom jeziku.',
    // «vitrinu u katalogu», а НЕ «na glavnoj strani»: витрина салонов
    // живёт в каталоге (CatalogView), на главной её нет — там витрина
    // ОБЪЯВЛЕНИЙ. Обещать салону место, которого он после одобрения
    // не найдёт, нельзя: тот же случай, что с меткой «Auto-salon»,
    // вычищенной из dealer_app_intro.
    home_seo_p2:
      'Katalog obuhvata Beograd, Novi Sad, Niš, Kragujevac, Pančevo i druge gradove. Oglasi prolaze moderaciju, a platforma je zaštićena od duplikata i lažnih ponuda. Auto-saloni dobijaju sopstvenu stranicu i vitrinu u katalogu.',
    // Абзац называет ОБЕ роли — покупателя и продавца, — потому что
    // блоком заканчивается выход в каталог. Прежняя редакция звала
    // только объявить о продаже, и кнопка «найти автомобиль» под ней
    // противоречила только что прочитанному.
    home_seo_p3:
      'Pronađite automobil po marki, gradu i ceni — ili objavite svoj za 10 minuta.',
    // Кнопка под SEO-текстом: выход в каталог для того, кто пришёл
    // ПОКУПАТЬ. Весь блок выше объясняет площадку, и заканчиваться он
    // должен действием — иначе прочитавший упирается в следующий
    // раздел и уходит листать дальше.
    home_seo_cta: 'Pronađite automobil',

    // Города. Блок ведёт в каталог с фильтром по городу.
    home_cities_title: 'Automobili po gradovima',
    // SEO-абзац под чипсами городов. Та же роль, что у текста марок:
    // связный текст для поиска и пояснение для человека.
    home_cities_text:
      'Oglasi za prodaju automobila iz cele Srbije. Najčešće se traže gradovi: Beograd, Novi Sad, Niš, Kragujevac i Pančevo. Izaberite grad da pogledate automobile u blizini — sa mogućnošću pregleda i direktne veze sa prodavcem.',

    // Дилеры
    dealers_title: 'Za autosalone',
    dealers_offer: 'Sopstvena stranica salona i kupci iz cele Srbije',
    dealers_offer_note: 'Za partnerske salone objavljivanje je besplatno',
    dealers_cta: 'Pošalji zahtev',

    // ------------------------------------------------------------
    // Блок «Za auto-salone» НА ГЛАВНОЙ.
    // ------------------------------------------------------------
    // Отдельные ключи, а не переиспользование dealers_* выше: те
    // стоят на странице /dealers и в форме заявки, где текст короче и
    // решает другую задачу. Один набор на два места означал бы, что
    // правка главной молча меняет посадочную страницу.
    home_dealers_title: 'Za auto-salone',
    home_dealers_lead:
      'Sopstvena stranica u katalogu salona i kupci iz cele Srbije — srpska i ruskojezična publika.',
    home_dealers_b1:
      'Vitrina na glavnoj strani — vaš salon se ističe u katalogu',
    home_dealers_b2: 'besplatno oglašavanje za salone-partnere',
    // Формулировка про ПРОВЕРКУ КОМПАНИИ, а не про метку «Auto-salon»
    // на объявлениях. Метки в проекте нет: её удалили, и 1 сентября
    // отдельной задачей вычистили обещание из текста над формой заявки
    // (dealer_app_intro) — интерфейс продавал то, чего салон после
    // одобрения не находил. Здесь обещаем ровно то, что происходит:
    // заявку проверяет администратор по PIB и матичном броју.
    home_dealers_b3:
      'provera kompanije pri prijavi — kupci vide potvrđeni salon, a ne anonimnog prodavca',
    home_dealers_b4:
      'uskoro pokrećemo reklamne kampanje — oglasi partnera ulaze u taj saobraćaj',
    home_dealers_cta: 'Ostavi zahtev',
    home_dealers_note: 'Javićemo vam se imejlom i pomoći oko prvih oglasa.',

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
      'Depozit se vraća po vraćanju vozila bez oštećenja. Uslove osiguranja, kilometražu i minimalni period zakupa potvrdite sa vlasnikom u prepisci.',
    rent_also_sale: 'Ovaj automobil je i na prodaju',
    rent_also_rent: 'Ovaj automobil se može i iznajmiti',
    rent_empty_title: 'Nema automobila za izdavanje',
    rent_min_period: 'Minimalni period zakupa',
    rent_min_period_value: '1 dan',

    // Подача: тип объявления
    sell_type: 'Tip oglasa',
    // Доступность автомобиля (0119). Показывается только салону и
    // только для продажи: сдают ту машину, которая есть.
    sell_availability: 'Dostupnost',
    sell_availability_hint:
      'Kupac vidi oznaku u oglasu. „Po porudžbini“ — vozila još nema, dovozite ga; „U dolasku“ — vozilo je kupljeno i stiže.',
    // Варианты выбора в форме и бейджи в каталоге — один и тот же
    // текст: разные слова для одного состояния сбивали бы с толку.
    availability_in_stock: 'Na stanju',
    availability_on_order: 'Po porudžbini',
    availability_in_transit: 'U dolasku',
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
    // Подсказка пустого селекта в формах ввода (подача, дилеры).
    // Дефолтное «Все» осмысленно только в фильтрах каталога, где оно
    // означает «без ограничения»; в форме то же слово читается как
    // уже сделанный выбор, хотя поле ещё пустое.
    picker_choose: 'Izaberi',
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
      'Stranica trenutno nije dostupna. Pokušajte da je osvežite — ako se greška ponovi, vratite se u katalog.',
    err_retry: 'Pokušaj ponovo',

    // Контакты
    nav_contact: 'Kontakt',
    contact_title: 'Kontakt',
    contact_subtitle:
      'Pišite nam — odgovaramo radnim danima. Za autosalone postoji poseban obrazac.',
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

    // Баннер согласия на куки. Одна фраза и одна кнопка — по макету:
    // ссылки «Detaljnije» нет намеренно, документы и так доступны из
    // подвала на каждой странице.
    // Текст называет цель — аналитику: человек соглашается на неё, а не
    // на «удобство» вообще. Технические куки (сессия, выбор языка)
    // согласия не требуют и работают при любом ответе.
    cookie_banner_text:
      'Koristimo kolačiće za analitiku posete',
    cookie_banner_accept: 'Prihvati',
    cookie_banner_reject: 'Odbij',
    // Подпись для скринридера: сама плашка — региональный ориентир,
    // и без имени он читается как безымянный «region».
    cookie_banner_aria: 'Obaveštenje o kolačićima',

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
    otp_err_invalid: 'Pogrešan kod iz e-pošte',
    otp_err_failed: 'Nije uspelo potvrđivanje koda. Pokušajte ponovo',
    otp_err_quota:
      'Prekoračen je dnevni limit poruka za ovu e-adresu. Pokušajte sutra.',
    // Odbijanje zbog duplikata (trg_cars_prevent_duplicate, migracija
    // 0093). Baza vraća tekst na ruskom — bez ovog prevoda prodavac bi
    // ga video takvog kakav jeste, zajedno sa šifrom greške.
    sell_err_duplicate:
      'Oglas za ovaj automobil već postoji. Izmenite postojeći oglas ili ga uklonite iz objave.',

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
    // Pitanje pre odjave. Ponovna prijava traži SMS kod, pa slučajan
    // klik košta korisnika ceo postupak prijave iznova. Zato dijalog
    // objašnjava i šta se NE gubi: oglasi i prepiska ostaju na nalogu,
    // bez toga odjava deluje opasnije nego što jeste.
    my_logout_confirm: 'Odjaviti se sa naloga?',
    my_logout_confirm_text:
      'Vaši oglasi i prepiska ostaju sačuvani — nalog se ne briše. Za ponovni ulazak biće potreban kod sa iste e-adrese.',
    my_logout_confirm_yes: 'Odjavi se',

    // Ulaz u kabinet. Kod se traži samo kada sesije nema: sesija živi
    // između poseta.
    my_auth_title: 'Prijavite se',
    my_auth_lead:
      'Unesite e-mail adresu — poslaćemo vam kod. Isti nalog radi na svakom uređaju i u svakom pregledaču.',
    my_auth_phone: 'Broj telefona',
    my_auth_code: 'Kod iz SMS-a',
    my_auth_send: 'Pošalji kod',

    // Вход по почте. Второй способ входа, заведён для администраторов
    // (у первого администратора площадки нет телефона).
    auth_tab_phone: 'Telefon',
    auth_tab_email: 'E-mail',
    auth_email_label: 'E-mail adresa',
    auth_email_ph: 'vasa@posta.rs',
    auth_email_code: 'Kod iz poruke',
    auth_email_sent_to: 'Kod smo poslali na adresu',
    auth_email_change: 'Promeni adresu',
    // Нейтральный отказ: одинаков и для несуществующего адреса, и для
    // существующего пользователя без прав. Разные тексты превратили бы
    // форму входа в способ проверять, кто зарегистрирован.
    // Отказ гейта больше не означает «адреса нет»: регистрация по
    // почте открыта (0107), и незнакомый адрес пропускается. Остались
    // две причины — исчерпанная квота и неверная форма адреса, о них
    // текст и говорит.
    auth_email_not_allowed:
      'Previše pokušaja ili adresa nije ispravna. Proverite adresu i pokušajte kasnije.',
    auth_email_invalid: 'Unesite ispravnu e-mail adresu.',
    my_auth_submit: 'Prijavi se',
    my_auth_checking: 'Proveravamo…',
    // Privremeni tekst sekcija koje stižu u sledećim paketima.
    my_soon: 'Ova sekcija je u pripremi i biće dostupna uskoro.',

    // Statusi oglasa — iste formulacije kao u aplikaciji
    // (app_strings.dart: statusModeration … statusSold).
    my_status_moderation: 'Na proveri',
    my_status_active: 'Objavljeno',
    my_status_archived: 'Arhivirano',
    // Срок публикации (0113). «Isteklo» вместо «Sklonjeno»: продавцу
    // важно, ПОЧЕМУ объявление ушло из каталога — сам он его не снимал.
    my_status_expired: 'Isteklo',
    my_extend: 'Produži',
    my_extend_all: 'Produži sve oglase',
    my_extend_done: 'Produženo oglasa: {n}',
    my_expires_at: 'Ističe {date}',
    my_expired_hint:
      'Rok objave je istekao — oglas nije u katalogu. Produžite ga jednim klikom, sve je sačuvano.',
    my_expiring_soon: 'Ističe uskoro',
    my_expiry_banner:
      'Neki od vaših oglasa uskoro ističu ili su već sklonjeni iz kataloga.',
    car_expired_notice:
      'Ovaj oglas više nije objavljen — rok objave je istekao.',
    my_status_rejected: 'Odbijeno',
    my_status_sold: 'Prodato',
    // Razlog odbijanja stiže iz moderation_comment.
    my_rejected_reason: 'Razlog odbijanja',
    // Oglas koji je sklonio administrator (cars.archived_by = 'admin',
    // migracija 0089). Poseban bedž, a ne obično „Arhivirano“: prodavac
    // takav oglas ne može sam da vrati, i mora da vidi zašto.
    my_status_archived_by_admin: 'Sklonjeno od strane administratora',
    my_archived_reason: 'Razlog sklanjanja',
    // Put nazad u ponudu: ispraviti primedbu i poslati na ponovnu
    // proveru. Dugmeta „Vrati“ nema — odluku administratora prodavac
    // ne poništava, ali primedbu može da otkloni sam.
    my_archived_fix_hint:
      'Ispravite primedbu i sačuvajte — oglas ide na ponovnu proveru.',

    // Metrike oglasa.
    my_metric_views: 'Pregledi',
    my_metric_favorites: 'U omiljenim',
    my_metric_contacts: 'Kontakti',

    // Radnje nad oglasom.
    my_action_archive: 'Skloni',
    // Удаление отклонённого объявления (0122). У него архив
    // бессмыслен — вернуть в выдачу нельзя, — поэтому вместо «Snimi»
    // предлагается убрать запись совсем.
    my_action_delete: 'Obriši',
    my_confirm_delete: 'Obrisati oglas? Vraćanje nije moguće.',
    my_action_restore: 'Vrati',
    my_action_sold: 'Prodato',
    // «Podigni», a ne «Promoviši»: na oglasnim sajtovima to je uobičajen
    // naziv radnje, i kraći je — bitno za dugme u uskoj koloni kabineta.
    // Isto rešenje kao u ruskom rečniku (my_action_promote: «Поднять»).
    my_action_promote: 'Podigni',
    // Potvrda u dva koraka: pitanje + Da/Otkaži.
    my_confirm_archive: 'Skloniti oglas sa objave?',
    my_confirm_restore: 'Vratiti oglas u objavu?',
    my_confirm_sold: 'Označiti kao prodato?',
    // Pitanje pred izmenu AKTIVNOG oglasa: izmena po suštini šalje ga
    // na ponovnu moderaciju (update_car_v3), pa privremeno nestaje iz
    // pretrage. Oglas koji je već na moderaciji ili odbijen ovo pitanje
    // ne dobija — tamo se nema šta izgubiti.
    my_confirm_edit: 'Izmena šalje oglas na ponovnu moderaciju — privremeno nestaje iz pretrage. Nastaviti?',
    my_confirm_yes: 'Da',
    my_confirm_no: 'Otkaži',
    my_action_busy: 'Čuvamo…',
    // Promocija je za sada besplatna (activate_promotion, 7 dana).
    my_promoted_until: 'Promoviše se do',
    my_promote_days: 'Besplatno, 7 dana u vrhu pretrage',
    // Vidi ruski rečnik: datum se dodaje pored teksta, ne u string.
    my_promote_done: 'Promocija je uključena do',
    my_promote_wait: 'Podizanje oglasa biće dostupno od',

    // Zbirna statistika (get_my_stats_totals).
    my_totals_title: 'Ukupno',
    my_totals_listings: 'Oglasi',

    // Prazno stanje.
    my_empty_title: 'Još nemate oglase',
    my_empty_text: 'Postavite prvi oglas — prodaja počinje odavde.',
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
    // Sesija je istekla dok je forma bila otvorena. Ranije je ovde
    // stajala poruka o SMS kodu — u režimu izmene to je besmisleno:
    // kod se uopšte ne traži.
    edit_err_session: 'Sesija je istekla. Prijavite se ponovo i pokušajte opet.',
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
    // Звонок. Номер раскрывается нажатием, а не стоит на странице
    // сразу: так его дороже собирать перекупам и видно, сколько
    // покупателей выбирают звонок вместо переписки.
    //
    // ОДНА НАДПИСЬ НА ВСЕХ, включая гостя. Отдельного «Prijavite se da
    // pozovete» больше нет: гость пришёл за номером, и кнопка обещает
    // ему номер, а требование войти он встречает следующим шагом.
    car_call_show: 'Prikaži broj',
    car_call_loading: 'Učitavanje…',
    // Номер не пришёл: чаще всего объявление сняли с публикации, пока
    // страница лежала в кэше. Для покупателя разница между «снято» и
    // «сбой» практическая одна, поэтому текст один.
    car_call_failed: 'Broj trenutno nije dostupan',

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
    // Уведомления о решении по заявке на статус салона (0101).
    // Подпись называет, КУДА ведёт переход: у одобренного это его
    // новая витрина, у отклонённого — профиль, где стоит блок заявки
    // и откуда подаётся новая.
    notif_open_showcase: 'Otvori stranicu salona',
    notif_open_profile: 'Otvori profil',
    notif_tag_dealer_ok: 'Status potvrđen',
    notif_tag_dealer_no: 'Zahtev odbijen',
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
    // Podnaslov polja telefona. Ranije je pisalo da se broj koristi za
    // prijavu i da se ne menja — to više nije tačno: prijava ide preko
    // e-pošte (migracija 0106), a telefon je kontakt koji kupac vidi u
    // oglasu. Zato tekst objašnjava čemu broj služi, a ne zašto je
    // zaključan.
    profile_phone_hint:
      'Broj vide kupci u vašim oglasima i unapred se popunjava pri objavi',
    // Greška pri čuvanju: broj ne odgovara srpskom formatu. Provera je
    // ista kao ograničenje baze (cars_contact_phone_serbian) — fiksni
    // brojevi 011, 021, 018 prolaze, kao i mobilni.
    profile_phone_invalid: 'Unesite ispravan broj telefona',
    profile_email: 'E-mail',
    // Podnaslov polja e-pošte. Prijava ide preko SMS-a, pa je adresa
    // prazna dok je vlasnik sam ne unese — a bez nje odluka moderacije
    // ne može da stigne nigde osim u kabinet.
    profile_email_hint:
      'Na ovu adresu šaljemo odluku o oglasu. Ostavite prazno ako ne želite e-poštu.',
    // Почта больше не редактируется: она служит входом (0106).
    // Подсказка говорит и о её роли, и о том, куда идти за сменой.
    profile_email_locked:
      'Ovom adresom se prijavljujete. Za promenu nas kontaktirajte.',
    profile_email_invalid: 'Proverite adresu e-pošte',
    profile_email_taken: 'Ova adresa se već koristi na drugom nalogu',
    profile_avatar: 'Fotografija',
    profile_avatar_change: 'Promeni',
    profile_seller_kind: 'Tip prodavca',
    profile_private: 'Privatno lice',
    profile_dealer: 'Autosalon',
    profile_company: 'Naziv autosalona',
    profile_company_required: 'Unesite naziv autosalona',
    // Логотип салона. Отдельно от profile_avatar: у салона это две
    // разные картинки — логотип компании на витрине и фотография
    // человека в аккаунте.
    // Замена уже загруженного. Отдельная строка, а не та же «Učitaj
    // logo»: при заполненном логотипе «загрузить» обещает добавить
    // второй, тогда как файл в бакете один и новый перезапишет старый.
    // Обложка витрины (0098). Подсказка называет рекомендуемый размер
    // и прямо говорит о кадрировании: салон должен понимать, почему
    // его вертикальный снимок стал широкой полосой.
    profile_cover: 'Naslovna slika salona',
    profile_cover_hint:
      'Preporučeno 1500×1000 (odnos 3:2), najmanje 900×600. Slika zauzima celu karticu salona u katalogu i vrh vaše stranice, a podaci stoje na traci preko dna — držite glavno u gornjem delu kadra. Bez slike prikazujemo firmenu pozadinu.',
    profile_cover_empty: 'Naslovna slika još nije učitana',
    profile_cover_change: 'Učitaj naslovnu sliku',
    profile_cover_replace: 'Zameni naslovnu sliku',
    profile_showcase: 'Moja stranica',
    profile_save: 'Sačuvaj',
    profile_saving: 'Čuvamo…',
    profile_saved: 'Promene su sačuvane',
    profile_error: 'Nije uspelo. Pokušajte ponovo.',
    profile_avatar_error: 'Nije uspelo učitavanje fotografije',
    profile_avatar_preparing: 'Pripremamo…',

    // ------------------------------------------------------------
    // ZAHTEV ZA STATUS AUTOSALONA (migracija 0100).
    // ------------------------------------------------------------
    // Раньше тип продавца переключался кнопкой, и статус салона
    // доставался любому. Теперь его подтверждает администратор по
    // заявке с реквизитами компании, и эта группа строк обслуживает
    // все четыре состояния блока: заявки нет (форма), заявка ждёт,
    // заявка отклонена, статус подтверждён.
    dealer_app_title: 'Prodajete kao auto-kuća?',
    // Объяснение ДО формы: человек должен понимать, почему у него
    // просят PIB, прежде чем начнёт его искать.
    dealer_app_intro:
      'Auto-kuća ima svoju stranicu u katalogu. Zato status potvrđuje administrator — pošaljite podatke o kompaniji i javićemo vam se.',
    dealer_app_open: 'Ostavite zahtev',
    dealer_app_cancel: 'Odustani',
    dealer_app_submit: 'Pošalji zahtev',
    dealer_app_sending: 'Šaljemo…',

    // Поля формы. Названия реквизитов НЕ ПЕРЕВОДИМ: PIB и «matični
    // broj» — официальные термины сербского реестра, и владелец
    // салона ищет в своей выписке именно эти слова.
    dealer_app_company: 'Naziv autosalona',
    dealer_app_tax_id: 'PIB',
    dealer_app_tax_id_hint: '9 cifara iz APR izvoda',
    dealer_app_reg_num: 'Matični broj',
    dealer_app_reg_num_hint: '8 cifara iz APR izvoda',
    dealer_app_city: 'Grad',
    dealer_app_person: 'Kontakt osoba',
    dealer_app_phone: 'Telefon za kontakt',
    dealer_app_email: 'Email',
    dealer_app_website: 'Sajt',
    dealer_app_comment: 'Komentar',
    dealer_app_comment_ph: 'Šta je još korisno da znamo',
    dealer_app_required: 'Obavezna polja',

    // Состояние «ждёт рассмотрения». Срока намеренно не обещаем:
    // заявки разбирает человек, и «за 24 sata» стало бы обещанием,
    // которое площадка не контролирует.
    dealer_app_pending_title: 'Zahtev je poslat',
    dealer_app_pending_text:
      'Proveravamo podatke firme. Javićemo vam se na kontakt iz zahteva.',
    dealer_app_pending_since: 'Poslato',

    // Отказ. Причина показывается дословно, как её написал
    // администратор: без неё повторная подача — стрельба вслепую.
    //
    // ЗАГОЛОВОК НАЗЫВАЕТ ПРЕДМЕТ ЗАЯВКИ ЦЕЛИКОМ. Было просто «Zahtev
    // nije odobren»: блок висит в профиле неделями, и владелец,
    // открывший кабинет через несколько дней, видел отказ без единого
    // слова о том, чего он касается — заявки на салон, объявления или
    // чего-то ещё. Рядом стоит причина от администратора, но она
    // объясняет ПОЧЕМУ, а не ЧТО.
    //
    // Формулировка «пока не можем одобрить», а не «отклонена»: отказ
    // здесь не окончательный — кнопка рядом предлагает подать новую
    // заявку, и большинство причин (не проверен номер, нет документа)
    // устранимы. «Отклонена» звучало как приговор аккаунту.
    //
    // ДЛИНА ПОДОБРАНА ПОД 360px: при body-размере (16px) в карточку
    // кабинета помещается ~33 символа в строку, и заголовок обязан
    // уложиться в две. Более полная формулировка («мы пока не можем
    // одобрить заявку на регистрацию автосалона») занимала три и
    // потребовала бы мельчить шрифт до размера служебных подписей —
    // тогда заголовок стал бы мельче даты под ним.
    dealer_app_rejected_title:
      'Nažalost, za sada ne možemo odobriti zahtev za auto-kuću',
    dealer_app_rejected_reason: 'Razlog',
    // Дата решения — парная к dealer_app_pending_since: блок висит,
    // пока не подана новая заявка, и без даты старый отказ читается
    // как сегодняшний.
    dealer_app_rejected_at: 'Odlučeno',
    dealer_app_retry: 'Novi zahtev',

    // Подтверждённый статус. Строка стоит там, где раньше был
    // переключатель «Privatno lice | Autosalon».
    dealer_app_approved_title: 'Status autosalona je potvrđen',
    dealer_app_approved_text:
      'Podaci salona ispod se prikazuju kupcima na vašoj stranici i u katalogu.',
    // Отказ от статуса. Возврат в «частное лицо» разрешён без
    // разрешения администратора — это право владельца.
    dealer_app_leave: 'Prebaci nalog na privatno lice',
    dealer_app_leave_confirm:
      'Kartica salona i podaci vitrine biće uklonjeni iz kataloga. Oglasi ostaju. Nastaviti?',

    // Ошибки подачи. Коды приходят из submitDealerApplication —
    // текст сервера русский, а строки подбираются здесь.
    dealer_app_err_pending: 'Zahtev je već poslat i čeka odluku',
    dealer_app_err_already: 'Već imate status autosalona',
    dealer_app_err_tax_id: 'PIB se sastoji od 9 cifara',
    dealer_app_err_reg_num: 'Matični broj se sastoji od 8 cifara',
    dealer_app_err_company: 'Unesite naziv autosalona',
    // Обязательные контакты (0103). Раньше эти поля принимались
    // пустыми, и по заявке не с кем было связаться.
    dealer_app_err_city: 'Unesite grad',
    dealer_app_err_person: 'Unesite kontakt osobu',
    dealer_app_err_phone: 'Unesite broj telefona',
    dealer_app_err_email: 'Proverite email adresu',
    dealer_app_err_long: 'Neko polje je predugačko — skratite tekst',
    dealer_app_err_auth: 'Sesija je istekla. Prijavite se ponovo.',
    dealer_app_err_unknown: 'Nije uspelo. Pokušajte ponovo.',

    // Общее
    // ------------------------------------------------------------
    // Навигация по контентным страницам.
    // ------------------------------------------------------------
    nav_about: 'O platformi',
    nav_how: 'Kako funkcioniše',
    nav_faq: 'Česta pitanja',
    nav_menu: 'Meni',
    // Подписи для скринридера на <nav>. На странице их несколько
    // (шапка, крошки, подвал, пагинация), и без имени каждый читается
    // просто как «навигация» — по списку ориентиров не различить.
    // Видимого текста эти строки не дают.
    nav_aria_main: 'Glavna navigacija',
    nav_aria_breadcrumbs: 'Putanja',
    nav_aria_footer: 'Navigacija u podnožju',
    // Вход и кабинет: шапка, бургер, подвал, страница /login.
    nav_login: 'Prijava',
    nav_my: 'Moji oglasi',
    login_title: 'Prijava na nalog',
    nav_menu_close: 'Zatvori meni',
    // Общие подписи закрытия для всех оверлеев: шторка фильтров,
    // список выбора, форма подачи, галерея объявления. Раньше в этих
    // местах стоял aria-label="×" — скринридер зачитывал имя символа
    // («знак умножения»), а не действие.
    common_close: 'Zatvori',
    // Полноэкранный просмотр фотографий. Подписи нужны скринридеру:
    // у стрелок нет текста, только иконка.
    gallery_prev: 'Prethodna fotografija',
    gallery_next: 'Sledeća fotografija',
    gallery_open: 'Otvori fotografiju preko celog ekrana',
    // Крестик в кабинете. Подпись НЕ общая («Закрыть»), а своя:
    // крестик здесь уводит на главную сайта, и скринридер обязан
    // сообщить, куда именно. Остальные крестики закрывают слой поверх
    // страницы и оставляют человека на месте — это другое действие.
    my_close: 'Zatvori nalog i idi na početnu',
    // ------------------------------------------------------------
    // ПОЛЯ ВИТРИНЫ САЛОНА в форме профиля (миграция 0095).
    // ------------------------------------------------------------
    // Наполняют карточку салона в каталоге и шапку его страницы:
    // обложка — фон, название со слоганом и контактами — полоса
    // поверх её нижнего края.
    showcase_section: 'Izložba salona',
    showcase_section_hint:
      'Ovo kupci vide na kartici vašeg salona u pretrazi.',
    // Слоган (0098). Подсказка объясняет, ГДЕ он виден, — иначе поле
    // неотличимо от описания и салон впишет туда то же самое.
    showcase_tagline: 'Slogan salona',
    showcase_tagline_hint:
      'Jedna rečenica ispod naziva salona na kartici u katalogu.',
    showcase_city: 'Grad salona',
    showcase_city_hint:
      'Grad se prikazuje na kartici salona u pretrazi.',
    showcase_city_empty: 'Nije naveden',
    showcase_phone: 'Telefon salona',
    showcase_phone_hint:
      'Javni broj kompanije. Ne menja broj kojim se prijavljujete.',
    showcase_hours: 'Radno vreme',
    // Slova oko vremena. Ne unosi ih salon — sastavljaju se sami, da bi
    // svaka kartica u katalogu glasila isto (v. buildOpeningHours).
    showcase_hours_from: 'Radimo od',
    showcase_hours_to: 'do',
    showcase_hours_hint:
      'Unesite samo sate. Na kartici salona ispada: „Radimo od 9:00 do 19:00“.',
    showcase_err_hours_time: 'Vreme unesite kao 9:00 ili 19:30',
    // Ошибки длины — те же границы, что в базе (миграция 0095).
    showcase_err_tagline: 'Slogan je predugačak (najviše 90 znakova)',
    showcase_err_phone: 'Telefon je predugačak',
    showcase_err_hours: 'Radno vreme je predugačko',
    // Подсказки на месте незаполненных полей плитки салона.
    // Показываются ТОЛЬКО в предпросмотре редактора витрины: в самом
    // каталоге пустое поле не печатается вовсе (см. DealerShowcaseCard).
    showcase_ph_name: 'Naziv autosalona',
    showcase_ph_tagline: 'Kratak slogan salona',
    showcase_ph_city: 'Grad',
    // Возврат с карточки объявления назад к выдаче.
    common_back: 'Nazad',

    // ------------------------------------------------------------
    // /dealers — выгоды для автосалона.
    // ------------------------------------------------------------
    dealers_benefit_1_title: 'Objavljivanje bez čekanja',
    dealers_benefit_1_text:
      'Oglasi partnerskih salona idu na sajt odmah, bez moderacije.',
    dealers_benefit_2_title: 'Stranica autosalona',
    dealers_benefit_2_text:
      'Svi vaši automobili na jednom mestu, pod nazivom salona i vašom naslovnom slikom.',
    dealers_benefit_3_title: 'Kupci iz cele Srbije',
    dealers_benefit_3_text:
      'Oglase vide kupci iz cele Srbije, sa svih uređaja.',

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
    // Реквизиты на этой форме НЕОБЯЗАТЕЛЬНЫ, поэтому текст ошибки
    // говорит о формате, а не требует заполнить: пустое поле сервер
    // пропускает, придирается он только к набранному неверно.
    dealers_err_tax_id: 'PIB se sastoji od 9 cifara.',
    dealers_err_email: 'Proverite email adresu.',
    // Повторная подача (0104).
    dealers_err_already_dealer:
      'Vaš nalog već ima status autosalona — zahtev nije potreban.',
    dealers_err_application_exists:
      'Zahtev za ovu firmu je već poslat i čeka obradu.',
    dealers_err_lead_exists:
      'Zahtev za ovu firmu je već poslat. Javićemo se uskoro.',
    dealers_err_city: 'Izaberite grad.',
    dealers_err_reg_num: 'Matični broj se sastoji od 8 cifara.',
    // Подпись под группой реквизитов: объясняет, ЗАЧЕМ их спрашивают
    // до первого разговора. Про необязательность здесь больше нет ни
    // слова — после 0103 они обязательны в обеих формах.
    dealers_details_hint: 'Podatke upoređujemo sa APR-om.',
    dealers_err_rate:
      'Već ste poslali zahtev sa ovog broja. Pokušajte ponovo sutra.',
    dealers_err_unknown: 'Došlo je do greške. Pokušajte ponovo.',

    // ------------------------------------------------------------
    // /install — установка сайта на телефон (PWA).
    // ------------------------------------------------------------
    install_title: 'Brzi pristup',
    // Вводный блок над карточками платформ.
    install_intro_title: 'RS Auto radi kao aplikacija',
    install_intro_body:
      'Dodajte RS Auto na početni ekran telefona — otvoriće se kao obična '
      + 'aplikacija: sa svojom ikonicom, preko celog ekrana, bez adresne '
      + 'trake pregledača. Traje par sekundi.',
    // Шаги. Двойные звёздочки выделяют название кнопки полужирным —
    // разбор в components/InstallGuide.tsx. Приём взят из приложения
    // (Baza), где жирные фрагменты вынесены отдельными ключами ARB;
    // здесь маркер прямо в строке — переводчику так виднее контекст.
    install_android_title: 'Android (Chrome)',
    install_android_1: 'Otvorite RS Auto u pregledaču **Chrome**.',
    install_android_2: 'Dodirnite **tri tačkice** u gornjem desnom uglu.',
    install_android_3:
      'Izaberite **«Instalirajte aplikaciju»** ili **«Dodaj na početni ekran»**.',
    install_android_4:
      'Potvrdite **«Instaliraj»** — ikonica RS Auto pojaviće se na ekranu.',
    install_ios_title: 'iPhone / iPad (Safari)',
    install_ios_1:
      'Otvorite RS Auto u pregledaču **Safari** (u drugim pregledačima na '
      + 'iOS-u instalacija nije dostupna).',
    install_ios_2:
      'Dodirnite dugme **«Podeli»** — kvadrat sa strelicom nagore, na dnu ekrana.',
    install_ios_3:
      'Na spisku izaberite **«Na početni ekran»** (On Home Screen).',
    install_ios_4:
      'Dodirnite **«Dodaj»** — ikonica RS Auto pojaviće se na početnom ekranu.',
    // Подпись номера шага для скринридера: кружок с цифрой от него
    // скрыт, и без неё шаги читались бы сплошным списком без номеров.
    install_step: 'Korak',
    // Плашка на карточке платформы, с которой человек зашёл.
    install_your_device: 'vaš uređaj',


    // ------------------------------------------------------------
    // Страница продавца / автосалона.
    // ------------------------------------------------------------
    dealer_page_since: 'Na platformi od',
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
      'JPG, PNG, WebP ili HEIC. Prva fotografija je naslovna.',
    sell_photos_preparing: 'Pripremamo fotografije…',
    sell_photos_cover: 'Naslovna',
    sell_photos_move_left: 'Pomeri levo',
    sell_photos_move_right: 'Pomeri desno',
    sell_photos_remove: 'Ukloni fotografiju',
    sell_photos_uploading: 'Otpremanje fotografija',
    sell_err_photos_required: 'Dodajte bar jednu fotografiju automobila.',
    sell_err_photo_type: 'Podržani su JPG, PNG, WebP i HEIC formati.',
    sell_err_photo_size: 'Fotografija je prevelika — najviše 25 MB.',
    // HEIC u pregledaču bez sistemskog dekodera (sve osim Safarija).
    // Poruka mora da kaže ŠTA DA SE URADI, a ne samo šta nije uspelo.
    sell_err_photo_heic:
      'HEIC format radi samo u Safariju. Na iPhone-u uključite «Najkompatibilniji» (Podešavanja → Kamera → Formati) ili pošaljite JPG.',
    sell_err_photo_decode:
      'Fotografiju nije moguće obraditi. Pokušajte drugu.',
    sell_err_photos_max: 'Najviše 15 fotografija.',

    // ------------------------------------------------------------
    // /about — о площадке.
    // ------------------------------------------------------------
    about_title: 'O nama',
    about_meta_desc:
      'RS Auto — platforma za kupovinu, prodaju i iznajmljivanje automobila u Srbiji. Oglasi su besplatni, a sa prodavcem se dopisujete direktno na sajtu.',
    about_lead:
      'RS Auto je tržište automobila u Srbiji. Povezujemo one koji prodaju ili iznajmljuju vozilo sa onima koji ga traže — bez posrednika i bez provizije na prodaju.',

    about_mission_title: 'Naša misija',
    about_mission_text:
      'Kupovina polovnog automobila je odluka od nekoliko hiljada evra, a najčešće se donosi na osnovu nepotpunih podataka. Trudimo se da oglas bude jasan: prava cena, stvarna kilometraža, fotografije vozila i grad u kome se nalazi. Što je oglas iskreniji, to je manje izgubljenog vremena na obe strane.',

    about_how_title: 'Kako je platforma uređena',
    about_how_1_title: 'Jedna baza oglasa',
    about_how_1_text:
      'Svi oglasi su na jednom mestu — ista ponuda, bez obzira na to sa kog uređaja gledate. Ne postoje dve odvojene ponude.',
    about_how_2_title: 'Provera pre objave',
    about_how_2_text:
      'Svaki oglas prolazi moderaciju. Vozila sa izmenjenim brojem šasije, lažnim cenama i prevarantski sadržaj se ne objavljuju.',
    about_how_3_title: 'Prepiska na sajtu',
    about_how_3_text:
      'Prodavcu pišete direktno iz oglasa, u svom kabinetu na sajtu — vaš lični broj telefona ne završi u bazama za neželjene pozive.',

    about_buyer_title: 'Za kupca',
    about_buyer_1: 'Pretraga po marki, modelu, godištu, ceni i gradu.',
    about_buyer_2:
      'Sačuvana pretraga sa obaveštenjem čim se pojavi odgovarajuće vozilo.',
    about_buyer_3: 'Obaveštenje kada prodavac snizi cenu praćenog automobila.',
    about_buyer_4: 'Kontakt sa prodavcem bez otkrivanja svog broja telefona.',

    about_seller_title: 'Za prodavca',
    about_seller_1: 'Objavljivanje oglasa je besplatno, bez provizije na prodaju.',
    about_seller_2: 'Oglas se postavlja direktno sa sajta, za nekoliko minuta.',
    about_seller_3: 'Isti oglas vide kupci iz cele Srbije, sa svih uređaja.',
    about_seller_4: 'Isticanje oglasa je opcija, a ne uslov za objavljivanje.',

    about_dealer_title: 'Za autosalone',
    about_dealer_1: 'Posebna stranica salona sa celim voznim parkom.',
    about_dealer_2: 'Objavljivanje bez čekanja za partnerske salone.',
    about_dealer_3: 'Svaki oglas vodi na stranicu vašeg salona.',
    about_dealer_4: 'Kupci iz cele Srbije, sa svih uređaja.',

    about_cta_title: 'Imate automobil za prodaju?',
    about_cta_text: 'Objavite oglas za nekoliko minuta — besplatno.',

    // ------------------------------------------------------------
    // /how-it-works — как это работает.
    // ------------------------------------------------------------
    how_title: 'Kako funkcioniše',
    how_meta_desc:
      'Kako funkcioniše RS Auto: pretraga auta po filterima, sačuvana pretraga, direktan kontakt sa prodavcem. Četiri scenarija — kupovina, prodaja, iznajmljivanje.',
    how_lead:
      'Tri scenarija — kupovina, prodaja i rad autosalona. Izaberite svoj i pratite korake.',

    how_buyer_title: 'Kupujem automobil',
    how_buyer_1_title: 'Pronađite vozilo',
    how_buyer_1_text:
      'Otvorite katalog i suzite izbor filterima: marka, model, godište, cena, kilometraža i grad. Rezultat se može podeliti linkom — filteri ostaju sačuvani u adresi.',
    how_buyer_2_title: 'Sačuvajte pretragu',
    how_buyer_2_text:
      'Ako trenutno nema odgovarajućeg vozila, sačuvajte link pretrage — filteri ostaju u adresi. Vratite se na njega i odmah vidite šta je novo.',
    how_buyer_3_title: 'Pišite prodavcu',
    how_buyer_3_text:
      'Prodavcu pišete direktno iz oglasa. Vaš broj telefona ostaje skriven, a cela prepiska je u vašem kabinetu na jednom mestu.',

    how_seller_title: 'Prodajem automobil',
    how_seller_1_title: 'Postavite oglas',
    // ВХОД ПО ПОЧТЕ, А НЕ ПО SMS. Текст обещал код в SMS и номер как
    // способ входа — так было до миграции 0106. Сейчас код приходит
    // на почту (SMS с сайта не уходят: Twilio требует одобренного
    // Compliance Profile для сербских номеров), а телефон
    // спрашивается как КОНТАКТ для покупателя и кодом не
    // подтверждается.
    how_seller_1_text:
      'Popunite formu u četiri koraka: vozilo, detalji, fotografije i kontakt. Kod za potvrdu stiže na e-poštu — to je istovremeno i vaša prijava, poseban nalog nije potreban. Broj telefona ostaje kao kontakt za kupce.',
    how_seller_2_title: 'Sačekajte proveru',
    how_seller_2_text:
      'Oglas ide na moderaciju. Obično je gotova u toku dana. Nakon odobrenja pojavljuje se u katalogu i vide ga kupci iz cele Srbije.',
    how_seller_3_title: 'Primajte poruke',
    how_seller_3_text:
      'Zainteresovani kupci pišu vam direktno na sajtu — poruke i obaveštenja čekaju vas u kabinetu. Kada je vozilo prodato, označite oglas kao prodat.',

    // Сценарий аренды. Стоит между продавцом и салоном: подача идёт
    // той же формой с переключателем типа, поэтому шаги повторяют
    // логику продажи, а отличия названы прямо — цена за день и залог.
    how_rent_title: 'Izdajem automobil',
    how_rent_1_title: 'Izaberite izdavanje',
    how_rent_1_text:
      'Forma je ista kao za prodaju — na prvom koraku izaberite „Izdavanje“ umesto „Prodaja“. Umesto cene vozila unosite cenu po danu i depozit.',
    how_rent_2_title: 'Postavite uslove',
    how_rent_2_text:
      'Depozit može biti i nula — tako i piše u oglasu. Minimalni period zakupa je jedan dan, a ostalo dogovarate direktno sa klijentom.',
    how_rent_3_title: 'Primajte zahteve',
    how_rent_3_text:
      'Oglas ide u zaseban katalog za izdavanje. Zainteresovani vas zovu ili pišu sa stranice oglasa, kao i kod prodaje.',
    // Подпись кнопки сценария. Ключ свой, а не home_why_cta с
    // главной: текст сейчас совпадает, но привязывать страницу
    // «Как это работает» к ключу с именем блока главной значит
    // получить неожиданную правку в одном месте при редактуре
    // другого.
    how_rent_cta: 'Postavi oglas',

    how_dealer_title: 'Imam autosalon',
    how_dealer_1_title: 'Pošaljite zahtev',
    how_dealer_1_text:
      'Popunite kratak obrazac na stranici za autosalone: naziv salona, kontakt osoba i telefon. Javljamo se i dogovaramo detalje.',
    how_dealer_2_title: 'Dobijate stranicu salona',
    how_dealer_2_text:
      'Sva vaša vozila na jednom mestu, sa nazivom salona i naslovnom slikom. Kupci odmah vide da imaju posla sa firmom, a ne sa privatnim licem.',
    how_dealer_3_title: 'Objavljujete ceo vozni park',
    how_dealer_3_text:
      'Oglasi partnerskih salona idu na sajt odmah, bez čekanja na moderaciju. Vide ih kupci iz cele Srbije.',

    how_step: 'Korak',

    // ------------------------------------------------------------
    // /faq — вопросы и ответы.
    // ------------------------------------------------------------
    faq_title: 'Česta pitanja',
    faq_meta_desc:
      'Odgovori na pitanja o prodaji i iznajmljivanju automobila u Srbiji: objavljivanje, moderacija, kontakt sa prodavcem, uslovi za auto-salone.',
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
    // Заголовок и описание главной. Идут и в <title>, и в og:title —
    // buildMetadata собирает их из одних значений, поэтому вкладка
    // браузера и превью в мессенджере не разойдутся.
    //
    // Название бренда внутри строки, а не приклеено снаружи: раньше
    // заголовок собирался как «RS Auto — » + слоган, и правка слогана
    // меняла title главной вместе с подписью в подвале.
    // БЕЗ ИМЕНИ БРЕНДА В НАЧАЛЕ. Ключ идёт и в <title>, и в og:title,
    // а рядом с последним соцсеть уже показывает og:site_name = «RS
    // Auto» отдельной строкой — заголовок читался как «RS Auto» над
    // «RS Auto — kupite…», с брендом дважды подряд. В выдаче Google
    // имя сайта тоже подставляется само.
    meta_home_title: 'Kupite, prodajte ili iznajmite auto u Srbiji',
    meta_home_desc:
      'Polovni i novi automobili od privatnih prodavaca i salona iz Beograda, Novog Sada i cele Srbije. Besplatno objavljivanje, provereni oglasi, na srpskom i ruskom.',
    // meta_catalog_desc — витрина ПРОДАЖИ /cars; meta_all_desc —
    // служебная смешанная витрина /all (она под noindex, но описание
    // нужно для превью при шаринге ссылки).
    meta_catalog_desc:
      'Automobili na prodaju u Srbiji. Pretraga po marki, modelu, gradu i ceni.',
    meta_all_desc:
      'Automobili u Srbiji: prodaja i izdavanje. Pretraga po marki, modelu, gradu i ceni.',
    meta_rent_desc:
      'Iznajmljivanje automobila u Srbiji: oglasi privatnih vlasnika i salona. Cena po danu, grad, marka, model. Direktna veza sa iznajmljivačem.',
    meta_sell_desc:
      'Objavite oglas za prodaju ili iznajmljivanje automobila u Srbiji besplatno. Prijava traje 10 minuta, kupci kontaktiraju direktno, bez provizije.',
    meta_dealers_desc:
      'Stranica auto-salona u katalogu RS Auto: vitrina, kompletan vozni park, kupci iz cele Srbije. Besplatno oglašavanje za salone-partnere.',
    // Телефон в описании НЕ упоминается: поддержка работает только по
    // почте (OPERATOR.phone пуст — см. lib/legal). Обещание в сниппете
    // того, чего на странице нет, — прямой повод для отказа посетителя,
    // а для поисковика расхождение сниппета с содержимым страницы.
    meta_contact_desc:
      'Kontaktirajte RS Auto: e-pošta podrške i obrazac za poruku. Odgovaramo radnim danima.',
    meta_terms_desc:
      'Uslovi korišćenja platforme RS Auto — oglasi za prodaju i izdavanje automobila u Srbiji.',
    meta_privacy_desc:
      'Politika privatnosti RS Auto — kako obrađujemo i štitimo lične podatke korisnika.',

    common_all: 'Sve',
    common_more: 'Prikaži još',
    common_currency_eur: '€',
    common_km: 'km',
  },

  ru: {
    // См. пояснение к паре ключей в сербском словаре выше:
    // nav_catalog — название раздела для крошек и JSON-LD,
    // nav_catalog_menu — пункт меню в паре с «Арендой».
    nav_catalog: 'Автомобили',
    nav_catalog_menu: 'Продажа',
    // См. комментарий в сербском словаре: корень крошек в JSON-LD.
    nav_home: 'Главная',
    // См. комментарий в сербском словаре.
    nav_all_cars: 'Все авто',
    nav_sell: 'Продать авто',
    // См. комментарий в сербском словаре: падеж выбран по смыслу
    // страницы.
    nav_dealers: 'Автосалонам',
    nav_install: 'Быстрый доступ',
    nav_share: 'Поделиться сайтом',
    share_text: 'RS Auto — продажа и аренда автомобилей в Сербии',
    share_copied: 'Ссылка скопирована',
    site_tagline: 'Продажа и аренда автомобилей в Сербии',

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
    empty_notify_hint:
      'Сохраните ссылку на этот поиск — фильтры остаются в адресе, и новые предложения проверяются в один клик.',

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

    // Объявление снято с публикации. Страница показывается вместо
    // голой 404, когда объявление в архиве, отклонено или вернулось
    // на проверку: ссылка из выдачи Google обязана вести куда-то, а
    // не в пустоту.
    // Формулировка намеренно НЕ раскрывает причину: посетителю всё
    // равно, архив это или отказ модерации, а второй вариант выдал бы
    // решение модератора постороннему.
    car_gone_title: 'Объявление недоступно',
    car_gone_text:
      'Это объявление снято с публикации или находится на проверке. Возможно, автомобиль уже продан.',
    car_gone_similar: 'Посмотрите похожие автомобили',
    car_gone_badge: 'Недоступно',
    car_promoted: 'Продвигается',
    car_viewed: 'Просмотрено',
    car_published: 'Опубликовано',
    car_share: 'Поделиться',
    car_share_copied: 'Ссылка скопирована',
    car_seller: 'Продавец',
    car_seller_dealer: 'Автосалон',
    car_seller_private: 'Частное лицо',
    car_contact_title: 'Связь с продавцом',
    car_qr_hint: 'Отсканируйте код телефоном, чтобы открыть объявление на телефоне',
    // См. комментарий в сербском словаре.
    home_qr_hint: 'Отсканируйте код, чтобы открыть каталог на телефоне',


    sell_title: 'Продайте автомобиль',
    sell_subtitle: 'Разместите объявление бесплатно — прямо на сайте, за несколько минут.',
    sell_step: 'Шаг',
    sell_next: 'Далее',
    sell_back: 'Назад',
    sell_submit: 'Опубликовать объявление',
    sell_step_car: 'Автомобиль',
    sell_step_details: 'Детали',
    sell_step_photos: 'Фотографии',
    sell_step_contact: 'Контакты',

    // Предупреждение о своём похожем объявлении (уровень 1 защиты от
    // дублей). Это ПРЕДУПРЕЖДЕНИЕ, а не запрет: продавец вправе
    // продолжить. Название машины подставляется отдельно в JSX —
    // интерполяции в словаре нет.
    sell_dup_title: 'У вас уже есть объявление об этой машине',
    sell_dup_open: 'Открыть существующее',
    sell_dup_ignore: 'Всё равно подать новое',
    sell_dup_moderation: 'на проверке',
    sell_phone: 'Номер телефона',
    // Сверка номера перед публикацией. Кодом телефон больше не
    // подтверждается, и это единственная проверка перед тем, как он
    // уйдёт в объявление: опечатку заметит только сам продавец.
    sell_phone_confirm_title: 'Проверьте номер телефона',
    sell_phone_confirm_text:
      'Покупатели будут звонить на этот номер. Убедитесь, что он верный — потом его можно изменить в объявлении.',
    sell_phone_confirm_edit: 'Изменить',
    sell_phone_confirm_ok: 'Верно',
    // Подпись под полем почты в форме подачи. Объясняет разницу между
    // двумя контактами на одном экране: телефон видит покупатель,
    // почту не видит никто — она нужна только для входа.
    sell_email_hint: 'На эту почту придёт код для входа. Покупатели её не видят.',
    sell_code: 'Код из письма',
    sell_send_code: 'Отправить код',
    sell_confirm: 'Подтвердить',
    sell_success_title: 'Объявление отправлено на проверку',
    sell_success_text:
      'После одобрения модератором объявление появится в каталоге. О результате сообщим.',

    home_hero_title: 'Продажа и аренда автомобилей в Сербии',
    home_hero_text: 'Бесплатное размещение. Покупатели напишут вам прямо на сайте.',
    home_hero_cta: 'Разместить авто',
    home_fresh: 'Свежие объявления',
    home_brands: 'Популярные марки',
    // SEO-абзац под чипсами марок. Перечисляет те же восемь марок
    // словами: поисковику нужен связный текст, а не только ссылки,
    // и человеку он объясняет, что за списком стоит.
    home_brands_text:
      'Самые востребованные марки автомобилей на рынке Сербии. На RS Auto вы найдёте объявления о продаже б/у и новых авто от частных продавцов и автосалонов: Volkswagen, BMW, Audi, Mercedes-Benz, Škoda, Opel, Renault и Fiat. Выберите марку — каталог покажет актуальные объявления с ценой, фотографиями и контактами продавца.',
    home_all_cars: 'Все автомобили',
    // Призыв под блоком «Почему RS Auto». Отдельный ключ, а не
    // home_hero_cta: там короткое «Разместить авто» рядом со второй
    // кнопкой, здесь кнопка одна и может позволить себе полную форму.
    home_why_cta: 'Подать объявление',
    // Призыв в карточке «Станьте первым продавцом». Называет
    // бесплатность прямо: карточка зовёт первых продавцов на пустой
    // каталог, и отсутствие платы — главный довод согласиться.
    home_sell_free_cta: 'Разместить бесплатно',

    // «Почему RS Auto» — четыре причины. Про рекламу говорим как о
    // текущей работе, без дат и обещаний охвата.
    home_why_title: 'Почему RS Auto',
    home_why_free_title: 'Бесплатное размещение',
    home_why_free_text:
      'Не берём плату за публикацию и связь с покупателями. Комиссии с продажи нет.',
    home_why_audience_title: 'Сразу две аудитории',
    home_why_audience_text:
      'Сербский и русский в одном объявлении — интерфейс переводит сайт, вы пишете на своём языке.',
    home_why_direct_title: 'Прямой контакт',
    home_why_direct_text:
      'Покупатель пишет или звонит лично вам. Без посредников и комиссии с продажи.',
    home_why_growth_title: 'Готовим запуск рекламы',
    home_why_growth_text:
      'Площадка запускается — работаем над привлечением покупателей. Первые объявления стартуют без конкуренции.',

    // Пустая витрина свежих объявлений: площадка запускается, объявлений
    // ещё нет. Не «ничего не найдено» (это про сбой поиска), а
    // приглашение стать первым.
    home_fresh_empty_title: 'Станьте первым продавцом',
    // Про рекламу — «готовим», без сроков и без цифр охвата: это факт о
    // нашей работе, а не обещание трафика тому, кто на него рассчитывает,
    // размещая автомобиль. Ту же осторожность держит карточка
    // home_why_growth_text.
    home_fresh_empty_text:
      'Каталог только наполняется, и первым объявлениям достаётся всё внимание покупателей. Мы готовим рекламные кампании — размещённые сейчас объявления встретят первый поток покупателей уже наверху выдачи.',

    // ------------------------------------------------------------
    // SEO-текст под витриной свежих объявлений.
    // ------------------------------------------------------------
    // Три абзаца, отвечающие поисковику и человеку на вопрос «что это
    // за площадка»: чем занимается, где работает, что делать дальше.
    // Стоит на главной ПОД первым экраном — там, где его прочтёт
    // заинтересовавшийся, а не тот, кто пришёл за конкретной машиной.
    home_seo_title: 'RS Auto — продажа и аренда авто в Сербии',
    home_seo_p1:
      'RS Auto — маркетплейс по продаже и аренде автомобилей в Сербии. Частные продавцы и автосалоны размещают объявления бесплатно, а покупатели смотрят предложения на сербском и русском языках.',
    // «витрину в каталоге», а НЕ «на главной странице»: витрина салонов
    // живёт в каталоге (CatalogView), на главной её нет — там витрина
    // ОБЪЯВЛЕНИЙ. Обещать салону место, которого он после одобрения
    // не найдёт, нельзя: тот же случай, что с меткой «Автосалон»,
    // вычищенной из dealer_app_intro.
    home_seo_p2:
      'Каталог охватывает Белград, Нови-Сад, Ниш, Крагуевац, Панчево и другие города. Объявления проходят модерацию, площадка защищена от дублей и фейков. Автосалоны получают собственную страницу и витрину в каталоге.',
    // Абзац называет ОБЕ роли — покупателя и продавца, — потому что
    // блоком заканчивается выход в каталог. Прежняя редакция звала
    // только разместить объявление, и кнопка «найти автомобиль» под
    // ней противоречила только что прочитанному.
    home_seo_p3:
      'Найдите автомобиль по марке, городу и цене — или разместите свой за 10 минут.',
    // Кнопка под SEO-текстом: выход в каталог для того, кто пришёл
    // ПОКУПАТЬ. Весь блок выше объясняет площадку, и заканчиваться он
    // должен действием — иначе прочитавший упирается в следующий
    // раздел и уходит листать дальше.
    home_seo_cta: 'Подобрать автомобиль',

    // Города. Блок ведёт в каталог с фильтром по городу.
    home_cities_title: 'Автомобили по городам',
    // SEO-абзац под чипсами городов. Та же роль, что у текста марок:
    // связный текст для поиска и пояснение для человека.
    home_cities_text:
      'Объявления о продаже автомобилей со всей Сербии. Чаще всего ищут в городах: Белград, Нови-Сад, Ниш, Крагуевац, Панчево. Выберите город, чтобы посмотреть машины рядом с вами — с возможностью осмотра и прямой связи с продавцом.',

    dealers_title: 'Автосалонам',
    dealers_offer: 'Своя страница салона и покупатели со всей Сербии',
    dealers_offer_note: 'Для салонов-партнёров размещение бесплатно',
    dealers_cta: 'Оставить заявку',

    // ------------------------------------------------------------
    // Блок «Автосалонам» НА ГЛАВНОЙ.
    // ------------------------------------------------------------
    // Отдельные ключи, а не переиспользование dealers_* выше: те
    // стоят на странице /dealers и в форме заявки, где текст короче и
    // решает другую задачу. Один набор на два места означал бы, что
    // правка главной молча меняет посадочную страницу.
    home_dealers_title: 'Автосалонам',
    home_dealers_lead:
      'Собственная страница в каталоге салонов и покупатели со всей Сербии — сербская и русскоязычная аудитории.',
    home_dealers_b1:
      'Витрина на главной странице — ваш салон заметен в каталоге',
    home_dealers_b2: 'бесплатное размещение для салонов-партнёров',
    // Формулировка про ПРОВЕРКУ КОМПАНИИ, а не про статус «Автосалон»
    // на объявлениях. Метки в проекте нет: её удалили, и 1 сентября
    // отдельной задачей вычистили обещание из текста над формой заявки
    // (dealer_app_intro) — интерфейс продавал то, чего салон после
    // одобрения не находил. Здесь обещаем ровно то, что происходит:
    // заявку проверяет администратор по ПИБ и матичному номеру.
    home_dealers_b3:
      'проверка компании при заявке — покупатели видят подтверждённый салон, а не анонимного продавца',
    home_dealers_b4:
      'готовим запуск рекламы — объявления партнёров войдут в этот трафик',
    home_dealers_cta: 'Оставить заявку',
    home_dealers_note: 'Свяжемся по почте и поможем с первыми объявлениями.',

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
      'Залог возвращается после сдачи автомобиля без повреждений. Условия страховки, лимит пробега и минимальный срок аренды уточните у владельца в переписке.',
    rent_also_sale: 'Этот автомобиль также продаётся',
    rent_also_rent: 'Этот автомобиль также сдаётся в аренду',
    rent_empty_title: 'Нет автомобилей в аренду',
    rent_min_period: 'Минимальный срок аренды',
    rent_min_period_value: '1 сутки',

    // Подача: тип объявления
    sell_type: 'Тип объявления',
    // См. комментарий в сербском словаре.
    sell_availability: 'Наличие',
    sell_availability_hint:
      'Покупатель увидит пометку в объявлении. «На заказ» — машины ещё нет, вы её привезёте; «В пути» — машина куплена и едет.',
    availability_in_stock: 'В наличии',
    availability_on_order: 'На заказ',
    availability_in_transit: 'В пути',
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
    picker_choose: 'Выбрать',
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
      'Страница сейчас недоступна. Попробуйте обновить её — если ошибка повторится, вернитесь в каталог.',
    err_retry: 'Попробовать снова',

    // Контакты
    nav_contact: 'Контакты',
    contact_title: 'Контакты',
    contact_subtitle:
      'Напишите нам — отвечаем по будням. Для автосалонов есть отдельная форма.',
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

    // Баннер согласия на куки. Одна фраза и одна кнопка — по макету:
    // ссылки «Подробнее» нет намеренно, документы и так доступны из
    // подвала на каждой странице.
    // Текст называет цель — аналитику: человек соглашается на неё, а не
    // на «удобство» вообще. Технические куки (сессия, выбор языка)
    // согласия не требуют и работают при любом ответе.
    cookie_banner_text:
      'Мы используем куки для аналитики посещений',
    cookie_banner_accept: 'Принять',
    cookie_banner_reject: 'Отклонить',
    // Подпись для скринридера: сама плашка — региональный ориентир,
    // и без имени он читается как безымянный «регион».
    cookie_banner_aria: 'Уведомление об использовании куки',

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
    otp_err_invalid: 'Неверный код из письма',
    otp_err_failed: 'Не удалось подтвердить код. Попробуйте ещё раз',
    otp_err_quota:
      'Превышен суточный лимит писем на этот адрес. Попробуйте завтра.',
    // Отказ по дублю (trg_cars_prevent_duplicate, миграция 0093).
    // База отдаёт свой текст, но он технический и с кодом ошибки —
    // продавцу показываем этот.
    sell_err_duplicate:
      'Объявление об этой машине уже существует. Отредактируйте его или снимите с публикации.',

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
    // Вопрос перед выходом. Повторный вход требует SMS-кода, поэтому
    // случайное нажатие стоит человеку всей процедуры входа заново.
    // Диалог объясняет и то, что НЕ теряется: объявления и переписка
    // остаются на аккаунте. Без этой строки выход выглядит опаснее,
    // чем есть, — люди боятся, что удаляют профиль.
    my_logout_confirm: 'Выйти из аккаунта?',
    my_logout_confirm_text:
      'Ваши объявления и переписка сохранятся — аккаунт не удаляется. Для повторного входа понадобится код на ту же почту.',
    my_logout_confirm_yes: 'Выйти',

    // Вход в кабинет. Код запрашивается только когда сессии нет: она
    // живёт между визитами, как и в приложении.
    my_auth_title: 'Вход',
    my_auth_lead:
      'Введите адрес почты — пришлём код. Один аккаунт работает на любом устройстве и в любом браузере.',
    my_auth_phone: 'Номер телефона',
    my_auth_code: 'Код из SMS',
    my_auth_send: 'Получить код',

    auth_tab_phone: 'Телефон',
    auth_tab_email: 'Почта',
    auth_email_label: 'Адрес электронной почты',
    auth_email_ph: 'vasha@pochta.rs',
    auth_email_code: 'Код из письма',
    auth_email_sent_to: 'Мы отправили код на адрес',
    auth_email_change: 'Изменить адрес',
    // Отказ гейта больше не означает «адреса нет»: регистрация по
    // почте открыта (0107), и незнакомый адрес пропускается. Остались
    // две причины — исчерпанная квота и неверная форма адреса, о них
    // текст и говорит.
    auth_email_not_allowed:
      'Слишком много попыток или адрес неверный. Проверьте адрес и попробуйте позже.',
    auth_email_invalid: 'Введите корректный адрес электронной почты.',
    my_auth_submit: 'Войти',
    my_auth_checking: 'Проверяем…',
    // Временный текст разделов, которые приходят в следующих пакетах.
    my_soon: 'Раздел готовится и появится в ближайшее время.',

    // Статусы объявления — те же формулировки, что в приложении
    // (app_strings.dart: statusModeration … statusSold).
    my_status_moderation: 'На проверке',
    my_status_active: 'Опубликовано',
    my_status_archived: 'В архиве',
    my_status_expired: 'Истекло',
    my_extend: 'Продлить',
    my_extend_all: 'Продлить все объявления',
    my_extend_done: 'Продлено объявлений: {n}',
    my_expires_at: 'Истекает {date}',
    my_expired_hint:
      'Срок публикации истёк — объявления нет в каталоге. Продлите одним нажатием, всё сохранено.',
    my_expiring_soon: 'Скоро истечёт',
    my_expiry_banner:
      'Часть ваших объявлений скоро истекает или уже скрыта из каталога.',
    car_expired_notice:
      'Это объявление больше не опубликовано — срок публикации истёк.',
    my_status_rejected: 'Отклонено',
    my_status_sold: 'Продано',
    // Причина отклонения приходит из moderation_comment.
    my_rejected_reason: 'Причина отклонения',
    // Объявление, снятое администратором (cars.archived_by = 'admin',
    // миграция 0089). Отдельный бейдж, а не обычное «В архиве»:
    // продавец такое объявление сам вернуть не может и должен видеть,
    // за что его сняли.
    my_status_archived_by_admin: 'Снято администратором',
    my_archived_reason: 'Причина снятия',
    // Путь назад в выдачу: исправить замечание и отправить на
    // повторную проверку. Кнопки «Вернуть» нет — решение
    // администратора продавец не отменяет, но замечание устраняет сам.
    my_archived_fix_hint:
      'Исправьте замечание и сохраните — объявление уйдёт на повторную проверку.',

    // Метрики объявления.
    my_metric_views: 'Просмотры',
    my_metric_favorites: 'В избранном',
    my_metric_contacts: 'Контакты',

    // Действия над объявлением.
    my_action_archive: 'Снять',
    // См. комментарий в сербском словаре.
    my_action_delete: 'Удалить',
    my_confirm_delete: 'Удалить объявление? Восстановить не получится.',
    my_action_restore: 'Вернуть',
    my_action_sold: 'Продано',
    // «Поднять», а не «Продвинуть»: на рынке объявлений это устоявшееся
    // название действия, и оно короче — важно для кнопки в узкой
    // колонке кабинета.
    my_action_promote: 'Поднять',
    // Подтверждение в два шага: вопрос + Да/Отмена.
    my_confirm_archive: 'Снять объявление с публикации?',
    my_confirm_restore: 'Вернуть объявление в публикацию?',
    my_confirm_sold: 'Отметить проданным?',
    // Вопрос перед правкой АКТИВНОГО объявления: правка по существу
    // отправляет его на повторную модерацию (update_car_v3), и оно
    // временно пропадает из выдачи. Объявление, которое уже на
    // модерации или отклонено, этот вопрос не получает — там терять
    // нечего.
    my_confirm_edit: 'Правка отправит объявление на повторную модерацию — оно временно пропадёт из выдачи. Продолжить?',
    my_confirm_yes: 'Да',
    my_confirm_no: 'Отмена',
    my_action_busy: 'Сохраняем…',
    // ------------------------------------------------------------
    // Продвижение (activate_promotion, миграция 0092).
    // ------------------------------------------------------------
    // Правила: 7 дней, доступно с 15-го дня после подачи, не чаще
    // одного раза в 30 дней. Даты в подсказках подставляются рядом
    // с текстом, а не внутрь строки: словарь здесь плоский, без
    // шаблонов, и такой приём уже используется (my_promoted_until).
    my_promoted_until: 'Продвигается до',
    my_promote_days: 'Бесплатно, 7 дней в начале выдачи',
    // Тост после успешного нажатия и подсказка при повторном.
    my_promote_done: 'Продвижение включено до',
    // Кнопка нажата раньше срока: объявление молодое либо не прошло
    // 30 дней с прошлого подъёма. Текст один на оба случая —
    // человеку важна дата, а не то, какое из двух правил сработало.
    my_promote_wait: 'Поднять объявление будет доступно с',

    // Сводная статистика (get_my_stats_totals).
    my_totals_title: 'Всего',
    my_totals_listings: 'Объявления',

    // Пустое состояние.
    my_empty_title: 'У вас пока нет объявлений',
    my_empty_text: 'Разместите первое — продажа начинается отсюда.',
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
    // Сессия истекла, пока форма была открыта. Раньше здесь стояло
    // сообщение про SMS-код — в режиме правки оно бессмысленно:
    // никакого кода форма не запрашивает.
    edit_err_session: 'Сессия истекла. Войдите заново и попробуйте ещё раз.',
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
    chat_back: 'Все чаты',
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
    // См. комментарий в сербском словаре.
    car_call_show: 'Показать номер',
    car_call_loading: 'Загрузка…',
    // См. комментарий в сербском словаре.
    car_call_failed: 'Номер сейчас недоступен',

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
    // См. комментарий у sr-версии этой группы.
    notif_open_showcase: 'Открыть витрину',
    notif_open_profile: 'Открыть профиль',
    notif_tag_dealer_ok: 'Статус подтверждён',
    notif_tag_dealer_no: 'Заявка отклонена',
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
    // Подпись под полем телефона. Прежний текст «номер используется
    // для входа и не меняется» устарел: вход идёт по почте (0106), а
    // телефон стал контактом, который видит покупатель в объявлении.
    profile_phone_hint:
      'Номер видят покупатели в ваших объявлениях; он подставляется при подаче',
    // Ошибка сохранения: номер не подходит под сербский формат. Та же
    // граница, что у ограничения базы cars_contact_phone_serbian —
    // городские 011, 021, 018 проходят наравне с мобильными.
    profile_phone_invalid: 'Введите корректный номер телефона',
    profile_email: 'E-mail',
    // Подпись под полем почты. Вход идёт по SMS, поэтому адрес пуст,
    // пока владелец не укажет его сам, — а без адреса решение
    // модерации некуда отправить, кроме кабинета.
    profile_email_hint:
      'На этот адрес приходит решение по объявлению. Оставьте пустым, если письма не нужны.',
    // Почта больше не редактируется: она служит входом (0106).
    // Подсказка говорит и о её роли, и о том, куда идти за сменой.
    profile_email_locked:
      'По этому адресу вы входите на сайт. Для смены напишите нам.',
    profile_email_invalid: 'Проверьте адрес электронной почты',
    profile_email_taken: 'Эта почта уже используется другим аккаунтом',
    profile_avatar: 'Фотография',
    profile_avatar_change: 'Изменить',
    profile_seller_kind: 'Тип продавца',
    profile_private: 'Частное лицо',
    profile_dealer: 'Автосалон',
    profile_company: 'Название автосалона',
    profile_company_required: 'Укажите название автосалона',
    // См. комментарий у sr-версии ключей.
    // См. комментарий у sr-версии ключа.
    // См. комментарий у sr-версии ключей.
    profile_cover: 'Обложка салона',
    profile_cover_hint:
      'Рекомендуем 1500×1000 (пропорция 3:2), минимум 900×600. Картинка занимает всю карточку салона в каталоге и верх вашей страницы, а данные стоят полосой поверх низа — держите главное в верхней части кадра. Без картинки показываем фирменный фон.',
    profile_cover_empty: 'Обложка ещё не загружена',
    profile_cover_change: 'Загрузить обложку',
    profile_cover_replace: 'Заменить обложку',
    profile_showcase: 'Моя витрина',
    profile_save: 'Сохранить',
    profile_saving: 'Сохраняем…',
    profile_saved: 'Изменения сохранены',
    profile_error: 'Не удалось. Попробуйте ещё раз.',
    profile_avatar_error: 'Не удалось загрузить фотографию',
    profile_avatar_preparing: 'Готовим…',

    // ------------------------------------------------------------
    // ЗАЯВКА НА СТАТУС АВТОСАЛОНА (миграция 0100).
    // ------------------------------------------------------------
    // См. пояснение у sr-версии этой группы.
    dealer_app_title: 'Продаёте как автосалон?',
    dealer_app_intro:
      'У автосалона есть своя страница в каталоге. Поэтому статус подтверждает администратор — отправьте данные компании, и мы свяжемся с вами.',
    dealer_app_open: 'Оставить заявку',
    dealer_app_cancel: 'Отмена',
    dealer_app_submit: 'Отправить заявку',
    dealer_app_sending: 'Отправляем…',

    // Названия реквизитов оставлены сербскими и в русской версии:
    // PIB и «матични број» человек ищет в своей выписке из APR
    // именно под этими словами, и перевод «регистрационный номер»
    // заставил бы его гадать, та ли это строка. Русское пояснение
    // идёт в скобках вторым — оно подсказывает смысл, но не
    // подменяет термин, который надо найти в документе.
    dealer_app_company: 'Название автосалона',
    dealer_app_tax_id: 'PIB (налоговый номер)',
    dealer_app_tax_id_hint: '9 цифр из выписки APR',
    dealer_app_reg_num: 'Матични број (рег. номер)',
    dealer_app_reg_num_hint: '8 цифр из выписки APR',
    dealer_app_city: 'Город',
    dealer_app_person: 'Контактное лицо',
    dealer_app_phone: 'Телефон для связи',
    dealer_app_email: 'Email',
    dealer_app_website: 'Сайт',
    dealer_app_comment: 'Комментарий',
    dealer_app_comment_ph: 'Что ещё нам полезно знать',
    dealer_app_required: 'Обязательные поля',

    dealer_app_pending_title: 'Заявка отправлена',
    dealer_app_pending_text:
      'Проверяем данные компании. Свяжемся с вами по контактам из заявки.',
    dealer_app_pending_since: 'Отправлена',

    // См. комментарий в сербском словаре: заголовок называет предмет
    // заявки, потому что блок читают спустя дни после отказа.
    dealer_app_rejected_title:
      'К сожалению, пока не можем одобрить заявку на автосалон',
    dealer_app_rejected_reason: 'Причина',
    // См. комментарий в сербском словаре.
    dealer_app_rejected_at: 'Решение принято',
    dealer_app_retry: 'Новая заявка',

    dealer_app_approved_title: 'Статус автосалона подтверждён',
    dealer_app_approved_text:
      'Данные салона ниже видят покупатели на вашей странице и в каталоге.',
    dealer_app_leave: 'Перевести аккаунт на частное лицо',
    dealer_app_leave_confirm:
      'Карточка салона и данные витрины пропадут из каталога. Объявления останутся. Продолжить?',

    dealer_app_err_pending: 'Заявка уже отправлена и ждёт решения',
    dealer_app_err_already: 'У вас уже есть статус автосалона',
    dealer_app_err_tax_id: 'PIB состоит из 9 цифр',
    dealer_app_err_reg_num: 'Матични број состоит из 8 цифр',
    dealer_app_err_company: 'Укажите название автосалона',
    // См. комментарий в сербском словаре.
    dealer_app_err_city: 'Укажите город',
    dealer_app_err_person: 'Укажите контактное лицо',
    dealer_app_err_phone: 'Укажите телефон',
    dealer_app_err_email: 'Проверьте email',
    dealer_app_err_long: 'Одно из полей слишком длинное — сократите текст',
    dealer_app_err_auth: 'Сессия истекла. Войдите заново.',
    dealer_app_err_unknown: 'Не удалось. Попробуйте ещё раз.',

    // ------------------------------------------------------------
    // Навигация по контентным страницам.
    // ------------------------------------------------------------
    nav_about: 'О площадке',
    nav_how: 'Как это работает',
    nav_faq: 'Вопросы',
    nav_menu: 'Меню',
    nav_aria_main: 'Основная навигация',
    nav_aria_breadcrumbs: 'Хлебные крошки',
    nav_aria_footer: 'Навигация в подвале',
    // Вход и кабинет: шапка, бургер, подвал, страница /login.
    nav_login: 'Войти',
    nav_my: 'Мои объявления',
    login_title: 'Вход в кабинет',
    nav_menu_close: 'Закрыть меню',
    common_close: 'Закрыть',
    gallery_prev: 'Предыдущая фотография',
    gallery_next: 'Следующая фотография',
    gallery_open: 'Открыть фотографию на весь экран',
    // См. пояснение в сербском словаре: крестик кабинета уводит на
    // главную, и подпись обязана это называть.
    my_close: 'Закрыть кабинет и перейти на главную',
    // См. комментарий у sr-версии этой группы.
    showcase_section: 'Витрина салона',
    showcase_section_hint:
      'Это покупатели видят на карточке вашего салона в выдаче.',
    // См. комментарий у sr-версии ключей.
    showcase_tagline: 'Слоган салона',
    showcase_tagline_hint:
      'Одна фраза под названием салона на карточке в каталоге.',
    showcase_city: 'Город салона',
    showcase_city_hint:
      'Город показывается на карточке салона в выдаче.',
    showcase_city_empty: 'Не указан',
    showcase_phone: 'Телефон салона',
    showcase_phone_hint:
      'Публичный номер компании. Номер входа в аккаунт он не меняет.',
    showcase_hours: 'Часы работы',
    // См. комментарий у sr-версии ключей.
    showcase_hours_from: 'Работаем с',
    showcase_hours_to: 'до',
    showcase_hours_hint:
      'Впишите только время. На карточке салона получится: «Работаем с 9:00 до 19:00».',
    showcase_err_hours_time: 'Время впишите как 9:00 или 19:30',
    showcase_err_tagline: 'Слоган слишком длинный (не больше 90 символов)',
    showcase_err_phone: 'Телефон слишком длинный',
    showcase_err_hours: 'Часы работы слишком длинные',
    // См. комментарий у sr-версии ключей.
    showcase_ph_name: 'Название автосалона',
    showcase_ph_tagline: 'Короткий слоган салона',
    showcase_ph_city: 'Город',
    common_back: 'Назад',

    // ------------------------------------------------------------
    // /dealers — выгоды для автосалона.
    // ------------------------------------------------------------
    dealers_benefit_1_title: 'Публикация без ожидания',
    dealers_benefit_1_text:
      'Объявления салонов-партнёров попадают на сайт сразу, без модерации.',
    dealers_benefit_2_title: 'Страница автосалона',
    dealers_benefit_2_text:
      'Все ваши автомобили в одном месте, под названием салона и вашей обложкой.',
    dealers_benefit_3_title: 'Покупатели со всей Сербии',
    dealers_benefit_3_text:
      'Объявления видят покупатели по всей Сербии, с любых устройств.',

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
    // См. комментарий в сербском словаре.
    dealers_err_tax_id: 'PIB состоит из 9 цифр.',
    dealers_err_email: 'Проверьте email.',
    // См. комментарий в сербском словаре.
    dealers_err_already_dealer:
      'У вашего аккаунта уже есть статус автосалона — заявка не нужна.',
    dealers_err_application_exists:
      'Заявка по этой компании уже отправлена и ждёт рассмотрения.',
    dealers_err_lead_exists:
      'Заявка по этой компании уже отправлена. Свяжемся с вами в ближайшее время.',
    dealers_err_city: 'Выберите город.',
    dealers_err_reg_num: 'Матични број состоит из 8 цифр.',
    dealers_details_hint: 'Данные сверяем с APR.',
    dealers_err_rate: 'С этого номера заявка уже отправлена. Попробуйте завтра.',
    dealers_err_unknown: 'Произошла ошибка. Попробуйте ещё раз.',

    // ------------------------------------------------------------
    // /install — установка сайта на телефон (PWA).
    // ------------------------------------------------------------
    install_title: 'Быстрый доступ',
    // Вводный блок над карточками платформ.
    install_intro_title: 'RS Auto работает как приложение',
    install_intro_body:
      'Добавьте RS Auto на главный экран телефона — и он откроется как '
      + 'обычное приложение: со своей иконкой, на весь экран, без адресной '
      + 'строки браузера. Займёт пару секунд.',
    // Шаги. Двойные звёздочки выделяют название кнопки полужирным —
    // разбор в components/InstallGuide.tsx. Приём взят из приложения
    // (Baza), где жирные фрагменты вынесены отдельными ключами ARB;
    // здесь маркер прямо в строке — переводчику так виднее контекст.
    install_android_title: 'Android (Chrome)',
    install_android_1: 'Откройте RS Auto в браузере **Chrome**.',
    install_android_2: 'Нажмите на **три точки** в правом верхнем углу.',
    install_android_3:
      'Выберите **«Установить приложение»** или **«Добавить на главный экран»**.',
    install_android_4:
      'Подтвердите **«Установить»** — иконка RS Auto появится на экране.',
    install_ios_title: 'iPhone / iPad (Safari)',
    install_ios_1:
      'Откройте RS Auto в браузере **Safari** (в других браузерах на iOS '
      + 'установка недоступна).',
    install_ios_2:
      'Нажмите кнопку **«Поделиться»** — квадрат со стрелкой вверх, внизу экрана.',
    install_ios_3:
      'В списке выберите **«На экран „Домой“»** (On Home Screen).',
    install_ios_4:
      'Нажмите **«Добавить»** — иконка RS Auto появится на главном экране.',
    // Подпись номера шага для скринридера: кружок с цифрой от него
    // скрыт, и без неё шаги читались бы сплошным списком без номеров.
    install_step: 'Шаг',
    // Плашка на карточке платформы, с которой человек зашёл.
    install_your_device: 'ваше устройство',


    // ------------------------------------------------------------
    // Страница продавца / автосалона.
    // ------------------------------------------------------------
    dealer_page_since: 'На площадке с',
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
      'JPG, PNG, WebP или HEIC. Первая фотография — главная.',
    sell_photos_preparing: 'Готовим фотографии…',
    sell_photos_cover: 'Главная',
    sell_photos_move_left: 'Сдвинуть влево',
    sell_photos_move_right: 'Сдвинуть вправо',
    sell_photos_remove: 'Удалить фотографию',
    sell_photos_uploading: 'Загрузка фотографий',
    sell_err_photos_required: 'Добавьте хотя бы одну фотографию автомобиля.',
    sell_err_photo_type: 'Поддерживаются форматы JPG, PNG, WebP и HEIC.',
    sell_err_photo_size: 'Фотография слишком большая — не больше 25 МБ.',
    // HEIC в браузере без системного декодера (всё, кроме Safari).
    // Сообщение обязано говорить ЧТО СДЕЛАТЬ, а не только что не вышло.
    sell_err_photo_heic:
      'HEIC открывается только в Safari. На iPhone включите «Наиболее совместимые» (Настройки → Камера → Форматы) или отправьте JPG.',
    sell_err_photo_decode:
      'Не удалось обработать фотографию. Попробуйте другую.',
    sell_err_photos_max: 'Не больше 15 фотографий.',

    // ------------------------------------------------------------
    // /about — о площадке.
    // ------------------------------------------------------------
    about_title: 'О нас',
    about_meta_desc:
      'RS Auto — площадка для покупки, продажи и аренды автомобилей в Сербии. Объявления бесплатны, с продавцом можно связаться прямо на сайте.',
    about_lead:
      'RS Auto — автомобильный маркетплейс в Сербии. Мы соединяем тех, кто продаёт или сдаёт машину, с теми, кто её ищет, — без посредников и без комиссии с продажи.',

    about_mission_title: 'Наша задача',
    about_mission_text:
      'Покупка подержанного автомобиля — решение на несколько тысяч евро, а принимается оно чаще всего по неполным данным. Мы добиваемся, чтобы объявление отвечало на главные вопросы сразу: настоящая цена, реальный пробег, фотографии машины и город, где она стоит. Чем честнее объявление, тем меньше потерянного времени у обеих сторон.',

    about_how_title: 'Как устроена площадка',
    about_how_1_title: 'Одна база объявлений',
    about_how_1_text:
      'Все объявления в одном месте — одна и та же витрина, с какого устройства ни смотри. Двух разных витрин не существует.',
    about_how_2_title: 'Проверка до публикации',
    about_how_2_text:
      'Каждое объявление проходит модерацию. Машины с перебитыми номерами, выдуманными ценами и мошеннические тексты до каталога не доходят.',
    about_how_3_title: 'Переписка на сайте',
    about_how_3_text:
      'Продавцу пишут прямо из объявления, а переписка идёт в личном кабинете на сайте, поэтому личный номер телефона не попадает в базы для спам-обзвона.',

    about_buyer_title: 'Покупателю',
    about_buyer_1: 'Поиск по марке, модели, году, цене и городу.',
    about_buyer_2:
      'Сохранённый поиск с уведомлением, как только появится подходящая машина.',
    about_buyer_3: 'Уведомление, когда продавец снизит цену на отслеживаемый автомобиль.',
    about_buyer_4: 'Связь с продавцом без раскрытия своего номера телефона.',

    about_seller_title: 'Продавцу',
    about_seller_1: 'Размещение объявления бесплатно, комиссии с продажи нет.',
    about_seller_2: 'Объявление подаётся прямо на сайте, за несколько минут.',
    about_seller_3: 'Одно и то же объявление видят покупатели по всей Сербии, с любых устройств.',
    about_seller_4: 'Продвижение — возможность, а не условие публикации.',

    about_dealer_title: 'Автосалонам',
    about_dealer_1: 'Отдельная страница салона со всем автопарком.',
    about_dealer_2: 'Публикация без ожидания для салонов-партнёров.',
    about_dealer_3: 'Каждое объявление ведёт на страницу вашего салона.',
    about_dealer_4: 'Покупатели со всей Сербии, с любых устройств.',

    about_cta_title: 'Есть автомобиль на продажу?',
    about_cta_text: 'Разместите объявление за несколько минут — бесплатно.',

    // ------------------------------------------------------------
    // /how-it-works — как это работает.
    // ------------------------------------------------------------
    how_title: 'Как это работает',
    how_meta_desc:
      'Как работает RS Auto: поиск авто по фильтрам, сохранённый поиск, прямая связь с продавцом. Четыре сценария — покупка, продажа, аренда, автосалон.',
    how_lead:
      'Три сценария — покупка, продажа и работа автосалона. Выберите свой и следуйте шагам.',

    how_buyer_title: 'Покупаю автомобиль',
    how_buyer_1_title: 'Найдите машину',
    how_buyer_1_text:
      'Откройте каталог и сузьте выбор фильтрами: марка, модель, год, цена, пробег и город. Результатом можно поделиться ссылкой — фильтры сохраняются в адресе.',
    how_buyer_2_title: 'Сохраните поиск',
    how_buyer_2_text:
      'Если подходящей машины сейчас нет, сохраните ссылку на поиск — фильтры остаются в адресе. Вернитесь по ней и сразу увидите, что появилось нового.',
    how_buyer_3_title: 'Напишите продавцу',
    how_buyer_3_text:
      'Продавцу пишут прямо из объявления. Ваш номер телефона остаётся скрытым, а вся переписка собрана в личном кабинете.',

    how_seller_title: 'Продаю автомобиль',
    how_seller_1_title: 'Подайте объявление',
    // См. комментарий в сербском словаре.
    how_seller_1_text:
      'Заполните форму из четырёх шагов: автомобиль, детали, фотографии и контакты. Код подтверждения придёт на почту — это же и есть вход, отдельная регистрация не нужна. Телефон остаётся контактом для покупателей.',
    how_seller_2_title: 'Дождитесь проверки',
    how_seller_2_text:
      'Объявление уходит на модерацию. Обычно она занимает до суток. После одобрения оно появляется в каталоге, и его видят покупатели по всей Сербии.',
    how_seller_3_title: 'Получайте сообщения',
    how_seller_3_text:
      'Заинтересованные покупатели пишут вам прямо на сайте — сообщения и уведомления ждут в личном кабинете. Когда машина продана, отметьте объявление как проданное.',

    // См. комментарий в сербском словаре.
    how_rent_title: 'Сдаю автомобиль в аренду',
    how_rent_1_title: 'Выберите аренду',
    how_rent_1_text:
      'Форма та же, что для продажи, — на первом шаге выберите «Аренда» вместо «Продажа». Вместо цены автомобиля указываете стоимость за день и залог.',
    how_rent_2_title: 'Задайте условия',
    how_rent_2_text:
      'Залог может быть нулевым — так и будет указано в объявлении. Минимальный срок аренды — один день, остальное вы обсуждаете с клиентом напрямую.',
    how_rent_3_title: 'Принимайте заявки',
    how_rent_3_text:
      'Объявление попадает в отдельный каталог аренды. Заинтересованные звонят или пишут со страницы объявления — так же, как при продаже.',
    // См. комментарий в сербском словаре.
    how_rent_cta: 'Подать объявление',

    how_dealer_title: 'У меня автосалон',
    how_dealer_1_title: 'Оставьте заявку',
    how_dealer_1_text:
      'Заполните короткую форму на странице для автосалонов: название салона, контактное лицо и телефон. Мы свяжемся и обсудим детали.',
    how_dealer_2_title: 'Получаете страницу салона',
    how_dealer_2_text:
      'Все ваши машины в одном месте, с названием салона и обложкой. Покупатели сразу видят, что имеют дело с компанией, а не с частным лицом.',
    how_dealer_3_title: 'Размещаете весь автопарк',
    how_dealer_3_text:
      'Объявления салонов-партнёров попадают на сайт сразу, без ожидания модерации. Их видят покупатели по всей Сербии.',

    how_step: 'Шаг',

    // ------------------------------------------------------------
    // /faq — вопросы и ответы.
    // ------------------------------------------------------------
    faq_title: 'Вопросы и ответы',
    faq_meta_desc:
      'Ответы на вопросы о продаже и аренде авто в Сербии: размещение, модерация, связь с продавцом, условия для автосалонов.',
    faq_lead: 'Не нашли ответа — напишите нам через страницу «Контакты».',
    faq_group_general: 'Общее',
    faq_group_buyer: 'Покупателям',
    faq_group_seller: 'Продавцам',
    faq_group_dealer: 'Автосалонам',
    faq_more_title: 'Не нашли ответ?',
    faq_more_text: 'Напишите нам — отвечаем по будням.',

    // ------------------------------------------------------------
    // Метаданные страниц (title/description для поиска).
    // ------------------------------------------------------------
    // См. комментарий в сербском словаре: бренд убран из начала,
    // потому что соцсеть показывает его отдельной строкой сама.
    meta_home_title: 'Купить, продать или арендовать авто в Сербии',
    meta_home_desc:
      'Б/у и новые автомобили от частников и автосалонов Белграда, Нови-Сада и всей Сербии. Бесплатное размещение, проверенные объявления, сербский и русский языки.',
    // См. комментарий в сербском словаре.
    meta_catalog_desc:
      'Автомобили на продажу в Сербии. Поиск по марке, модели, городу и цене.',
    meta_all_desc:
      'Автомобили в Сербии: продажа и аренда. Поиск по марке, модели, городу и цене.',
    meta_rent_desc:
      'Аренда авто в Сербии: объявления от частных владельцев и салонов. Цена за день, город, марка, модель. Связь с арендодателем напрямую.',
    meta_sell_desc:
      'Разместите объявление о продаже или аренде авто в Сербии бесплатно. Подача за 10 минут, покупатели пишут напрямую, комиссия с продажи — 0%.',
    meta_dealers_desc:
      'Страница автосалона в каталоге RS Auto: витрина, весь автопарк, покупатели со всей Сербии. Бесплатное размещение для салонов-партнёров.',
    // См. комментарий в сербском словаре: телефона поддержки нет.
    meta_contact_desc:
      'Свяжитесь с RS Auto: электронная почта поддержки и форма обращения. Отвечаем по будням.',
    meta_terms_desc:
      'Условия использования платформы RS Auto — объявления о продаже и аренде автомобилей в Сербии.',
    meta_privacy_desc:
      'Политика конфиденциальности RS Auto — как мы обрабатываем и защищаем персональные данные пользователей.',

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
