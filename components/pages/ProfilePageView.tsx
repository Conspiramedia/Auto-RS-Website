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
import type { DealerApplication, MyProfile } from '@/lib/types';

type Props = {
  locale: Locale;
};

export default async function ProfilePageView({ locale }: Props) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const supabase = await getServerClient();

  // Профиль и заявка на статус салона читаются ПАРАЛЛЕЛЬНО: запросы
  // независимы, и последовательное ожидание удвоило бы задержку
  // первого экрана кабинета.
  const [profileResult, applicationResult] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, email, full_name, phone, avatar_url, seller_kind, company_name, logo_url, description, dealer_phone, website, opening_hours, company_city, cover_url, tagline',
      )
      .eq('id', user.id)
      .maybeSingle(),

    // Последняя заявка на статус автосалона (миграция 0100). По ней
    // блок в форме решает, что показать: приглашение, «ждём
    // решения», причину отказа или подтверждение статуса.
    supabase.rpc('get_my_dealer_application'),
  ]);

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

  // Заявка возвращается таблицей из нуля или одной строки. Ошибку
  // чтения НЕ роняем в экран ошибки: профиль загрузился, и не дать
  // человеку сохранить имя из-за недоступной заявки — несоразмерно.
  // Блок заявки в этом случае покажет приглашение подать её; если
  // заявка на самом деле есть, сервер откажет при подаче и объяснит
  // почему.
  const application = applicationResult.error
    ? null
    : ((applicationResult.data ?? [])[0] ?? null);

  return (
    <ProfileForm
      locale={locale}
      profile={profile}
      application={application as DealerApplication | null}
    />
  );
}
