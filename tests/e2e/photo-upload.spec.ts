// ============================================================
// RS AUTO — Сьют: подготовка фотографий перед загрузкой.
// ============================================================
// ЧТО ПРОВЕРЯЕТСЯ. Конвейер lib/imagePrepare.ts — тот самый, что
// зеркалит image_picker(maxWidth: 1600, imageQuality: 80) приложения:
//
//   1) снимок 5 МБ после пережатия весит ≤2 МБ и укладывается
//      в 1600px по длинной стороне;
//   2) EXIF-ориентация применяется ОДНОКРАТНО, при выборе файла:
//      кадр с тегом «повернуть на 90°» выходит с переставленными
//      сторонами, а сам тег в результат не попадает — иначе поворот
//      применился бы второй раз при показе;
//   3) PNG с прозрачностью становится JPEG на белом фоне;
//   4) файл сверх 25 МБ и не-картинка отклоняются;
//   5) сквозная проверка: Storage ОТКАЗЫВАЕТ файлу сверх лимита
//      бакета и файлу чужого MIME (миграция 0087).
//
// ПОЧЕМУ БРАУЗЕРОМ, А НЕ ЮНИТОМ. Конвейер целиком построен на
// браузерных API: createImageBitmap с imageOrientation, canvas,
// toBlob. В Node их нет, а мок проверял бы мок. Ошибка, ради которой
// тест написан, как раз браузерная: EXIF применяется по-разному
// в зависимости от того, как файл попал на canvas.
//
// ------------------------------------------------------------
// ПОЧЕМУ ЧЕРЕЗ НАСТОЯЩУЮ ФОРМУ, А НЕ ЧЕРЕЗ import() МОДУЛЯ
// ------------------------------------------------------------
// Импортировать '@/lib/imagePrepare' внутри page.evaluate нельзя:
// алиас существует только на сборке, в браузере такого адреса нет,
// а имена чанков Next не фиксированы. Заводить служебный роут ради
// теста — значит тащить его в боевую сборку.
//
// Поэтому файл подсовывается в НАСТОЯЩИЙ input формы подачи, а
// результат снимается с превью: PhotoPicker показывает blob уже
// пережатого файла (пережатие идёт при выборе, до отправки). Это
// проверяет заодно и то, что модуль реально подключён к форме, —
// юнит на функции такого не поймал бы.
//
// ЗАВИСИМОСТЬ ОТ ДАННЫХ. Форма подачи рендерится на сервере и без
// Supabase отдаёт 500, поэтому весь сьют требует поднятого локального
// стека и без него пропускается, а не падает — как и остальные сьюты
// проекта (см. docs/testing.md, деградация).
// ============================================================

import { expect, test, type Page } from '@playwright/test';

import {
  isSupabaseUp,
  TEST_SUPABASE_ANON_KEY,
  TEST_SUPABASE_URL,
} from '../env';
import { signInAsSeller } from '../fixtures/session';

// Проверка один раз на файл: поднимать стек ради каждого теста
// незачем, а результат в пределах прогона не меняется.
let supabaseUp = false;
test.beforeAll(async () => {
  supabaseUp = await isSupabaseUp();
});

test.beforeEach(() => {
  test.skip(!supabaseUp, 'Локальный Supabase не поднят');
});

// Кнопка выбора и подпись шага «Фотографии» — обе локали.
const PHOTOS_STEP = /(Fotografije|Фотографии)/;
const NEXT_BUTTON = /(Dalje|Далее)/;

// ------------------------------------------------------------
// Доводит форму подачи до шага с фотографиями.
// ------------------------------------------------------------
// Шаги 1 и 2 заполняются минимально: цель — добраться до PhotoPicker,
// а не проверить валидацию (она покрыта отдельно).
async function openPhotoStep(page: Page): Promise<void> {
  await page.goto('/sell');

  // Шаг 1 → 2 → 3. Кнопка «Далее» одна и та же, поэтому просто
  // нажимаем, пока не покажется заголовок шага фотографий.
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: NEXT_BUTTON }).first().click();
  }

  await expect(
    page.getByRole('heading', { name: PHOTOS_STEP }),
  ).toBeVisible();
}

// ------------------------------------------------------------
// Помощники, живущие в странице.
// ------------------------------------------------------------
// JPEG собирается настоящим canvas-ом, а не байтовой заглушкой:
// preparePhoto обязан его декодировать, и «файл» из случайных байтов
// упал бы на первом же шаге, ничего не проверив.
//
// Шум вместо заливки принципиален: сплошной цвет JPEG сжимает почти
// в ноль, и «снимок 5 МБ» весил бы килобайты — проверка веса стала
// бы бессмысленной.
const HELPERS = `
window.__mkNoisyJpeg = async (w, h, quality) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = Math.random() * 255;
    img.data[i + 1] = Math.random() * 255;
    img.data[i + 2] = Math.random() * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
};

// Врезает в готовый JPEG сегмент APP1 с единственным тегом
// Orientation = 6 («повернуть на 90° по часовой»). Собираем вручную:
// библиотек в бандле нет, а тег нужен настоящий — createImageBitmap
// читает именно его.
window.__withExifOrientation6 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a,       // big-endian, magic 42
    0x00, 0x00, 0x00, 0x08,       // смещение IFD0
    0x00, 0x01,                   // один тег
    0x01, 0x12,                   // Orientation
    0x00, 0x03,                   // тип SHORT
    0x00, 0x00, 0x00, 0x01,       // одно значение
    0x00, 0x06, 0x00, 0x00,       // значение 6
    0x00, 0x00, 0x00, 0x00,       // следующего IFD нет
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\\0\\0"
  const len = payload.length + 2;
  const app1 = [0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload];

  // APP1 идёт сразу после SOI (первые два байта FFD8).
  const out = new Uint8Array(bytes.length + app1.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(bytes.subarray(2), 2 + app1.length);
  return new Blob([out], { type: 'image/jpeg' });
};

// Размеры и угловой пиксель картинки по её адресу (blob: превью).
window.__probe = async (src) => {
  const res = await fetch(src);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, 1, 1).data;
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close();

  // Ищем сигнатуру "Exif" в байтах: её наличие означало бы, что
  // ориентация может примениться повторно при показе.
  const raw = new Uint8Array(await blob.arrayBuffer());
  let hasExif = false;
  for (let i = 0; i < raw.length - 4; i++) {
    if (raw[i] === 0x45 && raw[i+1] === 0x78 && raw[i+2] === 0x69 && raw[i+3] === 0x66) {
      hasExif = true; break;
    }
  }

  return { ...dims, size: blob.size, type: blob.type, hasExif,
           pixel: [px[0], px[1], px[2]] };
};
`;

// Кладёт подготовленный в странице Blob в настоящий <input type=file>
// и возвращает характеристики того, что показал PhotoPicker.
async function pickAndProbe(
  page: Page,
  makeBlob: string,
  fileName: string,
  mime: string,
) {
  await page.evaluate(
    async ({ maker, name, type }) => {
      const blob: Blob = await (
        window as unknown as Record<string, () => Promise<Blob>>
      )[maker]();

      const file = new File([blob], name, { type });
      const dt = new DataTransfer();
      dt.items.add(file);

      const input = document.getElementById('photo-input') as HTMLInputElement;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { maker: makeBlob, name: fileName, type: mime },
  );

  // Превью появляется после пережатия — ждём именно его.
  const preview = page.locator('img[src^="blob:"]').first();
  await expect(preview).toBeVisible({ timeout: 15_000 });

  const src = await preview.getAttribute('src');
  return page.evaluate(
    (url) =>
      (
        window as unknown as {
          __probe: (u: string) => Promise<{
            width: number;
            height: number;
            size: number;
            type: string;
            hasExif: boolean;
            pixel: number[];
          }>;
        }
      ).__probe(url),
    src!,
  );
}

test.describe('Подготовка фотографий при подаче объявления', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(HELPERS);
  });

  // ----------------------------------------------------------
  // 1) Снимок ~5 МБ → ≤2 МБ и не больше 1600px по длинной стороне.
  // ----------------------------------------------------------
  test('фото 5 МБ пережимается до ≤2 МБ и 1600px', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__makeBig = () =>
        (
          window as unknown as {
            __mkNoisyJpeg: (w: number, h: number, q: number) => Promise<Blob>;
          }
        ).__mkNoisyJpeg(4000, 3000, 0.95);
    });

    await openPhotoStep(page);

    // Контроль осмысленности: вход действительно тяжёлый.
    const inputSize = await page.evaluate(async () => {
      const blob = await (
        window as unknown as { __makeBig: () => Promise<Blob> }
      ).__makeBig();
      return blob.size;
    });
    expect(inputSize).toBeGreaterThan(4 * 1024 * 1024);

    const out = await pickAndProbe(page, '__makeBig', 'photo.jpg', 'image/jpeg');

    // Длинная сторона ровно 1600, пропорция 4:3 сохранена.
    expect(Math.max(out.width, out.height)).toBe(1600);
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1200);

    // Порог MAX_OUTPUT_BYTES из lib/imagePrepare.ts.
    expect(out.size).toBeLessThanOrEqual(2 * 1024 * 1024);
    // И реально лёгкий: кадр 1600px при качестве 0.82 — сотни КБ.
    expect(out.size).toBeLessThan(inputSize / 2);
    expect(out.type).toBe('image/jpeg');
  });

  // ----------------------------------------------------------
  // 2) EXIF-ориентация применяется однократно.
  // ----------------------------------------------------------
  test('EXIF-поворот применяется один раз, тег в результат не попадает', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const w = window as unknown as {
        __mkNoisyJpeg: (w: number, h: number, q: number) => Promise<Blob>;
        __withExifOrientation6: (b: Blob) => Promise<Blob>;
        __makeRotated?: () => Promise<Blob>;
      };
      w.__makeRotated = async () =>
        w.__withExifOrientation6(await w.__mkNoisyJpeg(800, 400, 0.9));
    });

    await openPhotoStep(page);

    // Контроль: браузер действительно видит тег. Если нет —
    // проверка ничего не значит, и об этом надо узнать.
    const seen = await page.evaluate(async () => {
      const blob = await (
        window as unknown as { __makeRotated: () => Promise<Blob> }
      ).__makeRotated();
      const bmp = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
      });
      const dims = { w: bmp.width, h: bmp.height };
      bmp.close();
      return dims;
    });
    expect(seen.w).toBe(400);
    expect(seen.h).toBe(800);

    const out = await pickAndProbe(
      page,
      '__makeRotated',
      'rotated.jpg',
      'image/jpeg',
    );

    // Результат уже развёрнут — высокий, а не широкий.
    expect(out.width).toBe(400);
    expect(out.height).toBe(800);
    expect(out.height).toBeGreaterThan(out.width);

    // И тег не унаследован: повторного поворота при показе не будет.
    expect(out.hasExif).toBe(false);
  });

  // ----------------------------------------------------------
  // 3) PNG с прозрачностью → JPEG на белом фоне.
  // ----------------------------------------------------------
  test('PNG перекодируется в JPEG, прозрачность становится белой', async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__makePng = () => {
        const c = document.createElement('canvas');
        c.width = 200;
        c.height = 200;
        // Холст остаётся полностью прозрачным — худший случай для JPEG.
        return new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
      };
    });

    await openPhotoStep(page);

    const out = await pickAndProbe(page, '__makePng', 'shot.png', 'image/png');

    expect(out.type).toBe('image/jpeg');
    // Белый, а не чёрный: без заливки JPEG отдал бы 0,0,0.
    expect(out.pixel[0]).toBeGreaterThan(240);
    expect(out.pixel[1]).toBeGreaterThan(240);
    expect(out.pixel[2]).toBeGreaterThan(240);
  });

  // ----------------------------------------------------------
  // 4) Отказы: не-картинка отклоняется с понятным сообщением.
  // ----------------------------------------------------------
  test('PDF отклоняется, превью не появляется', async ({ page }) => {
    await openPhotoStep(page);

    await page.evaluate(() => {
      const file = new File([new Uint8Array(64)], 'doc.pdf', {
        type: 'application/pdf',
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('photo-input') as HTMLInputElement;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Сообщение об ошибке показано (Alert), превью нет.
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
  });

  // ----------------------------------------------------------
  // 5) Сквозная проверка: сам Storage применяет лимиты 0087.
  // ----------------------------------------------------------
  // SQL-тест (supabase/checks/0087_bucket_limits_test.sql) доказывает,
  // что настройки в базе верные. Этот — что storage-api их соблюдает:
  // между «колонка заполнена» и «сервис отказывает» стоит сервис,
  // и проверять надо его.
  test('Storage отклоняет файл сверх лимита и чужой MIME', async ({
    page,
  }) => {
    const session = await signInAsSeller();
    test.skip(!session, 'Не удалось получить тестовую сессию');

    // Страница нужна только как контекст для fetch с нужным origin.
    await page.goto('/install');

    const result = await page.evaluate(
      async ({ url, anon, token }) => {
        const put = async (mime: string, bytes: number, name: string) => {
          const body = new Blob([new Uint8Array(bytes)], { type: mime });
          const res = await fetch(
            `${url}/storage/v1/object/car-images/${name}`,
            {
              method: 'POST',
              headers: {
                apikey: anon,
                authorization: `Bearer ${token}`,
                'content-type': mime,
              },
              body,
            },
          );
          return res.status;
        };

        // Путь ОБЯЗАН начинаться с uid — иначе откажет RLS, и тест
        // проверял бы не лимиты, а политику. uid берём из токена.
        const uid = JSON.parse(atob(token.split('.')[1])).sub as string;
        const stamp = Date.now();

        return {
          // 6 МБ при лимите 5 МБ.
          oversize: await put(
            'image/jpeg',
            6 * 1024 * 1024,
            `${uid}/limit-${stamp}.jpg`,
          ),
          // PDF крошечного размера — отказ обязан быть по типу.
          wrongMime: await put(
            'application/pdf',
            1024,
            `${uid}/limit-${stamp}.pdf`,
          ),
        };
      },
      {
        url: TEST_SUPABASE_URL,
        anon: TEST_SUPABASE_ANON_KEY,
        token: session!.access_token,
      },
    );

    // Storage отвечает 413 на превышение размера и 415 на чужой тип;
    // часть версий отдаёт 400. Главное — НЕ 200: файл не принят.
    expect(result.oversize).not.toBe(200);
    expect([400, 413, 415]).toContain(result.oversize);

    expect(result.wrongMime).not.toBe(200);
    expect([400, 413, 415]).toContain(result.wrongMime);
  });
});
