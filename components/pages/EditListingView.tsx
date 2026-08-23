// ============================================================
// RS AUTO — Страница правки объявления. Server Component.
// ============================================================
// Общая для /my/listing/[id]/edit и /ru/my/listing/[id]/edit.
//
// ЗАЧЕМ ПРОВЕРКА ПРАВ ЗДЕСЬ, если её делает и RPC. Рубежей два, и они
// разные по назначению:
//   * update_car_v3 не даст ЗАПИСАТЬ чужое объявление — это защита
//     данных, и она обязательна;
//   * эта проверка не даёт ПОКАЗАТЬ форму с чужими данными.
// Без неё посторонний, подставив чужой id, увидел бы марку, модель,
// цену и телефон продавца в полях формы — и только при сохранении
// получил бы отказ. Права на чтение у get_car_details достаточные
// (владелец, админ, либо публичный статус), поэтому фильтруем сами.
//
// Чужое объявление → 404, а не 403: сообщать «оно существует, но не
// ваше» значит подтверждать факт существования карточки постороннему.
// notFound() отдаёт ту же страницу, что и несуществующий id.
//
// Гость сюда не попадает вовсе: layout кабинета (app/my/layout.tsx)
// показывает ему форму входа вместо содержимого.
// ============================================================

import { notFound } from 'next/navigation';

import SellForm from '@/components/SellForm';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { getCurrentUser, getServerClient } from '@/lib/supabaseServer';

type Props = {
  locale: Locale;
  carId: string;
};

export default async function EditListingView({ locale, carId }: Props) {
  const t = getT(locale);

  const user = await getCurrentUser();
  // Страховка на случай прямого захода: layout уже развернул бы гостя,
  // но полагаться на порядок рендера при проверке прав нельзя.
  if (!user) notFound();

  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc('get_car_details', {
    p_car_id: carId,
  });

  const car = (data ?? [])[0] as { user_id?: string; status?: string } | undefined;

  // Нет объявления, ошибка выборки или объявление чужое — 404.
  if (error || !car || car.user_id !== user.id) notFound();

  // Проданное и архивное сначала возвращают в публикацию: правка
  // завершённой сделки означала бы подмену её условий задним числом.
  // Тот же список статусов проверяет update_car_v3 — здесь мы лишь не
  // показываем форму, которую сервер всё равно отклонит.
  if (!['moderation', 'rejected', 'active'].includes(car.status ?? '')) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-2xl lg:max-w-3xl">
      <h1 className="mb-4 text-h2 font-bold sm:text-h1">{t('edit_title')}</h1>
      <SellForm locale={locale} mode="edit" carId={carId} />
    </div>
  );
}
