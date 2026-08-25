'use client';

// ============================================================
// RS AUTO — Выбор и упорядочивание фотографий объявления.
// ============================================================
// Раньше шаг «Фотографии» состоял из голого <input type="file"> и
// счётчика «n / 15». Продавец не видел, что именно выбрал, не мог
// убрать неудачный кадр и не управлял порядком — а первая фотография
// становится обложкой объявления в каталоге.
//
// ПОРЯДОК КАДРОВ = order_index в car_images. Первый элемент списка
// уходит в базу с order_index 0 и показывается в выдаче, поэтому
// перестановка здесь напрямую влияет на то, как объявление выглядит
// в каталоге.
//
// ПОЧЕМУ СТРЕЛКИ, А НЕ DRAG-AND-DROP: перетаскивание на мобильном
// конфликтует с прокруткой страницы (тач-события приходится
// перехватывать), а подача объявления — сценарий преимущественно
// мобильный. Две кнопки работают одинаково везде и доступны
// с клавиатуры.
//
// ПЕРЕЖАТИЕ ПРИ ВЫБОРЕ. Каждый файл проходит через
// preparePhoto (lib/imagePrepare.ts) СРАЗУ ПОСЛЕ выбора, а не
// перед отправкой: длинная сторона до 1600px, JPEG 0.82,
// EXIF-поворот применён однократно — тот же конвейер, что
// у image_picker в приложении.
//
// ПОЧЕМУ ПРИ ВЫБОРЕ, А НЕ ПРИ ОТПРАВКЕ. Превью тогда
// показывает РОВНО то, что уйдёт в хранилище: если снимок
// повернулся по EXIF или потерял в качестве, это видно сразу,
// а не после публикации. И ошибка формата (HEIC вне Safari)
// приходит до того, как человек заполнил всю форму.
//
// ВАЛИДАЦИЯ на клиенте: тип и размер файла. Она дублирует
// ограничения бакета car-images (миграция 0087: allowed_mime_types
// и file_size_limit), но сообщает о проблеме ДО загрузки — иначе
// человек ждёт отправки 12 мегабайт, чтобы получить отказ.
// Серверный предел при этом НЕ единственный рубеж: клиентские
// проверки обходятся прямым вызовом Storage API.
//
// ------------------------------------------------------------
// ДВА ВИДА ФОТОГРАФИЙ В ОДНОМ НАБОРЕ
// ------------------------------------------------------------
// При подаче объявления все снимки новые — это File из файлового
// диалога. При РЕДАКТИРОВАНИИ к ним добавляются уже загруженные: они
// живут в бакете и известны только по URL, файла на устройстве нет.
//
// Оба вида лежат в одном списке (тип PhotoItem) и выглядят одинаково:
// продавец не должен думать, какое фото «старое», а какое «новое», —
// он просто расставляет их в нужном порядке и удаляет лишние. Порядок
// в списке становится order_index в car_images, первый элемент —
// обложка объявления в каталоге.
//
// Разница проявляется только при сохранении: новые файлы сначала
// уходят в хранилище, существующие берутся по готовому URL
// (см. SellForm, сборка photoUrls).
// ============================================================

import { useEffect, useRef, useState } from 'react';

import Alert from './ui/Alert';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import {
  ACCEPT_ATTR,
  PhotoPrepareError,
  preparePhoto,
} from '@/lib/imagePrepare';

// Один снимок в наборе: либо выбранный на устройстве файл, либо уже
// загруженное фото объявления, известное по адресу.
export type PhotoItem =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string };

// Ключ для React и для сравнения наборов. У файла — имя с размером
// (двух одинаковых снимков подряд не бывает), у существующего — URL.
export function photoKey(item: PhotoItem): string {
  return item.kind === 'file'
    ? `${item.file.name}-${item.file.size}`
    : item.url;
}

type Props = {
  locale: Locale;
  files: PhotoItem[];
  onChange: (files: PhotoItem[]) => void;
  maxPhotos: number;
  // Идёт загрузка на сервер: пока она идёт, менять набор нельзя.
  uploading?: boolean;
  // Прогресс загрузки 0..100. Показывается только при uploading.
  progress?: number;
};

export default function PhotoPicker({
  locale,
  files,
  onChange,
  maxPhotos,
  uploading = false,
  progress = 0,
}: Props) {
  const t = getT(locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Идёт пережатие выбранных файлов. Отдельно от uploading: это разные
  // фазы с разной причиной ожидания. Пережатие занимает доли секунды на
  // снимок, но десять снимков на слабом телефоне — уже несколько секунд
  // молчания сразу после закрытия файлового диалога, и без индикатора
  // это выглядит как «кнопка не сработала».
  const [preparing, setPreparing] = useState(false);

  // URL превью. Держим в состоянии, а не вычисляем при рендере:
  // createObjectURL на каждый рендер создавал бы новые ссылки и
  // протекал бы памятью, пока вкладка открыта.
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    // Временные ссылки нужны только локальным файлам; у существующих
    // фотографий адрес уже есть, и создавать для них blob нечего.
    const created: string[] = [];

    const urls = files.map((item) => {
      if (item.kind === 'url') return item.url;
      const objectUrl = URL.createObjectURL(item.file);
      created.push(objectUrl);
      return objectUrl;
    });

    setPreviews(urls);

    // Освобождение обязательно: без revokeObjectURL браузер держит
    // выбранные файлы в памяти до перезагрузки страницы. Освобождаем
    // ТОЛЬКО созданные здесь ссылки — отзыв чужого URL сломал бы
    // показ уже загруженного фото.
    return () => {
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  // Сообщение по причине отказа. Отдельной функцией, а не цепочкой
  // тернарников в обработчике: причин четыре, и каждая ведёт
  // к своему действию пользователя.
  function messageFor(reason: PhotoPrepareError['reason']): string {
    switch (reason) {
      case 'type':
        return t('sell_err_photo_type');
      case 'size':
        return t('sell_err_photo_size');
      case 'heic':
        return t('sell_err_photo_heic');
      default:
        return t('sell_err_photo_decode');
    }
  }

  async function handlePick(picked: FileList | null) {
    if (!picked) return;
    setError(null);

    // Лимит считается от УЖЕ выбранных: пользователь может добавлять
    // фотографии в несколько заходов, и каждый раз обнулять набор
    // было бы неожиданным поведением.
    const room = maxPhotos - files.length;
    const chosen = Array.from(picked);

    if (chosen.length > room) {
      setError(t('sell_err_photos_max'));
    }
    if (room <= 0) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    // Сброс значения поля ДО await: без него повторный выбор того
    // же файла не вызовет onChange (значение не изменилось). После await
    // элемент мог бы уже уйти из дерева.
    if (inputRef.current) inputRef.current.value = '';

    setPreparing(true);
    try {
      // Пережатие ПОСЛЕДОВАТЕЛЬНОЕ, в отличие от загрузки в SellForm.
      // Каждый файл держит декодированный битмап вне кучи JS
      // (для 6000×4000 это ~96 МБ), и три таких параллельно уронили бы
      // вкладку на телефоне. Сеть здесь не задействована — выигрыша
      // от параллелизма всё равно не было бы.
      const prepared: PhotoItem[] = [];
      let firstError: string | null = null;

      for (const file of chosen.slice(0, room)) {
        try {
          prepared.push({ kind: 'file', file: await preparePhoto(file) });
        } catch (e) {
          // Один бракованный файл не отменяет остальные: человек
          // выбрал десять снимков, и терять девять из-за одного
          // HEIC было бы грубо. Показываем ПЕРВУЮ причину:
          // при выборе пачкой они почти всегда одной природы.
          const reason =
            e instanceof PhotoPrepareError ? e.reason : ('decode' as const);
          firstError ??= messageFor(reason);
        }
      }

      if (firstError) setError(firstError);
      if (prepared.length > 0) onChange([...files, ...prepared]);
    } finally {
      setPreparing(false);
    }
  }

  function remove(index: number) {
    onChange(files.filter((_, i) => i !== index));
    setError(null);
  }

  // Перестановка соседних элементов. Границы проверяются здесь, а не
  // только disabled на кнопке: клавиатурный вызов должен быть безопасен.
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= files.length) return;

    const next = [...files];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div>
      {/* Кнопка выбора. Само поле скрыто: системный вид <input type=file>
          не поддаётся стилизации и выбивается из остальных контролов. */}
      <input
        ref={inputRef}
        type="file"
        // image/*, а не перечень MIME: часть галерей Android при жёстком
        // списке не показывает вообще ничего. Расширения .heic/.heif
        // дописаны для iOS — там HEIC мимо image/* проходит не всегда.
        accept={ACCEPT_ATTR}
        multiple
        disabled={uploading || preparing || files.length >= maxPhotos}
        onChange={(e) => void handlePick(e.target.files)}
        className="sr-only"
        id="photo-input"
      />

      <label
        htmlFor="photo-input"
        className={
          'flex h-11 w-full cursor-pointer items-center justify-center rounded-control border border-dashed border-neutral-30 px-4 text-caption font-semibold transition-colors duration-fast ease-out ' +
          (uploading || preparing || files.length >= maxPhotos
            ? 'cursor-not-allowed text-neutral-30'
            : 'text-neutral-60 hover:border-brand-primary hover:text-brand-primary')
        }
      >
        {t('sell_photos_add')}
      </label>

      <p className="mt-2 text-small text-neutral-50">
        {t('sell_photos_hint')} · {files.length} / {maxPhotos}
      </p>

      {error && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}

      {/* Пережатие выбранных файлов. Без процентов: фаза короткая, и
          счётчик успевал бы только мигнуть. */}
      {preparing && (
        <p className="mt-2 text-caption text-neutral-60">
          {t('sell_photos_preparing')}
        </p>
      )}

      {/* Прогресс загрузки. Показывается на месте сетки превью, когда
          файлы уже уходят на сервер. После пережатия снимок весит
          сотни килобайт вместо десятка мегабайт, но на слабой сети
          пятнадцать таких файлов всё равно идут заметное время. */}
      {uploading && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-caption text-neutral-60">
            <span>{t('sell_photos_uploading')}</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-pill bg-surface-muted">
            <div
              className="h-full rounded-pill bg-brand-green transition-[width] duration-normal ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {files.length > 0 && !uploading && !preparing && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {files.map((item, i) => (
            <div
              key={`${photoKey(item)}-${i}`}
              className="group relative overflow-hidden rounded-control border border-neutral-10"
            >
              {/* aspect-[4/3] — та же пропорция, что у карточки в
                  каталоге: продавец сразу видит, как кадр обрежется. */}
              <div className="relative aspect-[4/3] bg-surface-muted">
                {previews[i] && (
                  // Обычный <img>, а не next/image: это blob-адрес
                  // локального файла, оптимизировать через сервер
                  // Next его нельзя и не нужно.
                  //
                  // Показывается УЖЕ ПЕРЕЖАТЫЙ файл (preparePhoto
                  // отработал при выборе), поэтому превью совпадает
                  // с тем, что ляжет в хранилище, — включая применённый
                  // EXIF-поворот.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previews[i]}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>

              {/* Пометка обложки: первая фотография попадает в каталог. */}
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded-sm bg-brand-dark px-1.5 py-0.5 text-small font-semibold text-white">
                  {t('sell_photos_cover')}
                </span>
              )}

              {/* Удаление. Всегда видно на мобильном (там нет наведения). */}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={t('sell_photos_remove')}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-pill bg-brand-red text-white"
              >
                {/* Знак — inline-SVG по той же причине, что в CloseButton:
                    у текстового «×» метрики зависят от шрифта, и в круге
                    24px он вставал заметно выше центра. Сам CloseButton
                    сюда не подходит — у него область 40px, а значок
                    прижат к углу миниатюры и должен остаться мелким. */}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>

              {/* Перестановка. Крайние кнопки отключены на границах. */}
              <div className="flex border-t border-neutral-10">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={t('sell_photos_move_left')}
                  className="flex-1 py-1.5 text-caption text-neutral-60 transition-colors duration-fast ease-out hover:bg-surface-hover disabled:text-neutral-30 disabled:hover:bg-transparent"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === files.length - 1}
                  aria-label={t('sell_photos_move_right')}
                  className="flex-1 border-l border-neutral-10 py-1.5 text-caption text-neutral-60 transition-colors duration-fast ease-out hover:bg-surface-hover disabled:text-neutral-30 disabled:hover:bg-transparent"
                >
                  →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
