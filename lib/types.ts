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
export type CatalogCar = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number | null;
  body_type: string | null;
  transmission: string | null;
  fuel: string | null;
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

// ------------------------------------------------------------
// КАБИНЕТ ПРОДАВЦА
// ------------------------------------------------------------

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
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  // private | dealer
  seller_kind: string;
  company_name: string | null;
  logo_url: string | null;
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
