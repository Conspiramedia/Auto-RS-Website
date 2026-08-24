// ============================================================
// RS AUTO — константы seed-данных.
// ============================================================
// ЗЕРКАЛО supabase/seed.sql. Идентификаторы, адреса и цены здесь и там
// обязаны совпадать: тест открывает карточку по прямому адресу и
// сверяет цену из разметки, а SQL-файл эти же строки создаёт.
//
// ПРИ ПРАВКЕ SEED МЕНЯЮТСЯ ОБА ФАЙЛА. Разойдись они — тест упадёт с
// «страница 404» или «цена не совпала», и причина будет неочевидна,
// поэтому в docs/testing.md заведён отдельный раздел про обновление
// seed, а здесь стоит эта пометка.
// ============================================================

export const SEED_USERS = {
  // Админ: входит ТОЛЬКО по почте — rpc_check_email_login пускает
  // администраторов и отказывает всем прочим (нейтрально, не различая
  // «нет такого адреса» и «вход не разрешён»).
  admin: {
    id: '00000000-0000-4000-a000-00000000ad01',
    email: 'admin@rsauto.test',
  },
  // Обычный продавец: вход по телефону, основной путь площадки.
  seller: {
    id: '00000000-0000-4000-a000-00000000c101',
    email: 'seller@rsauto.test',
    phone: '+381601234567',
    // Код из [auth.sms.test_otp] в supabase/config.toml.
    otp: '123456',
  },
  dealer: {
    id: '00000000-0000-4000-a000-00000000d101',
    email: 'dealer@rsauto.test',
    phone: '+381601234568',
    displayName: 'Auto Centar Test',
  },
} as const;

// Адрес, заведомо отсутствующий среди админов. Нужен проверке
// нейтрального отказа: ответ на него обязан совпадать с ответом на
// адрес существующего не-админа.
export const NON_ADMIN_EMAIL = 'nobody@rsauto.test';

export const SEED_CARS = {
  // Основная карточка: продажа, active. На ней проверяются Vehicle
  // JSON-LD, SEO-теги и Lighthouse.
  activeSale: {
    id: '00000000-0000-4000-b000-000000000001',
    brand: 'Volkswagen',
    model: 'Golf',
    year: 2019,
    mileage: 87000,
    salePrice: 12500,
    city: 'Beograd',
  },
  // Аренда: Offer с ценой за сутки и unitCode DAY.
  activeRent: {
    id: '00000000-0000-4000-b000-000000000002',
    brand: 'Škoda',
    model: 'Octavia',
    year: 2021,
    rentPriceDaily: 35,
    city: 'Novi Sad',
  },
  // И продажа, и аренда — ДВА Offer в разметке.
  activeBoth: {
    id: '00000000-0000-4000-b000-000000000003',
    brand: 'BMW',
    model: 'Serija 3',
    year: 2020,
    salePrice: 24900,
    rentPriceDaily: 55,
    city: 'Beograd',
  },
  // На модерации: в каталоге и sitemap появляться не должно.
  moderation: {
    id: '00000000-0000-4000-b000-000000000004',
    brand: 'Opel',
    model: 'Astra',
  },
  // Снятое: страница отдаёт CarGoneView под noindex.
  archived: {
    id: '00000000-0000-4000-b000-000000000005',
    brand: 'Renault',
    model: 'Clio',
  },
} as const;

// Объявления, которые ОБЯЗАНЫ быть в публичной выдаче. Используется
// проверкой каталога и sitemap.
export const PUBLIC_CAR_IDS = [
  SEED_CARS.activeSale.id,
  SEED_CARS.activeRent.id,
  SEED_CARS.activeBoth.id,
] as const;

// Объявления, которых в публичной выдаче быть НЕ ДОЛЖНО.
export const HIDDEN_CAR_IDS = [
  SEED_CARS.moderation.id,
  SEED_CARS.archived.id,
] as const;
