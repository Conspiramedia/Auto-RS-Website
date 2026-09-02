// ============================================================
// RS AUTO — Значки пунктов бургер-меню.
// ============================================================
// Иконочного пакета в проекте нет (см. package.json: только next,
// react, supabase и qrcode), поэтому набор нарисован здесь по образцу
// уже существующего — ui/InstallIcons.tsx. Ставить lucide-react ради
// пятнадцати значков значило бы тянуть зависимость в сборку клиента
// там, где хватает полутора килобайт разметки.
//
// Формы повторяют общепринятые (те же, что в lucide под именами
// LogIn, Tag, KeyRound, Building2, Smartphone, Info, Lightbulb,
// CircleHelp, Mail, Car, CarFront, MessageSquare, Bell, CircleUser,
// LogOut): меню — не место для авторской иконографики, узнаваемость
// здесь важнее оригинальности.
//
// ЕДИНЫЙ КАРКАС: viewBox 24, обводка currentColor, толщина 2,
// скруглённые концы и стыки. Тот же контракт, что у InstallIcons, —
// значки из двух наборов стоят в одном меню (InstallIcon у пункта
// «Быстрый доступ») и обязаны выглядеть роднёй.
//
// Цвет НЕ задаётся внутри: его наследует currentColor от пункта меню,
// поэтому активный пункт красит значок брендовым синим, а обычный —
// neutral-60, без единого условия внутри самих иконок.
// ============================================================

import type { ReactNode } from 'react';

type IconProps = {
  className?: string;
};

// Общие атрибуты. Вынесены, чтобы толщина линии и скругления не
// разъехались между значками — та же причина, что в InstallIcons.
const STROKE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// Обёртка: единственное место, где стоит aria-hidden. Значки в меню
// декоративны — рядом всегда есть подпись пункта, и озвучивать их
// скринридеру значило бы читать каждый пункт дважды.
function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg {...STROKE} aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

// ---------- Вход и аккаунт ----------

// LogIn — стрелка, входящая в проём.
export function LogInIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="m10 17 5-5-5-5" />
      <path d="M15 12H3" />
    </Icon>
  );
}

// LogOut — та же стрелка, направленная наружу.
export function LogOutIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  );
}

// CircleUser — профиль.
export function CircleUserIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.2 18.4a6 6 0 0 1 11.6 0" />
    </Icon>
  );
}

// ---------- Разделы каталога ----------

// CarFront — «Мои объявления»: машина анфас.
export function CarFrontIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 13 5.6 7.4A2 2 0 0 1 7.5 6h9a2 2 0 0 1 1.9 1.4L20 13" />
      <path d="M4 13h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
      <path d="M6.5 16h.01M17.5 16h.01" />
      <path d="M6 19v1.5M18 19v1.5" />
    </Icon>
  );
}

// Car — «Все авто»: машина в профиль. Намеренно НЕ CarFront: тот занят
// пунктом «Мои объявления», и два одинаковых силуэта в одном меню
// читались бы как один раздел, показанный дважды.
export function CarIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 7.6A2 2 0 0 0 16.6 6.5H7.4a2 2 0 0 0-1.8 1.1L3.5 11.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </Icon>
  );
}

// Tag — продажа: ценник.
export function TagIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4.8A2 2 0 0 1 4.8 2.8H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8z" />
      <path d="M7.5 7.5h.01" />
    </Icon>
  );
}

// KeyRound — аренда: ключ.
export function KeyRoundIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M16.5 3a4.5 4.5 0 0 0-4.3 5.9L3 18.1V21h2.9l1-1v-2h2v-2h2l1.2-1.2A4.5 4.5 0 1 0 16.5 3z" />
      <path d="M17.5 7.5h.01" />
    </Icon>
  );
}

// Building2 — автосалоны.
export function Building2Icon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 21V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15" />
      <path d="M12 10h7a1 1 0 0 1 1 1v10" />
      <path d="M2 21h20" />
      <path d="M7 8.5h.01M7 12.5h.01M7 16.5h.01M16 14h.01M16 17.5h.01" />
    </Icon>
  );
}

// MapPin — город: метка на карте. Нужна счётчику городов в герое
// главной, где рядом стоят CarIcon и TagIcon.
export function MapPinIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M20 10c0 4.4-5.4 9.5-7.4 11.2a1 1 0 0 1-1.2 0C9.4 19.5 4 14.4 4 10a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </Icon>
  );
}

// ---------- Справочные разделы ----------

// Smartphone — страница приложения.
export function SmartphoneIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18.5h2" />
    </Icon>
  );
}

// Info — о площадке.
export function InfoIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4.5" />
      <path d="M12 8h.01" />
    </Icon>
  );
}

// Lightbulb — как это работает.
export function LightbulbIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M9 17.5a5.5 5.5 0 1 1 6 0V19a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 19v-1.5z" />
      <path d="M9.5 21.5h5" />
    </Icon>
  );
}

// CircleHelp — вопросы и ответы.
export function CircleHelpIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

// Mail — контакты.
export function MailIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="m3 7 8.1 5.4a1.6 1.6 0 0 0 1.8 0L21 7" />
    </Icon>
  );
}

// ---------- Кабинет ----------

// MessageSquare — сообщения.
export function MessageSquareIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
    </Icon>
  );
}

// Bell — уведомления.
export function BellIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M18 8a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </Icon>
  );
}

// ---------- Действия над самим сайтом ----------

// Share2 — «Поделиться». Три узла, соединённые линиями: знак, который
// на телефоне узнают без подписи, потому что им же помечено системное
// меню шаринга в Android.
//
// Иконка «стрелка из коробки» (iOS-вариант) не взята намеренно: она
// узнаётся только владельцами iPhone, а сербский рынок — почти
// сплошь Android.
export function ShareIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4" />
      <path d="M15.4 6.5l-6.8 4" />
    </Icon>
  );
}
