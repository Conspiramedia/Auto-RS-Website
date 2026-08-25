// ============================================================
// RS AUTO — Профиль /my/profile. Server Component.
// ============================================================
// Данные читаются на сервере и отдаются форме готовыми: клиентский
// компонент не должен начинать жизнь с пустых полей и подгружать их
// эффектом — иначе форма на мгновение показывает чужое (пустое)
// состояние, а вошедший видит мигание.
//
// Телефон берётся из auth.users, а не из profiles: он там источник
// истины (вход по SMS, миграция 0035), и в profiles может быть пустым
// у аккаунтов, заведённых раньше.
// ============================================================

import { notFound } from 'next/navigation';

import ProfileForm from '@/components/ProfileForm';
import StateCard from '@/components/ui/StateCard';
import type { Locale } from '@/lib/i18n';
import { getCurrentUser, getServerClient } from '@/lib/supabaseServer';
import type { MyProfile } from '@/lib/types';

type Props = {
  locale: Locale;
};

export default async function ProfilePageView({ locale }: Props) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const supabase = await getServerClient();

  const profileResult = await supabase
    .from('profiles')
    .select('id, email, full_name, phone, avatar_url, seller_kind, company_name, logo_url')
    .eq('id', user.id)
    .maybeSingle();

  if (profileResult.error || !profileResult.data) {
    return (
      <StateCard locale={locale} variant="error" retryPath="/my/profile" />
    );
  }

  const row = profileResult.data as MyProfile;

  const profile: MyProfile = {
    ...row,
    // Номер из сессии: в profiles он мог не сохраниться. Приводим к
    // виду с плюсом — Supabase хранит его без ведущего знака.
    phone: user.phone ? `+${user.phone.replace(/^\+/, '')}` : row.phone,
  };

  return <ProfileForm locale={locale} profile={profile} />;
}
