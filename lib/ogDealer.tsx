// ============================================================
// RS AUTO — OG-картинка витрины продавца.
// ============================================================
// ЗАЧЕМ. У карточки объявления своё превью с фотографией и ценой, а
// витрина салона до сих пор репостилась с общей брендовой заглушкой:
// в ленте ссылка на «Auto Centar Beograd» выглядела так же, как ссылка
// на главную. Витрина — целевая посадочная по запросу «<название
// салона> Beograd», и в превью должно стоять имя салона.
//
// ОБЩИЙ МОДУЛЬ НА ДВЕ ЛОКАЛИ, как и lib/ogCover: роуты
// app/dealer/[id]/opengraph-image.tsx и его русское зеркало —
// тонкие обёртки, композиция правится в одном месте.
//
// ДИНАМИЧЕСКАЯ, а не собранная на сборке: имя и число объявлений
// берутся из базы по id. Кэш — на стороне Next, роут наследует
// revalidate страницы.
// ============================================================

import { ImageResponse } from 'next/og';

import { brand } from '@/lib/brand';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { countNoun } from '@/lib/plural';
import { fetchDealerProfile } from '@/lib/queries';

export const OG_SIZE = { width: 1200, height: 630 };

export async function renderOgDealer(locale: Locale, id: string) {
  const t = getT(locale);
  const size = OG_SIZE;

  const profile = await fetchDealerProfile(id).catch(() => null);

  // Профиля нет — отдаём брендовую плашку без имени, а не падаем:
  // роут превью не должен ронять страницу, которая и так отдаст 404.
  const name = profile?.display_name ?? brand.name;
  const isDealer = profile?.seller_kind === 'dealer';
  const logo = profile?.logo_url ?? null;

  const countLine = profile
    ? countNoun(profile.active_cars, 'activeListing', locale)
    : t('site_tagline');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          // Фирменный синий сплошной подложкой: фотографии витрины у
          // нас нет, а логотип салона — чужая графика неизвестного
          // размера и цвета, класть её во весь кадр нельзя.
          background: brand.colors.primary,
          padding: '0 80px',
          position: 'relative',
        }}
      >
        {/* ЛОГОТИП САЛОНА, ЕСЛИ ОН ЕСТЬ. Не во весь кадр, а плашкой
            фиксированного размера на белом: логотипы приходят с
            прозрачным фоном и тёмным знаком, и на синем они
            пропадали бы.

            contain, а не cover: чужой знак нельзя кадрировать — обрежет
            название. Белая подложка со скруглением повторяет карточку
            салона на сайте.

            eslint-disable: Satori понимает только обычный <img>. */}
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            width={200}
            height={200}
            style={{
              width: 200,
              height: 200,
              objectFit: 'contain',
              background: '#FFFFFF',
              borderRadius: 24,
              padding: 20,
              marginBottom: 40,
            }}
          />
        )}

        {/* Вид продавца мелкой строкой над именем: «Auto-salon» или
            «Prodavac». Без него имя частного продавца в превью
            читалось бы как название компании. */}
        <div
          style={{
            display: 'flex',
            fontSize: 30,
            color: 'rgba(255,255,255,0.75)',
            marginBottom: 16,
          }}
        >
          {isDealer
            ? t('dealer_meta_desc_dealer_prefix')
            : t('dealer_meta_desc_private_prefix')}
        </div>

        {/* ИМЯ САЛОНА — главное в кадре. Размер уменьшен для длинных
            названий: Satori не умеет автоподбор, поэтому порог по
            длине строки задан вручную. 28 символов — та граница, за
            которой имя на 72px перестаёт помещаться в строку при
            боковых отступах 80px. */}
        <div
          style={{
            display: 'flex',
            fontSize: name.length > 28 ? 52 : 72,
            fontWeight: 700,
            color: '#FFFFFF',
            lineHeight: 1.15,
          }}
        >
          {name}
        </div>

        {/* Число активных объявлений — то, ради чего на витрину
            заходят. Склоняется (lib/plural). */}
        <div
          style={{
            display: 'flex',
            fontSize: 36,
            color: 'rgba(255,255,255,0.92)',
            marginTop: 20,
          }}
        >
          {countLine}
        </div>

        {/* Зелёная черта — тот же акцент, что на брендовой обложке. */}
        <div
          style={{
            display: 'flex',
            width: 160,
            height: 8,
            background: brand.colors.green,
            borderRadius: 999,
            marginTop: 28,
          }}
        />

        {/* Подпись площадки в углу: превью уходит в чужие ленты, и
            источник должен быть виден. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 56,
            right: 80,
            fontSize: 32,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.9)',
          }}
        >
          {brand.name}
        </div>
      </div>
    ),
    size,
  );
}
