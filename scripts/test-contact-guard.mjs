// ============================================================
// RS AUTO — юнит-тесты валидации текста (клиентский слой).
// ============================================================
// Проверяют lib/contactGuard.ts на трёх участках:
//   • описание объявления — контакты, ссылки, разметка, длина;
//   • сообщения в чате — контакты и ссылки без правил длины;
//   • подсветка и устойчивость правил к повторному вызову.
//
// В каждом наборе поровну нарушений и чистых текстов, и ВТОРАЯ
// половина важнее первой: пропущенный номер поймает модерация, а
// ложное срабатывание делает объявление неподаваемым, а чат —
// неработающим, и человек уходит, не поняв почему.
//
// ЗАПУСК: npm run test:contacts
//
// ПОЧЕМУ НЕ PLAYWRIGHT. Проверяются чистые функции без браузера и без
// сети; поднимать для них тестовый прогон Playwright — минуты вместо
// миллисекунд. Серверная половина правил проверяется отдельно, в
// supabase/checks/0135…0137, и там же лежит объяснение, почему оба
// слоя обязаны совпадать.
//
// ЗАВИСИМОСТЕЙ НЕТ НАМЕРЕННО: node:test и node:assert входят в Node,
// а тянуть Jest или Vitest ради этих проверок в проект, где до сих
// пор не было ни одного unit-раннера, — плохой обмен.
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';

// ------------------------------------------------------------
// Загрузка модуля.
// ------------------------------------------------------------
// Node 24 импортирует .ts напрямую — снимает аннотации типов сам, без
// сборки и без раннера. contactGuard.ts для этого подходит: он не
// использует ничего, что требует НАСТОЯЩЕЙ компиляции (enum,
// декораторов, namespace), только аннотации и type-объявления, а их
// достаточно стереть.
//
// Отсюда же следует правило для будущих правок: если импорт вдруг
// упадёт с ошибкой синтаксиса, значит в модуль добавили конструкцию,
// требующую компилятора — и решать надо там, а не здесь.
const {
  findContacts,
  hasContacts,
  splitByContacts,
  validateDescription,
  descriptionLength,
  DESCRIPTION_MIN,
  DESCRIPTION_MAX,
  isMessageAllowed,
  findMessageContacts,
  splitMessageByContacts,
} = await import('../lib/contactGuard.ts');

// ============================================================
// 1. ДЕСЯТЬ ОПИСАНИЙ С КОНТАКТАМИ — ВСЕ ОТКЛОНЯЮТСЯ.
// ============================================================
// Форматы взяты те, какими сербские и русские продавцы пишут номер на
// самом деле: с плюсом и без, со скобками, точками, дефисами,
// разрывами по группам.
const MUST_REJECT = [
  ['+381 сербский с пробелами', 'Odlicno stanje, prvi vlasnik. +381 60 123 4567'],
  ['+381 слитно', 'Auto je u odlicnom stanju, pozovite +381641234567'],
  ['06x с пробелами', 'Prodajem auto, sve informacije na 064 123 4567'],
  ['06x с дефисами', 'Kontakt: 060-345-6789, moze zamena'],
  ['06x в скобках', 'Zvati posle 17h (065) 1234567'],
  ['городской Белград', 'Auto se nalazi u Beogradu, telefon 011 2345678'],
  ['русский 8 в скобках', 'Машина в отличном состоянии, звоните 8 (999) 123-45-67'],
  ['русский 7 слитно', 'Продаю срочно, пишите 79161234567'],
  ['email', 'Sve dodatne informacije na mail: prodavac.auto@gmail.com'],
  ['@ник и t.me', 'Pisite na @prodavac_auto ili t.me/prodavacauto'],
];

for (const [name, text] of MUST_REJECT) {
  test(`отклоняется: ${name}`, () => {
    const found = findContacts(text);
    assert.ok(
      found.length > 0,
      `Контакт НЕ найден в тексте: ${JSON.stringify(text)}`,
    );
    assert.equal(hasContacts(text), true);
  });
}

// ============================================================
// 2. ДЕСЯТЬ ЧИСТЫХ ОПИСАНИЙ — ВСЕ ПРИНИМАЮТСЯ.
// ============================================================
// Здесь собрано ровно то, из-за чего наивный фильтр «шесть цифр
// подряд» неприменим: год, пробег с разделителем и без, цена,
// объём двигателя, размер дисков, VIN-подобные строки, даты
// обслуживания и числа рядом со словом «звоните».
const MUST_PASS = [
  ['год выпуска', 'Automobil 2020. godiste, prvi vlasnik, garazirani.'],
  ['пробег с пробелом', 'Predjeno 86 500 km, redovno servisiran.'],
  ['пробег слитно', 'Kilometraza 145000 km, motor bez ikakvih problema.'],
  ['объём с точкой', 'Motor 1.9 TDI, potrosnja 5.5 litara na 100 km.'],
  ['объём 2.0', 'Dizel 2.0, 140 konjskih snaga, menjac automatik.'],
  ['цена', 'Cena 12 500 evra, moguca sitna dogovor pri kupovini.'],
  ['цена рублями', 'Цена 1 250 000 рублей, торг при осмотре автомобиля.'],
  ['диски и шины', 'Alu felne 17 cola, gume 225/45 R17 iz 2022. godine.'],
  ['даты обслуживания', 'Veliki servis uradjen na 120000 km, 15.03.2024.'],
  [
    'числа рядом с «звоните»',
    'Звоните после 18 часов. Машина 2015 года, пробег 90 000 км.',
  ],
];

for (const [name, text] of MUST_PASS) {
  test(`принимается: ${name}`, () => {
    const found = findContacts(text);
    assert.deepEqual(
      found.map((m) => `${m.kind}:${m.text}`),
      [],
      `ЛОЖНОЕ СРАБАТЫВАНИЕ в тексте: ${JSON.stringify(text)}`,
    );
    assert.equal(hasContacts(text), false);
  });
}

// ============================================================
// 3. ПОДСВЕТКА: индексы указывают на исходный текст.
// ============================================================
// Нормализация обязана сохранять длину строки — на этом держится
// подсветка в форме. Проверяем на тексте с неразрывным пробелом и
// кириллическим гомоглифом: и то и другое нормализатор заменяет.
test('индексы совпадений указывают на исходный текст', () => {
  const text = 'Zvati na 064 123 4567 svaki dan';
  const [match] = findContacts(text);

  assert.ok(match, 'номер не найден');
  assert.equal(
    text.slice(match.start, match.end),
    match.text,
    'срез исходного текста по индексам не совпал с match.text',
  );
  assert.ok(match.text.includes('064'), `подсвечен не номер: ${match.text}`);
});

test('splitByContacts собирается обратно в исходный текст', () => {
  const text = 'Auto 2020, пробег 86 500 км. Viber 060 111 2233 ili @prodavac';
  const chunks = splitByContacts(text);

  assert.equal(
    chunks.map((c) => c.text).join(''),
    text,
    'склейка кусков не равна исходному тексту',
  );
  assert.ok(
    chunks.some((c) => c.match !== null),
    'контакт не выделен в отдельный кусок',
  );
});

// ============================================================
// 4. ПОВТОРНЫЙ ВЫЗОВ ДАЁТ ТОТ ЖЕ РЕЗУЛЬТАТ.
// ============================================================
// Регулярки объявлены с флагом g и хранят lastIndex. Если бы
// findContacts использовал их напрямую, второй вызов на том же тексте
// начал бы поиск с середины и вернул меньше совпадений — а форма
// вызывает функцию на каждое нажатие клавиши.
test('повторный вызов возвращает тот же результат', () => {
  const text = 'Kontakt 064 123 4567 i mail prodaja@auto.rs';

  const first = findContacts(text);
  const second = findContacts(text);

  assert.deepEqual(second, first, 'результат второго вызова отличается');
  assert.ok(first.length >= 2, `ожидалось минимум два совпадения: ${first.length}`);
});

// ============================================================
// 5. ВНЕШНИЕ ССЫЛКИ — ДЕСЯТЬ ОПИСАНИЙ, ВСЕ ОТКЛОНЯЮТСЯ.
// ============================================================
// Ссылка уводит покупателя с площадки так же, как телефон в тексте,
// только через чужой сайт. Проверяем все записи: со схемой, с www,
// голый домен, домен с путём, поддомен, ftp.
const MUST_REJECT_LINKS = [
  ['https со схемой', 'Pogledajte na https://avito.ru/12345 vise slika automobila'],
  ['http со схемой', 'Detaljan opis i slike na http://mojauto.rs/oglas/998877'],
  ['www без схемы', 'Vise informacija na www.mojauto.rs o ovom vozilu i ceni'],
  ['голый домен .rs', 'Detalji: mojauto.rs/oglas/12345 pogledajte slike i opis'],
  ['голый домен .com', 'Slike na imgur.com/abc123 ima ih dosta za pregled kupcima'],
  ['поддомен', 'Sve slike na slike.mojauto.rs u punoj rezoluciji za kupce'],
  ['домен .net', 'Kompletna istorija servisa na autoistorija.net za proveru'],
  ['домен .io', 'Izvestaj o vozilu dostupan na carcheck.io pogledajte sami'],
  ['ftp', 'Dokumentacija na ftp://files.example.com dostupna svima vama'],
  ['youtube', 'Video snimak motora na youtube.com/watch pogledajte obavezno'],
];

for (const [name, text] of MUST_REJECT_LINKS) {
  test(`ссылка отклоняется: ${name}`, () => {
    assert.equal(
      validateDescription(text),
      'sell_err_desc_links',
      `ссылка не поймана или названа другой причиной: ${JSON.stringify(text)}`,
    );
  });
}

// ============================================================
// 6. HTML И СКРИПТЫ — ДЕСЯТЬ ОПИСАНИЙ, ВСЕ ОТКЛОНЯЮТСЯ.
// ============================================================
// Разметка приезжает при копировании с другой площадки и ломает и
// карточку, и письма, и JSON-LD. Отклоняем, а НЕ вычищаем молча:
// подменять авторский текст без ведома продавца нельзя.
const MUST_REJECT_HTML = [
  ['парный тег b', 'Opis <b>odlicno</b> stanje auta i kompletna oprema vozila'],
  ['одиночный br', 'Prvi vlasnik<br/>Garaziran primerak, nije nikada udaran'],
  ['div с атрибутом', '<div class=x>Prodajem auto</div> u odlicnom stanju danas'],
  ['script', 'Auto <script>alert(1)</script> u odlicnom stanju bez ostecenja'],
  ['незакрытый script', 'Odlicno stanje <script src=x.js nije nikada udaran auto'],
  ['iframe', 'Pogledajte <iframe src=x></iframe> i procenite stanje vozila'],
  ['обработчик onclick', 'onclick=alert(1) odlicno stanje automobila, garaziran'],
  ['javascript:', 'javascript:void(0) prodajem auto u odlicnom stanju, nov'],
  ['HTML-сущности', 'Tekst sa &lt;br&gt; oznakama i ostalim stvarima iz oglasa'],
  ['закрывающий тег', 'Prodajem auto</p> u odlicnom stanju, prvi vlasnik, klima'],
];

for (const [name, text] of MUST_REJECT_HTML) {
  test(`разметка отклоняется: ${name}`, () => {
    assert.equal(
      validateDescription(text),
      'sell_err_desc_html',
      `разметка не поймана или названа другой причиной: ${JSON.stringify(text)}`,
    );
  });
}

// ============================================================
// 7. ДЛИНА ОПИСАНИЯ.
// ============================================================
// Десять слишком коротких: от одного слова до двадцати с небольшим
// символов. Границу проверяем отдельным тестом с обеих сторон.
const TOO_SHORT = [
  'Auto',
  'Prodajem',
  'Prodajem auto',
  'Odlicno stanje',
  'Продаю машину',
  'Golf 7 dizel',
  'Hitno prodajem!',
  'Prvi vlasnik auta',
  'Срочно продам авто!',
  'Odlicno stanje auta hit',
];

for (const text of TOO_SHORT) {
  test(`слишком короткое (${text.trim().length}): ${text}`, () => {
    assert.ok(
      text.trim().length < DESCRIPTION_MIN,
      'тест составлен неверно: описание не короче минимума',
    );
    assert.equal(validateDescription(text), 'sell_err_desc_short');
  });
}

test('граница минимума: 29 отклоняется, 30 принимается', () => {
  // Ровно на границе — то место, где ошибаются чаще всего.
  const at29 = 'a'.repeat(29);
  const at30 = 'a'.repeat(30);

  assert.equal(validateDescription(at29), 'sell_err_desc_short');
  assert.equal(validateDescription(at30), null);
});

test('длина считается без крайних пробелов', () => {
  // Двадцать пробелов вокруг двадцати букв: визуально «длинно»,
  // по смыслу — двадцать символов.
  const padded = `          ${'a'.repeat(20)}          `;

  assert.equal(descriptionLength(padded), 20);
  assert.equal(validateDescription(padded), 'sell_err_desc_short');
});

test('граница максимума: 6000 принимается, 6001 отклоняется', () => {
  const at6000 = 'a'.repeat(DESCRIPTION_MAX);
  const at6001 = 'a'.repeat(DESCRIPTION_MAX + 1);

  assert.equal(validateDescription(at6000), null);
  assert.equal(validateDescription(at6001), 'sell_err_desc_long');
});

test('пустое описание допустимо — поле необязательное', () => {
  // Описание необязательно с 0034. Требовать текст от всех значило бы
  // менять правила подачи, а не добавлять проверку.
  assert.equal(validateDescription(''), null);
  assert.equal(validateDescription('   \n  '), null);
});

// ============================================================
// 8. ДЕСЯТЬ ЧИСТЫХ ОПИСАНИЙ ПРОХОДЯТ ВСЮ ВАЛИДАЦИЮ ЦЕЛИКОМ.
// ============================================================
// Не только правила по отдельности, но и validateDescription как одно
// целое: длина, ссылки, разметка и контакты вместе. Все описания не
// короче тридцати символов и содержат числа, из-за которых наивные
// фильтры дают ложные срабатывания.
const CLEAN_FULL = [
  'Motor 1.9 TDI, potrosnja 5.5 litara na 100 km, odlicno stanje.',
  'Veliki servis uradjen na 120000 km, 15.03.2024. Sve je uredno.',
  'Alu felne 17 cola, gume 225/45 R17 iz 2022. godine, kao nove.',
  'Automobil 2020. godiste, prvi vlasnik, garaziran, nije udaran.',
  'Dizel 2.0, 140 konjskih snaga, menjac automatik, tempomat, klima.',
  'Predjeno 86 500 km, redovno servisiran u ovlascenom servisu.',
  'Цена 12 500 евро. Машина 2015 года, пробег 90 000 км, один хозяин.',
  'Klima, ABS, ESP, 6 vazdusnih jastuka, parking senzori napred.',
  'Звоните после 18 часов. Машина 2015 года, пробег 90 000 км, торг.',
  'Auto je nov.Me interesuje samo ozbiljan kupac za ovaj automobil.',
];

for (const text of CLEAN_FULL) {
  test(`чистое описание принимается целиком: ${text.slice(0, 40)}…`, () => {
    assert.equal(
      validateDescription(text),
      null,
      `ЛОЖНОЕ СРАБАТЫВАНИЕ: ${JSON.stringify(text)}`,
    );
  });
}

// ============================================================
// 9. ПРИОРИТЕТ ПРИЧИН.
// ============================================================
// Порядок обязан совпадать с триггером в базе (0136): иначе форма
// назовёт одну причину, а сервер при обходе — другую.
test('разметка важнее ссылки и контакта', () => {
  const text = '<b>Zovite</b> na 064 123 4567 ili mojauto.rs za detalje sada';
  assert.equal(validateDescription(text), 'sell_err_desc_html');
});

test('контакт важнее общей ссылки', () => {
  // t.me — и мессенджер, и ссылка. Причина про контакты точнее.
  const text = 'Pisite na t.me/prodavac ili pogledajte mojauto.rs za slike';
  assert.equal(validateDescription(text), 'sell_err_contacts');
});

test('нарушение содержания важнее короткой длины', () => {
  // Текст короче тридцати символов И содержит номер. Продавцу
  // полезнее узнать про номер: дописать текст он и так собирался.
  const text = 'Zovi 064 123 4567';
  assert.equal(validateDescription(text), 'sell_err_contacts');
});

// ============================================================
// 10. СООБЩЕНИЯ В ЧАТЕ.
// ============================================================
// Правила те же, что у описания, но без длины и без деления причин:
// в переписке запрещено всё контактное разом. Проверяется отдельно от
// описания, потому что набор реплик другой — это диалог, а не текст
// объявления, и ложное срабатывание здесь злее: человек не может
// задать обычный вопрос.

// --- Десять сообщений, которые НЕ должны уйти ---------------
const MESSAGES_BLOCKED = [
  ['сербский мобильный', 'Zovite me na 064 123 4567 dogovorimo se oko cene'],
  ['международный +381', 'Posaljite poruku na +381 60 123 4567 molim vas'],
  ['русский со скобками', 'Пишите на 8 (999) 123-45-67, так будет удобнее'],
  ['русский слитно', 'Мой телефон 79161234567, звоните после шести вечера'],
  ['email', 'Napisite mi na mail prodavac.auto@gmail.com za detalje'],
  ['t.me', 'Nadjite me na t.me/prodavac tamo sam stalno dostupan'],
  ['wa.me', 'Pisite na wa.me/381641234567 tamo mi je brze da odgovorim'],
  ['@никнейм', 'Moj instagram @car_seller_rs pogledajte tamo jos slika'],
  ['https-ссылка', 'Pogledajte jos slika na https://imgur.com/abc123 evo'],
  ['www-домен', 'Sve fotografije su na www.mojauto.rs pogledajte tamo'],
];

for (const [name, text] of MESSAGES_BLOCKED) {
  test(`сообщение НЕ отправляется: ${name}`, () => {
    assert.equal(
      isMessageAllowed(text),
      false,
      `контакт не пойман в сообщении: ${JSON.stringify(text)}`,
    );
    assert.ok(
      findMessageContacts(text).length > 0,
      'совпадений нет — подсвечивать будет нечего',
    );
  });
}

// --- Десять сообщений, которые ДОЛЖНЫ уйти ------------------
// Обычная переписка покупателя с продавцом. Половина содержит числа —
// год, пробег, цену, объём двигателя, время встречи: ровно то, из-за
// чего наивный фильтр «цифры = телефон» сделал бы чат неработающим.
const MESSAGES_CLEAN = [
  ['приветствие', 'Dobar dan, da li je auto jos uvek dostupan za prodaju?'],
  ['вопрос о пробеге', 'Koliko ima kilometara? Vidim 86 500 u oglasu.'],
  ['торг', 'Da li moze 9 500 evra? To mi je maksimum koji mogu.'],
  ['год выпуска', 'Auto je iz 2020. godine, je li tako? Prvi vlasnik?'],
  ['приветствие по-русски', 'Здравствуйте! Машина ещё продаётся?'],
  ['пробег по-русски', 'Какой пробег? В объявлении указано 86 500 км.'],
  ['цена по-русски', 'Цена 9 500 € окончательная или возможен торг?'],
  ['время встречи', 'Mogu li da dodjem u subotu oko 15 casova da pogledam?'],
  ['вопрос об истории', 'Da li je bio u nekom udesu? Ima li tragova popravke?'],
  ['характеристики', 'Motor 2.0 dizel, menjac automatik — je li tako?'],
];

for (const [name, text] of MESSAGES_CLEAN) {
  test(`сообщение отправляется: ${name}`, () => {
    assert.equal(
      isMessageAllowed(text),
      true,
      `ЛОЖНОЕ СРАБАТЫВАНИЕ в сообщении: ${JSON.stringify(
        text,
      )} → ${JSON.stringify(
        findMessageContacts(text).map((m) => `${m.kind}:${m.text}`),
      )}`,
    );
  });
}

// --- Разметка в чате НЕ запрещена ---------------------------
// В отличие от описания: сообщения выводятся как текст, без
// dangerouslySetInnerHTML, поэтому теги безобидны, а разговор про них
// вполне возможен. Правило, которое не защищает, но мешает, не нужно.
test('разметка в сообщении не блокируется', () => {
  assert.equal(isMessageAllowed('Napisi <b>podebljano</b> u oglasu'), true);
});

// --- Подсветка сообщения --------------------------------------
test('splitMessageByContacts собирается обратно в исходный текст', () => {
  const text = 'Zovite na 064 123 4567 ili pogledajte www.mojauto.rs danas';
  const chunks = splitMessageByContacts(text);

  assert.equal(
    chunks.map((c) => c.text).join(''),
    text,
    'склейка кусков не равна исходному сообщению',
  );
  assert.ok(
    chunks.some((c) => c.match !== null),
    'контакт не выделен в отдельный кусок',
  );
});

// ============================================================
// 11. ОБЯЗАТЕЛЬНОЕ ОПИСАНИЕ (режим сайта).
// ============================================================
// Два режима одной функции, и разница между ними не косметическая:
// по умолчанию она повторяет БАЗУ (0136: пустое описание допустимо), а
// с required:true — правило САЙТА, который строже. Проверяем оба,
// потому что расхождение режимов и есть то, ради чего флаг заведён.
test('по умолчанию пустое описание допустимо — как в базе', () => {
  // Это поведение обязано совпадать с триггером 0136: там проверки
  // длины стоят внутри `if new.description is not null`.
  assert.equal(validateDescription(''), null);
  assert.equal(validateDescription('   \n  '), null);
});

test('required: пустое описание отклоняется', () => {
  assert.equal(
    validateDescription('', { required: true }),
    'sell_err_desc_required',
  );
  // Пробелы — то же самое: строка из пробелов описанием не является.
  assert.equal(
    validateDescription('   \n  ', { required: true }),
    'sell_err_desc_required',
  );
});

test('required: короткое описание остаётся «слишком коротким»', () => {
  // У пустого и у короткого РАЗНЫЕ сообщения: пустому полю говорить
  // «в нём 0 символов из 30» — объяснять очевидное вместо просьбы
  // заполнить.
  assert.equal(
    validateDescription('Продаю Golf', { required: true }),
    'sell_err_desc_short',
  );
  assert.equal(
    validateDescription('a'.repeat(29), { required: true }),
    'sell_err_desc_short',
  );
});

test('required: нормальное описание проходит', () => {
  const text =
    'Автомобиль в отличном состоянии, один хозяин, гаражное хранение.';
  assert.equal(validateDescription(text, { required: true }), null);
  assert.equal(validateDescription('a'.repeat(30), { required: true }), null);
});

test('required не отменяет проверку содержания', () => {
  // Флаг добавляет правило, а не заменяет остальные: телефон в
  // непустом описании по-прежнему важнее длины.
  assert.equal(
    validateDescription('Отличная машина, звоните 064 123 4567 в любое время', {
      required: true,
    }),
    'sell_err_contacts',
  );
});
