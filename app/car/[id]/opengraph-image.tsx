// ============================================================
// RS AUTO — Динамическая OG-картинка объявления.
// ============================================================
// Требование виральности: при отправке ссылки в WhatsApp/Viber/Telegram
// собеседник должен увидеть фото, цену и модель, а не пустой прямоугольник.
//
// Картинка собирается через ImageResponse (Satori) на лету и кэшируется.
// Внешние шрифты не подключаем: сборка не должна зависеть от сети.
// ============================================================

import { ImageResponse } from 'next/og';

import { brand } from '@/lib/brand';
import { carTitle, formatMileage, formatPrice } from '@/lib/format';
import { fetchCarDetails, fetchCarImages } from '@/lib/queries';

// Стандартный размер OG-превью, который ожидают соцсети.
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'RS Auto';

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const car = await fetchCarDetails(id);

  // Объявление недоступно — отдаём нейтральную заглушку с брендом.
  // Возвращать 404 нельзя: соцсеть тогда покажет «битую» карточку.
  if (!car) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: brand.colors.primary,
            color: '#fff',
            fontSize: 72,
            fontWeight: 700,
          }}
        >
          {brand.name}
        </div>
      ),
      size,
    );
  }

  const images = await fetchCarImages(id);
  const photo = images[0]?.image_url ?? null;
  const title = carTitle(car);
  const price = formatPrice(car.sale_price, car.currency, 'sr');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
        }}
      >
        {/* Верхние 2/3 — фотография автомобиля: именно она привлекает
            внимание в ленте мессенджера. */}
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: 400,
            background: '#e9e9ec',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt=""
              width={1200}
              height={400}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ display: 'flex', fontSize: 48, color: '#9a9aa2' }}>{brand.name}</div>
          )}
        </div>

        {/* Нижняя треть — модель, цена и характеристики. */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            padding: '24px 40px',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 44, fontWeight: 700, color: '#2b2b2e' }}>
              {title}
            </div>
            {/* Satori (движок ImageResponse) требует явный display: flex
                у любого <div> с несколькими дочерними узлами. Здесь их три
                (город, разделитель, пробег) — без flex рендер падает с
                «failed to pipe response», и соцсеть получает пустое превью.
                По той же причине строка собирается заранее, а не склеивается
                из выражений прямо в разметке. */}
            <div
              style={{
                display: 'flex',
                fontSize: 28,
                color: '#6b6b73',
                marginTop: 8,
              }}
            >
              {`${car.city} · ${formatMileage(car.mileage, 'sr')}`}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 52,
                fontWeight: 700,
                color: brand.colors.primary,
              }}
            >
              {price}
            </div>
            <div style={{ display: 'flex', fontSize: 24, color: brand.colors.green, marginTop: 6 }}>
              {brand.name}
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
