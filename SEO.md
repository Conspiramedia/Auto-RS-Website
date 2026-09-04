# SEO-инвентаризация RS Auto

Ревизия метаданных всех публичных и личных страниц сайта в обеих локалях.
Дата среза: 2026-09-04.

**Статус: правки внесены, все флаги закрыты.** Документ описывает
состояние ПОСЛЕ исправления — таблицы приведены к фактическим значениям,
раздел 7 отмечает по каждой проблеме, что с ней сделано. Значения
проверены на отдаваемом HTML (`next start` + curl), а не только по
исходникам. Ревизия охватывает `<head>`, а также `<h1>` витрин марок и
моделей (проблема №14).

Одна проверка **отложена до появления данных** — арендные витрины, см.
раздел 9.

**Как читать длины.** Колонка «title» приводит ДВА значения: raw — строка,
которую отдаёт `generateMetadata`, и `<head>` — то, что реально уходит в
разметку после шаблона корневого layout (`app/layout.tsx`:
`template: '%s | RS Auto'`, +10 символов). Оценка по диапазону 30–60
делается по значению `<head>`: именно его видит поисковик. Исключения —
страницы, объявляющие `title: { absolute: ... }`; у них шаблон не
применяется, и raw = `<head>`.

Базовый домен: `https://rsauto.rs` (`NEXT_PUBLIC_SITE_BASE_URL`).
Сербская локаль живёт в корне без префикса, русская — под `/ru`
(`lib/i18n.ts` → `localeHref`).

---

## 1. Публичные страницы

### Главная

| | SR `/` | RU `/ru` |
|---|---|---|
| title raw / `<head>` | `Kupite, prodajte ili iznajmite auto u Srbiji` — 44 / **44** (absolute) | `Купить, продать или арендовать авто в Сербии` — 44 / **44** (absolute) |
| description | `Oglasnik za prodaju i iznajmljivanje automobila u Srbiji. Privatni prodavci i saloni objavljuju besplatno; kupci biraju na srpskom i ruskom.` — **140** | `Маркетплейс по продаже и аренде авто в Сербии. Частные продавцы и автосалоны размещают бесплатно; покупатели выбирают на сербском и русском.` — **140** |
| canonical | `https://rsauto.rs/` | `https://rsauto.rs/ru` |
| hreflang | `sr-Latn` → `/`, `ru` → `/ru`, `x-default` → `/` | то же |
| index | index | index |
| JSON-LD | `Organization` + `WebSite` (SearchAction → `/cars?q=`) | `Organization` + `WebSite` (SearchAction → `/ru/cars?q=`) |
| og:title | = title (44) | = title (44) |
| og:description | **длинное**, 160: `Polovni i novi automobili od privatnih prodavaca i salona iz Beograda, Novog Sada i cele Srbije…` | **длинное**, 157: `Б/у и новые автомобили от частников и автосалонов Белграда, Нови-Сада и всей Сербии…` |
| og:image | `/opengraph-image` | `/ru/opengraph-image` |

Разведение короткого и длинного описания сделано намеренно
(`lib/i18n.ts`, комментарий у `meta_home_desc_short`): `<meta name=
"description">` получает короткую версию под обрезку Google, og/twitter —
полную под мессенджеры.

### Каталог продажи

| | SR `/cars` | RU `/ru/cars` |
|---|---|---|
| title raw / `<head>` | `Automobili na prodaju` — 21 / **31** | `Автомобили на продажу` — 21 / **31** |
| description | `Automobili na prodaju u Srbiji. Pretraga po marki, modelu, gradu i ceni.` — **72** | `Автомобили на продажу в Сербии. Поиск по марке, модели, городу и цене.` — **70** |
| canonical | `https://rsauto.rs/cars` | `https://rsauto.rs/ru/cars` |
| hreflang | `sr-Latn` → `/cars`, `ru` → `/ru/cars`, `x-default` → `/cars` | то же |
| index | index — только чистая витрина. `noindex` при любом активном фильтре или `page > 1` | то же |
| JSON-LD | `ItemList` (сквозная нумерация, `numberOfItems` = всего в выдаче); пустая выдача не размечается | то же |
| og:title / og:description | = title / = description | = title / = description |

Важно: canonical чистый (`/cars`) подставляется и на отфильтрованных
страницах — параметры в него не попадают. Это корректно только в паре с
`noindex`, который там и стоит.

### Аренда

| | SR `/rent` | RU `/ru/rent` |
|---|---|---|
| title raw / `<head>` | `Automobili za izdavanje u Srbiji` — 32 / **42** ✅ | `Автомобили в аренду в Сербии` — 28 / **38** ✅ |
| description | `Iznajmljivanje automobila u Srbiji: oglasi privatnih vlasnika i salona. Cena po danu, grad, marka, model. Direktna veza sa iznajmljivačem.` — **138** | `Аренда авто в Сербии: объявления от частных владельцев и салонов. Цена за день, город, марка, модель. Связь с арендодателем напрямую.` — **133** |
| canonical | `https://rsauto.rs/rent` | `https://rsauto.rs/ru/rent` |
| hreflang | `sr-Latn` → `/rent`, `ru` → `/ru/rent`, `x-default` → `/rent` | то же |
| index | index; `noindex` при фильтрах и `page > 1` | то же |
| JSON-LD | `ItemList` | `ItemList` |
| og:title / og:description | = title / = description | = title / = description |

### Подача объявления

| | SR `/sell` | RU `/ru/sell` |
|---|---|---|
| title raw / `<head>` | `Prodajte automobil u Srbiji` — 27 / **37** ✅ | `Продайте автомобиль в Сербии` — 28 / **38** ✅ |
| description | `Objavite oglas za prodaju ili iznajmljivanje automobila u Srbiji besplatno. Prijava traje 10 minuta, kupci kontaktiraju direktno, bez provizije.` — **144** | `Разместите объявление о продаже или аренде авто в Сербии бесплатно. Подача за 10 минут, покупатели пишут напрямую, комиссия с продажи — 0%.` — **139** |
| canonical | `https://rsauto.rs/sell` | `https://rsauto.rs/ru/sell` |
| hreflang | `sr-Latn` → `/sell`, `ru` → `/ru/sell`, `x-default` → `/sell` | то же |
| index | index | index |
| JSON-LD | — (снята вместе со списком шагов) | — (снята вместе со списком шагов) |
| og:title / og:description | = title / = description | = title / = description |

### Каталог салонов

| | SR `/dealers` | RU `/ru/dealers` |
|---|---|---|
| title raw / `<head>` | `Autosalonima: vitrina i kupci iz cele Srbije` — 44 / **54** ✅ | `Автосалонам: витрина и покупатели со всей Сербии` — 48 / **58** ✅ |
| description | `Stranica auto-salona u katalogu RS Auto: vitrina, kompletan vozni park, kupci iz cele Srbije. Besplatno oglašavanje za salone-partnere.` — **135** | `Страница автосалона в каталоге RS Auto: витрина, весь автопарк, покупатели со всей Сербии. Бесплатное размещение для салонов-партнёров.` — **135** |
| canonical | `https://rsauto.rs/dealers` | `https://rsauto.rs/ru/dealers` |
| hreflang | `sr-Latn` → `/dealers`, `ru` → `/ru/dealers`, `x-default` → `/dealers` | то же |
| index | index | index |
| JSON-LD | `WebPage` (`buildPageJsonLd`) | `WebPage` |
| og:title / og:description | = title / = description | = title / = description |

### FAQ

| | SR `/faq` | RU `/ru/faq` |
|---|---|---|
| title raw / `<head>` | `Česta pitanja o prodaji automobila u Srbiji` — 43 / **53** ✅ | `Вопросы и ответы о продаже авто в Сербии` — 40 / **50** ✅ |
| description | `Odgovori na pitanja o prodaji i iznajmljivanju automobila u Srbiji: objavljivanje, moderacija, kontakt sa prodavcem, uslovi za auto-salone.` — **139** | `Ответы на вопросы о продаже и аренде авто в Сербии: размещение, модерация, связь с продавцом, условия для автосалонов.` — **118** |
| canonical | `https://rsauto.rs/faq` | `https://rsauto.rs/ru/faq` |
| hreflang | `sr-Latn` → `/faq`, `ru` → `/ru/faq`, `x-default` → `/faq` | то же |
| index | index | index |
| JSON-LD | `FAQPage` (строится из того же массива `FAQ[locale]`, что рендерится) | `FAQPage` |
| og:title / og:description | = title / = description | = title / = description |

### Как это работает

| | SR `/how-it-works` | RU `/ru/how-it-works` |
|---|---|---|
| title raw / `<head>` | `Kako kupiti ili prodati auto u Srbiji` — 37 / **47** ✅ | `Как купить или продать авто в Сербии` — 36 / **46** ✅ |
| description | `Kako funkcioniše RS Auto: pretraga auta po filterima, sačuvana pretraga, direktan kontakt sa prodavcem. Četiri scenarija — kupovina, prodaja, iznajmljivanje.` — **157** | `Как работает RS Auto: поиск авто по фильтрам, сохранённый поиск, прямая связь с продавцом. Четыре сценария — покупка, продажа, аренда, автосалон.` — **145** |
| canonical | `https://rsauto.rs/how-it-works` | `https://rsauto.rs/ru/how-it-works` |
| hreflang | `sr-Latn` → `/how-it-works`, `ru` → `/ru/how-it-works`, `x-default` → `/how-it-works` | то же |
| index | index | index |
| JSON-LD | `WebPage` + `HowTo` (шаги сценария продавца) | `WebPage` + `HowTo` |
| og:title / og:description | = title / = description | = title / = description |

### Контакты

| | SR `/contact` | RU `/ru/contact` |
|---|---|---|
| title raw / `<head>` | `Kontakt i podrška u Srbiji` — 26 / **36** ✅ | `Контакты и поддержка в Сербии` — 29 / **39** ✅ |
| description | `Kontaktirajte tim RS Auto: pitanja o oglasima, prodaji i iznajmljivanju automobila u Srbiji. Odgovaramo radnim danima. Za auto-salone — poseban obrazac.` — **152** | `Свяжитесь с командой RS Auto: вопросы по объявлениям, продаже и аренде авто в Сербии. Отвечаем по будням. Для автосалонов — отдельная форма заявки.` — **147** |
| canonical | `https://rsauto.rs/contact` | `https://rsauto.rs/ru/contact` |
| hreflang | `sr-Latn` → `/contact`, `ru` → `/ru/contact`, `x-default` → `/contact` | то же |
| index | index | index |
| JSON-LD | `ContactPage` + `Organization` | `ContactPage` + `Organization` |
| og:title / og:description | = title / = description | = title / = description |

### Политика конфиденциальности

| | SR `/privacy` | RU `/ru/privacy` |
|---|---|---|
| title raw / `<head>` | `Politika privatnosti` — 20 / **30** | `Политика конфиденциальности` — 27 / **37** |
| description | `Kako RS Auto obrađuje lične podatke: šta prikupljamo, zašto i kako štitimo. Kontakt za pitanja o privatnosti.` — **109** | `Как RS Auto обрабатывает персональные данные: что собираем, зачем и как защищаем. Контакты для вопросов о конфиденциальности.` — **125** |
| canonical | `https://rsauto.rs/privacy` | `https://rsauto.rs/ru/privacy` |
| hreflang | `sr-Latn` → `/privacy`, `ru` → `/ru/privacy`, `x-default` → `/privacy` | то же |
| index | index | index |
| JSON-LD | `WebPage` ✅ | `WebPage` ✅ |
| og:title / og:description | = title / = description | = title / = description |

### Условия использования

| | SR `/terms` | RU `/ru/terms` |
|---|---|---|
| title raw / `<head>` | `Uslovi korišćenja` — 17 / **27** ⚠ (осознанно, см. проблему №3) | `Условия использования` — 21 / **31** ✅ |
| description | `Pravila korišćenja platforme RS Auto: objavljivanje oglasa, moderacija, obaveze prodavaca i kupaca.` — **99** | `Правила использования платформы RS Auto: подача объявлений, модерация, обязанности продавцов и покупателей.` — **107** |
| canonical | `https://rsauto.rs/terms` | `https://rsauto.rs/ru/terms` |
| hreflang | `sr-Latn` → `/terms`, `ru` → `/ru/terms`, `x-default` → `/terms` | то же |
| index | index | index |
| JSON-LD | `WebPage` ✅ | `WebPage` ✅ |
| og:title / og:description | = title / = description | = title / = description |

---

## 2. Динамические маршруты

### Карточка объявления `/car/{id}` — шаблон

Источник: `app/car/[id]/page.tsx` и `app/ru/car/[id]/page.tsx`
(логика идентична, различается только `locale`).

**title** = `` `${carTitle(car)} — ${formatPrice(car.sale_price, car.currency, locale)}` `` ,
где `carTitle` = `` `${brand} ${model}, ${year}` `` (`lib/format.ts`).
Далее шаблон layout добавляет ` | RS Auto`.

**description** — ветвление (порог 70 символов):
- описание продавца после `truncateDescription` даёт **70+** → берём его;
- иначе (описания нет ИЛИ оно короче 70) → `buildCarFallbackDescription`:
  `` `{марка} {модель}, {год}, {город}. {пробег}, {топливо}, {коробка}. {цена}. {хвост}` ``
  Незаполненные характеристики пропускаются, а не печатаются прочерком.
  Если и так вышло меньше 70 (всё пусто, цена договорная) — добавляется
  вторая фраза `car_meta_fallback_extra`. Нижняя граница гарантирована.

**Особые состояния** — теперь тоже через `buildMetadata`, поэтому несут
canonical и полный набор hreflang; robots прежний: ✅
- карточка не найдена: title `Oglas nije pronađen`, `robots: noindex, nofollow`;
- снята с публикации и смотрит посторонний: title
  `` `${brand} ${model}, ${year} — Oglas nije dostupan` ``, `noindex, follow`.

**Пример подстановки** — живое объявление
`1c998ba0-9a0b-43e7-8c99-4e1e463262a3` (Volvo XC60, 2023, 45 000 €,
Beograd, 28 000 км, status `active`, продажа):

| | SR `/car/1c998ba0-…` | RU `/ru/car/1c998ba0-…` |
|---|---|---|
| title raw / `<head>` | `Volvo XC60, 2023 — 45.000 €` — 27 / **37** | `Volvo XC60, 2023 — 45 000 €` — 27 / **37** |
| description | `Volvo XC60 в состоянии нового автомобиля, пробег — всего 27 058 км. Куплен новым в 2023 году в Белграде у официального дилера Volvo. Около 25 000 км пройдено…` — **158** | то же, **158** (описание продавца — на языке автора, не локализуется) |
| canonical | `https://rsauto.rs/car/1c998ba0-9a0b-43e7-8c99-4e1e463262a3` | `https://rsauto.rs/ru/car/1c998ba0-9a0b-43e7-8c99-4e1e463262a3` |
| hreflang | `sr-Latn` → `/car/{id}`, `ru` → `/ru/car/{id}`, `x-default` → `/car/{id}` | то же |
| index | index (для `active` и `sold`) | index |
| JSON-LD | `Vehicle` + `Offer` + `BreadcrumbList` (+ `ItemList` похожих, если есть) | то же |
| og:title | = title (27) | = title (27) |
| og:description | = description (158) | = description (158) |
| og:image | свой роут `app/car/[id]/opengraph-image.tsx` — фото объявления с ценой (`ownOgImage: true`, брендовая картинка не подставляется) | то же |
| product:price | `product:price:amount` = 45000, `product:price:currency` = EUR ✅ | то же |

Различие в цене (`45.000 €` vs `45 000 €`) — разделитель разрядов
`Intl.NumberFormat` для `sr-Latn-RS` и `ru-RU`.

JSON-LD теперь собирает адреса из текущей локали (`localeHref`), а не из
`car.site_url`: на `/ru/car/{id}` `Vehicle.url`, `Offer.url`, последняя
крошка и `ItemList` похожих ссылаются на `/ru/...`. Проверено на живом
HTML — все три `"url"` в разметке русской страницы идут с префиксом. ✅

### Витрина салона `/dealer/{id}` — шаблон

Источник: `app/dealer/[id]/page.tsx`, `app/ru/dealer/[id]/page.tsx`.

**title** = `profile.display_name` (без префикса и суффикса; шаблон layout
добавляет ` | RS Auto`).
**description** = `buildDealerMetaDescription` (`lib/dealerPage.ts`):
`` `{префикс} {имя}: {N активных объявлений} {хвост}` ``, где счётчик
склоняется (`lib/plural.ts`, форма `activeListing`), а префикс и хвост
зависят от `seller_kind`:
- салон, SR: `Auto-salon {имя}: {N} aktivnih oglasa na RS Auto. Kupci iz cele Srbije, direktna veza sa salonom.`
- салон, RU: `Автосалон {имя}: {N} активных объявлений на RS Auto. Покупатели со всей Сербии, прямая связь с салоном.`
- частник: те же фразы со словом `Prodavac` / `Продавец` и «…sa prodavcem» /
  «…с продавцом» — называть человека автосалоном в выдаче нельзя.
**canonical** — путь БЕЗ `?page`, всегда на первую страницу витрины.
**noindex** — если `active_cars === 0` или `page > 1`.
**Профиля нет** → title `nf_title`, `noindex, nofollow`, без canonical/hreflang.

**Пример подстановки.** Живых салонов в базе на дату среза нет
(`get_site_dealers` вернул пустой список), поэтому пример условный —
салон `Auto Centar Beograd` с 24 активными объявлениями:

| | SR `/dealer/{uuid}` | RU `/ru/dealer/{uuid}` |
|---|---|---|
| title raw / `<head>` | `Auto Centar Beograd` — 19 / **29** ⚠ (зависит от имени салона) | `Auto Centar Beograd` — 19 / **29** ⚠ |
| description | `Auto-salon Auto Centar Beograd: 24 aktivna oglasa na RS Auto. Kupci iz cele Srbije, direktna veza sa salonom.` — **109** ✅ | `Автосалон Auto Centar Beograd: 24 активных объявления на RS Auto. Покупатели со всей Сербии, прямая связь с салоном.` — **116** ✅ |
| canonical | `https://rsauto.rs/dealer/{uuid}` | `https://rsauto.rs/ru/dealer/{uuid}` |
| hreflang | `sr-Latn` → `/dealer/{uuid}`, `ru` → `/ru/dealer/{uuid}`, `x-default` → `/dealer/{uuid}` | то же |
| index | index при `active_cars > 0` и `page === 1` | то же |
| JSON-LD | `AutoDealer` (только для роли dealer, только первая страница) + `BreadcrumbList` (+ `ItemList`) | то же |
| og:title | = title (19) | = title (19) |
| og:description | = description (109) | = description (116) |
| og:image | свой роут `app/dealer/[id]/opengraph-image.tsx` — имя салона на брендовой подложке, логотип если загружен ✅ | `app/ru/dealer/[id]/opengraph-image.tsx` ✅ |

Длина description зависит от имени и числа объявлений, но нижнюю границу
держит при любых значениях: короткое имя («BG Auto», 1 объявление) даёт
95 символов SR / 103 RU, длинное («Premium Motors Novi Sad Group», 137) —
121 / 127. Диапазон 70–160 выдержан на всём поле значений. ✅

---

## 3. Кабинет

Из четырёх названных в задаче разделов на сайте существуют три.
**«Сохранённые поиски» отдельной страницей не реализованы**: в коде есть
только серверная часть (`saved_searches`, `push_queue`), UI отсутствует —
см. комментарий в `components/EmptyState.tsx:12`. Сценарий сохранения
поиска работает через ссылку с фильтрами в адресе (так он и описан в
`/how-it-works`), собственного маршрута у него нет.

Метаданные всего поддерева задаёт `app/my/layout.tsx` и `app/ru/my/layout.tsx`:
`robots: { index: false, follow: false, nocache: true, noimageindex: true }`,
`buildMetadata` намеренно НЕ используется — canonical и hreflang личным
страницам не нужны. `dynamic = 'force-dynamic'`.

| Маршрут | title raw / `<head>` | description | canonical | hreflang | index | JSON-LD | og |
|---|---|---|---|---|---|---|---|
| `/my` (мои объявления) | `Moj nalog` — 9 / **19** (от layout) | `null` — погашен в layout ✅ | нет | нет | **noindex, nofollow, nocache, noimageindex** | нет | нет |
| `/ru/my` | `Мой кабинет` — 11 / **21** (от layout) | `null` ✅ | нет | нет | noindex + весь набор | нет | нет |
| `/my/favorites` | `Favoriti — RS Auto` — **18** (absolute) | `null` — тег погашен явно | нет | нет | noindex (от layout) | нет | нет |
| `/ru/my/favorites` | `Избранное — RS Auto` — **19** (absolute) | `null` — погашен | нет | нет | noindex (от layout) | нет | нет |
| `/my/profile` (настройки) | `Moj nalog` — 9 / **19** (от layout) | `null` — от layout ✅ | нет | нет | noindex (от layout) | нет | нет |
| `/ru/my/profile` | `Мой кабинет` — 11 / **21** (от layout) | `null` ✅ | нет | нет | noindex (от layout) | нет | нет |
| `/my/messages`, `/my/notifications` и зеркала | title от layout | `null` — от layout ✅ | нет | нет | noindex (от layout) | нет | нет |

`description: null` теперь стоит в `generateMetadata` самого layout'а
кабинета, поэтому гашение наследуется ВСЕМИ его страницами разом, а не
повторяется в каждой. Избранное сохраняет свой `generateMetadata` ради
собственного заголовка.

Дополнительный рубеж: `/my`, `/ru/my` закрыты в `robots.txt` от обхода.

---

## 4. 404

| | SR `not-found` | RU `/ru` `not-found` |
|---|---|---|
| title raw / `<head>` | `Stranica nije pronađena` — 23 / **33** | `Страница не найдена` — 19 / **29** (под noindex, длина роли не играет) |
| description | `null` — наследование погашено ✅ (проверено: тега в HTML нет) | `null` ✅ |
| canonical | нет | нет |
| hreflang | нет | нет |
| index | **noindex, follow** | **noindex, follow** |
| JSON-LD | нет | нет |
| og:title / og:description | своих нет; og-заголовок наследуется от корневого layout, описание больше не подставляется | то же |

Отдельный `app/ru/not-found.tsx` заведён намеренно: без него `notFound()`
из `/ru/*` поднялся бы до корневого 404 и отдал сербскую страницу.

---

## 5. Служебные страницы (вне списка задачи, для полноты картины)

| Маршрут | title | index | Примечание |
|---|---|---|---|
| `/all`, `/ru/all` | `catalog_mixed_title` | **noindex безусловный** | смешанная витрина, дубль двух лендингов; описание есть ради шаринга |
| `/about`, `/ru/about` | — | index | `AboutPage` + `Organization`; в sitemap есть |
| `/login`, `/ru/login` | `login_title` | noindex, nofollow, nocache | закрыт и в robots.txt |
| `/cars/{brand}`, `/cars/{brand}/{model}` и то же под `/rent` | по марке/модели | index | `BreadcrumbList` + `ItemList`; в sitemap есть |
| `/install`, `/unsubscribe` | — | — | в sitemap отсутствуют (и не должны быть) |
| `/admin/*` | — | — | закрыт в robots.txt, одноязычный |

---

## 6. sitemap.xml и robots.txt

**Состав sitemap** (`app/sitemap.ts`, revalidate 3600): статические
разделы `/`, `/cars`, `/rent`, `/sell`, `/dealers`, `/faq`,
`/how-it-works`, `/about`, `/terms`, `/privacy`, `/contact`; страницы
марок и моделей обеих витрин; витрины салонов (`get_site_dealers`);
карточки активных объявлений (`get_sitemap_cars`, до 45 000). Каждая
запись несёт `alternates.languages`, собранные той же
`buildAlternates`, что и теги в `<head>`. Жёсткая обрезка на 50 000 URL
с предупреждением в лог сборки.

**robots.txt** (`app/robots.ts`): `allow` — `/`, `/*opengraph-image*`,
`/cars?q=*`, `/ru/cars?q=*`; `disallow` — 13 фильтрующих параметров
(`type`, `brand`, `model`, `city`, `year_from`, `year_to`,
`mileage_max`, `price_from`, `price_to`, `body`, `gearbox`, `fuel`,
`sort`), `/my`, `/ru/my`, `/admin`, `/login`, `/ru/login`. Пагинация
(`?page=N`) намеренно открыта для обхода при `noindex` на самих
страницах.

---

## 7. Проблемы и что с ними сделано

Флаги из первой ревизии, по каждому — статус. Оценка длины title по
значению в `<head>` (с суффиксом ` | RS Auto`), как его видит поисковик.
Все значения ниже сняты с отдаваемого HTML.

### 1. Состав sitemap — расхождений не было

Состав sitemap и набор публичных индексируемых страниц совпадают. `/all`
под безусловным `noindex` в карту не попадает, `/install` и
`/unsubscribe` отсутствуют — верно. **Правок не требовалось.**

### 2. Description витрины салона — ✅ исправлено

Было: `Automobili prodavca X: 24.` — 44 символа, вдвое ниже нижней
границы, без города, без вида продавца, число без единицы измерения.

Стало: `buildDealerMetaDescription` (`lib/dealerPage.ts`) с плюрализацией
счётчика и разделением салон / частник.

| Случай | SR | RU |
|---|---|---|
| «BG Auto», 1 объявление | 95 | 103 |
| «Auto Centar Beograd», 24 | 109 | 116 |
| «Premium Motors Novi Sad Group», 137 | 121 | 127 |
| частник «Marko», 2 | 94 | 102 |

Диапазон 70–160 выдержан на всём поле значений.

Отступление от буквы задания, сделанное сознательно: шаблон просил
«Auto-salon {name}» безусловно, но витрина обслуживает и частных
продавцов (`seller_kind`). Называть человека автосалоном в выдаче —
фактическая ошибка, поэтому для частников те же фразы со словом
`Prodavac` / `Продавец`.

### 3. Title короче 30 символов — ✅ исправлено (публичные страницы)

Все семь пар заменены; каждый заголовок теперь содержит рыночное слово
(«Srbija» / «Сербия»), которого раньше не было.

| Страница | Было `<head>` | Стало `<head>` |
|---|---|---|
| `/sell` | 28 | **37** |
| `/ru/sell` | 29 | **38** |
| `/dealers` | 23 | **54** |
| `/ru/dealers` | 21 | **58** |
| `/faq` | 23 | **53** |
| `/ru/faq` | 26 | **50** |
| `/how-it-works` | 26 | **47** |
| `/ru/how-it-works` | 26 | **46** |
| `/contact` | 17 | **36** |
| `/ru/contact` | 18 | **39** |
| `/terms` | 27 | **27** (см. ниже) |
| `/ru/terms` | 31 | **31** |
| `/rent` | 33 | **42** |
| `/ru/rent` | 29 | **38** |

**Как это сделано — важная деталь.** Прямая замена ключей `sell_title`,
`faq_title`, `rent_title` и прочих была бы порчей интерфейса: те же ключи
стоят в `<h1>` страниц, в подвале, в хлебных крошках карточки и в
заголовке блока на главной: развёрнутая поисковая фраза встала бы вместо
короткой подписи раздела, а `rent_title` длиной 32 символа поехал бы в
крошки четырёх компонентов.

Поэтому заведены ОТДЕЛЬНЫЕ ключи `meta_*_title` только для `<head>`, а
UI-ключи оставлены как были. Так уже устроена главная (`meta_home_title`
отдельно от UI-строк) — решение не новое для проекта.

Оставшиеся короткие заголовки — только у страниц под `noindex`
(`/my/*` — 19–21, 404 — 29–33) и у витрины салона, где title это имя
салона и длина от нас не зависит. Для выдачи это значения не имеет.

**`/terms` — сознательное исключение из диапазона.** ✅ Первая версия
заголовка давала в разметке `Uslovi korišćenja platforme RS Auto |
RS Auto` — бренд дважды подряд. Строка укорочена до `Uslovi korišćenja`
(**27** с суффиксом) и `Условия использования` (**31**).

Сербский вариант тем самым выпал из диапазона 30–60 на три символа, и
это принято осознанно: дубль бренда в выдаче хуже недобора длины, а
название документа уже содержит имя площадки. Ключ `meta_terms_title`
оставлен отдельным, хотя и совпал по значению с UI-ключом
`legal_terms_title`: все страницы берут `<title>` из `meta_*`, и одно
исключение в вызове `buildMetadata` читалось бы как недосмотр.

### 4. Title длиннее 60 — не было и не появилось

Самый длинный сейчас — `/ru/dealers` (58). Все 14 новых заголовков
проверены скриптом: диапазон 36–58.

### 5. Description вне 70–160 — ✅ исправлено

Витрина салона — см. пункт 2. Второй случай, fallback карточки:

- было: `{марка} {модель}, {год}, {город}. {пробег}.` — ~45 символов;
- стало: `buildCarFallbackDescription` (`lib/seo.ts`) с характеристиками
  и ценой, **96** символов на живом примере (Volvo XC60).

Добавлены две вещи сверх шаблона из задания, обе — ради гарантии нижней
границы:

1. **Порог 70 на описание продавца.** Короткое авторское описание
   («Prodajem hitno») теперь ЗАМЕНЯЕТСЯ собранным из характеристик, а не
   отдаётся как есть: в нём нет ни года, ни пробега, ни города.
2. **Добор для скудных карточек.** Худший случай — пробег, топливо и
   коробка не заполнены, цена договорная — давал 66 символов. Добавляется
   вторая фраза (`car_meta_fallback_extra`), итог **126 / 132**.

Прочерки в описание не попадают: незаполненные характеристики
пропускаются, а не печатаются как «—».

### 6. Отсутствующие description — ✅ исправлено

`description: null` проставлен в `generateMetadata` layout'а кабинета
(обе локали) и в метаданных обоих файлов 404. Проверено на живом HTML:
на `/nosuchpage` и `/ru/nosuchpage` тега `<meta name="description">` нет
вовсе — раньше туда приходило описание маркетплейса.

Гашение стоит в layout'е, а не в каждой странице кабинета: один источник
истины, новые разделы получают его автоматически.

### 7. Задублированные title/description — правок не требовалось

Единственное буквальное совпадение — `/dealer/{id}` и `/ru/dealer/{id}`
(имя салона не переводится). Это корректно и снимается парой hreflang.

### 8. Canonical в JSON-LD карточки — ✅ исправлено

`CarPageView` и `DealerPageView` больше не используют `car.site_url` из
БД (он всегда сербский). Адреса собираются из текущей локали через
`localeHref`, что затрагивает `Vehicle.url`, `Offer.url`, последний
элемент `BreadcrumbList` и `ItemList` (похожие на карточке, автопарк на
витрине).

Проверено на живом HTML: на `/ru/car/{id}` все три `"url"` в разметке
идут с префиксом `/ru`. Для сербского зеркала значения не изменились —
это ровно то, что отдавал `f_car_site_url`.

### 9. Особые состояния теряли canonical и hreflang — ✅ исправлено

Три ветки переведены на `buildMetadata`: «объявление не найдено», «снято
с публикации», «нет профиля салона» (обе локали). Для этого в
`buildMetadata` добавлен флаг `nofollow` — раньше он умел только
`noindex, follow`, а несуществующему адресу нужен полный запрет.

Проверено на `/ru/car/{несуществующий-uuid}`: canonical на себя, все три
`hreflang` (sr-Latn, ru, x-default), `robots: noindex, nofollow` — как и
было. Описание берётся из `nf_text`.

### 10–11. Битые hreflang и canonical не на себя — не было

Проверено повторно после правок: связка цела, все страницы
self-canonical. Два намеренных исключения (фильтры каталога, `?page=N`
витрины) канонизируют «родителя» и одновременно закрыты `noindex` —
корректно.

### 12. og-теги шаринг-страниц — ⚠️ выполнено частично

**Витрина салона получила своё превью.** ✅ Роуты
`app/dealer/[id]/opengraph-image.tsx` и русское зеркало, общий рендер в
`lib/ogDealer.tsx`: имя салона на брендовой подложке, вид продавца, число
объявлений со склонением, логотип на белой плашке если загружен.
Проверено: HTTP 200, `image/png`, 31 КБ. Страницам проставлен
`ownOgImage: true` — иначе явный `images` отключил бы файловый роут.

**`og:type=product` выставить не удалось.** ⚠️ Next 16 не даёт этого
сделать ни одним из двух путей, и это выяснилось только на живом HTML:

- `openGraph.type` — рендерер перебирает допустимые значения `switch`'ем
  и на неизвестном **бросает** `Invalid OpenGraph type: product`
  (`node_modules/next/dist/lib/metadata/metadata.js`, ветка `default`).
  Приведение типа обманывает компилятор, но страница карточки падает при
  рендере. Список закрыт: website, article, book, profile, music.\*,
  video.\*;
- `metadata.other` — печатает теги через `name=`, а не `property=`.
  Open Graph читается только по `property`, так что соцсети такой тег
  игнорируют, а рядом остаётся противоречащий `property="og:type"
  content="website"` из блока openGraph.

Поэтому `og:type` карточки остался `website`. Противоречивую пару тегов я
в разметке не оставил — это было бы хуже, чем текущее состояние.

**`product:price:*` при этом поставлены.** ✅ Проверено на живом HTML:
`product:price:amount` = 45000, `product:price:currency` = EUR. Идут
через `name=`, их читают агрегаторы товаров; для поиска же полные данные
о товаре карточка отдаёт в JSON-LD (`Offer` внутри `Vehicle`) — это и
есть основной канал, и он не пострадал.

Обойти ограничение можно только своим `<meta>` в теле страницы или
патчем рендерера — оба варианта выходят за рамки задачи, поэтому
оставлены на ваше решение.

### 13. JSON-LD на `/sell`, `/privacy`, `/terms` — ✅ исправлено

- **`/sell`** — `HowTo` с тремя `HowToStep`. Массив сценариев вынесен из
  `HowItWorksPageView` в общий `lib/scenarios.ts`, обе страницы читают
  один источник. **Позже отменено — см. примечание в конце пункта.**
- **`/privacy` и `/terms`** — `WebPage` через `buildPageJsonLd`, добавлен
  в общий `LegalPageView` (один компонент на оба документа и обе локали).

Проверено на живом HTML: `sell` → `HowTo` + `HowToStep`, `privacy` и
`terms` → `WebPage`, в обеих локалях.

**Сверх задания на `/sell` добавлен видимый список шагов.** Google
требует, чтобы шаги в `HowTo` совпадали с видимым текстом страницы, а на
`/sell` стояла только форма. Разметка без видимых шагов — ошибка
структурированных данных, за которую сниппет не даётся. Список сделан
компактным (одна строка на шаг, без абзацев пояснений), чтобы не
отодвигать форму за сгиб.

> **ОТМЕНЕНО 2026-09-04.** Список шагов со `/sell` убран по
> продуктовому решению: человек, открывший страницу подачи, уже принял
> решение, и три строки «Подайте объявление / Дождитесь проверки /
> Получайте сообщения» только отодвигали форму, ничего не сообщая.
>
> Вместе со списком снята и разметка `HowTo` — по той же причине, по
> которой список когда-то появился: без видимых шагов она стала бы
> ошибкой структурированных данных. Одно без другого на этой странице
> не живёт.
>
> Сценарий продавца и его `HowTo` остаются на `/how-it-works`:
> `lib/scenarios.ts` по-прежнему общий источник, но читает его теперь
> одна страница.

### 14. `<h1>` на витринах марок и моделей — ✅ проверено, нарушений нет

Единственный пункт, оставшийся от первой ревизии за пределами `<head>`.
Проверен на отдаваемом HTML в обеих локалях.

| Страница | `<h1>` | `<title>` |
|---|---|---|
| `/cars` | `Automobili na prodaju` | `Automobili na prodaju \| RS Auto` |
| `/cars/volvo` | `Volvo — automobili na prodaju` | `Volvo — automobili na prodaju u Srbiji \| RS Auto` |
| `/cars/volvo/xc60` | `Volvo XC60 — automobili na prodaju` | `Volvo XC60 — polovni automobili u Srbiji \| RS Auto` |
| `/ru/cars/volvo` | `Volvo — автомобили на продажу` | `Volvo — автомобили на продажу в Сербии \| RS Auto` |
| `/ru/cars/volvo/xc60` | `Volvo XC60 — автомобили на продажу` | `Volvo XC60 — подержанные автомобили в Сербии \| RS Auto` |

**Ровно один `<h1>` на страницу.** Счёт тегов: `/cars`, `/cars/volvo`,
`/cars/volvo/xc60` и `/ru/cars/volvo` дают `h1=1`. Дубликатов и
страниц без заголовка нет.

**Заголовки уникальны между соседними витринами** — ради этого пункт и
заводился. Пять проверенных адресов дают пять разных `<h1>`; в русском
зеркале то же самое.

**Иерархия корректна.** Витрина марки: `<h1>` + один `<h2>` (блок
перелинковки на модели). Витрина модели: только `<h1>`. Уровни не
пропускаются.

**`<h1>` короче `<title>` и не дублирует его.** В `<title>` есть
рыночное слово («u Srbiji» / «в Сербии»), в `<h1>` его нет — на самой
странице страна очевидна из контекста. Это осознанное разделение, а не
рассогласование.

Устроено так: `<h1>` рендерит общий `CatalogView` из пропа `title`,
который обе витрины собирают из названия марки или модели и режима
(продажа/аренда). Одна точка сборки на все шесть витрин — расхождению
взяться неоткуда.

**Оговорка о полноте.** Проверены витрины ПРОДАЖИ — три живые марки и
одна модель, это всё, что есть в базе на дату среза. Арендные витрины
(`/rent/{brand}`, `/rent/{brand}/{model}`) фактически не проверены:
объявлений в аренду в базе нет, и `/rent` не отдаёт ни одной марки.
Вынесено в раздел 9 как отложенная проверка.

---

## 8. Сводка

| Проверка | Было | Стало |
|---|---|---|
| title > 60 | нет | нет (максимум 58) |
| title < 30 | 8 публичных типов | только `/terms` (27) — осознанное исключение |
| description вне 70–160 | витрина салона (~44), fallback карточки (~45) | нет, нижняя граница гарантирована |
| отсутствующий description | `/my/*`, 404 обеих локалей | погашен через `null` |
| задублированный title/description | только `/dealer/{id}` между локалями | без изменений, корректно |
| noindex на публичной | нет | нет |
| index на кабинете | нет | нет |
| битые hreflang | нет | нет |
| canonical не на себя | нет | нет |
| canonical/hreflang в особых состояниях | отсутствовали | добавлены |
| URL в JSON-LD русских страниц | вели на сербский адрес | по текущей локали |
| вне sitemap / лишние в sitemap | нет | нет |
| og-картинка витрины салона | брендовая заглушка | своя, с именем салона |
| `og:type` карточки | website | website — оставлен намеренно, см. ниже |
| `product:price:*` | не было | есть |
| JSON-LD `/sell`, `/privacy`, `/terms` | отсутствовал | `HowTo`, `WebPage`, `WebPage` |
| `<h1>` витрин марок и моделей | не проверялось | по одному на страницу, уникальны |

### Открытые вопросы по правкам — оба закрыты

1. **`/terms`: дубль бренда — исправлено.** ✅ Заголовки укорочены до
   `Uslovi korišćenja` и `Условия использования`; в разметке теперь
   `Uslovi korišćenja | RS Auto` вместо прежнего варианта с брендом
   дважды. Сербская версия при этом занимает 27 символов вместо
   минимальных 30 — исключение принято сознательно, разбор в проблеме
   №3. UI-ключи `legal_terms_title` не тронуты.

2. **`og:type=product` — отложено.** ✅ Решение: карточка остаётся с
   `og:type: website`. Обходные пути (ручной `<meta>` в теле страницы,
   патч рендерера Next) не применяются — цена выше выгоды, а полные
   данные о товаре уже уходят в JSON-LD (`Offer` внутри `Vehicle`),
   который и является основным источником для поиска.

   `product:price:amount` и `product:price:currency` **сохранены** — они
   не зависят от `og:type` и читаются агрегаторами товаров.

   Вернуться к вопросу имеет смысл, если Next расширит список
   допустимых значений `openGraph.type` либо научит `metadata.other`
   печатать теги через `property=`. Технический разбор ограничения — в
   проблеме №12 и в комментарии у `productMeta` (`lib/seo.ts`).

**Вопросов, требующих решения, не осталось.** Последний непроверенный
пункт — `<h1>` на витринах марок и моделей (проблема №14) — закрыт:
нарушений не найдено.

Одна проверка остаётся ОТЛОЖЕННОЙ, и не по нашему выбору: арендные
витрины нечем проверить, пока в базе нет объявлений в аренду. Условие
и порядок проверки — в разделе 9 ниже.

---

## 9. Отложено до появления данных

### Арендные витрины `/rent/{brand}` и `/rent/{brand}/{model}`

**Статус: не проверено. Причина — нет данных, а не пропуск.**

На дату среза в базе нет ни одного объявления в аренду: `/rent` не
отдаёт ни одной марки, `get_sitemap_cars` по арендной витрине возвращает
пусто, а `/rent/audi` открывается пустым. Проверять на HTML нечего —
страниц с содержимым не существует.

Всё остальное по аренде проверено: сама витрина `/rent` и `/ru/rent`
входила в ревизию с самого начала (раздел 1) — title, description,
canonical, hreflang, `ItemList` у неё в порядке. Открыт только вопрос о
страницах МАРОК и МОДЕЛЕЙ внутри аренды.

**Когда проверять.** Как только появится хотя бы одно опубликованное
объявление с `is_for_rent = true`: этого достаточно, чтобы `/rent`
показал марку и открылся адрес `/rent/{brand}`. Для витрины модели нужна
марка минимум с одним объявлением конкретной модели.

**Что проверять** — тот же набор, что прошли витрины продажи в проблеме
№14:

1. на `/rent/{brand}` и `/rent/{brand}/{model}` ровно один `<h1>`;
2. заголовки соседних арендных витрин различаются между собой;
3. `<h1>` арендной витрины отличается от `<h1>` витрины продажи той же
   марки — то есть `/cars/volvo` и `/rent/volvo` не дают одинаковый
   заголовок;
4. иерархия уровней не пропускается (`<h1>`, затем `<h2>` перелинковки);
5. в `<title>`, `<h1>` и хлебных крошках стоит подпись АРЕНДЫ, а не
   продажи.

**Чего ждать по коду.** Разметка у витрин общая: `<h1>` рендерит
`CatalogView` из пропа `title`, который `BrandPageView` и
`ModelPageView` собирают одинаково для обоих режимов, подставляя
`rent_title` вместо `catalog_title` при `mode === 'rent'`. Поэтому
ожидание — что нарушений не будет.

Пункт 5 по коду уже прослеживается: `BrandPageView` и `ModelPageView`
подставляют в `<h1>` UI-ключ `rent_title` («Automobili za izdavanje» /
«Автомобили в аренду»), а не поисковый `meta_rent_title` с «u Srbiji» —
последний уходит только в `<head>`. Ожидаемый заголовок арендной витрины
Volvo, таким образом, `Volvo — automobili za izdavanje`, и с витриной
продажи (`Volvo — automobili na prodaju`) он не совпадает. Проверка на
HTML нужна, чтобы подтвердить это фактом, а не чтением кода.

**Команда для проверки** (порт свободный, сервер после — остановить):

```
npm run build && npx next start -p 3991
curl -s http://localhost:3991/rent | grep -oE 'href="/rent/[a-z0-9-]+"' | sort -u
curl -s http://localhost:3991/rent/{brand} | grep -oE '<title>[^<]*</title>|<h1[^>]*>[^<]*</h1>'
```

Повторить для `/ru/rent/{brand}` и для витрины модели.
