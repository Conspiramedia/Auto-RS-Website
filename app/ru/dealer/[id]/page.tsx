// ============================================================
// RS AUTO — Витрина продавца /dealer/{id}, ru-версия. SSR.
// ============================================================
// Разметка живёт в components/pages/DealerPageView — общая для
// обеих локалей.
// ============================================================

import type { Metadata } from 'next';

import DealerPageView from '@/components/pages/DealerPageView';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { fetchDealerProfile } from '@/lib/queries';
import { buildMetadata } from '@/lib/seo';
import {
  buildDealerMetaDescription,
  parseDealerPage,
} from '@/lib/dealerPage';
import type { SearchParams } from '@/lib/searchParams';

// Витрина меняется при каждой новой публикации продавца, но не чаще
// каталога: пяти минут достаточно.
export const revalidate = 300;

const locale: Locale = 'ru';

type Params = { id: string };

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { id } = await params;
  const page = parseDealerPage(await searchParams);
  const profile = await fetchDealerProfile(id);
  const t = getT(locale);

  // Профиля нет — страница отдаст 404, и индексировать её не нужно.
  // Метаданные всё равно собираем через buildMetadata: canonical и
  // hreflang нужны и здесь. Без них несуществующий адрес выпадал из
  // языкового графа сайта, и пара sr/ru для него рвалась — Google
  // требует, чтобы связка hreflang была взаимной на ВСЕХ адресах, где
  // она заявлена. robots при этом прежний: ни индекса, ни обхода.
  if (!profile) {
    return buildMetadata({
      locale,
      path: `/dealer/${id}`,
      title: t('nf_title'),
      description: t('nf_text'),
      noindex: true,
      nofollow: true,
    });
  }

  return buildMetadata({
    locale,
    // Путь БЕЗ ?page: canonical всех страниц витрины ведёт на первую.
    // Так же поступает каталог, и по той же причине — вторая страница
    // содержательно не отличается от первой настолько, чтобы
    // претендовать на отдельное место в индексе.
    path: `/dealer/${id}`,
    title: profile.display_name,
    // Описание собирается общей функцией (lib/dealerPage): счётчик
    // объявлений склоняется, а вид продавца — салон или частное лицо —
    // подставляет свою формулировку.
    description: buildDealerMetaDescription({
      locale,
      displayName: profile.display_name,
      activeCars: profile.active_cars,
      sellerKind: profile.seller_kind,
    }),
    // Витрина без единого объявления в индексе бесполезна: это thin
    // content, который вредит сайту. Страницы со второй и дальше — та
    // же логика, что в каталоге: в индекс не отдаём, но ссылки
    // проходимы, и краулер доходит до карточек машин.
    noindex: profile.active_cars === 0 || page > 1,
    // У витрины есть свой роут opengraph-image (имя салона на
    // брендовой подложке, логотип если загружен). Флаг говорит
    // buildMetadata не выставлять ключ images — иначе явное значение
    // отключит автоподстановку файлового роута, и превью снова станет
    // общей заглушкой сайта (тот же механизм, что у карточки).
    ownOgImage: true,
  });
}

export default async function DealerPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const page = parseDealerPage(await searchParams);
  return <DealerPageView locale={locale} id={id} page={page} />;
}
