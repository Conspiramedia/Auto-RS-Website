// ============================================================
// RS AUTO — Справочники фильтров. ЕДИНЫЙ ИСТОЧНИК ДЛЯ САЙТА.
// ============================================================
// Перенесены из приложения: D:\Project\Auto.RS\lib\core\config\
// reference_data.dart. Списки обязаны совпадать — иначе пользователь,
// пришедший из приложения, не находит на сайте привычную марку или город
// и решает, что объявлений нет.
//
// ВАЖНО ПРО ДВА РАЗНЫХ ИСТОЧНИКА:
//   * ФИЛЬТРЫ используют ЭТОТ полный справочник — как в приложении.
//     Пустая выдача по редкой марке допустима: пользователь видит
//     empty state с подпиской «Сообщить, когда появится».
//   * SEO-СТРАНИЦЫ и sitemap строятся по ЖИВЫМ данным
//     (get_site_brands/models/cities). Генерировать страницу для марки
//     без объявлений нельзя: это thin content, который вредит индексации.
//
// При изменении справочника в приложении правится и этот файл.
// ============================================================

// ------------------------------------------------------------
// Марки. Полный список, по алфавиту. Совпадает с ReferenceData.brands.
// ------------------------------------------------------------
export const BRANDS: string[] = [
  'Acura', 'Afeela', 'Alfa Romeo', 'Alpine', 'Aston Martin', 'Audi',
  'Avatr', 'BMW', 'BYD', 'Baojun', 'Bentley', 'Bugatti', 'Buick',
  'Cadillac', 'Changan', 'Chery', 'Chevrolet', 'Chrysler', 'Citroen',
  'Cupra', 'Dacia', 'Daewoo', 'Daihatsu', 'Denza', 'Dodge', 'Dongfeng',
  'Exeed', 'Ferrari', 'Fiat', 'Fisker', 'Ford', 'Forthing', 'Foton',
  'GAC', 'GMC', 'Geely', 'Genesis', 'Great Wall', 'Haval', 'Hiphi',
  'Honda', 'Hongqi', 'Hummer', 'Hyundai', 'Ineos', 'Infiniti', 'Isuzu',
  'Iveco', 'JAC', 'Jaecoo', 'Jaguar', 'Jeep', 'Jetour', 'Jetta', 'Kia',
  'Koenigsegg', 'Lamborghini', 'Lancia', 'Land Rover', 'Leapmotor',
  'Lexus', 'Li Auto', 'Lincoln', 'Lotus', 'Lucid', 'Lync & Co', 'MG',
  'Mahindra', 'Maserati', 'Maxus', 'Maybach', 'Mazda', 'McLaren',
  'Mercedes-Benz', 'Mini', 'Mitsubishi', 'M-Hero', 'Neta', 'Nio',
  'Nissan', 'Omoda', 'Opel', 'Pagani', 'Peugeot', 'Polestar', 'Pontiac',
  'Porsche', 'Proton', 'Ram', 'Ravon', 'Renault', 'Rimac', 'Rivian',
  'Rolls-Royce', 'Rover', 'Saab', 'Scion', 'Seat', 'Seres', 'Škoda',
  'Smart', 'SsangYong', 'Subaru', 'Suzuki', 'Tank', 'Tata', 'Tesla',
  'Togg', 'Toyota', 'Vauxhall', 'Venucia', 'Volkswagen', 'Volvo', 'Voya',
  'Wuling', 'Xpeng', 'Yangwang', 'Zeekr',
];

// ------------------------------------------------------------
// Города. Тот же список, что показывает онбординг приложения
// (ReferenceData.cities → onboarding_screen.dart).
// ------------------------------------------------------------
export const CITIES: string[] = [
  'Beograd', 'Novi Sad', 'Niš', 'Kragujevac', 'Subotica', 'Zrenjanin',
  'Pančevo', 'Čačak', 'Kraljevo', 'Novi Pazar', 'Leskovac', 'Smederevo',
  'Valjevo', 'Kruševac', 'Vranje', 'Šabac', 'Užice', 'Sombor',
];

// ------------------------------------------------------------
// Диапазон годов выпуска.
// ------------------------------------------------------------
// Нижняя граница совпадает с constraint chk_year таблицы cars
// (year between 1900 and текущий + 1). Верхняя — следующий год:
// новые модели продаются заранее.
export const YEAR_MIN = 1900;

export function yearMax(): number {
  return new Date().getFullYear() + 1;
}
