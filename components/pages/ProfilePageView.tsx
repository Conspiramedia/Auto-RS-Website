// ============================================================
// RS AUTO — Профиль /my/profile. Server Component.
// ============================================================
// Данные читаются на сервере и отдаются форме готовыми: клиентский
// компонент не должен начинать жизнь с пустых полей и подгружать их
// эффектом — иначе форма на мгновение показывает чужое (пустое)
// состояние, а вошедший видит мигание.
//
// Телефон берётся из profiles — это КОНТАКТ продавца, а не способ
// входа. Раньше он читался из auth.users (вход по SMS, миграция 0035)
// и перекрывал значение профиля. После перехода на почтовый вход
// (0106) поле auth.users.phone пусто у всех новых аккаунтов, а номер
// живёт в profiles.phone: туда его пишет подача объявления
// (set_profile_phone), оттуда же читает форма подачи.
//
// Значение из сессии остаётся ЗАПАСНЫМ вариантом: у аккаунтов,
// заведённых по SMS до 0106, profiles.phone может быть пустым, и
// показать им пустое поле вместо их же номера было бы потерей данных
// на вид.
// ============================================================

import { notFound } from 'next/navigation';

import type { DeleteConfirmKind } from '@/components/DeleteAccountBlock';
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
  const [profileResult, applicationResult, confirmResult] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, email, email_on_message, full_name, phone, avatar_url, seller_kind, company_name, logo_url, description, dealer_phone, website, opening_hours, company_city, cover_url, tagline',
      )
      .eq('id', user.id)
      .maybeSingle(),

    // Последняя заявка на статус автосалона (миграция 0100). По ней
    // блок в форме решает, что показать: приглашение, «ждём
    // решения», причину отказа или подтверждение статуса.
    supabase.rpc('get_my_dealer_application'),

    // Чем подтверждается удаление аккаунта: 'email' | 'phone' | 'word'
    // (миграция 0128). Спрашиваем СЕРВЕР, а не выводим из профиля
    // ниже: там phone подменяется номером из сессии, когда в profiles
    // пусто, — и клиент ждал бы номер, которого база не знает, а
    // значит не принял бы ни одного верного ответа.
    supabase.rpc('get_my_delete_confirmation'),
  ]);

  if (profileResult.error || !profileResult.data) {
    return (
      <StateCard locale={locale} variant="error" retryPath="/my/profile" />
    );
  }

  const row = profileResult.data as MyProfile;

  const profile: MyProfile = {
    ...row,
    // Приоритет у profiles.phone: это поле продавец правит сам.
    // Номер из сессии подставляется, только когда профиль пуст —
    // у SMS-аккаунтов доцифровой эпохи. Приводим к виду с плюсом:
    // Supabase хранит его без ведущего знака.
    phone:
      row.phone ??
      (user.phone ? `+${user.phone.replace(/^\+/, '')}` : null),
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

  // Вид подтверждения. Ошибка чтения не должна ронять профиль: без
  // ответа считаем, что подтверждать нужно словом, — это работает у
  // любого аккаунта, тогда как ошибочно выбранная почта заперла бы
  // человека без почты. База в любом случае проверит сама.
  const deleteConfirmKind = (
    confirmResult.error ? 'word' : (confirmResult.data ?? 'word')
  ) as DeleteConfirmKind;

  return (
    <ProfileForm
      locale={locale}
      profile={profile}
      application={application as DealerApplication | null}
      deleteConfirmKind={deleteConfirmKind}
    />
  );
}
