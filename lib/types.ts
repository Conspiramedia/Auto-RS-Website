// ============================================================
// RS AUTO — Типы данных сайта.
// ============================================================
// Типы повторяют RETURNS TABLE соответствующих RPC в Supabase.
// При изменении сигнатуры функции в миграции — правится и здесь.
//
// ВАЖНО: сайт работает только с продажей (is_for_sale). Поля аренды
// (rent_price_daily, deposit_amount) намеренно не включены в типы —
// аренда выключена продуктовым решением, и её отсутствие должно быть
// видно на уровне компиляции, а не только в рантайме.
// ============================================================

// Режим витрины. Значение уходит в p_listing_type RPC search_cars_public
// (миграция 0055) — набор строк обязан совпадать с миграцией.
// 'both' используется общим поиском; отдельной страницы у него нет.
export type ListingType = 'sale' | 'rent' | 'both';

// Строка каталога. Источник: RPC search_cars_public (миграции 0051, 0055).
// Доступность автомобиля. Зеркалит enum car_availability из базы
// (миграция 0119). Три значения вместо пары булевых флагов: машина не
// может быть одновременно «под заказ» и «в пути», и запрет на такое
// сочетание должен жить в типе, а не в проверке.
export type CarAvailability = 'in_stock' | 'on_order' | 'in_transit';

// Состояние автомобиля. Зеркалит enum car_condition из базы
// (миграция 0138).
//
// ЭТО ДРУГАЯ ОСЬ, НЕ ПУТАТЬ С CarAvailability ВЫШЕ. Доступность —
// логистика салона («когда я смогу её увидеть»), состояние —
// физическое и юридическое состояние самой машины («что именно я
// получу»). Сочетания осмысленны: салон везёт битую машину
// ('in_transit' + 'damaged') или берёт под заказ донора на разборку
// ('on_order' + 'parts'), и на карточке оба бейджа стоят рядом.
//
// Второе отличие от доступности: состояние доступно ВСЕМ продавцам,
// а не только салонам. Битую машину продаёт и частник.
export type CarCondition =
  | 'normal'
  | 'damaged'
  | 'parts'
  | 'no_docs'
  | 'salvage'
  | 'for_export';

// Состояния для селектора в форме подачи и для бейджей каталога.
// Порядок — от лёгкого к тяжёлому, 'normal' первым как значение по
// умолчанию.
//
// Ключи цвета совпадают с группой condition в lib/brand.ts, а классы
// перечислены ПОЛНОСТЬЮ, а не собраны из кусков: Tailwind сканирует
// исходники статически и класс, собранный конкатенацией
// (`bg-condition-${key}`), в сборку не попадёт.
//
// 'normal' цвета и бейджа не имеет намеренно: обычная машина —
// состояние по умолчанию у подавляющего большинства объявлений, и
// плашка о нём была бы шумом в каждой карточке.
//
// Поле icon — цвет ОДНОГО ЗНАЧКА на нейтральном фоне: им покрашены
// иконки в селекторе формы подачи. Там сам вариант выделяется
// акцентной рамкой (ui/segmented.ts), а цвет состояния несёт только
// значок — иначе сетка из шести цветных плашек читалась бы как
// светофор.
export const CAR_CONDITIONS = [
  { key: 'normal', badge: null, surface: null, icon: null },
  {
    key: 'damaged',
    badge: 'bg-condition-damaged text-white',
    surface: 'bg-condition-damaged-soft text-condition-damaged',
    icon: 'text-condition-damaged',
  },
  {
    key: 'parts',
    badge: 'bg-condition-parts text-white',
    surface: 'bg-condition-parts-soft text-condition-parts',
    icon: 'text-condition-parts',
  },
  {
    key: 'no_docs',
    badge: 'bg-condition-no_docs text-white',
    surface: 'bg-condition-no_docs-soft text-condition-no_docs',
    icon: 'text-condition-no_docs',
  },
  {
    key: 'salvage',
    badge: 'bg-condition-salvage text-white',
    surface: 'bg-condition-salvage-soft text-condition-salvage',
    icon: 'text-condition-salvage',
  },
  {
    key: 'for_export',
    badge: 'bg-condition-for_export text-white',
    surface: 'bg-condition-for_export-soft text-condition-for_export',
    icon: 'text-condition-for_export',
  },
] as const;

// Состояния, которые каталог скрывает по умолчанию: машина не на ходу
// либо восстановлению не подлежит. Набор обязан совпадать с условием
// в search_cars_public (миграция 0138).
//
// no_docs и for_export сюда НЕ входят: машина на ходу и в порядке,
// ограничение чисто юридическое, и прятать её от покупателя, которого
// это ограничение устраивает, незачем.
export const DAMAGED_CONDITIONS: readonly CarCondition[] = [
  'damaged',
  'parts',
  'salvage',
];

// Оформление бейджа и пояснительной плашки. Неизвестное значение и
// 'normal' дают null — вызывающий просто ничего не рисует.
export function conditionStyle(value: string | null | undefined): {
  badge: string;
  surface: string;
} | null {
  const found = CAR_CONDITIONS.find((c) => c.key === value);
  if (!found || !found.badge || !found.surface) return null;
  return { badge: found.badge, surface: found.surface };
}

export type CatalogCar = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  body_type: string | null;
  transmission: string | null;
  fuel: string | null;
  // Объём двигателя в литрах. null у электромобилей (0133).
  engine_volume: number | null;
  currency: string;
  // null означает «Договорная» — цена не указана продавцом.
  sale_price: number | null;
  // Суточная ставка аренды. Для объявлений только на продажу — null.
  rent_price_daily: number | null;
  // Залог. Осмыслен только для аренды; в продаже всегда 0.
  deposit_amount: number | null;
  // Одно объявление может быть и продажей, и арендой одновременно.
  is_for_sale: boolean;
  is_for_rent: boolean;
  city: string;
  status: string;
  // Действующее продвижение (is_vip + не истёкший boosted_until).
  is_promoted: boolean;
  site_url: string;
  photo_url: string | null;
  seller_kind: string;
  // Доступность автомобиля (миграция 0119):
  //   'in_stock'   — стоит у продавца, можно посмотреть сегодня;
  //   'on_order'   — салон привезёт под клиента;
  //   'in_transit' — конкретная машина куплена салоном и едет к нему.
  // Значения кроме 'in_stock' ставит только продавец со
  // seller_kind = 'dealer': у частника их гасит триггер в базе.
  // Взаимоисключение обеспечено самим типом — двух пометок сразу не
  // бывает.
  availability: CarAvailability;
  // Состояние автомобиля (0138). Ось, независимая от availability
  // выше: у объявления салона могут стоять обе пометки сразу, и
  // карточка рисует два бейджа рядом.
  condition: CarCondition;
  created_at: string;
  // Общее число объявлений по текущим фильтрам (одинаково во всех строках).
  total_count: number;
};

// Карточка объявления. Источник: RPC get_car_details (миграция 0048).
export type CarDetails = {
  id: string;
  user_id: string;
  is_for_sale: boolean;
  is_for_rent: boolean;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  body_type: string | null;
  transmission: string | null;
  fuel: string | null;
  // Объём двигателя в литрах. null у электромобилей (0133).
  engine_volume: number | null;
  currency: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  deposit_amount: number | null;
  city: string;
  description: string | null;
  contact_phone: string | null;
  rating_avg: number | null;
  reviews_count: number | null;
  // 'active' | 'sold' — объявление доступно целиком.
  // 'archived' | 'rejected' | 'moderation' постороннему приходят в
  // урезанном виде (миграция 0072): цены, описание, контакты и витрина
  // продавца обнулены, показывается экран «объявление снято».
  // Владельцу и админу все статусы приходят полностью.
  status: string;
  is_vip: boolean;
  boosted_until: string | null;
  is_promoted: boolean;
  site_url: string;
  // Витрина продавца. NULL у снятых объявлений, показанных
  // постороннему: имя человека, снявшего объявление, публиковать
  // незачем. Наличие seller_name и служит признаком полного доступа.
  seller_kind: string | null;
  seller_name: string | null;
  seller_logo_url: string | null;
  seller_avatar_url: string | null;
  seller_since: string | null;
  created_at: string;
  updated_at: string;
  // Кто снял объявление и за что (миграции 0089, 0090). Приходят
  // только владельцу и администратору: причина снятия — внутреннее
  // решение площадки о конкретном человеке, а страница снятого
  // объявления публична. Постороннему здесь всегда null.
  //
  // По ним страница правки отличает админский архив (редактируется,
  // правка уходит на повторную модерацию) от владельческого (сначала
  // возвращают в публикацию кнопкой «Вернуть»).
  archived_by: string | null;
  archived_reason: string | null;
  // Доступность автомобиля (0119). См. комментарий у CatalogCar.
  availability: CarAvailability;
  // Состояние автомобиля (0138). См. комментарий у CatalogCar.
  condition: CarCondition;
};

// Фотография объявления. Источник: RPC get_car_images (миграция 0052).
export type CarImage = {
  id: string;
  image_url: string;
  order_index: number;
};

// Похожее объявление. Источник: RPC get_similar_cars (миграции 0051, 0055).
export type SimilarCar = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  currency: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  is_for_sale: boolean;
  is_for_rent: boolean;
  city: string;
  site_url: string;
  photo_url: string | null;
};

// Марка со счётчиком. Источник: RPC get_site_brands (миграция 0052).
export type SiteBrand = {
  brand: string;
  brand_slug: string;
  cars_count: number;
};

// Модель со счётчиком. Источник: RPC get_site_models (миграция 0052).
export type SiteModel = {
  brand: string;
  brand_slug: string;
  model: string;
  model_slug: string;
  cars_count: number;
};

// Город со счётчиком. Источник: RPC get_site_cities (миграция 0052).
export type SiteCity = {
  city: string;
  city_slug: string;
  cars_count: number;
};

// Счётчики главной. Источник: RPC get_site_stats (миграции 0052, 0055).
export type SiteStats = {
  // Объявления о продаже.
  cars_total: number;
  // Объявления об аренде.
  rent_total: number;
  brands_total: number;
  cities_total: number;
  dealers_total: number;
};

// ------------------------------------------------------------
// Справочники значений enum'ов БД.
// ------------------------------------------------------------
// Ключ — значение enum в PostgreSQL (менять нельзя, оно уходит в RPC),
// значение — подписи для двух локалей сайта.
// Списки повторяют миграцию 0001_extensions_and_enums.sql приложения.

// Порядок и набор ключей повторяют enum body_type в БД
// (миграция 0001) и ReferenceData.bodyTypes приложения — все 10 значений.
//
// Ключ 'convertible', а НЕ 'cabrio': значение уходит в фильтр как есть и
// сравнивается с enum. Прежний 'cabrio' в enum отсутствовал, поэтому
// выбор «Kabriolet» молча давал пустую выдачу вместо кабриолетов.
export const BODY_TYPES: Record<string, { sr: string; ru: string }> = {
  sedan: { sr: 'Limuzina', ru: 'Седан' },
  hatchback: { sr: 'Hečbek', ru: 'Хэтчбек' },
  suv: { sr: 'Džip / SUV', ru: 'Внедорожник' },
  crossover: { sr: 'Krosover', ru: 'Кроссовер' },
  coupe: { sr: 'Kupe', ru: 'Купе' },
  wagon: { sr: 'Karavan', ru: 'Универсал' },
  minivan: { sr: 'Monovolumen', ru: 'Минивэн' },
  pickup: { sr: 'Pikap', ru: 'Пикап' },
  convertible: { sr: 'Kabriolet', ru: 'Кабриолет' },
  van: { sr: 'Kombi', ru: 'Фургон' },
};

export const TRANSMISSIONS: Record<string, { sr: string; ru: string }> = {
  manual: { sr: 'Manuelni', ru: 'Механика' },
  automatic: { sr: 'Automatik', ru: 'Автомат' },
  robot: { sr: 'Automatizovani', ru: 'Робот' },
  variator: { sr: 'CVT', ru: 'Вариатор' },
};

export const FUELS: Record<string, { sr: string; ru: string }> = {
  petrol: { sr: 'Benzin', ru: 'Бензин' },
  diesel: { sr: 'Dizel', ru: 'Дизель' },
  hybrid: { sr: 'Hibrid', ru: 'Гибрид' },
  electric: { sr: 'Električni', ru: 'Электро' },
  gas: { sr: 'Gas (TNG)', ru: 'Газ' },
};

// ------------------------------------------------------------
// Объём двигателя: ступени фильтра (миграция 0133).
// ------------------------------------------------------------
// Готовые ступени, а не пара полей «от/до»: покупатель мыслит
// классами моторов («полторашка», «двухлитровый»), а не точными
// литрами, и выбор из списка быстрее ввода двух чисел с телефона.
//
// Границы полуинтервальные: from включается, to — нет. Иначе машина
// ровно 2.0 л попала бы и в «1.6–2.0», и в «2.0–3.0», а счётчики
// результатов у соседних ступеней не сошлись бы с суммой.
//
// to: null у последней ступени — верхней границы нет. В RPC уходит
// как null, то есть «сверху не ограничивать».
export const ENGINE_VOLUMES = [
  { key: 'to_1_4', from: null, to: 1.4, sr: 'Do 1.4', ru: 'До 1.4' },
  { key: '1_4_1_6', from: 1.4, to: 1.6, sr: '1.4 – 1.6', ru: '1.4 – 1.6' },
  { key: '1_6_2_0', from: 1.6, to: 2.0, sr: '1.6 – 2.0', ru: '1.6 – 2.0' },
  { key: '2_0_3_0', from: 2.0, to: 3.0, sr: '2.0 – 3.0', ru: '2.0 – 3.0' },
  { key: 'from_3_0', from: 3.0, to: null, sr: 'Preko 3.0', ru: 'Свыше 3.0' },
] as const;

export type EngineVolumeKey = (typeof ENGINE_VOLUMES)[number]['key'];

// Проверка ступени из URL. Мусорный ?engine= не должен ронять
// каталог — по той же причине, что и у сортировки: страница обязана
// отдать контент краулеру, а не ошибку.
export function isEngineVolumeKey(
  value: string | undefined,
): value is EngineVolumeKey {
  return ENGINE_VOLUMES.some((o) => o.key === value);
}

// Границы ступени для передачи в RPC. Неизвестный ключ даёт пустые
// границы, то есть фильтр просто не применяется.
export function engineVolumeRange(value: string | undefined): {
  from: number | null;
  to: number | null;
} {
  const step = ENGINE_VOLUMES.find((o) => o.key === value);
  return { from: step?.from ?? null, to: step?.to ?? null };
}

// Точные значения объёма для формы подачи (миграция 0133).
// Список, а не свободный ввод: NumberInput принимает только целые
// (он стоит на ценах и пробеге), а расширять его ради одного поля
// значило бы рисковать всеми остальными. Шаг 0.1 от 0.6 до 6.0
// покрывает легковой транспорт; редкие моторы крупнее продавец
// укажет в описании.
//
// В БАЗУ УХОДИТ ТОЧНОЕ ЧИСЛО, а ступени ENGINE_VOLUMES работают
// поверх него в фильтре. Так карточка показывает «1.6 л», а не
// «1.4 – 1.6», и данные остаются пригодными для любых будущих
// разрезов.
export const ENGINE_VOLUME_VALUES: readonly string[] = (() => {
  const out: string[] = [];
  for (let v = 6; v <= 60; v += 1) out.push((v / 10).toFixed(1));
  return out;
})();

// Варианты сортировки каталога. Значение key уходит в p_sort RPC
// search_cars_public — набор строк обязан совпадать с миграцией 0051.
export const SORT_OPTIONS = [
  { key: 'fresh', sr: 'Najnovije', ru: 'Сначала новые' },
  { key: 'price_asc', sr: 'Cena: rastuće', ru: 'Цена: по возрастанию' },
  { key: 'price_desc', sr: 'Cena: opadajuće', ru: 'Цена: по убыванию' },
  { key: 'year_desc', sr: 'Godište: novije', ru: 'Год: новее' },
  { key: 'year_asc', sr: 'Godište: starije', ru: 'Год: старше' },
  { key: 'mileage_asc', sr: 'Kilometraža: manja', ru: 'Пробег: меньше' },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]['key'];

// Проверка значения сортировки из URL. Мусорный ?sort= не должен
// приводить к ошибке — каталог обязан отдать контент краулеру.
export function isSortKey(value: string | undefined): value is SortKey {
  return SORT_OPTIONS.some((o) => o.key === value);
}

// ------------------------------------------------------------
// Публичная карточка продавца/автосалона.
// ------------------------------------------------------------
// Возвращает RPC get_dealer_profile (миграция 0043). Одна и та же
// структура для частника и салона: у дилера display_name — название
// компании и есть logo_url, у частника — имя и аватар.
export type DealerProfile = {
  id: string;
  seller_kind: string;
  // Имя витрины: название салона либо имя частного продавца.
  // Пустым не бывает — RPC подставляет запасное значение.
  display_name: string;
  logo_url: string | null;
  avatar_url: string | null;
  member_since: string;
  active_cars: number;
  sold_cars: number;
  // Поля витрины (0095/0098). Заполнены только у салона: у частного
  // продавца RPC отдаёт по ним null.
  company_city?: string | null;
  description?: string | null;
  dealer_phone?: string | null;
  website?: string | null;
  opening_hours?: string | null;
  cover_url?: string | null;
  tagline?: string | null;
};

// Салон для широкой плитки-витрины. RPC get_showcase_dealers (0095).
//
// Отличается от DealerProfile тем, что несёт МИНИАТЮРЫ МАШИН: плитка
// показывает не только данные салона, но и его товар. Собирать их
// вторым запросом на каждый салон значило бы N+1 на странице каталога.
export type ShowcaseDealer = {
  id: string;
  display_name: string;
  logo_url: string | null;
  company_city: string | null;
  description: string | null;
  active_cars: number;
  // Адреса главных фотографий свежих объявлений салона. Пустой массив —
  // штатное состояние: у машин может не быть ни одного снимка.
  preview_photos: string[];
  // Часы работы и публичный телефон салона (миграция 0096). null —
  // салон их не заполнил; плитка такие строки просто не печатает.
  opening_hours: string | null;
  dealer_phone: string | null;
  // Обложка витрины и слоган (миграция 0098). Обложка — кадр 8:3,
  // занимающий верхнюю половину плитки; null означает, что салон её
  // не загрузил, и половину займёт description. Слоган — одна фраза
  // под названием, до 90 символов.
  cover_url: string | null;
  tagline: string | null;
  // Сайт салона (миграция 0099). Поле существовало с 0095, но в
  // плитку не доходило — RPC его не отдавала.
  website: string | null;
};

// Объявление в витрине продавца. RPC get_seller_listings (миграция 0050).
// Отличается от CatalogCar набором полей: здесь нет характеристик
// (кузов, коробка, топливо) — витрине они не нужны.
export type SellerListing = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  city: string;
  currency: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  is_for_sale: boolean;
  is_for_rent: boolean;
  status: string;
  is_promoted: boolean;
  site_url: string;
  photo_url: string | null;
  created_at: string;
};

// Объявление в избранном. RPC get_my_favorites (миграция 0130).
//
// Повторяет SellerListing и добавляет три поля: availability и
// seller_kind рисует карточка каталога (бейдж «на заказ», пометка
// «Автосалон»), а favorited_at задаёт порядок списка — новые закладки
// сверху. created_at здесь, наоборот, не нужен: сортировка идёт по
// дате закладки, а не по дате объявления.
export type FavoriteListing = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  city: string;
  currency: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  is_for_sale: boolean;
  is_for_rent: boolean;
  status: string;
  is_promoted: boolean;
  availability: string | null;
  seller_kind: string | null;
  site_url: string;
  photo_url: string | null;
  favorited_at: string;
};

// ------------------------------------------------------------
// КАБИНЕТ ПРОДАВЦА
// ------------------------------------------------------------

// Своё объявление, найденное по ключу brand+model+year при подаче.
// RPC get_my_similar_listings (миграция 0093).
//
// Нужен форме подачи для предупреждения «у вас уже есть такое
// объявление». Полей здесь намеренно мало: плашке хватает названия
// машины, статуса и адреса карточки, а метрики и цены на первом шаге
// подачи не нужны — тянуть весь MyListing ради трёх полей значило бы
// возить лишнее по сети на каждом выборе года.
export type SimilarListing = {
  car_id: string;
  brand: string;
  model: string;
  year: number;
  // moderation | active — других статусов RPC не отдаёт
  status: string;
  is_for_sale: boolean;
  is_for_rent: boolean;
  // Готовый адрес карточки с сервера (f_car_site_url): собирать его
  // на клиенте значило бы завести второй источник правды о том, как
  // выглядит ссылка на объявление.
  site_url: string;
  created_at: string;
};

// Строка списка «Мои объявления». RPC get_my_listings_stats
// (миграция 0044, расширена в 0047 и 0070).
//
// Отличается от SellerListing тем, что это ВЗГЛЯД ВЛАДЕЛЬЦА: здесь есть
// метрики (просмотры, избранное, контакты), причина отклонения и все
// статусы, включая непубличные. Витрина продавца (SellerListing) отдаёт
// только active и sold, и метрик в ней нет — чужие цифры посторонним
// не показываются.
export type MyListing = {
  car_id: string;
  brand: string;
  model: string;
  year: number;
  city: string;
  // moderation | active | archived | rejected | sold
  status: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  currency: string;
  photo_url: string | null;
  views: number;
  favorites: number;
  contacts: number;
  // Действует ли продвижение прямо сейчас — считает сервер (флаг вместе
  // со сроком), клиенту сравнивать даты не нужно.
  is_promoted: boolean;
  boosted_until: string | null;
  created_at: string;
  // Причина отклонения от модератора. Сервер отдаёт её только в статусе
  // 'rejected', в остальных приходит null.
  moderation_comment: string | null;
  is_for_sale: boolean;
  is_for_rent: boolean;
  // Кто отправил объявление в архив: 'owner' | 'admin' | 'system'
  // (миграция 0089). null — объявление не в архиве либо в архиве с
  // времён до 0089, когда авторство не фиксировалось.
  //
  // Определяет, вправе ли владелец вернуть объявление сам: снятое
  // администратором возвращает только администратор, и кабинет для
  // такого объявления показывает причину вместо кнопки «Вернуть».
  //
  // Тип — string, а не union: значение приходит из enum базы, и
  // добавление в него нового варианта не должно ломать сборку сайта.
  archived_by: string | null;
  // Причина снятия. Заполняется для админского архива; у снятого
  // владельцем остаётся null — он снял сам и причина ему известна.
  archived_reason: string | null;
  // ----------------------------------------------------------
  // Состояние кнопки «Поднять» (миграция 0092).
  // ----------------------------------------------------------
  // Считает сервер: правила (15 дней с подачи, не чаще раза в 30 дней)
  // живут в базе, и второй их экземпляр здесь неизбежно разошёлся бы
  // с первым.
  //   'available' — можно продвигать прямо сейчас;
  //   'active'    — продвижение идёт, дата ниже — «включено до»;
  //   'too_young' — объявление моложе 15 дней;
  //   'cooldown'  — не прошло 30 дней с прошлого подъёма;
  //   'blocked'   — статус не active, кнопка неприменима.
  //
  // Тип — string, а не union: значения приходят из базы, и появление
  // нового не должно ломать сборку сайта.
  promo_state: string;
  // Дата, с которой продвижение станет доступно, либо до которой оно
  // уже действует. null для 'available' и 'blocked'.
  promo_available_at: string | null;
  // Когда объявление уйдёт в expired (0113/0115). NULL у неактивных —
  // у них таймер не идёт.
  expires_at: string | null;
};

// Итоговая плашка кабинета. RPC get_my_stats_totals (миграция 0044).
// Считается по ВСЕМ объявлениям продавца, включая архив: важна общая
// отдача, а не только текущая витрина.
export type MyStatsTotals = {
  listings_count: number;
  views: number;
  favorites: number;
  contacts: number;
};

// ------------------------------------------------------------
// ЧАТ
// ------------------------------------------------------------

// Строка списка диалогов. VIEW chats_with_details (миграции 0018/0041).
// Не RPC, а представление с security_invoker: RLS вызывающего сама
// оставляет только его чаты, и отдельная функция здесь не нужна.
export type ChatListItem = {
  id: string;
  car_id: string;
  buyer_id: string;
  seller_id: string;
  created_at: string;
  // Собеседник вычисляется относительно auth.uid() внутри VIEW.
  opponent_id: string;
  opponent_name: string | null;
  opponent_avatar: string | null;
  brand: string;
  model: string;
  year: number;
  car_photo: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message: string | null;
  pinned: boolean;
  pinned_at: string | null;
  // Заблокировал ли ТЕКУЩИЙ пользователь собеседника: при true
  // отправка запрещена политикой messages_insert_participant.
  peer_blocked: boolean;
};

// Сообщение в ленте. Таблица messages напрямую под RLS.
export type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  is_read: boolean;
  created_at: string;
};

// ------------------------------------------------------------
// ПРОФИЛЬ
// ------------------------------------------------------------

// Свой профиль. Таблица profiles под политикой profiles_select_own.
// Телефон приходит из auth.users (это логин) и здесь может быть пустым
// у профилей, заведённых до перехода на вход по SMS.
export type MyProfile = {
  id: string;
  // NULL у аккаунтов, заведённых входом по SMS: auth.users.email при
  // телефонной авторизации пуст (миграция 0035). Владелец заполняет
  // адрес сам в кабинете — без него письма о модерации слать некуда.
  email: string | null;
  // Слать ли письма о новых сообщениях в чате (миграция 0132).
  // Транзакционных писем — модерация, код входа — флаг не касается:
  // отписаться от них нельзя, иначе продавец не узнает решения по
  // объявлению.
  email_on_message: boolean;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  // private | dealer
  seller_kind: string;
  company_name: string | null;
  logo_url: string | null;
  // Поля витрины салона (миграция 0095). Наполняют плитку салона в
  // каталоге и шапку его публичной страницы. Читаются прямым SELECT
  // из profiles под политикой profiles_select_own — это собственный
  // профиль владельца, и RPC ради него не нужна.
  description: string | null;
  dealer_phone: string | null;
  website: string | null;
  opening_hours: string | null;
  // Город салона. РЕДАКТИРУЕТСЯ ВЛАДЕЛЬЦЕМ — с миграции 0097, где
  // update_seller_profile получила параметр p_company_city.
  //
  // Прежде поле было внутренним: его проставлял администратор при
  // заключении договора (0085), а салон видел значение только для
  // чтения. Порядок сломался, когда город стали показывать
  // ПОКУПАТЕЛЮ — в плитке каталога и в шапке витрины: салон видел у
  // себя пустое место и не мог его заполнить, приходилось писать
  // администратору ради одной строки.
  //
  // Источников теперь два — администратор в админке (правит profiles
  // напрямую) и салон в кабинете. Конфликта нет: чьё значение
  // записано последним, то и стоит, как у любого обычного поля.
  company_city: string | null;
  // Обложка витрины и слоган (миграция 0098).
  cover_url: string | null;
  tagline: string | null;
};

// ------------------------------------------------------------
// УВЕДОМЛЕНИЯ
// ------------------------------------------------------------

// Строка ленты уведомлений. Таблица notifications (миграция 0024)
// напрямую под политикой notifications_select_own — RLS сама оставляет
// только свои записи, поэтому RPC здесь не нужна.
//
// title и body приходят из БАЗЫ и написаны по-русски: их пишут триггеры
// (0024, 0039), общие с приложением. Перевести их на сербский можно
// только заменив тексты в самих триггерах, а это затронет приложение —
// отдельная задача. Поэтому сайт показывает их как есть и НЕ пытается
// подменять словарём: расхождение «в колокольчике одно, в письме
// другое» хуже, чем русский текст на сербской версии.
export type SiteNotification = {
  id: string;
  title: string;
  body: string | null;
  // Категория: chat_message | car_approved | car_rejected |
  // booking_status_changed | … Перечень открытый — триггеры приложения
  // могут добавить свои, и падать из-за незнакомого типа лента
  // не должна.
  type: string;
  // Связанная сущность: id объявления или чата. По ней строится ссылка
  // «перейти» — какая именно, решает тип.
  action_id: string | null;
  is_read: boolean;
  created_at: string;
};

// ------------------------------------------------------------
// АДМИН-КОМНАТА (/admin)
// ------------------------------------------------------------

// Сводка дашборда: одна строка из admin_dashboard_stats() (0078).
// Все счётчики приходят как bigint, а PostgREST отдаёт bigint строкой,
// когда значение не помещается в number. На наших объёмах этого не
// случится, но supabase-js типизирует такие поля как number — оставляем
// number и не изобретаем разбор строки для гипотетического триллиона
// объявлений.
export type AdminDashboardStats = {
  queue_count: number;
  rejected_today: number;
  approved_today: number;
  active_total: number;
  users_total: number;
  users_new_7d: number;
  email_pending: number;
  // Провалившиеся письма — операционный инцидент, а не статистика:
  // продавцы не получают решений модерации, а очередь молчит.
  email_failed: number;
};

// ------------------------------------------------------------
// Автосалоны в админке (миграция 0085).
// ------------------------------------------------------------
// Карточка салона на главной админки. Все счётчики приходят из
// admin_dealer_cards() одним запросом — по одному вызову на салон
// (N+1) экран не собирается.
export type AdminDealerCard = {
  user_id: string;
  company_name: string;
  logo_url: string | null;
  company_city: string | null;
  // Публикует без модерации. Управляется тумблером в окне салона.
  trusted_seller: boolean;
  active_count: number;
  queue_count: number;
  rejected_count: number;
};

// Профиль салона для окна. Поля города, контактного лица и даты
// договора появились в 0085 и у существующих салонов пусты — окно
// не печатает незаполненные строки заглушками.
export type AdminDealerProfile = {
  user_id: string;
  company_name: string;
  logo_url: string | null;
  company_city: string | null;
  contact_person: string | null;
  // Два телефона: contact_phone — для связи по объявлениям,
  // phone — номер входа в аккаунт.
  contact_phone: string | null;
  phone: string | null;
  email: string | null;
  contract_date: string | null;
  trusted_seller: boolean;
  created_at: string;
  active_count: number;
  queue_count: number;
  rejected_count: number;
};

// ------------------------------------------------------------
// ЗАЯВКА НА СТАТУС АВТОСАЛОНА (миграция 0100).
// ------------------------------------------------------------
// НЕ ПУТАТЬ С DealerLead НИЖЕ. Это две разные сущности, и различие
// принципиальное:
//
//   dealer_leads (0053)        — маркетинговый лид с формы
//     «Автосалонам». Оставляет кто угодно, не входя на сайт; ведёт к
//     звонку менеджера. Прав не даёт никаких.
//   dealer_applications (0100) — заявка на статус от ВОШЕДШЕГО
//     пользователя с реквизитами компании. Её одобрение выдаёт
//     статус автосалона: витрину в каталоге и подпись «Автосалон» на
//     объявлениях.
//
// Слить их в одну таблицу нельзя: у лида нет пользователя, а заявка
// без пользователя бессмысленна — некому выдавать статус.
export type DealerApplication = {
  id: string;
  // pending | approved | rejected — набор задан chk_dealer_app_status.
  status: string;
  company_name: string;
  // PIB (9 цифр) и матични број (8 цифр). Хранятся строками, а не
  // числами: это идентификаторы, а не величины — ведущий ноль в них
  // значащий, и арифметики над ними не бывает.
  tax_id: string;
  registration_number: string;
  company_city: string | null;
  contact_person: string | null;
  phone: string | null;
  // Контактная почта САЛОНА из заявки (0103). Отдельно от
  // account_email ниже: заявитель входил по SMS, и рабочая почта
  // салона может отличаться от почты аккаунта — та же причина, по
  // которой phone стоит отдельно от account_phone.
  // Nullable: заявки, поданные до 0103, почты не содержат.
  email: string | null;
  website: string | null;
  comment: string | null;
  // Заполнена только у отклонённых: обязательна при status =
  // 'rejected' (chk_dealer_app_reason_required).
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
};

// Строка очереди заявок в админке: та же заявка плюс контакты
// заявителя из profiles и общее число строк под фильтром.
export type AdminDealerApplication = DealerApplication & {
  user_id: string;
  // Контакты АККАУНТА, а не заявки: заявитель входил по SMS, и
  // связаться с ним можно по номеру входа, даже если контактный
  // телефон в заявке он не указал.
  account_phone: string | null;
  account_email: string | null;
  account_name: string | null;
  // count(*) over () из admin_dealer_applications — приходит
  // одинаковым во всех строках страницы. Число, а не bigint-строка:
  // supabase-js отдаёт bigint строкой, поэтому на границе его
  // приводит Number() (см. app/admin/dealer-applications/page.tsx).
  total_count: number;
};

// ------------------------------------------------------------
// Заявка автосалона с /dealers (миграция 0053).
// ------------------------------------------------------------
// Таблица dealer_leads заполняется анонимно через RPC
// submit_dealer_lead и читается ТОЛЬКО админом (политика
// dealer_leads_select_admin). Отдельной RPC для чтения нет и не
// нужно: фильтр и сортировка здесь не бизнес-правило, а обычный
// select под уже существующей политикой — ровно как очередь
// модерации на дашборде.
export type DealerLead = {
  id: string;
  company_name: string;
  contact_name: string;
  phone: string;
  email: string | null;
  city: string | null;
  comment: string | null;
  // Реквизиты компании (0102). Необязательны: форма на /dealers
  // открыта анониму и остаётся лидом, а не заявкой на статус, —
  // поэтому здесь они nullable, в отличие от dealer_applications,
  // где PIB и матични број обязательны.
  tax_id: string | null;
  registration_number: string | null;
  website: string | null;
  // new | in_progress | done | rejected — набор задан
  // chk_dealer_lead_status в 0053.
  status: string;
  created_at: string;
};

// Строка очереди модерации для дашборда и списка проверки.
// Собирается обычным select по cars под админской RLS-политикой
// cars_select_admin_moderation (0015) — отдельная RPC не нужна.
export type AdminQueueItem = {
  id: string;
  brand: string;
  model: string;
  year: number | null;
  city: string | null;
  created_at: string;
  user_id: string;
};

// Строка очереди модерации из admin_moderation_queue (0079).
// AdminQueueItem выше остаётся для дашборда: там читается прямой
// select без контекста доверия, и тянуть ради пяти строк тяжёлую RPC
// со счётчиками по каждому владельцу незачем.
export type AdminQueueRow = {
  car_id: string;
  brand: string;
  model: string;
  year: number;
  city: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  currency: string;
  photo_url: string | null;
  photos_count: number;
  owner_name: string | null;
  // Контекст доверия: сколько всего подавал и сколько отклонено сейчас.
  owner_listings_total: number;
  owner_rejected_count: number;
  created_at: string;
  // Общее число в очереди — одинаково во всех строках ответа.
  total_count: number;
  // Объявление уже проходило через решение администратора: его
  // отклоняли или снимали с публикации, владелец исправил замечание и
  // прислал снова (миграция 0091). Такие идут в начале очереди.
  //
  // Модератору это важно знать до того, как он откроет карточку: у
  // возврата разбор другой — не «допустимо ли это объявление вообще»,
  // а «устранено ли конкретное замечание».
  returned_after_decision: boolean;
  // Причина последнего решения администратора. Null у первой подачи и
  // у решения, записанного без причины.
  last_decision_reason: string | null;
};

// Фотография в карточке модерации (jsonb-массив из admin_get_car).
export type AdminCarPhoto = {
  image_url: string;
  order_index: number;
};

// Запись истории модерации по объявлению (jsonb-массив из
// admin_get_car). payload — свободный jsonb из журнала: у отклонения
// там reason, у одобрения prev_status.
//
// action — строка, а не union из четырёх кодов: перечень открытый.
// Новое действие в журнале не должно ломать типизацию страниц,
// которые его просто покажут как есть. Известные коды разбираются в
// components/admin/ActionLabel.tsx, остальные выводятся сырыми.
export type AdminModerationEvent = {
  action: string;
  created_at: string;
  actor_name: string;
  payload: Record<string, unknown> | null;
};

// Карточка объявления для модерации: admin_get_car (0079).
export type AdminCar = {
  car_id: string;
  user_id: string;
  status: string;
  is_for_sale: boolean;
  is_for_rent: boolean;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  body_type: string | null;
  transmission: string | null;
  fuel: string | null;
  currency: string;
  sale_price: number | null;
  rent_price_daily: number | null;
  deposit_amount: number;
  city: string;
  description: string | null;
  contact_phone: string | null;
  moderation_comment: string | null;
  created_at: string;
  updated_at: string;
  owner_name: string | null;
  owner_email: string;
  owner_phone: string | null;
  // Язык продавца. Определяет, на каком языке он получит причину
  // отклонения; null означает «не выбирал» → сербский.
  owner_locale: string | null;
  owner_created_at: string;
  owner_listings_total: number;
  owner_rejected_count: number;
  photos: AdminCarPhoto[];
  moderation_history: AdminModerationEvent[];
  // Кто снял объявление с публикации (0089): 'owner' | 'admin' |
  // 'system', null — не в архиве. Модератору важно с первого взгляда
  // отличить своё решение от того, что продавец убрал объявление сам.
  archived_by: string | null;
  archived_reason: string | null;
};

// ------------------------------------------------------------
// АДМИНКА: объявления, пользователи, журнал (миграция 0080)
// ------------------------------------------------------------

// Строка списка «Все объявления»: admin_list_cars.
export type AdminCarRow = {
  car_id: string;
  brand: string;
  model: string;
  year: number;
  city: string;
  status: string;
  is_for_sale: boolean;
  is_for_rent: boolean;
  sale_price: number | null;
  rent_price_daily: number | null;
  currency: string;
  photo_url: string | null;
  photos_count: number;
  owner_id: string;
  owner_name: string | null;
  created_at: string;
  updated_at: string;
  total_count: number;
};

// Строка списка пользователей: admin_list_users.
// last_sign_in_at — единственное поле, приходящее из auth.users;
// наружу оттуда не отдаётся больше ничего (см. комментарий в 0080).
export type AdminUserRow = {
  user_id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: string;
  is_admin: boolean;
  verification_status: string;
  locale: string | null;
  listings_total: number;
  listings_active: number;
  created_at: string;
  last_sign_in_at: string | null;
  total_count: number;
};

// Объявление в карточке пользователя (jsonb из admin_get_user).
export type AdminUserListing = {
  car_id: string;
  brand: string;
  model: string;
  year: number;
  status: string;
  created_at: string;
};

// Карточка пользователя: admin_get_user.
export type AdminUser = {
  user_id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: string;
  // Показывается, но НЕ редактируется: флаг ставится вручную в SQL.
  is_admin: boolean;
  verification_status: string;
  verification_comment: string | null;
  locale: string | null;
  avatar_url: string | null;
  rating_avg: number;
  reviews_count: number;
  created_at: string;
  last_sign_in_at: string | null;
  listings_total: number;
  listings_active: number;
  listings_rejected: number;
  listings: AdminUserListing[];
  actions: AdminModerationEvent[];
};

// Строка журнала: admin_action_list.
export type AdminLogRow = {
  id: number;
  action: string;
  actor_id: string;
  actor_name: string;
  target_table: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  total_count: number;
};

// Администратор с числом действий: admin_actors (фильтр журнала).
export type AdminActor = {
  actor_id: string;
  actor_name: string;
  actions: number;
};

// ------------------------------------------------------------
// Согласие на куки (миграция 0094).
// ------------------------------------------------------------
// Строка журнала cookie_consents. Читается обычным select под
// политикой cookie_consents_select_admin — отдельная RPC не нужна:
// сортировка «сначала новые» и фильтр по версии политики не бизнес-
// правило, а параметры выборки.
//
// user_id nullable по существу события: согласие на куки даёт
// посетитель, а не аккаунт, и у большинства строк аккаунта нет.
export type CookieConsent = {
  id: string;
  user_id: string | null;
  consent_at: string;
  // inet приходит из PostgREST строкой ('10.0.0.1'). NULL, если
  // заголовок с адресом до функции не дошёл.
  ip: string | null;
  user_agent: string | null;
  policy_version: string;
  // Принятые категории. Сейчас всегда {cookies: true} — баннер
  // предлагает одну кнопку, — но тип оставлен открытым: категории
  // добавляются без миграции (см. 0094).
  consents: Record<string, boolean>;
};
