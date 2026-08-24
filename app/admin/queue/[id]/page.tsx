// ============================================================
// RS AUTO — Карточка проверки объявления. Server Component.
// ============================================================
// Данные — одним вызовом admin_get_car (0079): поля, все фотографии и
// история решений. Три отдельных запроса означали бы три задержки
// подряд на каждом объявлении, а модератор открывает их десятками.
//
// Разделение ответственности на странице:
//   ModerationCard      — Server, только показ (фото, поля, продавец,
//                         история);
//   ModerationActions   — Client, всё интерактивное (кнопки, диалог,
//                         клавиши A/R).
// Так клиентским остаётся минимум разметки, а тяжёлая часть карточки
// приходит готовой из SSR.
//
// КАРТОЧКА ОТКРЫВАЕТСЯ И ДЛЯ УЖЕ РАЗОБРАННЫХ объявлений: модератор
// приходит сюда по ссылке из журнала (M7), чтобы посмотреть, что
// именно одобрили. Кнопок в этом случае нет — вместо них объяснение.
// Скрывать саму карточку было бы неверно: смотреть на решение нужно
// чаще, чем принимать его заново.
// ============================================================

import { notFound } from 'next/navigation';
import Link from 'next/link';

import ModerationActions from '@/components/admin/ModerationActions';
import ModerationCard from '@/components/admin/ModerationCard';
import { getServerClient } from '@/lib/supabaseServer';
import type { AdminCar } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export default async function AdminCarPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await getServerClient();

  const { data, error } = await supabase.rpc('admin_get_car', {
    p_car_id: id,
  });

  // Ошибка RPC и несуществующее объявление ведут в одно место, но по
  // разным причинам: первое — сбой, второе — опечатка в адресе.
  // Обрабатывать их по-разному незачем: показать карточку всё равно
  // нечего, а 404 внутри админки уводит обратно в очередь
  // (app/admin/not-found.tsx).
  if (error) notFound();

  const car = ((data ?? [])[0] ?? null) as AdminCar | null;
  if (!car) notFound();

  // Решения доступны только для того, что ждёт проверки. Проверка
  // здесь — про интерфейс, а не про безопасность: настоящую защиту
  // даёт сам approve_car/reject_car, который проверит статус под
  // FOR UPDATE и откажет, даже если кнопку как-то нажали.
  const decided = car.status !== 'moderation';

  return (
    <>
      {/* Возврат в очередь. Обычная ссылка, а не router.back():
          в карточку приходят и из журнала, и по прямому адресу,
          и «назад» увело бы в непредсказуемое место. */}
      <Link
        href="/admin/queue"
        className="text-caption text-brand-blue hover:underline"
      >
        ← Очередь
      </Link>

      <div className="mt-4">
        <ModerationCard car={car} />
      </div>

      {/* Панель решений — внизу, после всего, что нужно посмотреть.
          Липкая на десктопе: при длинном описании и десятке фотографий
          кнопки иначе уезжают за пределы экрана, и модератору
          приходится прокручивать обратно вверх после каждого
          объявления. */}
      <div className="sticky bottom-0 mt-8 border-t border-neutral-10 bg-white py-4">
        <ModerationActions
          carId={car.car_id}
          ownerLocale={car.owner_locale}
          decided={decided}
        />
      </div>
    </>
  );
}
