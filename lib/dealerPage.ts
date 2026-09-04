// ============================================================
// RS AUTO — Номер страницы из адреса (?page=N).
// ============================================================
// Заведено для витрины продавца, поэтому и имя такое; сейчас той же
// функцией пользуется избранное в кабинете (/my/favorites) — правила
// разбора у них ровно одни и те же, и заводить вторую копию ради
// другого раздела значило бы получить два расходящихся Number(...).
//
// Отдельным файлом, потому что разбор нужен ЧЕТЫРЕ раза: в
// generateMetadata и в самой странице, и всё это дважды — для sr и
// для ru. Четыре копии одного Number(...) разошлись бы при первой же
// правке, и метаданные страницы перестали бы соответствовать её
// содержимому.
//
// Правила те же, что у номера страницы каталога (lib/searchParams.ts
// → parseFilters): мусор в адресе не должен ронять страницу. '?page=abc',
// '?page=-3' и '?page=0' дают первую страницу, а не ошибку и не
// пустую витрину.
// ============================================================

import type { Locale } from './i18n';
import { getT } from './i18n';
import { countNoun } from './plural';
import type { SearchParams } from './searchParams';

export function parseDealerPage(sp: SearchParams): number {
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const parsed = Number(raw);

  // Дробные номера отбрасываем вниз: '?page=2.7' — это вторая
  // страница, а не ошибка.
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

// ------------------------------------------------------------
// Описание витрины продавца для <meta name="description">.
// ------------------------------------------------------------
// Здесь, а не в самих страницах, по той же причине, что и разбор
// номера выше: вызывается ЧЕТЫРЕ раза (generateMetadata в sr и ru, и
// оба зеркала), и четыре копии шаблона разошлись бы при первой правке
// текста — сниппеты двух локалей начали бы описывать витрину
// по-разному.
//
// Счётчик склоняется (lib/plural, форма activeListing): «1 aktivan
// oglas», но «5 aktivnih oglasa». Вид продавца различается по
// seller_kind — назвать частное лицо «Auto-salon» в выдаче нельзя.
//
// Длина: при коротком имени салона («BG Auto», 7 символов) сербский
// вариант даёт 96 символов, русский — 99; при длинном имени она
// растёт, оставаясь заметно ниже верхней границы в 160. Нижняя
// граница в 70 выдержана при любом имени, включая пустое.
export function buildDealerMetaDescription(params: {
  locale: Locale;
  displayName: string;
  activeCars: number;
  sellerKind: string;
}): string {
  const { locale, displayName, activeCars, sellerKind } = params;
  const t = getT(locale);

  const isDealer = sellerKind === 'dealer';
  const prefix = isDealer
    ? t('dealer_meta_desc_dealer_prefix')
    : t('dealer_meta_desc_private_prefix');
  const tail = isDealer
    ? t('dealer_meta_desc_dealer_tail')
    : t('dealer_meta_desc_private_tail');

  const count = countNoun(activeCars, 'activeListing', locale);

  return `${prefix} ${displayName}: ${count} ${tail}`;
}
