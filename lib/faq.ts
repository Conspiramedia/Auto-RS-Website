// ============================================================
// RS AUTO — Вопросы и ответы. ЕДИНЫЙ ИСТОЧНИК для /faq и JSON-LD.
// ============================================================
// Держатся отдельно от dict по той же причине, что и тексты legal.ts:
// это длинные абзацы, а не подписи интерфейса, и плоский словарь из-за
// них стал бы нечитаемым.
//
// ВАЖНО: этот же массив кормит разметку FAQPage (schema.org). Поэтому
// вопрос и ответ обязаны быть самодостаточными — Google показывает их
// в выдаче вырванными из контекста страницы. Ответы без ссылок и без
// «см. выше»: в сниппете такие отсылки бессмысленны.
//
// ⚠️ Сербские формулировки — черновик, требуют вычитки носителем языка
// перед релизом (отмечено в README).
// ============================================================

import type { Locale } from './i18n';

// Группа вопросов. Ключ подписи берётся из dict, чтобы заголовки
// разделов не разъезжались с навигацией.
export type FaqGroup = 'general' | 'buyer' | 'seller' | 'dealer';

export type FaqItem = {
  group: FaqGroup;
  question: string;
  answer: string;
};

const FAQ_SR: FaqItem[] = [
  // ---------- Общее ----------
  {
    group: 'general',
    question: 'Da li je objavljivanje oglasa besplatno?',
    answer:
      'Jeste. Objavljivanje oglasa za prodaju ili iznajmljivanje automobila je besplatno, a proviziju na prodaju ne naplaćujemo. Plaća se samo isticanje oglasa, i to je opcija — oglas se objavljuje i bez toga.',
  },
  {
    group: 'general',
    question: 'Da li moram da instaliram aplikaciju?',
    answer:
      'Za pregled oglasa i postavljanje oglasa — ne, sve radi na sajtu. Aplikacija je potrebna za poruke i pozive sa prodavcem, za sačuvane pretrage i obaveštenja o novim vozilima i sniženjima cena.',
  },
  {
    group: 'general',
    question: 'Da li su sajt i aplikacija ista baza oglasa?',
    answer:
      'Da. Oglas postavljen na sajtu odmah je vidljiv u aplikaciji, i obrnuto. Ne postoje dve odvojene ponude i ne treba objavljivati oglas dva puta.',
  },
  {
    group: 'general',
    question: 'Da li RS Auto učestvuje u kupoprodaji?',
    answer:
      'Ne. RS Auto je platforma za oglase i nije strana u poslu — ne nastupa kao prodavac, kupac ni posrednik. Pregled vozila, proveru dokumentacije i plaćanje dogovaraju kupac i prodavac neposredno, na sopstvenu odgovornost.',
  },

  // ---------- Покупателям ----------
  {
    group: 'buyer',
    question: 'Kako da kontaktiram prodavca?',
    answer:
      'Na stranici oglasa pritisnite „Nastavi u aplikaciji“. Poruke i pozivi idu kroz aplikaciju RS Auto, pa vaš broj telefona ostaje skriven, a cela prepiska je na jednom mestu.',
  },
  {
    group: 'buyer',
    question: 'Nema automobila koji mi odgovara. Šta da radim?',
    answer:
      'Sačuvajte pretragu u aplikaciji sa svojim uslovima — marka, godište, cena, grad. Poslaćemo obaveštenje čim se pojavi vozilo koje im odgovara, kao i kada prodavac snizi cenu automobila koji pratite.',
  },
  {
    group: 'buyer',
    question: 'Da li proveravate ispravnost automobila?',
    answer:
      'Ne. Proveravamo sadržaj oglasa — da nije prevara, da nema zabranjenog sadržaja i očigledno lažnih podataka. Tehničko stanje vozila, kilometražu i dokumentaciju obavezno proverite lično pre kupovine, najbolje na ovlašćenom servisu.',
  },
  {
    group: 'buyer',
    question: 'Kako da prijavim sumnjiv oglas?',
    answer:
      'Pišite nam preko stranice Kontakt i izaberite temu „Prijava zloupotrebe“. Navedite link oglasa. Sumnjive oglase proveravamo i uklanjamo, a naloge koji krše pravila blokiramo.',
  },

  // ---------- Продавцам ----------
  {
    group: 'seller',
    question: 'Koliko traje provera oglasa?',
    answer:
      'Obično do jednog dana. Nakon odobrenja oglas se pojavljuje u katalogu sajta i u aplikaciji. Ako oglas bude odbijen, obavestićemo vas o razlogu.',
  },
  {
    group: 'seller',
    question: 'Zašto je potreban broj telefona i SMS kod?',
    answer:
      'Potvrda broja je istovremeno i vaša prijava — poseban nalog nije potreban. To je i osnovna zaštita od lažnih oglasa: svaki oglas vezan je za potvrđen broj. Broj se koristi za kontakt u vezi sa oglasom i prikazuje se kupcima kao kontakt prodavca.',
  },
  {
    group: 'seller',
    question: 'Prodajem i iznajmljujem isti automobil. Kako da ga objavim?',
    answer:
      'Postavite dva odvojena oglasa — jedan za prodaju, jedan za izdavanje. Oglas ima jedan tip posla, a cena prodaje i cena po danu su različite stvari i ne mogu stajati u istom oglasu. Zaštita od duplikata ovo dozvoljava.',
  },

  // ---------- Автосалонам ----------
  {
    group: 'dealer',
    question: 'Kako da priključim svoj autosalon?',
    answer:
      'Popunite obrazac na stranici za autosalone: naziv salona, kontakt osoba i telefon. Javljamo se i dogovaramo detalje. Prva 3 meseca su bez naknade.',
  },
  {
    group: 'dealer',
    question: 'Po čemu se nalog salona razlikuje od privatnog?',
    answer:
      'Salon dobija posebnu stranicu sa celim voznim parkom na jednom mestu, sa nazivom i logotipom. Svaki oglas nosi oznaku „Autosalon“, pa kupci odmah vide da imaju posla sa firmom, a ne sa privatnim licem.',
  },
];

const FAQ_RU: FaqItem[] = [
  // ---------- Общее ----------
  {
    group: 'general',
    question: 'Размещение объявления бесплатное?',
    answer:
      'Да. Публикация объявления о продаже или аренде автомобиля бесплатна, комиссию с продажи мы не берём. Платное только продвижение объявления, и это возможность — без него объявление тоже публикуется.',
  },
  {
    group: 'general',
    question: 'Обязательно ли устанавливать приложение?',
    answer:
      'Для просмотра объявлений и подачи объявления — нет, всё работает на сайте. Приложение нужно для сообщений и звонков продавцу, для сохранённых поисков и уведомлений о новых машинах и снижении цен.',
  },
  {
    group: 'general',
    question: 'У сайта и приложения одна база объявлений?',
    answer:
      'Да. Объявление, поданное на сайте, сразу видно в приложении, и наоборот. Двух разных витрин не существует, подавать объявление дважды не нужно.',
  },
  {
    group: 'general',
    question: 'RS Auto участвует в сделке?',
    answer:
      'Нет. RS Auto — площадка объявлений, а не сторона сделки: мы не выступаем продавцом, покупателем или посредником. Осмотр автомобиля, проверку документов и расчёты покупатель и продавец ведут напрямую, под свою ответственность.',
  },

  // ---------- Покупателям ----------
  {
    group: 'buyer',
    question: 'Как связаться с продавцом?',
    answer:
      'На странице объявления нажмите «Продолжить в приложении». Сообщения и звонки идут через приложение RS Auto, поэтому ваш номер телефона остаётся скрытым, а вся переписка — в одном месте.',
  },
  {
    group: 'buyer',
    question: 'Подходящей машины нет. Что делать?',
    answer:
      'Сохраните поиск в приложении со своими условиями — марка, год, цена, город. Пришлём уведомление, как только появится подходящий автомобиль, а также когда продавец снизит цену на отслеживаемую машину.',
  },
  {
    group: 'buyer',
    question: 'Вы проверяете техническое состояние автомобилей?',
    answer:
      'Нет. Мы проверяем содержание объявления — что это не мошенничество, нет запрещённого контента и заведомо ложных данных. Техническое состояние, пробег и документы обязательно проверьте лично перед покупкой, лучше всего на сервисе.',
  },
  {
    group: 'buyer',
    question: 'Как пожаловаться на подозрительное объявление?',
    answer:
      'Напишите нам через страницу «Контакты», выбрав тему «Жалоба на нарушение». Укажите ссылку на объявление. Подозрительные объявления мы проверяем и снимаем, а аккаунты нарушителей блокируем.',
  },

  // ---------- Продавцам ----------
  {
    group: 'seller',
    question: 'Сколько идёт проверка объявления?',
    answer:
      'Обычно до суток. После одобрения объявление появляется в каталоге сайта и в приложении. Если объявление отклонено, мы сообщим причину.',
  },
  {
    group: 'seller',
    question: 'Зачем нужен номер телефона и код из SMS?',
    answer:
      'Подтверждение номера одновременно является входом — отдельная регистрация не нужна. Это же базовая защита от фальшивых объявлений: каждое объявление привязано к подтверждённому номеру. Номер используется для связи по объявлению и показывается покупателям как контакт продавца.',
  },
  {
    group: 'seller',
    question: 'Продаю и сдаю одну и ту же машину. Как её разместить?',
    answer:
      'Подайте два отдельных объявления — одно на продажу, одно в аренду. У объявления один тип сделки, а цена продажи и цена за сутки — разные величины и в одном объявлении не уживаются. Защита от дублей это разрешает.',
  },

  // ---------- Автосалонам ----------
  {
    group: 'dealer',
    question: 'Как подключить автосалон?',
    answer:
      'Заполните форму на странице для автосалонов: название салона, контактное лицо и телефон. Мы свяжемся и обсудим детали. Первые 3 месяца — без оплаты.',
  },
  {
    group: 'dealer',
    question: 'Чем аккаунт салона отличается от частного?',
    answer:
      'Салон получает отдельную страницу со всем автопарком в одном месте, с названием и логотипом. На каждом объявлении стоит пометка «Автосалон», поэтому покупатели сразу видят, что имеют дело с компанией, а не с частным лицом.',
  },
];

export const FAQ: Record<Locale, FaqItem[]> = {
  sr: FAQ_SR,
  ru: FAQ_RU,
};

// Порядок групп на странице: от общего к частному.
export const FAQ_GROUPS: FaqGroup[] = ['general', 'buyer', 'seller', 'dealer'];

// ------------------------------------------------------------
// JSON-LD FAQPage (schema.org).
// ------------------------------------------------------------
// Даёт раскрывающиеся вопросы прямо в результатах поиска. Требование
// Google: разметка должна содержать ТОТ ЖЕ текст, что видит посетитель,
// — поэтому строится из того же массива, а не из отдельной копии.
export function buildFaqJsonLd(items: FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}
