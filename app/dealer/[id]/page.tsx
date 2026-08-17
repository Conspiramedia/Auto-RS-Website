// ============================================================
// RS AUTO — Витрина продавца /dealer/{id}, sr-версия. SSR.
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

// Витрина меняется при каждой новой публикации продавца, но не чаще
// каталога: пяти минут достаточно.
export const revalidate = 300;

const locale: Locale = 'sr';

type Params = { id: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
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
    path: `/dealer/${id}`,
    title: profile.display_name,
    description: `${t('dealer_page_meta_desc_prefix')} ${profile.display_name}: ${profile.active_cars}.`,
    // Витрина без единого объявления в индексе бесполезна: это thin
    // content, который вредит сайту. Ссылки при этом проходимы.
    noindex: profile.active_cars === 0,
  });
}

export default async function DealerPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  return <DealerPageView locale={locale} id={id} />;
}
