// ============================================================
// RS AUTO — Тексты условий использования и политики конфиденциальности.
// ============================================================
// ЕДИНЫЙ ИСТОЧНИК ИСТИНЫ. Здесь лежат и сами тексты, и версия
// редакции (POLICY_VERSION) — согласие пользователя сверяется именно
// с ней, поэтому текст и версия обязаны жить в одном файле.
//
// Сербская версия — перевод тех же формулировок: сербский здесь
// основной рынок, и отдавать сербу русский юридический текст нельзя.
//
// ТЕРМИН. Сервис именуется «Платформа» / „Platforma“. Прежняя редакция
// называла его «Приложение», что противоречило существу: все сценарии
// работают на сайте, и предметом соглашения является именно он.
//
// ЮРИДИЧЕСКОЕ ЗАМЕЧАНИЕ: применимое право — Республика Сербия,
// сервис 18+. Перед публичным релизом текст должен быть вычитан
// юристом.
// ============================================================

import type { Locale } from './i18n';

// ------------------------------------------------------------
// Реквизиты Оператора. ЕДИНЫЙ ИСТОЧНИК.
// ------------------------------------------------------------
// Используются в трёх местах: разделе «Контакты» обоих документов,
// на странице /contact и в JSON-LD Organization. Держать их строкой
// внутри текста политики нельзя — при смене адреса или регистрационного
// номера пришлось бы править четыре перевода вручную.
//
// ⚠️ ВНИМАНИЕ: MB, PIB и юридический адрес — ПЛЕЙСХОЛДЕРЫ.
// Регистрационные данные юридического лица нельзя выдумывать: указание
// несуществующего номера APR в публичной оферте — нарушение само по
// себе. Заполняются владельцем перед релизом (см. README → TODO).
// Признак незаполненности — OPERATOR.verified: страница /contact и
// разделы документов показывают строку с номером ТОЛЬКО когда он
// подставлен, а не печатают «MB: [номер APR]» посетителю.
// Тип задан явно, без `as const`: при `as const` пустые поля получают
// литеральный тип '' и сужаются до never внутри проверок вида
// `OPERATOR.phone && …`, из-за чего обращение к строковым методам
// перестаёт компилироваться. Поля обязаны оставаться просто string —
// они и предназначены для заполнения.
type OperatorDetails = {
  legalName: string;
  registrationNumber: string;
  taxNumber: string;
  address: string;
  email: string;
  phone: string;
};

export const OPERATOR: OperatorDetails = {
  // Наименование юридического лица.
  legalName: 'RS AUTO d.o.o. Beograd',
  // Матични број (регистрационный номер APR).
  registrationNumber: '',
  // ПИБ (налоговый идентификатор).
  taxNumber: '',
  // АДРЕС РЕГИСТРАЦИИ из APR — и только он. Фактическое место работы,
  // склад или адрес для корреспонденции сюда не подставляются: в
  // публичной оферте указывается регистрационный адрес юридического
  // лица, тот же, что в выписке APR. Пока пусто — блок адреса не
  // выводится ни на /contact, ни в разделах «Контакты» документов
  // (см. OPERATOR_VERIFIED ниже).
  address: '',
  // Контактный ящик проекта для ВХОДЯЩИХ обращений. Он же печатается
  // в разделах «Контакты» обоих документов и выводится ссылкой в
  // подвале и на /contact.
  //
  // Не путать с MAIL_FROM (noreply@rsauto.rs) — это ИСХОДЯЩИЙ адрес
  // транзакционных писем через Resend, другая роль: на него не пишут,
  // и его смена к этой строке отношения не имеет.
  email: 'info.rsauto.rs@gmail.com',
  // ТЕЛЕФОН ПОДДЕРЖКИ НЕ ЗАВОДИТСЯ. Решение владельца площадки:
  // поддержка работает только по электронной почте — по адресу выше.
  // Поле оставлено в типе намеренно — вся разметка уже проверяет его
  // на непустоту, и удаление поля потребовало бы правок в четырёх
  // местах ради строки, которая всё равно останется пустой.
  // Пустая строка = блок телефона не выводится нигде.
  phone: '',
};

// Заполнены ли регистрационные данные. Пока false, страницы показывают
// только наименование и почту, а README держит открытый пункт TODO.
export const OPERATOR_VERIFIED =
  OPERATOR.registrationNumber !== '' &&
  OPERATOR.taxNumber !== '' &&
  OPERATOR.address !== '';

// Версия и дата редакции документа. Поднимается при КАЖДОЙ правке
// текста: по ней проверяется, принимал ли пользователь действующую
// редакцию. Редакция .2 — терминологическая: сервис называется
// «Платформа»/„Platforma“ вместо прежнего «Приложение»/„Aplikacija“.
// Сайт решает все задачи сам, и документ, называющий его приложением,
// вводил читателя в заблуждение относительно предмета соглашения.
export const POLICY_VERSION = '2026-08-26.2';

export const POLICY_UPDATED: Record<Locale, string> = {
  sr: '26. avgust 2026.',
  ru: '26 августа 2026 г.',
};

// Пункт документа: заголовок раздела и его абзацы. Структура вместо
// одной строки нужна затем, что страница обязана быть размеченной
// (h2 + p), а не «простынёй» в <pre> — иначе документ не читается
// с телефона и не индексируется как текст.
export type LegalSection = {
  heading?: string;
  paragraphs: string[];
  // Контактный адрес раздела «Контакты». Вынесен из paragraphs
  // отдельным полем, потому что абзацы печатаются как обычный текст,
  // а почта обязана быть кликабельной ссылкой mailto: — иначе с
  // телефона по ней нельзя написать, а именно с телефона документ и
  // читают. Хранить здесь HTML-строку было бы хуже: разметка внутри
  // юридического текста рано или поздно попадёт на страницу как есть.
  // Подпись к адресу локализуется (contact_email), сам адрес — нет.
  email?: string;
};

// ------------------------------------------------------------
// Политика конфиденциальности.
// ------------------------------------------------------------
const PRIVACY_RU: LegalSection[] = [
  {
    paragraphs: [
      'Настоящая Политика конфиденциальности (далее — «Политика») определяет порядок обработки и защиты персональной информации пользователей (далее — «Пользователь»), которую платформа «Auto RS» (далее — «Платформа») может получить во время использования сервиса.',
      `Оператором персональных данных (лицом, определяющим цели и способы обработки) является ${OPERATOR.legalName} (далее — «Оператор» или «мы»). Полные реквизиты Оператора указаны на странице «Контакты» сайта и в разделе 8 настоящей Политики.`,
      'Платформа предназначено для лиц, достигших 18 лет. Используя Платформу, Пользователь подтверждает, что ему исполнилось 18 лет. Мы сознательно не собираем данные лиц младше этого возраста; при обнаружении таких данных они удаляются.',
      'Использование Платформы означает безоговорочное согласие Пользователя с настоящей Политикой и указанными в ней условиями обработки его персональной информации. В случае несогласия с этими условиями Пользователь должен воздержаться от использования Платформы.',
    ],
  },
  {
    heading: '1. Правовые основания и цели обработки данных',
    paragraphs: [
      'Мы обрабатываем данные исключительно для исполнения пользовательского соглашения, предоставления сервисов Платформы и защиты интересов Пользователей.',
      '• Предоставление сервиса: обеспечение возможности публикации объявлений о продаже и аренде автомобилей, связи между покупателями/арендаторами и продавцами.',
      '• Идентификация: создание, верификация и защита учётной записи Пользователя (вход выполняется по номеру телефона и одноразовому коду из SMS).',
      '• Связь и уведомления: направление уведомлений, запросов и информации, касающихся использования Платформы, а также обработка запросов от Пользователя.',
      '• Безопасность: предотвращение мошенничества, спама, оскорблений и других нарушений правил Платформы.',
      '• Аналитика: улучшение качества Платформы, удобства его использования и разработка новых функций на основе обезличенных технических данных.',
    ],
  },
  {
    heading: '2. Перечень обрабатываемых данных',
    paragraphs: [
      'Платформа собирает и обрабатывает следующие категории данных:',
      'Данные, предоставляемые Пользователем:',
      '• Номер телефона (используется для авторизации по SMS-коду, для связи и отображается в объявлениях как контакт продавца).',
      '• Данные профиля (имя или псевдоним, изображение профиля/аватар).',
      '• Контент объявлений (марка, модель, год, пробег, цена, город, тип кузова, коробка передач, топливо, текстовое описание и фотографии автомобиля).',
      'Автоматически собираемые данные:',
      '• Геоданные (город, указанный Пользователем вручную при подаче объявления).',
      '• Технические данные (уникальный идентификатор устройства, тип и модель устройства, версия операционной системы, версия Платформы, IP-адрес, время доступа).',
    ],
  },
  {
    heading: '3. Условия обработки и передачи данных третьим лицам',
    paragraphs: [
      'В отношении персональной информации Пользователя сохраняется её конфиденциальность, кроме случаев добровольного предоставления Пользователем данных для общего доступа.',
      'Платформа вправе передавать данные третьим лицам в следующих случаях:',
      '• Публичные данные: имя, аватар, номер телефона и контент объявлений становятся доступны другим пользователям Платформы в целях совершения сделок купли-продажи и аренды автомобилей.',
      '• Облачная инфраструктура: данные передаются и хранятся на серверах провайдера инфраструктуры (Supabase) на основании соглашения об обработке данных и при условии соблюдения строгих мер безопасности.',
      '• Отправка SMS: для доставки одноразовых кодов авторизации номер телефона передаётся провайдеру SMS-рассылки.',
      '• Push-уведомления: для доставки уведомлений на устройство может использоваться сервис облачных уведомлений. При включении уведомлений обрабатывается технический токен устройства; содержимое личной переписки в таких уведомлениях не раскрывается.',
      '• Требование законодательства: передача предусмотрена применимым законодательством в рамках установленной процедуры (по запросу суда или уполномоченных органов).',
      'Платформа обязуется не продавать, не сдавать в аренду и не передавать персональные данные Пользователя в маркетинговых целях третьим лицам без явного согласия.',
    ],
  },
  {
    heading: '4. Место обработки, защита и хранение данных',
    paragraphs: [
      '• Сроки хранения: данные хранятся в течение всего срока существования учётной записи Пользователя и до момента достижения целей их обработки, либо до отзыва согласия Пользователем.',
      '• Меры безопасности: для защиты данных применяются современные технические и организационные меры, включая шифрование данных при передаче (SSL/TLS), ограничение прав доступа на уровне базы данных (Row Level Security — RLS), регулярные аудиты безопасности.',
      '• Безопасность чатов: личные сообщения, списки избранного и история операций изолированы и защищены от доступа третьих лиц.',
      '• Применимое право: к обработке данных и к настоящей Политике применяется законодательство Республики Сербия. Данные могут храниться и обрабатываться на серверах провайдеров инфраструктуры за пределами Сербии с соблюдением надлежащих мер защиты.',
    ],
  },
  {
    heading: '5. Права Пользователей',
    paragraphs: [
      'Пользователь имеет право:',
      '• На доступ и изменение: самостоятельно редактировать, обновлять или исправлять свои персональные данные через профиль на Платформе.',
      '• На отзыв согласия и удаление: отозвать своё согласие на обработку данных путём удаления объявлений или личного кабинета.',
      '• На полное забвение: направить запрос на полное удаление аккаунта и всех связанных с ним персональных данных из баз данных Платформы.',
      'Обратите внимание: часть архивных технических данных может сохраняться в резервных копиях в течение ограниченного времени в целях безопасности и исполнения требований закона.',
    ],
  },
  {
    heading: '6. Ответственность Пользователя за размещаемый контент',
    paragraphs: [
      'Пользователь несёт полную и единоличную ответственность за любой контент (тексты объявлений, фотографии, описания, комментарии и сообщения), который он размещает или передаёт через Платформу.',
      'Размещая контент, Пользователь гарантирует и обязуется, что он:',
      '• касается автомобилей и сопутствующих товаров/услуг, оборот которых не запрещён и не ограничен законодательством Республики Сербия;',
      '• не относится к запрещённым к обороту товарам и услугам, включая, помимо прочего: краденое имущество и транспортные средства с изменёнными идентификационными номерами (VIN), поддельные документы и денежные знаки, а также любые иные товары и услуги, оборот которых ограничен или запрещён применимым законодательством;',
      '• не содержит нецензурной (ненормативной) лексики, оскорблений, разжигания ненависти, угроз, клеветы и иных материалов, нарушающих права третьих лиц или нормы морали;',
      '• не нарушает авторских, товарных и иных прав третьих лиц.',
      'Платформа применяет автоматическую модерацию (проверку по словарю и с помощью технологий искусственного интеллекта) для выявления запрещённого контента. Однако автоматическая модерация носит вспомогательный характер и не снимает с Пользователя ответственности: прохождение объявлением проверки не означает согласия или одобрения его содержания со стороны Платформы.',
      'Платформа вправе без предварительного уведомления отклонять публикацию, скрывать или удалять любой контент, нарушающий настоящую Политику, а также блокировать учётную запись Пользователя-нарушителя. Ответственность за последствия размещения запрещённого контента, включая претензии третьих лиц и требования уполномоченных органов, несёт непосредственно Пользователь, разместивший такой контент.',
    ],
  },
  {
    heading: '7. Изменение Политики конфиденциальности',
    paragraphs: [
      'Мы оставляем за собой право вносить изменения в настоящую Политику. Новая редакция вступает в силу с момента её размещения на Платформе, если иное не предусмотрено новой редакцией Политики. При внесении существенных изменений, влияющих на права Пользователя, Платформа обязуется уведомить об этом (например, через всплывающее окно) и запросить повторное согласие.',
    ],
  },
  {
    heading: '8. Контакты и реквизиты',
    paragraphs: [
      'По любым вопросам, связанным с обработкой, изменением или удалением персональных данных, вы можете обратиться к нам через страницу «Контакты» на сайте, через форму обратной связи или по электронной почте.',
      `Оператор: ${OPERATOR.legalName}.`,
      // Регистрационные данные печатаются только когда заполнены:
      // строка «MB: [номер APR]» в публичном документе хуже её отсутствия.
      ...(OPERATOR_VERIFIED
        ? [
            `Матичный номер (MB): ${OPERATOR.registrationNumber}. ПИБ: ${OPERATOR.taxNumber}.`,
            `Адрес: ${OPERATOR.address}.`,
          ]
        : []),
    ],
    email: OPERATOR.email,
  },
];

const PRIVACY_SR: LegalSection[] = [
  {
    paragraphs: [
      'Ova Politika privatnosti (u daljem tekstu: „Politika“) određuje način obrade i zaštite ličnih podataka korisnika (u daljem tekstu: „Korisnik“) koje platforma „Auto RS“ (u daljem tekstu: „Platforma“) može dobiti tokom korišćenja servisa.',
      `Rukovalac ličnih podataka (lice koje određuje svrhe i način obrade) jeste ${OPERATOR.legalName} (u daljem tekstu: „Rukovalac“ ili „mi“). Puni podaci Rukovaoca navedeni su na stranici „Kontakt“ na sajtu i u odeljku 8 ove Politike.`,
      'Platforma je namenjena licima starijim od 18 godina. Korišćenjem Platforme Korisnik potvrđuje da ima 18 godina. Svesno ne prikupljamo podatke lica mlađih od tog uzrasta; ako se takvi podaci otkriju, brišu se.',
      'Korišćenje Platforme znači bezuslovnu saglasnost Korisnika sa ovom Politikom i u njoj navedenim uslovima obrade njegovih ličnih podataka. U slučaju neslaganja sa ovim uslovima, Korisnik treba da se uzdrži od korišćenja Platforme.',
    ],
  },
  {
    heading: '1. Pravni osnov i svrhe obrade podataka',
    paragraphs: [
      'Podatke obrađujemo isključivo radi izvršenja korisničkog ugovora, pružanja usluga Platforme i zaštite interesa Korisnika.',
      '• Pružanje usluge: omogućavanje objavljivanja oglasa za prodaju i izdavanje automobila, kao i povezivanje kupaca/zakupaca i prodavaca.',
      '• Identifikacija: kreiranje, verifikacija i zaštita korisničkog naloga (prijava se vrši putem broja telefona i jednokratnog koda iz SMS-a).',
      '• Komunikacija i obaveštenja: slanje obaveštenja, upita i informacija u vezi sa korišćenjem Platforme, kao i obrada zahteva Korisnika.',
      '• Bezbednost: sprečavanje prevara, spama, uvreda i drugih kršenja pravila Platforme.',
      '• Analitika: poboljšanje kvaliteta Platforme, njene upotrebljivosti i razvoj novih funkcija na osnovu anonimizovanih tehničkih podataka.',
    ],
  },
  {
    heading: '2. Spisak podataka koji se obrađuju',
    paragraphs: [
      'Platforma prikuplja i obrađuje sledeće kategorije podataka:',
      'Podaci koje dostavlja Korisnik:',
      '• Broj telefona (koristi se za prijavu putem SMS koda, za kontakt i prikazuje se u oglasima kao kontakt prodavca).',
      '• Podaci profila (ime ili nadimak, slika profila/avatar).',
      '• Sadržaj oglasa (marka, model, godište, kilometraža, cena, grad, tip karoserije, menjač, gorivo, tekstualni opis i fotografije automobila).',
      'Automatski prikupljani podaci:',
      '• Geopodaci (grad koji je Korisnik ručno naveo pri postavljanju oglasa).',
      '• Tehnički podaci (jedinstveni identifikator uređaja, tip i model uređaja, verzija operativnog sistema, verzija Platforme, IP adresa, vreme pristupa).',
    ],
  },
  {
    heading: '3. Uslovi obrade i prenosa podataka trećim licima',
    paragraphs: [
      'U pogledu ličnih podataka Korisnika čuva se njihova poverljivost, osim u slučajevima kada Korisnik dobrovoljno učini podatke javno dostupnim.',
      'Platforma ima pravo da prenese podatke trećim licima u sledećim slučajevima:',
      '• Javni podaci: ime, avatar, broj telefona i sadržaj oglasa postaju dostupni drugim korisnicima Platforme radi zaključivanja poslova kupoprodaje i izdavanja automobila.',
      '• Cloud infrastruktura: podaci se prenose i čuvaju na serverima pružaoca infrastrukture (Supabase) na osnovu ugovora o obradi podataka i uz poštovanje strogih mera bezbednosti.',
      '• Slanje SMS-a: radi dostave jednokratnih kodova za prijavu, broj telefona se prosleđuje pružaocu usluge SMS slanja.',
      '• Push obaveštenja: za dostavu obaveštenja na uređaj može se koristiti servis cloud obaveštenja. Pri uključenim obaveštenjima obrađuje se tehnički token uređaja; sadržaj lične prepiske se u takvim obaveštenjima ne otkriva.',
      '• Zahtev zakona: prenos je predviđen važećim propisima u okviru propisanog postupka (po zahtevu suda ili nadležnih organa).',
      'Platforma se obavezuje da neće prodavati, iznajmljivati niti prenositi lične podatke Korisnika u marketinške svrhe trećim licima bez izričite saglasnosti.',
    ],
  },
  {
    heading: '4. Mesto obrade, zaštita i čuvanje podataka',
    paragraphs: [
      '• Rokovi čuvanja: podaci se čuvaju tokom celog perioda postojanja korisničkog naloga i do ostvarenja svrhe njihove obrade, odnosno do povlačenja saglasnosti Korisnika.',
      '• Mere bezbednosti: za zaštitu podataka primenjuju se savremene tehničke i organizacione mere, uključujući šifrovanje podataka pri prenosu (SSL/TLS), ograničenje prava pristupa na nivou baze podataka (Row Level Security — RLS) i redovne bezbednosne provere.',
      '• Bezbednost poruka: lične poruke, liste omiljenih i istorija operacija su izolovane i zaštićene od pristupa trećih lica.',
      '• Merodavno pravo: na obradu podataka i na ovu Politiku primenjuje se zakonodavstvo Republike Srbije. Podaci se mogu čuvati i obrađivati na serverima pružalaca infrastrukture izvan Srbije, uz poštovanje odgovarajućih mera zaštite.',
    ],
  },
  {
    heading: '5. Prava Korisnika',
    paragraphs: [
      'Korisnik ima pravo:',
      '• Na pristup i izmenu: da samostalno uređuje, ažurira ili ispravlja svoje lične podatke putem profila na Platformi.',
      '• Na povlačenje saglasnosti i brisanje: da povuče svoju saglasnost za obradu podataka brisanjem oglasa ili korisničkog naloga.',
      '• Na potpuno brisanje: da pošalje zahtev za potpuno brisanje naloga i svih sa njim povezanih ličnih podataka iz baza podataka Platforme.',
      'Napomena: deo arhivskih tehničkih podataka može se čuvati u rezervnim kopijama tokom ograničenog vremena radi bezbednosti i ispunjenja zakonskih obaveza.',
    ],
  },
  {
    heading: '6. Odgovornost Korisnika za objavljeni sadržaj',
    paragraphs: [
      'Korisnik snosi punu i isključivu odgovornost za svaki sadržaj (tekstove oglasa, fotografije, opise, komentare i poruke) koji objavljuje ili prenosi putem Platforme.',
      'Objavljivanjem sadržaja Korisnik garantuje i obavezuje se da sadržaj:',
      '• se odnosi na automobile i prateću robu/usluge čiji promet nije zabranjen niti ograničen zakonodavstvom Republike Srbije;',
      '• ne spada u robu i usluge zabranjene u prometu, uključujući, ali ne ograničavajući se na: ukradenu imovinu i vozila sa izmenjenim identifikacionim brojevima (VIN), falsifikovana dokumenta i novčanice, kao i bilo koju drugu robu i usluge čiji je promet ograničen ili zabranjen važećim propisima;',
      '• ne sadrži nepristojan (vulgaran) govor, uvrede, govor mržnje, pretnje, klevete i druge materijale koji krše prava trećih lica ili moralne norme;',
      '• ne krši autorska, žigovna i druga prava trećih lica.',
      'Platforma primenjuje automatsku moderaciju (proveru rečnikom i pomoću tehnologija veštačke inteligencije) radi otkrivanja zabranjenog sadržaja. Međutim, automatska moderacija ima pomoćni karakter i ne oslobađa Korisnika odgovornosti: prolazak oglasa kroz proveru ne znači saglasnost ili odobrenje njegovog sadržaja od strane Platforme.',
      'Platforma ima pravo da bez prethodnog obaveštenja odbije objavljivanje, sakrije ili ukloni svaki sadržaj koji krši ovu Politiku, kao i da blokira korisnički nalog Korisnika koji je prekršio pravila. Odgovornost za posledice objavljivanja zabranjenog sadržaja, uključujući zahteve trećih lica i nadležnih organa, snosi neposredno Korisnik koji je takav sadržaj objavio.',
    ],
  },
  {
    heading: '7. Izmena Politike privatnosti',
    paragraphs: [
      'Zadržavamo pravo da menjamo ovu Politiku. Nova verzija stupa na snagu od trenutka njenog objavljivanja na Platformi, osim ako novom verzijom Politike nije drugačije predviđeno. Pri unošenju bitnih izmena koje utiču na prava Korisnika, Platforma se obavezuje da o tome obavesti (na primer, putem iskačućeg prozora) i zatraži ponovnu saglasnost.',
    ],
  },
  {
    heading: '8. Kontakt i podaci',
    paragraphs: [
      'Za sva pitanja u vezi sa obradom, izmenom ili brisanjem ličnih podataka možete nam se obratiti putem stranice „Kontakt“ na sajtu, obrasca za kontakt ili e-poštom.',
      `Rukovalac: ${OPERATOR.legalName}.`,
      ...(OPERATOR_VERIFIED
        ? [
            `Matični broj (MB): ${OPERATOR.registrationNumber}. PIB: ${OPERATOR.taxNumber}.`,
            `Adresa: ${OPERATOR.address}.`,
          ]
        : []),
    ],
    email: OPERATOR.email,
  },
];

// ------------------------------------------------------------
// Условия использования.
// ------------------------------------------------------------
const TERMS_RU: LegalSection[] = [
  {
    paragraphs: [
      'Настоящие Условия использования (далее — «Условия») регулируют отношения между Пользователем и Оператором платформы «Auto RS» (далее — «Платформа») в связи с использованием Платформы.',
      'Начиная использовать Платформа, Пользователь подтверждает, что полностью ознакомился с настоящими Условиями и принимает их. В случае несогласия следует прекратить использование Платформы.',
    ],
  },
  {
    heading: '1. Предмет и статус Платформы',
    paragraphs: [
      'Платформа «Auto RS» является информационной площадкой (сервисом объявлений об автомобилях), которая предоставляет Пользователям техническую возможность размещать объявления о продаже и аренде автомобилей, находить транспортные средства и связываться друг с другом.',
      'Платформа НЕ является стороной сделок между Пользователями, не выступает продавцом, покупателем, арендодателем, посредником, агентом или гарантом по сделкам. Все сделки заключаются и исполняются Пользователями напрямую, на их собственный риск и под их ответственность.',
    ],
  },
  {
    heading: '2. Регистрация и учётная запись',
    paragraphs: [
      '• Использование ряда функций (публикация объявлений, переписка, избранное) требует авторизации по номеру телефона и одноразовому коду из SMS.',
      '• Платформа предназначено для лиц старше 18 лет. Регистрируясь, Пользователь подтверждает своё совершеннолетие.',
      '• Пользователь отвечает за сохранность доступа к своей учётной записи и за все действия, совершённые под ней.',
      '• Запрещается создавать учётные записи от имени третьих лиц и вводить в заблуждение относительно своей личности.',
    ],
  },
  {
    heading: '3. Правила размещения объявлений и контента',
    paragraphs: [
      'Пользователь несёт полную ответственность за размещаемый контент (тексты, фотографии, цены, характеристики автомобиля, описания, сообщения) и гарантирует, что он:',
      '• касается автомобилей и сопутствующих товаров/услуг, оборот которых не запрещён и не ограничен законодательством Республики Сербия;',
      '• не относится к запрещённым категориям, включая, помимо прочего: краденое имущество и транспортные средства с изменёнными идентификационными номерами (VIN), поддельные документы и денежные знаки, а также иные ограниченные в обороте товары и услуги;',
      '• не содержит нецензурной лексики, оскорблений, угроз, клеветы, разжигания ненависти;',
      '• не нарушает авторских, товарных и иных прав третьих лиц;',
      '• не является спамом, мошенничеством или вводящей в заблуждение информацией (в том числе указанием заведомо ложной цены, пробега или технического состояния автомобиля).',
      'Платформа применяет автоматическую модерацию (проверку по словарю и с помощью технологий искусственного интеллекта). Модерация носит вспомогательный характер и не снимает с Пользователя ответственности: прохождение проверки не означает одобрения контента со стороны Платформы.',
    ],
  },
  {
    heading: '4. Права на контент',
    paragraphs: [
      'Размещая контент, Пользователь сохраняет свои права на него, но предоставляет Платформе неисключительную безвозмездную лицензию на его хранение, воспроизведение и показ другим пользователям в объёме, необходимом для работы сервиса (в том числе на превью и в результатах поиска).',
    ],
  },
  {
    heading: '5. Отсутствие гарантий и ограничение ответственности',
    paragraphs: [
      '• Платформа предоставляется «как есть» и «как доступно». Оператор не гарантирует бесперебойной и безошибочной работы сервиса.',
      '• Оператор не несёт ответственности за качество, безопасность, законность, техническое состояние и достоверность автомобилей, товаров, услуг и информации, размещаемых Пользователями, а также за исполнение Пользователями своих обязательств по сделкам.',
      '• Все споры, возникающие между Пользователями в связи со сделками, разрешаются ими самостоятельно. Оператор не участвует в таких спорах и не обязан их разрешать.',
      '• В максимально допустимой законом степени Оператор не отвечает за косвенные убытки, упущенную выгоду и утрату данных, возникшие в связи с использованием Платформы.',
    ],
  },
  {
    heading: '6. Блокировка и прекращение доступа',
    paragraphs: [
      'Оператор вправе без предварительного уведомления ограничить, приостановить или прекратить доступ Пользователя к Платформе, а также удалить или скрыть контент в случае нарушения настоящих Условий, требований законодательства или прав третьих лиц.',
    ],
  },
  {
    heading: '7. Изменение Условий',
    paragraphs: [
      'Оператор вправе изменять настоящие Условия. Новая редакция вступает в силу с момента её размещения на Платформе. При существенных изменениях Платформа уведомляет Пользователя и при необходимости запрашивает повторное согласие.',
    ],
  },
  {
    heading: '8. Применимое право и разрешение споров',
    paragraphs: [
      'К настоящим Условиям применяется законодательство Республики Сербия. Споры между Пользователем и Оператором, не урегулированные путём переговоров, подлежат разрешению в соответствии с законодательством Республики Сербия.',
    ],
  },
  {
    heading: '9. Контакты',
    paragraphs: [
      'По вопросам, связанным с работой Платформы и настоящими Условиями, обращайтесь через страницу «Контакты» на сайте или по электронной почте.',
      `Оператор: ${OPERATOR.legalName}.`,
      ...(OPERATOR_VERIFIED
        ? [
            `Матичный номер (MB): ${OPERATOR.registrationNumber}. ПИБ: ${OPERATOR.taxNumber}.`,
            `Адрес: ${OPERATOR.address}.`,
          ]
        : []),
    ],
    email: OPERATOR.email,
  },
];

const TERMS_SR: LegalSection[] = [
  {
    paragraphs: [
      'Ovi Uslovi korišćenja (u daljem tekstu: „Uslovi“) uređuju odnose između Korisnika i Rukovaoca platforme „Auto RS“ (u daljem tekstu: „Platforma“) u vezi sa korišćenjem Platforme.',
      'Počinjanjem korišćenja Platforme Korisnik potvrđuje da se u potpunosti upoznao sa ovim Uslovima i da ih prihvata. U slučaju neslaganja, potrebno je prekinuti korišćenje Platforme.',
    ],
  },
  {
    heading: '1. Predmet i status Platforme',
    paragraphs: [
      'Platforma „Auto RS“ je informativna platforma (servis oglasa o automobilima) koja Korisnicima pruža tehničku mogućnost da postavljaju oglase za prodaju i izdavanje automobila, pronalaze vozila i međusobno stupaju u kontakt.',
      'Platforma NIJE strana u poslovima između Korisnika, ne nastupa kao prodavac, kupac, zakupodavac, posrednik, agent ili garant u poslovima. Svi poslovi se zaključuju i izvršavaju između Korisnika neposredno, na njihov sopstveni rizik i odgovornost.',
    ],
  },
  {
    heading: '2. Registracija i korisnički nalog',
    paragraphs: [
      '• Korišćenje niza funkcija (objavljivanje oglasa, prepiska, omiljeni) zahteva prijavu putem broja telefona i jednokratnog koda iz SMS-a.',
      '• Platforma je namenjena licima starijim od 18 godina. Registracijom Korisnik potvrđuje svoju punoletnost.',
      '• Korisnik odgovara za čuvanje pristupa svom nalogu i za sve radnje izvršene pod tim nalogom.',
      '• Zabranjeno je kreiranje naloga u ime trećih lica i dovođenje u zabludu u pogledu sopstvenog identiteta.',
    ],
  },
  {
    heading: '3. Pravila objavljivanja oglasa i sadržaja',
    paragraphs: [
      'Korisnik snosi punu odgovornost za objavljeni sadržaj (tekstove, fotografije, cene, karakteristike automobila, opise, poruke) i garantuje da sadržaj:',
      '• se odnosi na automobile i prateću robu/usluge čiji promet nije zabranjen niti ograničen zakonodavstvom Republike Srbije;',
      '• ne spada u zabranjene kategorije, uključujući, ali ne ograničavajući se na: ukradenu imovinu i vozila sa izmenjenim identifikacionim brojevima (VIN), falsifikovana dokumenta i novčanice, kao i drugu robu i usluge ograničene u prometu;',
      '• ne sadrži nepristojan govor, uvrede, pretnje, klevete, govor mržnje;',
      '• ne krši autorska, žigovna i druga prava trećih lica;',
      '• nije spam, prevara ili obmanjujuća informacija (uključujući navođenje očigledno lažne cene, kilometraže ili tehničkog stanja automobila).',
      'Platforma primenjuje automatsku moderaciju (proveru rečnikom i pomoću tehnologija veštačke inteligencije). Moderacija ima pomoćni karakter i ne oslobađa Korisnika odgovornosti: prolazak provere ne znači odobrenje sadržaja od strane Platforme.',
    ],
  },
  {
    heading: '4. Prava na sadržaj',
    paragraphs: [
      'Objavljivanjem sadržaja Korisnik zadržava svoja prava na njega, ali Platformi daje neisključivu besplatnu licencu za njegovo čuvanje, umnožavanje i prikazivanje drugim korisnicima u obimu neophodnom za rad servisa (uključujući u pregledima i u rezultatima pretrage).',
    ],
  },
  {
    heading: '5. Odsustvo garancija i ograničenje odgovornosti',
    paragraphs: [
      '• Platforma se pruža „takva kakva jeste“ i „prema dostupnosti“. Rukovalac ne garantuje neprekidan i bezgrešan rad servisa.',
      '• Rukovalac ne odgovara za kvalitet, bezbednost, zakonitost, tehničko stanje i verodostojnost automobila, robe, usluga i informacija koje objavljuju Korisnici, niti za ispunjenje obaveza Korisnika po poslovima.',
      '• Sve sporove koji nastanu između Korisnika u vezi sa poslovima oni rešavaju samostalno. Rukovalac ne učestvuje u takvim sporovima i nije dužan da ih rešava.',
      '• U najvećoj meri dozvoljenoj zakonom, Rukovalac ne odgovara za posrednu štetu, izmaklu dobit i gubitak podataka nastale u vezi sa korišćenjem Platforme.',
    ],
  },
  {
    heading: '6. Blokiranje i prekid pristupa',
    paragraphs: [
      'Rukovalac ima pravo da bez prethodnog obaveštenja ograniči, privremeno obustavi ili prekine pristup Korisnika Platformi, kao i da ukloni ili sakrije sadržaj u slučaju kršenja ovih Uslova, zakonskih propisa ili prava trećih lica.',
    ],
  },
  {
    heading: '7. Izmena Uslova',
    paragraphs: [
      'Rukovalac ima pravo da menja ove Uslove. Nova verzija stupa na snagu od trenutka njenog objavljivanja na Platformi. Pri bitnim izmenama Platforma obaveštava Korisnika i po potrebi traži ponovnu saglasnost.',
    ],
  },
  {
    heading: '8. Merodavno pravo i rešavanje sporova',
    paragraphs: [
      'Na ove Uslove primenjuje se zakonodavstvo Republike Srbije. Sporovi između Korisnika i Rukovaoca koji nisu rešeni pregovorima rešavaju se u skladu sa zakonodavstvom Republike Srbije.',
    ],
  },
  {
    heading: '9. Kontakt',
    paragraphs: [
      'Za pitanja u vezi sa radom Platforme i ovim Uslovima obratite se putem stranice „Kontakt“ na sajtu ili e-poštom.',
      `Rukovalac: ${OPERATOR.legalName}.`,
      ...(OPERATOR_VERIFIED
        ? [
            `Matični broj (MB): ${OPERATOR.registrationNumber}. PIB: ${OPERATOR.taxNumber}.`,
            `Adresa: ${OPERATOR.address}.`,
          ]
        : []),
    ],
    email: OPERATOR.email,
  },
];

export const PRIVACY_POLICY: Record<Locale, LegalSection[]> = {
  sr: PRIVACY_SR,
  ru: PRIVACY_RU,
};

export const TERMS_OF_USE: Record<Locale, LegalSection[]> = {
  sr: TERMS_SR,
  ru: TERMS_RU,
};
