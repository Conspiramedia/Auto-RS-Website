// ============================================================
// RS AUTO — «Объявление снято». Server Component.
// ============================================================
// ЗАЧЕМ ОТДЕЛЬНЫЙ ЭКРАН, А НЕ 404. Объявление, побывавшее в индексе,
// рано или поздно уходит в архив, продаётся или возвращается на
// перепроверку после правки. Ссылка в выдаче Google при этом живёт
// ещё недели. Голая 404 в такой момент — худший исход: человек искал
// конкретную машину, кликнул и получил страницу без единого следа
// того, что искал. Уходит он не на другую страницу сайта, а обратно
// в поиск, то есть к конкуренту.
//
// Этот экран решает ровно одну задачу: подтвердить, что адрес верный,
// объявление существовало, и увести в похожие. Показывать больше
// нечего и незачем.
//
// ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Есть марка, модель, год, город и
// подборка похожих. Нет цены, описания, фотографий, контактов и имени
// продавца — их обнуляет сама RPC (миграция 0072), так что даже при
// ошибке в разметке они сюда не попадут. Это не перестраховка: снятое
// объявление не должно приводить звонки человеку, который уже продал
// машину.
//
// ПРИЧИНА СНЯТИЯ НЕ РАСКРЫВАЕТСЯ. 'archived', 'rejected' и
// 'moderation' дают один и тот же текст. Посетителю разница не важна,
// а «отклонено модератором» на публичной странице выдало бы решение
// модератора постороннему и опозорило бы продавца.
//
// NOINDEX. Страница отдаётся с robots: noindex, follow (см.
// generateMetadata в роутах): в индексе ей делать нечего — контента
// нет, — но ссылки на каталог и похожие обойти нужно, чтобы вес
// исчезнувшей страницы перетёк на живые.
// ============================================================

import CarCard from '@/components/CarCard';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { fetchSimilarCars } from '@/lib/queries';
import type { CarDetails } from '@/lib/types';

export default async function CarGoneView({
  locale,
  car,
}: {
  locale: Locale;
  // Урезанная карточка из get_car_details: марка, модель, год, город,
  // статус. Цены, описание и продавец в ней уже NULL.
  car: CarDetails;
}) {
  const t = getT(locale);

  // Похожие подбираются по той же RPC, что и на живой карточке, — она
  // сама отбирает только активные объявления. Именно ради этого блока
  // страница и существует: без него экран был бы тупиком не хуже 404.
  const similar = await fetchSimilarCars(car.id);

  // Витрина, к которой относилось объявление: аренда возвращает в
  // /rent, всё остальное — в /cars. Отправлять человека, искавшего
  // прокат, в каталог продажи значило бы потерять его во второй раз.
  const mode: 'sale' | 'rent' = car.is_for_sale ? 'sale' : 'rent';
  const catalogPath = mode === 'rent' ? '/rent' : '/cars';
  const catalogLabel = mode === 'rent' ? t('rent_title') : t('nav_catalog');

  // Название без цены: цена снятого объявления не показывается, а
  // carTitle из lib/format её и не добавляет.
  const title = `${car.brand} ${car.model}, ${car.year}`;

  return (
    <>
      <SiteHeader locale={locale} pathname={catalogPath} />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        {/* Верхний блок ограничен по ширине и центрирован: это
            сообщение, а не контент. Растянутый на 1152px абзац из двух
            строк выглядел бы потерянным. */}
        <Card padding="none" className="mx-auto max-w-2xl px-6 py-10 text-center">
          <Badge tone="neutral">{t('car_gone_badge')}</Badge>

          <h1 className="mt-3 text-h2 font-bold sm:text-h1">{t('car_gone_title')}</h1>

          {/* Название объявления — единственное подтверждение, что
              человек пришёл по верному адресу. Без него страница
              неотличима от общей ошибки. */}
          <p className="mt-2 text-h4 font-semibold text-neutral-60">{title}</p>

          {car.city && (
            <p className="mt-0.5 text-caption text-neutral-50">{car.city}</p>
          )}

          <p className="mx-auto mt-4 max-w-md text-neutral-60">
            {t('car_gone_text')}
          </p>

          {/* Столбик на мобильном, ряд с sm — тот же приём, что на
              экранах 404 и 500: inline-grid уравнивает кнопки по самой
              широкой, поэтому ширина берётся по длине подписи. */}
          <div className="mt-6 inline-grid grid-cols-1 gap-3 sm:flex sm:flex-row sm:items-center sm:justify-center">
            <Button size="lg" href={localeHref(locale, catalogPath)}>
              {catalogLabel}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              href={localeHref(locale, '/')}
            >
              {t('nf_home')}
            </Button>
          </div>
        </Card>

        {/* Похожие. Заголовок отличается от «Похожие автомобили» на
            живой карточке: здесь это не дополнение к объявлению, а
            основное предложение страницы, и звучать должно как
            приглашение. */}
        {similar.length > 0 && (
          <section className="mt-10">
            <h2 className="text-h3 font-semibold">{t('car_gone_similar')}</h2>

            {/* Та же сетка, что в каталоге: 1 колонка на мобильном,
                2 на планшете, 3 на десктопе. Карточки обязаны
                выглядеть одинаково во всех списках сайта. */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {similar.map((item) => (
                <CarCard
                  key={item.id}
                  locale={locale}
                  car={item}
                  mode={mode}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
