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
// ВАЛИДАЦИЯ на клиенте: тип и размер файла. Она дублирует ограничения
// бакета car-images, но сообщает о проблеме ДО загрузки — иначе
// человек ждёт отправки 12 мегабайт, чтобы получить отказ.
// ============================================================

import { useEffect, useRef, useState } from 'react';

import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

// Разрешённые форматы. HEIC с iPhone намеренно НЕ включён: браузер не
// умеет его показывать, и превью осталось бы пустым квадратом.
// Мобильная камера отдаёт JPEG при выборе через файловый диалог.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// 10 МБ на файл. Снимок современного телефона укладывается с запасом.
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

type Props = {
  locale: Locale;
  files: File[];
  onChange: (files: File[]) => void;
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

  // URL превью. Держим в состоянии, а не вычисляем при рендере:
  // createObjectURL на каждый рендер создавал бы новые ссылки и
  // протекал бы памятью, пока вкладка открыта.
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);

    // Освобождение обязательно: без revokeObjectURL браузер держит
    // выбранные файлы в памяти до перезагрузки страницы.
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  function handlePick(picked: FileList | null) {
    if (!picked) return;
    setError(null);

    const accepted: File[] = [];

    for (const file of Array.from(picked)) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setError(t('sell_err_photo_type'));
        continue;
      }
      if (file.size > MAX_SIZE_BYTES) {
        setError(t('sell_err_photo_size'));
        continue;
      }
      accepted.push(file);
    }

    // Лимит считается от УЖЕ выбранных: пользователь может добавлять
    // фотографии в несколько заходов, и каждый раз обнулять набор
    // было бы неожиданным поведением.
    const room = maxPhotos - files.length;
    if (accepted.length > room) {
      setError(t('sell_err_photos_max'));
    }

    if (room > 0) onChange([...files, ...accepted.slice(0, room)]);

    // Сброс значения поля: без него повторный выбор того же файла
    // не вызовет onChange (значение не изменилось).
    if (inputRef.current) inputRef.current.value = '';
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
        accept={ALLOWED_TYPES.join(',')}
        multiple
        disabled={uploading || files.length >= maxPhotos}
        onChange={(e) => handlePick(e.target.files)}
        className="sr-only"
        id="photo-input"
      />

      <label
        htmlFor="photo-input"
        className={
          'flex h-11 w-full cursor-pointer items-center justify-center rounded-control border border-dashed border-neutral-30 px-4 text-caption font-semibold transition-colors duration-fast ease-out ' +
          (uploading || files.length >= maxPhotos
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
        <p className="mt-2 rounded-control bg-brand-red/10 px-3 py-2 text-caption text-brand-red">
          {error}
        </p>
      )}

      {/* Прогресс загрузки. Показывается на месте сетки превью, когда
          файлы уже уходят на сервер: 15 фотографий по 10 МБ грузятся
          заметное время, и без индикатора это выглядит как зависание. */}
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

      {files.length > 0 && !uploading && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${file.size}-${i}`}
              className="group relative overflow-hidden rounded-control border border-neutral-10"
            >
              {/* aspect-[4/3] — та же пропорция, что у карточки в
                  каталоге: продавец сразу видит, как кадр обрежется. */}
              <div className="relative aspect-[4/3] bg-surface-muted">
                {previews[i] && (
                  // Обычный <img>, а не next/image: это blob-адрес
                  // локального файла, оптимизировать через сервер
                  // Next его нельзя и не нужно.
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
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-pill bg-brand-red text-caption leading-none text-white"
              >
                ×
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
