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
import { parseDealerPage } from '@/lib/dealerPage';
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
  if (!profile) {
    return {
      title: t('nf_title'),
      robots: { index: false, follow: false },
    };
  }

  return buildMetadata({
    locale,
    // Путь БЕЗ ?page: canonical всех страниц витрины ведёт на первую.
    // Так же поступает каталог, и по той же причине — вторая страница
    // содержательно не отличается от первой настолько, чтобы
    // претендовать на отдельное место в индексе.
    path: `/dealer/${id}`,
    title: profile.display_name,
    description: `${t('dealer_page_meta_desc_prefix')} ${profile.display_name}: ${profile.active_cars}.`,
    // Витрина без единого объявления в индексе бесполезна: это thin
    // content, который вредит сайту. Страницы со второй и дальше — та
    // же логика, что в каталоге: в индекс не отдаём, но ссылки
    // проходимы, и краулер доходит до карточек машин.
    noindex: profile.active_cars === 0 || page > 1,
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
