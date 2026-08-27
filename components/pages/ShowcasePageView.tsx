// ============================================================
// RS AUTO — Витрина салона в кабинете (/my/showcase). Server Component.
// ============================================================
// Экран собирается сверху вниз ровно в том порядке, в каком продавец
// принимает решения:
//   1) живое превью широкой карточки — как салон видят покупатели;
//   2) поля витрины и кнопка сохранения (ShowcaseForm, клиентский);
//   3) объявления салона — то, что за этой карточкой стоит.
//
// ------------------------------------------------------------
// ЭКРАН ТОЛЬКО ДЛЯ САЛОНА
// ------------------------------------------------------------
// Частнику страница отдаёт 404, а не пустую форму. Причина не в
// оформлении: update_seller_profile при seller_kind = 'private'
// затирает все поля витрины, и форма обещала бы сохранение, которого
// не произойдёт. Роль переключается в профиле (/my/profile) — там же,
// где она и была.
//
// ------------------------------------------------------------
// ДАННЫЕ ЧИТАЮТСЯ НА СЕРВЕРЕ И ОТДАЮТСЯ ФОРМЕ ГОТОВЫМИ
// ------------------------------------------------------------
// Клиентский компонент не должен начинать жизнь с пустых полей и
// подгружать их эффектом: форма на мгновение показала бы пустую
// витрину, и продавец решил бы, что данные потерялись. Тот же приём,
// что в ProfilePageView.
//
// Профиль читается ПРЯМЫМ SELECT, а не через get_dealer_profile:
// нужен собственный профиль владельца, и политика profiles_select_own
// (0007) отдаёт его без всякой RPC. Публичная функция здесь была бы
// лишним слоем — она ещё и прячет поля, которые владельцу видеть
// положено.
//
// Миниатюры машин для превью берутся из ЕГО ЖЕ объявлений
// (get_seller_listings): предпросмотр обязан показывать настоящие
// машины салона, иначе он не предпросмотр, а макет.
// ============================================================

import { notFound } from 'next/navigation';

import MyListingCard from '@/components/MyListingCard';
import ShowcaseForm from '@/components/ShowcaseForm';
import StateCard from '@/components/ui/StateCard';
import Button from '@/components/ui/Button';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { fetchSellerListings } from '@/lib/queries';
import { getCurrentUser, getServerClient } from '@/lib/supabaseServer';
import type { MyListing, MyProfile } from '@/lib/types';

// Сколько объявлений салона показать в превью карточки. Три —
// столько помещается в плитку рядом с логотипом (PREVIEW_LIMIT в
// DealerShowcaseCard). Берём с запасом: у части машин фотографии
// может не быть, и запас позволяет заполнить ряд без второго запроса.
const PREVIEW_FETCH = 8;

export default async function ShowcasePageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  const user = await getCurrentUser();
  if (!user) notFound();

  const supabase = await getServerClient();

  const profileResult = await supabase
    .from('profiles')
    .select(
      'id, email, full_name, phone, avatar_url, seller_kind, company_name, logo_url, description, dealer_phone, website, opening_hours, company_city',
    )
    .eq('id', user.id)
    .maybeSingle();

  if (profileResult.error || !profileResult.data) {
    return <StateCard locale={locale} variant="error" retryPath="/my/showcase" />;
  }

  const profile = profileResult.data as MyProfile;

  // Не салон — страницы не существует (см. шапку файла).
  if (profile.seller_kind !== 'dealer') notFound();

  // Витрина для превью и список объявлений кабинета грузятся
  // параллельно: запросы независимы, и последовательное ожидание
  // удвоило бы задержку отрисовки.
  const [previewCars, listingsResult] = await Promise.all([
    fetchSellerListings(user.id, 'active', PREVIEW_FETCH),
    supabase.rpc('get_my_listings_stats'),
  ]);

  const previewPhotos = previewCars
    .map((car) => car.photo_url)
    .filter((url): url is string => typeof url === 'string' && url !== '');

  // Число машин в превью — это АКТИВНЫЕ объявления, ровно та цифра,
  // которую увидит покупатель в плитке. Считаем по тому же признаку,
  // что и публичная выдача: длина выборки годится лишь до PREVIEW_FETCH,
  // поэтому берём отдельный счётчик из списка кабинета.
  const listings = (listingsResult.error ? [] : (listingsResult.data ?? [])) as MyListing[];
  const activeCars = listings.filter((l) => l.status === 'active').length;

  return (
    <div className="space-y-8">
      <ShowcaseForm
        locale={locale}
        profile={profile}
        previewPhotos={previewPhotos}
        activeCars={activeCars}
      />

      {/* ------------------------------------------------------------
          ОБЪЯВЛЕНИЯ САЛОНА
          ------------------------------------------------------------
          Тот же вид карточки, что на «Моих объявлениях»: это один и
          тот же список, показанный в контексте витрины. Второй вид
          карточки владельца заставлял бы заново разбираться, что
          означают статусы и кнопки. */}
      <section>
        <h2 className="mb-3 text-h3 font-semibold">{t('showcase_listings')}</h2>

        {listings.length === 0 ? (
          <StateCard
            locale={locale}
            title={t('my_empty_title')}
            text={t('my_empty_text')}
            actions={
              <Button size="sm" href={localeHref(locale, '/sell')}>
                {t('my_empty_cta')}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {listings.map((listing) => (
              <MyListingCard
                key={listing.car_id}
                locale={locale}
                listing={listing}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
