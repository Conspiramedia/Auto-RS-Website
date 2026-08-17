'use client';

// ============================================================
// RS AUTO — Аварийный экран: падение самого корневого layout.
// ============================================================
// Срабатывает только тогда, когда сломался app/layout.tsx — то есть
// когда обычный error.tsx отрисовать уже негде. Поэтому файл ОБЯЗАН
// содержать собственные <html> и <body>: он подменяет корневую
// разметку, а не встраивается в неё.
//
// ПОЧЕМУ ЗДЕСЬ НЕТ СЛОВАРЯ И ШРИФТА БРЕНДА.
// Локаль на сайте определяется префиксом пути, который разбирают
// страницы и layout'ы. В этой точке ни layout, ни роутинг не отработали,
// и надёжно узнать язык неоткуда. Показывать сербский текст русскому
// пользователю (или наоборот) на аварийном экране хуже, чем показать
// обе строки сразу — их две, они короткие, и любой посетитель найдёт
// свою. Шрифт Montserrat подключается в упавшем layout, поэтому здесь
// используется системный стек.
//
// Цвета всё равно берутся из lib/brand.ts: правило проекта — брендовые
// константы не хардкодятся даже в аварийной разметке. Tailwind здесь
// не применяется (globals.css грузит тот же упавший layout), поэтому
// стили заданы инлайном — это единственное место в проекте, где так.
// ============================================================

import { useEffect } from 'react';

import { brand } from '@/lib/brand';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[RS Auto] Критическая ошибка: не отрисован корневой layout', {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    // lang="sr-Latn" — язык по умолчанию: сербское зеркало живёт в корне
    // сайта. Атрибут обязателен для валидности документа.
    <html lang="sr-Latn">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: brand.spacing.lg,
          textAlign: 'center',
          background: brand.colors.bg,
          color: brand.colors.dark,
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: brand.colors.primary,
          }}
        >
          {brand.name}
        </div>

        {/* Обе локали сразу — по причине, описанной в шапке файла. */}
        <h1 style={{ marginTop: brand.spacing.md, fontSize: 22 }}>
          Nešto je pošlo naopako
        </h1>
        <p style={{ margin: 0, opacity: 0.6, fontSize: 15 }}>
          Что-то пошло не так
        </p>

        <div
          style={{
            marginTop: brand.spacing.lg,
            display: 'flex',
            gap: brand.spacing.sm,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <button
            type="button"
            onClick={reset}
            style={{
              border: 'none',
              cursor: 'pointer',
              borderRadius: brand.radius.control,
              background: brand.colors.green,
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: 15,
              padding: `${brand.spacing.sm} ${brand.spacing.lg}`,
            }}
          >
            Pokušaj ponovo
          </button>

          <a
            href="/cars"
            style={{
              borderRadius: brand.radius.control,
              border: '1px solid rgba(0,0,0,0.15)',
              color: 'inherit',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 15,
              padding: `${brand.spacing.sm} ${brand.spacing.lg}`,
            }}
          >
            Idi na katalog
          </a>
        </div>
      </body>
    </html>
  );
}
