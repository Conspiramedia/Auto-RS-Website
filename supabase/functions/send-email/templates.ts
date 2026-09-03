// ============================================================
// AUTO.RS — Шаблоны писем (sr + ru)
// ============================================================
// ПОЧЕМУ ШАБЛОНЫ ЗДЕСЬ, А НЕ В БАЗЕ. В email_queue лежит только ключ
// шаблона и данные (миграция 0071). Готовый HTML в очереди означал бы,
// что правка вёрстки требует миграции, а письмо, пролежавшее в очереди
// час, уходит со сведениями, устаревшими на час.
//
// ПОЧЕМУ HTML ЗДЕСЬ ТАКОЙ АРХАИЧНЫЙ. Почтовые клиенты — не браузеры:
// Outlook рендерит движком Word, Gmail вырезает <style> из <head> и не
// поддерживает ни flex, ни grid, ни CSS-переменные. Поэтому:
//   * раскладка — таблицами, а не div'ами;
//   * стили — инлайновым атрибутом style у каждого элемента;
//   * ширина 600px — предел, который показывают все клиенты без
//     горизонтальной прокрутки;
//   * шрифт — системный стек. Montserrat сайта здесь недоступен:
//     подключать веб-шрифт в письме бессмысленно, большинство клиентов
//     его не загрузит, а те, что загрузят, сделают это медленно.
//
// ЦВЕТА ПРОДУБЛИРОВАНЫ КОНСТАНТАМИ ниже. Импортировать lib/brand.ts
// нельзя: Edge Function выполняется в Deno на стороне Supabase и к
// файлам Next-проекта доступа не имеет. Значения обязаны совпадать с
// lib/brand.ts — при смене палитры править оба места.
//
// ------------------------------------------------------------
// ЭТОТ ФАЙЛ НЕ ПРОВЕРЯЕТСЯ НИ npm run build, НИ tsc --noEmit.
// ------------------------------------------------------------
// Он вне tsconfig проекта (supabase/functions в exclude): здесь
// Deno-рантайм и импорты по URL, которые сборка Next не понимает.
// Значит СИНТАКСИЧЕСКАЯ ошибка тут не всплывёт ни в одной локальной
// проверке — она проявится только на деплое, отказом bundle-фазы:
//
//   Failed to bundle the function (reason: The module's source code
//   could not be parsed: Expected ',', got 'string literal' ...)
//
// Так уже случилось однажды: в .join() попал НАСТОЯЩИЙ перевод строки
// внутри одинарных кавычек вместо escape-последовательности. Для
// JavaScript это незакрытая строка, и деплой упал.
//
// Перед деплоем прогоняйте парсер вручную:
//
//   npx tsc --noEmit --ignoreConfig --skipLibCheck --target esnext //     --module esnext --moduleResolution bundler //     supabase/functions/send-email/templates.ts
//
// Ошибки резолва импортов по URL здесь ожидаемы и не важны — ловим
// именно синтаксис (TS1xxx).
// ============================================================

// Дизайн-токены бренда. Зеркало lib/brand.ts → brand.colors.
const COLOR = {
  primary: '#1565C0',
  green: '#22C063',
  red: '#E01E23',
  dark: '#2B2B2E',
  bg: '#FFFFFF',
  // Нейтральные для письма заданы сплошными, а не прозрачным чёрным:
  // rgba в почтовых клиентах поддерживается неровно, а фон письма
  // всегда светлый — визуально результат тот же.
  text: '#000000',
  textMuted: '#666666',
  textFaint: '#999999',
  border: '#E5E5E5',
  surface: '#F7F7F7',
} as const;

// Системный шрифтовый стек: Montserrat в письме недоступен (см. шапку).
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

export type Locale = 'sr' | 'ru';

// Данные письма: произвольный payload из очереди.
export type Payload = Record<string, unknown>;

// Готовое письмо.
export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

// ------------------------------------------------------------
// Экранирование HTML.
// ------------------------------------------------------------
// ОБЯЗАТЕЛЬНО для КАЖДОГО значения из payload. В письмо попадают строки,
// которые ввёл пользователь: название салона, текст обращения, причина
// отклонения от модератора. Без экранирования любая из них ломает
// вёрстку письма, а в почтовом клиенте, показывающем HTML, это ещё и
// вектор подмены содержимого.
function esc(value: unknown): string {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Многострочный пользовательский текст в HTML: экранируем и переводим
// переносы строк в <br>. Иначе абзацы обращения слипаются в одну
// простыню — именно так выглядело бы письмо с текстом из <textarea>.
function escMultiline(value: unknown): string {
  return esc(value).replace(/\r?\n/g, '<br>');
}

// Строка payload или пустая строка. Отдельный хелпер, чтобы не писать
// приведение типа в каждом шаблоне.
function str(payload: Payload, key: string): string {
  const value = payload[key];
  return value === null || value === undefined ? '' : String(value);
}

// ------------------------------------------------------------
// Словарь. Только строки писем; словарь сайта (lib/i18n.ts) сюда не
// импортируется по той же причине, что и brand.ts, — Deno не видит
// файлов Next-проекта.
// ------------------------------------------------------------
const DICT = {
  sr: {
    greeting: 'Zdravo',
    footer_note:
      'Ovu poruku ste dobili jer koristite RS Auto. Ne odgovarajte na nju — sanduče se ne čita.',
    footer_privacy: 'Politika privatnosti',
    footer_contact: 'Kontakt',
    btn_open_listing: 'Pogledaj oglas',
    btn_open_my: 'Moji oglasi',

    // Одобрено.
    approved_subject: 'Oglas je objavljen',
    approved_title: 'Oglas je objavljen',
    approved_lead:
      'Vaš oglas je prošao proveru i sada je vidljiv svim posetiocima sajta.',
    approved_hint:
      'Kupci vam mogu pisati direktno sa oglasa. Odgovorite brzo — prvi odgovor najviše utiče na prodaju.',

    // Отклонено.
    rejected_subject: 'Oglas nije odobren',
    rejected_title: 'Oglas nije odobren',
    rejected_lead: 'Nažalost, vaš oglas nije prošao proveru.',
    rejected_reason_label: 'Razlog',
    rejected_no_reason: 'Razlog nije naveden.',
    rejected_hint:
      'Ispravite oglas u svom nalogu i pošaljite ga ponovo na proveru.',

    // Код входа по почте.
    login_subject: 'Kod za prijavu',
    login_title: 'Kod za prijavu',
    login_lead: 'Unesite ovaj kod na sajtu da biste se prijavili:',
    login_expires: 'Kod važi 10 minuta.',
    login_ignore:
      'Ako niste tražili prijavu, jednostavno zanemarite ovu poruku — niko nije ušao u vaš nalog.',

    // Снято администратором. Отдельно от «не одобрено»: там оглас
    // никогда не публиковался, а здесь он был виден покупателям и
    // исчез — человек это заметит и заслуживает объяснения.
    archived_subject: 'Oglas je uklonjen sa sajta',
    archived_title: 'Oglas je uklonjen sa sajta',
    archived_lead:
      'Vaš oglas je uklonjen iz pretrage odlukom administracije.',
    archived_hint:
      'Ako smatrate da je došlo do greške, odgovorite na ovu poruku ili nam pišite preko kontakt forme.',

    // Копия обращения.
    contact_subject: 'Primili smo vašu poruku',
    contact_title: 'Primili smo vašu poruku',
    contact_lead:
      'Hvala što ste nam pisali. Odgovorićemo na adresu sa koje ste poslali poruku, obično u roku od jednog radnog dana.',
    contact_copy_label: 'Vaša poruka',
    contact_topic_label: 'Tema',

    // Темы обращения — совпадают с contact_topic_* на сайте.
    topic_general: 'Opšte pitanje',
    topic_ad: 'Pitanje o oglasu',
    topic_abuse: 'Prijava zloupotrebe',
    topic_privacy: 'Lični podaci',

    // Ответ по заявке на статус автосалона (0101). Не путать с
    // dealer_lead_admin: то письмо администратору о лиде, эти —
    // заявителю о его правах.
    btn_open_showcase: 'Moja stranica salona',
    btn_open_profile: 'Otvori profil',

    dealer_app_ok_subject: 'Status autosalona je potvrđen',
    dealer_app_ok_title: 'Status autosalona je potvrđen',
    dealer_app_ok_lead:
      'Proverili smo podatke vaše firme. Nalog sada ima status autosalona.',
    dealer_app_ok_hint:
      'Popunite vitrinu u profilu: naslovna slika, slogan, grad i radno vreme. Tako kupci vide sa kim imaju posla još pre nego što otvore oglas.',

    dealer_app_no_subject: 'Zahtev za status autosalona nije odobren',
    dealer_app_no_title: 'Zahtev nije odobren',
    dealer_app_no_lead:
      'Nažalost, ne možemo da potvrdimo status autosalona po ovom zahtevu.',
    dealer_app_reason_label: 'Razlog',
    dealer_app_no_hint:
      'Ispravite podatke i pošaljite novi zahtev iz svog profila. Oglasi na nalogu ostaju nepromenjeni.',
    // Срок публикации (0113). Тон обеих строк — напоминание, а не
    // требование: объявление не удаляется, и продавцу ничего не
    // угрожает. Кнопка ведёт в кабинет, где продление в один клик.
    expiring_subject: 'Oglas uskoro ističe',
    expiring_title: 'Oglas uskoro ističe',
    expiring_lead:
      'Rok objave vašeg oglasa uskoro ističe. Produžite ga da ostane u katalogu.',
    expiring_hint:
      'Ako je automobil već prodat, ne morate ništa da radite — oglas će se sam skloniti.',
    expired_subject: 'Oglas je sklonjen',
    expired_title: 'Oglas je sklonjen',
    expired_lead:
      'Rok objave je istekao, pa je oglas sklonjen iz kataloga. Nije obrisan — možete ga vratiti jednim klikom.',
    expired_hint:
      'Fotografije, opis i cena su sačuvani. Nakon produžetka oglas se odmah vraća u katalog, bez ponovne provere.',
    btn_extend: 'Produži oglas',

    // Nova poruka u prepisci.
    message_subject: 'Nova poruka',
    message_title: 'Nova poruka',
    message_lead_named: 'vam je poslao poruku u vezi sa oglasom',
    message_lead_anon: 'Dobili ste poruku u vezi sa oglasom',
    message_hint:
      'Odgovorite direktno na sajtu. Brz odgovor najviše utiče na prodaju — kupci obično pišu većem broju prodavaca odjednom.',
    btn_open_chat: 'Otvori prepisku',

  },

  ru: {
    greeting: 'Здравствуйте',
    footer_note:
      'Вы получили это письмо, потому что пользуетесь RS Auto. Отвечать на него не нужно — ящик не читается.',
    footer_privacy: 'Политика конфиденциальности',
    footer_contact: 'Контакты',
    btn_open_listing: 'Открыть объявление',
    btn_open_my: 'Мои объявления',

    approved_subject: 'Объявление опубликовано',
    approved_title: 'Объявление опубликовано',
    approved_lead:
      'Ваше объявление прошло проверку и теперь видно всем посетителям сайта.',
    approved_hint:
      'Покупатели могут написать вам прямо со страницы объявления. Отвечайте быстро — первый ответ сильнее всего влияет на продажу.',

    rejected_subject: 'Объявление не одобрено',
    rejected_title: 'Объявление не одобрено',
    rejected_lead: 'К сожалению, ваше объявление не прошло проверку.',
    rejected_reason_label: 'Причина',
    rejected_no_reason: 'Причина не указана.',
    rejected_hint:
      'Исправьте объявление в личном кабинете и отправьте его на проверку заново.',

    login_subject: 'Код для входа',
    login_title: 'Код для входа',
    login_lead: 'Введите этот код на сайте, чтобы войти:',
    login_expires: 'Код действует 10 минут.',
    login_ignore:
      'Если вы не запрашивали вход, просто не обращайте внимания на это письмо — в ваш аккаунт никто не вошёл.',

    archived_subject: 'Объявление снято с публикации',
    archived_title: 'Объявление снято с публикации',
    archived_lead:
      'Ваше объявление убрано из поиска решением администрации.',
    archived_hint:
      'Если вы считаете, что произошла ошибка, ответьте на это письмо или напишите нам через форму обратной связи.',

    contact_subject: 'Мы получили ваше обращение',
    contact_title: 'Мы получили ваше обращение',
    contact_lead:
      'Спасибо, что написали. Мы ответим на адрес, с которого пришло обращение, обычно в течение одного рабочего дня.',
    contact_copy_label: 'Ваше сообщение',
    contact_topic_label: 'Тема',

    topic_general: 'Общий вопрос',
    topic_ad: 'Вопрос по объявлению',
    topic_abuse: 'Жалоба на нарушение',
    topic_privacy: 'Персональные данные',

    // См. комментарий у sr-версии этой группы.
    btn_open_showcase: 'Моя витрина',
    btn_open_profile: 'Открыть профиль',

    dealer_app_ok_subject: 'Статус автосалона подтверждён',
    dealer_app_ok_title: 'Статус автосалона подтверждён',
    dealer_app_ok_lead:
      'Мы проверили данные вашей компании. Аккаунт получил статус автосалона.',
    dealer_app_ok_hint:
      'Заполните витрину в профиле: обложка, слоган, город и часы работы. Так покупатели видят, с кем имеют дело, ещё до того, как откроют объявление.',

    dealer_app_no_subject: 'Заявка на статус автосалона отклонена',
    dealer_app_no_title: 'Заявка отклонена',
    dealer_app_no_lead:
      'К сожалению, по этой заявке мы не можем подтвердить статус автосалона.',
    dealer_app_reason_label: 'Причина',
    dealer_app_no_hint:
      'Исправьте данные и отправьте новую заявку из своего профиля. Объявления на аккаунте остаются без изменений.',
    expiring_subject: 'Объявление скоро истечёт',
    expiring_title: 'Объявление скоро истечёт',
    expiring_lead:
      'Срок публикации вашего объявления скоро истекает. Продлите его, чтобы оно осталось в каталоге.',
    expiring_hint:
      'Если машина уже продана, делать ничего не нужно — объявление скроется само.',
    expired_subject: 'Объявление скрыто',
    expired_title: 'Объявление скрыто',
    expired_lead:
      'Срок публикации истёк, и объявление скрыто из каталога. Оно не удалено — вернуть его можно одним нажатием.',
    expired_hint:
      'Фотографии, описание и цена сохранены. После продления объявление сразу возвращается в каталог, без повторной проверки.',
    btn_extend: 'Продлить объявление',

    // Новое сообщение в переписке.
    message_subject: 'Новое сообщение',
    message_title: 'Новое сообщение',
    message_lead_named: 'написал вам по объявлению',
    message_lead_anon: 'Вам написали по объявлению',
    message_hint:
      'Ответить можно прямо на сайте. Быстрый ответ решает больше всего — покупатели обычно пишут сразу нескольким продавцам.',
    btn_open_chat: 'Открыть переписку',

  },
} as const;

type DictKey = keyof typeof DICT.sr;

function t(locale: Locale, key: DictKey): string {
  return DICT[locale][key];
}

// Человеческое название темы обращения по её коду.
function topicLabel(locale: Locale, topic: string): string {
  const map: Record<string, DictKey> = {
    general: 'topic_general',
    ad: 'topic_ad',
    abuse: 'topic_abuse',
    privacy: 'topic_privacy',
  };

  const key = map[topic];
  return key ? t(locale, key) : topic;
}

// ============================================================
// КАРКАС ПИСЬМА
// ============================================================
// Общая обёртка: шапка с названием площадки, белая карточка с
// содержимым, подвал со ссылкой на политику конфиденциальности.
//
// Внешняя таблица на всю ширину с фоном — приём обязательный: без неё
// в Outlook письмо прижимается к левому краю окна вместо центра.
//
// ССЫЛКА НА /privacy В ПОДВАЛЕ — требование задачи и здравого смысла:
// человек, получивший письмо, должен одним кликом дойти до документа,
// объясняющего, откуда у нас его адрес.
function layout(params: {
  locale: Locale;
  title: string;
  bodyHtml: string;
  siteUrl: string;
  // Цвет полосы над карточкой: зелёный для хороших новостей, красный
  // для отказа, синий для нейтральных. Единственный цветовой акцент
  // письма — правило «один акцент» действует и здесь.
  accent: string;
}): string {
  const { locale, title, bodyHtml, siteUrl, accent } = params;

  // Ссылки подвала ведут на сербскую версию для sr и на /ru для ru:
  // человек, читающий письмо по-русски, не должен попадать на сербский
  // документ. Тот же localeHref, что на сайте, только вручную —
  // импортировать lib/i18n сюда нельзя.
  const prefix = locale === 'ru' ? '/ru' : '';
  const privacyUrl = `${siteUrl}${prefix}/privacy`;
  const contactUrl = `${siteUrl}${prefix}/contact`;

  return `<!doctype html>
<html lang="${locale === 'ru' ? 'ru' : 'sr-Latn'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.surface};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.surface};">
  <tr>
    <td align="center" style="padding:24px 12px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">

        <tr>
          <td style="padding:0 0 16px 0;font-family:${FONT};font-size:18px;font-weight:700;color:${COLOR.dark};">
            <a href="${siteUrl}${prefix}" style="color:${COLOR.dark};text-decoration:none;">RS Auto</a>
          </td>
        </tr>

        <tr>
          <td style="height:4px;background-color:${accent};font-size:0;line-height:0;">&nbsp;</td>
        </tr>

        <tr>
          <td style="background-color:${COLOR.bg};padding:28px 28px 32px 28px;border:1px solid ${COLOR.border};border-top:none;">
            ${bodyHtml}
          </td>
        </tr>

        <tr>
          <td style="padding:20px 4px 0 4px;font-family:${FONT};font-size:12px;line-height:18px;color:${COLOR.textFaint};">
            ${esc(t(locale, 'footer_note'))}
            <br>
            <a href="${privacyUrl}" style="color:${COLOR.textMuted};text-decoration:underline;">${esc(t(locale, 'footer_privacy'))}</a>
            &nbsp;·&nbsp;
            <a href="${contactUrl}" style="color:${COLOR.textMuted};text-decoration:underline;">${esc(t(locale, 'footer_contact'))}</a>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}

// Заголовок первого уровня внутри карточки.
function h1(text: string): string {
  return `<h1 style="margin:0 0 12px 0;font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;color:${COLOR.text};">${esc(text)}</h1>`;
}

// Обычный абзац. muted — для второстепенных пояснений.
function p(text: string, muted = false): string {
  const color = muted ? COLOR.textMuted : COLOR.text;
  return `<p style="margin:0 0 12px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${color};">${text}</p>`;
}

// ------------------------------------------------------------
// Кнопка.
// ------------------------------------------------------------
// Таблица, а не <a> с padding: Outlook игнорирует внутренние отступы
// у ссылок, и кнопка схлопывается в строчку текста. Обёртка таблицей —
// единственный способ получить одинаковую кнопку во всех клиентах.
function button(text: string, url: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px 0;">
  <tr>
    <td style="background-color:${color};border-radius:12px;">
      <a href="${url}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">${esc(text)}</a>
    </td>
  </tr>
</table>`;
}

// ------------------------------------------------------------
// Плашка с выделенным содержимым: причина отказа, копия обращения,
// данные заявки. Серый фон с левой цветной полосой — тот же приём,
// что у карточек-подложек на сайте.
// ------------------------------------------------------------
function panel(innerHtml: string, accent: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;background-color:${COLOR.surface};border-left:3px solid ${accent};">
  <tr>
    <td style="padding:14px 16px;font-family:${FONT};font-size:15px;line-height:22px;color:${COLOR.text};">
      ${innerHtml}
    </td>
  </tr>
</table>`;
}

// Строка «метка: значение» для писем администратору.
function row(label: string, value: string): string {
  if (!value) return '';

  return `<tr>
  <td style="padding:6px 12px 6px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${COLOR.textMuted};white-space:nowrap;vertical-align:top;">${esc(label)}</td>
  <td style="padding:6px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${COLOR.text};">${escMultiline(value)}</td>
</tr>`;
}

// Название автомобиля: «BMW X5, 2018». Год необязателен — у письма
// администратору его может не быть вовсе.
function carTitle(payload: Payload): string {
  const brand = str(payload, 'brand');
  const model = str(payload, 'model');
  const year = str(payload, 'year');

  const name = [brand, model].filter(Boolean).join(' ');
  return year ? `${name}, ${year}` : name;
}

// ============================================================
// ШАБЛОНЫ
// ============================================================
// Каждый возвращает и HTML, и текстовую версию. Текстовая обязательна:
// без неё письмо теряет баллы у спам-фильтров, а клиенты в текстовом
// режиме (и часть корпоративных шлюзов) показали бы пустое сообщение.

// ---------- 1) Объявление одобрено ----------
function carApproved(
  locale: Locale,
  payload: Payload,
  siteUrl: string,
): RenderedEmail {
  const title = carTitle(payload);
  const carUrl = str(payload, 'car_url') || siteUrl;
  const subject = `${t(locale, 'approved_subject')}: ${title}`;

  const bodyHtml = [
    h1(t(locale, 'approved_title')),
    p(esc(t(locale, 'approved_lead'))),
    panel(
      `<strong style="font-size:16px;">${esc(title)}</strong>`,
      COLOR.green,
    ),
    button(t(locale, 'btn_open_listing'), carUrl, COLOR.green),
    p(esc(t(locale, 'approved_hint')), true),
  ].join('\n');

  const text = [
    t(locale, 'approved_title'),
    '',
    t(locale, 'approved_lead'),
    '',
    title,
    carUrl,
    '',
    t(locale, 'approved_hint'),
  ].join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.green }),
    text,
  };
}

// ---------- 2) Объявление отклонено ----------
function carRejected(
  locale: Locale,
  payload: Payload,
  siteUrl: string,
): RenderedEmail {
  const title = carTitle(payload);
  const reason = str(payload, 'reason');
  const subject = `${t(locale, 'rejected_subject')}: ${title}`;

  // Ссылка ведёт в кабинет, а не на карточку: отклонённое объявление
  // публично недоступно (get_car_details отдаёт только active и sold),
  // и ссылка на него дала бы продавцу 404 вместо формы правки.
  const prefix = locale === 'ru' ? '/ru' : '';
  const myUrl = `${siteUrl}${prefix}/my`;

  const bodyHtml = [
    h1(t(locale, 'rejected_title')),
    p(esc(t(locale, 'rejected_lead'))),
    panel(
      [
        `<strong style="font-size:16px;">${esc(title)}</strong><br>`,
        `<span style="color:${COLOR.textMuted};">${esc(t(locale, 'rejected_reason_label'))}:</span> `,
        reason
          ? escMultiline(reason)
          : `<em style="color:${COLOR.textMuted};">${esc(t(locale, 'rejected_no_reason'))}</em>`,
      ].join(''),
      COLOR.red,
    ),
    p(esc(t(locale, 'rejected_hint')), true),
    button(t(locale, 'btn_open_my'), myUrl, COLOR.primary),
  ].join('\n');

  const text = [
    t(locale, 'rejected_title'),
    '',
    t(locale, 'rejected_lead'),
    '',
    title,
    `${t(locale, 'rejected_reason_label')}: ${reason || t(locale, 'rejected_no_reason')}`,
    '',
    t(locale, 'rejected_hint'),
    myUrl,
  ].join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.red }),
    text,
  };
}

// ---------- 1b) Код для входа по почте ----------
// Отправляется НЕ из очереди, а синхронно — из auth-email-hook, когда
// GoTrue просит доставить код. Очередь тут не годится: она
// разбирается раз в пять минут, а код нужен человеку сейчас.
//
// В письме НЕТ НИ ОДНОЙ ССЫЛКИ, и это осознанно. Письмо с кодом —
// главная мишень фишинга: приучив администратора нажимать в нём
// кнопку «Войти», мы делаем поддельное письмо с такой же кнопкой
// рабочим. Код вводится на той вкладке, где его запросили.
//
// Код набран моноширинным шрифтом и разрежен трекингом: шесть цифр
// подряд обычным шрифтом переписываются с ошибкой чаще, чем кажется.
function loginCode(
  locale: Locale,
  payload: Payload,
  siteUrl: string,
): RenderedEmail {
  const code = str(payload, 'code');
  const subject = `${t(locale, 'login_subject')}: ${code}`;

  const bodyHtml = [
    h1(t(locale, 'login_title')),
    p(esc(t(locale, 'login_lead'))),
    // Панель с кодом вместо кнопки: нажимать нечего, читать — есть.
    panel(
      `<span style="font-family: 'SF Mono', Consolas, 'Courier New', monospace;` +
        ` font-size: 32px; font-weight: 700; letter-spacing: 6px;` +
        ` color: ${COLOR.text};">${esc(code)}</span>`,
      COLOR.primary,
    ),
    p(esc(t(locale, 'login_expires')), true),
    p(esc(t(locale, 'login_ignore')), true),
  ].join('\n');

  const text = [
    t(locale, 'login_title'),
    '',
    t(locale, 'login_lead'),
    '',
    code,
    '',
    t(locale, 'login_expires'),
    t(locale, 'login_ignore'),
  ].join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.primary }),
    text,
  };
}

// ---------- 2b) Объявление снято администратором ----------
// Отдельный шаблон, а не переиспользование carRejected. Разница не в
// формулировке, а в положении дел: отклонённое объявление никогда не
// публиковалось и правится дальше по той же дороге, а снятое БЫЛО
// видно покупателям и исчезло. Второе человек замечает сам и,
// не получив письма, идёт в поддержку выяснять, что сломалось.
//
// Поэтому здесь нет кнопки «исправьте и отправьте заново»: снятие —
// решение администрации, и правильный следующий шаг — не повторная
// подача, а разговор с площадкой. Ссылка ведёт в кабинет, где
// объявление лежит в архиве.
function carArchivedByAdmin(
  locale: Locale,
  payload: Payload,
  siteUrl: string,
): RenderedEmail {
  const title = carTitle(payload);
  const reason = str(payload, 'reason');
  const subject = `${t(locale, 'archived_subject')}: ${title}`;

  const prefix = locale === 'ru' ? '/ru' : '';
  const myUrl = `${siteUrl}${prefix}/my`;

  const bodyHtml = [
    h1(t(locale, 'archived_title')),
    p(esc(t(locale, 'archived_lead'))),
    panel(
      [
        `<strong style="font-size:16px;">${esc(title)}</strong><br>`,
        `<span style="color:${COLOR.textMuted};">${esc(t(locale, 'rejected_reason_label'))}:</span> `,
        reason
          ? escMultiline(reason)
          : `<em style="color:${COLOR.textMuted};">${esc(t(locale, 'rejected_no_reason'))}</em>`,
      ].join(''),
      COLOR.red,
    ),
    p(esc(t(locale, 'archived_hint')), true),
    button(t(locale, 'btn_open_my'), myUrl, COLOR.primary),
  ].join('\n');

  const text = [
    t(locale, 'archived_title'),
    '',
    t(locale, 'archived_lead'),
    '',
    title,
    `${t(locale, 'rejected_reason_label')}: ${reason || t(locale, 'rejected_no_reason')}`,
    '',
    t(locale, 'archived_hint'),
    myUrl,
  ].join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.red }),
    text,
  };
}

// ---------- 3) Копия обращения автору ----------
function contactReceived(
  locale: Locale,
  payload: Payload,
  siteUrl: string,
): RenderedEmail {
  const name = str(payload, 'name');
  const topic = topicLabel(locale, str(payload, 'topic'));
  const message = str(payload, 'message');
  const subject = t(locale, 'contact_subject');

  const bodyHtml = [
    h1(t(locale, 'contact_title')),
    // Имя есть всегда (форма его требует), но пустое значение не должно
    // давать «Здравствуйте, !» — поэтому запятая только вместе с именем.
    p(name ? `${esc(t(locale, 'greeting'))}, ${esc(name)}!` : `${esc(t(locale, 'greeting'))}!`),
    p(esc(t(locale, 'contact_lead'))),
    panel(
      [
        `<span style="color:${COLOR.textMuted};">${esc(t(locale, 'contact_topic_label'))}:</span> ${esc(topic)}<br><br>`,
        `<span style="color:${COLOR.textMuted};">${esc(t(locale, 'contact_copy_label'))}:</span><br>`,
        escMultiline(message),
      ].join(''),
      COLOR.primary,
    ),
  ].join('\n');

  const text = [
    t(locale, 'contact_title'),
    '',
    name ? `${t(locale, 'greeting')}, ${name}!` : `${t(locale, 'greeting')}!`,
    t(locale, 'contact_lead'),
    '',
    `${t(locale, 'contact_topic_label')}: ${topic}`,
    `${t(locale, 'contact_copy_label')}:`,
    message,
  ].join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.primary }),
    text,
  };
}

// ---------- 4) Обращение — администратору ----------
// Служебное письмо: без приветствий и кнопок, только данные. Читает
// его команда площадки, и важна плотность информации, а не вёрстка.
function contactAdmin(payload: Payload, siteUrl: string): RenderedEmail {
  const locale: Locale = 'ru';
  const topic = topicLabel(locale, str(payload, 'topic'));
  const email = str(payload, 'email');
  const carId = str(payload, 'car_id');
  const subject = `[RS Auto] Обращение: ${topic}`;

  const bodyHtml = [
    h1('Новое обращение'),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
${[
  row('Тема', topic),
  row('Имя', str(payload, 'name')),
  row('E-mail', email),
  row('Язык формы', str(payload, 'from_locale')),
  row('Объявление', carId ? `${siteUrl}/car/${carId}` : ''),
  row('ID обращения', str(payload, 'message_id')),
]
  .filter(Boolean)
  .join('\n')}
</table>`,
    panel(escMultiline(str(payload, 'message')), COLOR.primary),
    // mailto с проставленной темой: ответ отправляется в один клик,
    // без копирования адреса руками.
    email
      ? p(
          `<a href="mailto:${esc(email)}?subject=${encodeURIComponent('Re: ' + topic)}" style="color:${COLOR.primary};">Ответить: ${esc(email)}</a>`,
        )
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const text = [
    'Новое обращение',
    '',
    `Тема: ${topic}`,
    `Имя: ${str(payload, 'name')}`,
    `E-mail: ${email}`,
    carId ? `Объявление: ${siteUrl}/car/${carId}` : '',
    '',
    str(payload, 'message'),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.primary }),
    text,
  };
}

// ---------- 6) Заявка на СТАТУС салона: статус выдан ----------
// Не путать с dealerLeadAdmin ниже: то письмо АДМИНИСТРАТОРУ о
// маркетинговом лиде с формы «Автосалонам», эти два — ЗАЯВИТЕЛЮ о
// решении по его правам (миграция 0101).
//
// Кнопка ведёт НА ВИТРИНУ, а не в кабинет: человек только что получил
// страницу салона и первым делом хочет увидеть её, а не список своих
// объявлений. Адрес собирается из dealer_id: у салона идентификатор
// страницы совпадает с идентификатором владельца.
function dealerAppApproved(
  locale: Locale,
  payload: Payload,
  siteUrl: string,
): RenderedEmail {
  const company = str(payload, 'company');
  const dealerId = str(payload, 'dealer_id');
  const subject = t(locale, 'dealer_app_ok_subject');

  const prefix = locale === 'ru' ? '/ru' : '';
  // Без dealer_id кнопки на витрину не будет вовсе: ссылка в никуда
  // хуже её отсутствия — то же правило, что в ленте уведомлений.
  const showcaseUrl = dealerId ? `${siteUrl}${prefix}/dealer/${dealerId}` : '';
  const profileUrl = `${siteUrl}${prefix}/my/profile`;

  const bodyHtml = [
    h1(t(locale, 'dealer_app_ok_title')),
    p(esc(t(locale, 'dealer_app_ok_lead'))),
    company
      ? panel(
          `<strong style="font-size:16px;">${esc(company)}</strong>`,
          COLOR.green,
        )
      : '',
    p(esc(t(locale, 'dealer_app_ok_hint')), true),
    showcaseUrl
      ? button(t(locale, 'btn_open_showcase'), showcaseUrl, COLOR.green)
      : button(t(locale, 'btn_open_profile'), profileUrl, COLOR.green),
  ]
    .filter(Boolean)
    .join('\n');

  const text = [
    t(locale, 'dealer_app_ok_title'),
    '',
    t(locale, 'dealer_app_ok_lead'),
    company,
    '',
    t(locale, 'dealer_app_ok_hint'),
    showcaseUrl || profileUrl,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.green }),
    text,
  };
}

// ---------- 7) Заявка на СТАТУС салона: отказ ----------
// ПРИЧИНА — ГЛАВНОЕ СОДЕРЖИМОЕ ПИСЬМА. Ради неё оно и отправляется:
// отказ без объяснения не даёт исправить заявку, и вторая попытка
// вслепую закончится тем же отказом.
// escMultiline: администратор может разбить причину на абзацы, и
// слипшийся текст читался бы хуже написанного.
//
// Кнопка ведёт В ПРОФИЛЬ: именно там стоит блок заявки, из которого
// подаётся новая. Витрины у отклонённого нет.
function dealerAppRejected(
  locale: Locale,
  payload: Payload,
  siteUrl: string,
): RenderedEmail {
  const company = str(payload, 'company');
  const reason = str(payload, 'reason');
  const subject = t(locale, 'dealer_app_no_subject');

  const prefix = locale === 'ru' ? '/ru' : '';
  const profileUrl = `${siteUrl}${prefix}/my/profile`;

  const bodyHtml = [
    h1(t(locale, 'dealer_app_no_title')),
    p(esc(t(locale, 'dealer_app_no_lead'))),
    panel(
      [
        company ? `<strong style="font-size:16px;">${esc(company)}</strong><br>` : '',
        `<span style="color:${COLOR.textMuted};">${esc(t(locale, 'dealer_app_reason_label'))}:</span> `,
        escMultiline(reason),
      ].join(''),
      COLOR.red,
    ),
    p(esc(t(locale, 'dealer_app_no_hint')), true),
    button(t(locale, 'btn_open_profile'), profileUrl, COLOR.primary),
  ].join('\n');

  const text = [
    t(locale, 'dealer_app_no_title'),
    '',
    t(locale, 'dealer_app_no_lead'),
    company,
    `${t(locale, 'dealer_app_reason_label')}: ${reason}`,
    '',
    t(locale, 'dealer_app_no_hint'),
    profileUrl,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.red }),
    text,
  };
}

// ---------- 5) Заявка автосалона — администратору ----------
function dealerLeadAdmin(payload: Payload, siteUrl: string): RenderedEmail {
  const locale: Locale = 'ru';
  const company = str(payload, 'company_name');
  const email = str(payload, 'email');
  const subject = `[RS Auto] Заявка салона: ${company}`;

  const bodyHtml = [
    h1('Новая заявка автосалона'),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
${[
  row('Салон', company),
  row('Контакт', str(payload, 'contact_name')),
  row('Телефон', str(payload, 'phone')),
  row('E-mail', email),
  row('Город', str(payload, 'city')),
  // Реквизиты (0102). row отдаёт пустую строку на пустом значении, и
  // .filter(Boolean) ниже убирает строку целиком — поля
  // необязательные, поэтому в письме их может не быть.
  row('PIB', str(payload, 'tax_id')),
  row('Матични број', str(payload, 'reg_num')),
  row('Сайт', str(payload, 'website')),
  row('ID заявки', str(payload, 'lead_id')),
]
  .filter(Boolean)
  .join('\n')}
</table>`,
    str(payload, 'comment')
      ? panel(escMultiline(str(payload, 'comment')), COLOR.primary)
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const text = [
    'Новая заявка автосалона',
    '',
    `Салон: ${company}`,
    `Контакт: ${str(payload, 'contact_name')}`,
    `Телефон: ${str(payload, 'phone')}`,
    email ? `E-mail: ${email}` : '',
    str(payload, 'city') ? `Город: ${str(payload, 'city')}` : '',
    str(payload, 'tax_id') ? `PIB: ${str(payload, 'tax_id')}` : '',
    str(payload, 'reg_num') ? `Матични број: ${str(payload, 'reg_num')}` : '',
    str(payload, 'website') ? `Сайт: ${str(payload, 'website')}` : '',
    '',
    str(payload, 'comment'),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.primary }),
    text,
  };
}

// ============================================================
// ДИСПЕТЧЕР
// ---------- Срок публикации: скоро истечёт ----------
// Предупреждение за N дней. Тон намеренно мягкий: объявление ещё
// работает, и письмо — напоминание, а не уведомление о санкции.
// Отдельно сказано, что при уже проданной машине делать ничего не
// нужно, — иначе продавец решит, что от него требуют действия.
function listingExpiring(
  locale: Locale,
  payload: Payload,
  siteUrl: string,
): RenderedEmail {
  const title = carTitle(payload);
  // url кладёт expire_listings — это /my, кабинет продавца, где
  // объявление продлевается одной кнопкой.
  const extendUrl = str(payload, 'url') || `${siteUrl}/my`;
  const subject = `${t(locale, 'expiring_subject')}: ${title}`;

  const bodyHtml = [
    h1(t(locale, 'expiring_title')),
    p(esc(t(locale, 'expiring_lead'))),
    panel(`<strong style="font-size:16px;">${esc(title)}</strong>`, COLOR.primary),
    button(t(locale, 'btn_extend'), extendUrl, COLOR.green),
    p(esc(t(locale, 'expiring_hint')), true),
  ].join('\n');

  const text = [
    t(locale, 'expiring_title'),
    '',
    t(locale, 'expiring_lead'),
    '',
    title,
    extendUrl,
    '',
    t(locale, 'expiring_hint'),
  ].join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.primary }),
    text,
  };
}

// ---------- Срок публикации: объявление скрыто ----------
// Письмо после скрытия. Главное здесь — снять тревогу: объявление НЕ
// удалено, фотографии и описание на месте, возврат мгновенный и без
// повторной модерации. Продавец, решивший, что потерял работу по
// заполнению карточки, второй раз её заполнять не станет.
function listingExpired(
  locale: Locale,
  payload: Payload,
  siteUrl: string,
): RenderedEmail {
  const title = carTitle(payload);
  const extendUrl = str(payload, 'url') || `${siteUrl}/my`;
  const subject = `${t(locale, 'expired_subject')}: ${title}`;

  const bodyHtml = [
    h1(t(locale, 'expired_title')),
    p(esc(t(locale, 'expired_lead'))),
    panel(`<strong style="font-size:16px;">${esc(title)}</strong>`, COLOR.primary),
    button(t(locale, 'btn_extend'), extendUrl, COLOR.green),
    p(esc(t(locale, 'expired_hint')), true),
  ].join('\n');

  const text = [
    t(locale, 'expired_title'),
    '',
    t(locale, 'expired_lead'),
    '',
    title,
    extendUrl,
    '',
    t(locale, 'expired_hint'),
  ].join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.primary }),
    text,
  };
}


// ============================================================
// Единственная точка входа для index.ts. Возвращает null для
// неизвестного ключа: перечень шаблонов ограничен check-ограничением
// в базе, но функция может оказаться старее миграции (деплой ещё не
// прошёл) — и тогда письмо должно уйти в failed с внятной ошибкой,
// а не уронить разбор всей пачки.
// ---------- 11) Новое сообщение в переписке ----------
// Ссылка ведёт прямо в диалог (/my/messages/{chat_id}), а не в список
// чатов: письмо приходит по конкретному сообщению, и лишний шаг выбора
// нужного собеседника здесь ничем не оправдан.
//
// Превью сообщения показываем в плашке, но короткое — те же 50
// символов, что в колокольчике и пуше. Письмо не должно раскрывать
// переписку больше, чем остальные каналы: почтовый ящик читают на
// экране блокировки и через сторонние клиенты.
function newMessage(
  locale: Locale,
  payload: Payload,
  siteUrl: string,
): RenderedEmail {
  const sender = str(payload, 'sender');
  const preview = str(payload, 'preview');
  const car = carTitle(payload);

  // Ссылку собрал триггер: локаль получателя там уже учтена. Пустой
  // chat_url (теоретический случай) не должен давать битую кнопку —
  // тогда ведём в список переписок.
  const prefix = locale === 'ru' ? '/ru' : '';
  const chatUrl = str(payload, 'chat_url') || `${siteUrl}${prefix}/my/messages`;

  // Имя отправителя в теме: по нему человек сразу понимает, отвечать
  // ли немедленно. Имени нет (профиль не заполнен) — тема остаётся
  // нейтральной, выдумывать имя нельзя.
  const subject = sender
    ? `${t(locale, 'message_subject')}: ${sender}`
    : t(locale, 'message_subject');

  // Формулировка зависит от наличия имени: в сербском имя стоит перед
  // сказуемым, в русском — тоже, поэтому обе локали строят строку
  // одинаково, а безымянный вариант вынесен отдельной строкой словаря.
  const lead = sender
    ? `<strong>${esc(sender)}</strong> ${esc(t(locale, 'message_lead_named'))}`
    : esc(t(locale, 'message_lead_anon'));

  const bodyHtml = [
    h1(t(locale, 'message_title')),
    p(car ? `${lead} <strong>${esc(car)}</strong>.` : `${lead}.`),
    preview ? panel(escMultiline(preview), COLOR.primary) : '',
    p(esc(t(locale, 'message_hint')), true),
    button(t(locale, 'btn_open_chat'), chatUrl, COLOR.primary),
  ].filter(Boolean).join('\n');

  const text = [
    t(locale, 'message_title'),
    '',
    sender
      ? `${sender} ${t(locale, 'message_lead_named')}${car ? ` ${car}` : ''}.`
      : `${t(locale, 'message_lead_anon')}${car ? ` ${car}` : ''}.`,
    ...(preview ? ['', preview] : []),
    '',
    t(locale, 'message_hint'),
    chatUrl,
  ].join('\n');

  return {
    subject,
    html: layout({ locale, title: subject, bodyHtml, siteUrl, accent: COLOR.primary }),
    text,
  };
}

export function renderEmail(
  templateKey: string,
  payload: Payload,
  siteUrl: string,
): RenderedEmail | null {
  // Локаль письма приходит в payload. Неизвестное значение — сербский:
  // основной рынок площадки.
  const raw = str(payload, 'locale');
  const locale: Locale = raw === 'ru' ? 'ru' : 'sr';

  switch (templateKey) {
    case 'car_approved':
      return carApproved(locale, payload, siteUrl);
    case 'car_rejected':
      return carRejected(locale, payload, siteUrl);
    case 'car_archived_by_admin':
      return carArchivedByAdmin(locale, payload, siteUrl);
    case 'login_code':
      return loginCode(locale, payload, siteUrl);
    case 'contact_received':
      return contactReceived(locale, payload, siteUrl);
    case 'contact_admin':
      return contactAdmin(payload, siteUrl);
    case 'dealer_lead_admin':
      return dealerLeadAdmin(payload, siteUrl);
    case 'dealer_app_approved':
      return dealerAppApproved(locale, payload, siteUrl);
    case 'dealer_app_rejected':
      return dealerAppRejected(locale, payload, siteUrl);
    case 'listing_expiring':
      return listingExpiring(locale, payload, siteUrl);
    case 'listing_expired':
      return listingExpired(locale, payload, siteUrl);
    case 'new_message':
      return newMessage(locale, payload, siteUrl);
    default:
      return null;
  }
}
