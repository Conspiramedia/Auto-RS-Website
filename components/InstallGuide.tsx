'use client';

// ============================================================
// RS AUTO — Две карточки инструкции по установке с подсветкой
// платформы посетителя.
// ============================================================
// Client Component по одной причине: платформу видно только в браузере
// (navigator.userAgent). Сам текст инструкции статичен и мог бы жить
// в серверном компоненте — но тогда подсветка «ваше устройство»
// требовала бы второго дерева и дублирования разметки.
//
// ПОЧЕМУ ОБЕ КАРТОЧКИ ВСЕГДА НА СТРАНИЦЕ, а не только своя. Определение
// по userAgent ошибается: iPad с iPadOS 13+ по умолчанию представляется
// Mac'ом, а десктопный Chrome с включённой эмуляцией — телефоном. Если
// показывать только «свою» карточку, человек с неверно опознанным
// устройством не увидит нужную инструкцию вовсе и упрётся в тупик.
// Подсветка — подсказка, а не фильтр: вторая инструкция остаётся
// доступной всегда.
//
// ПОРЯДОК КАРТОЧЕК тоже зависит от платформы: своя поднимается наверх.
// На телефоне карточки идут одна под другой, и нужная не должна
// требовать прокрутки.
//
// ГИДРАТАЦИЯ. Первый рендер — и на сервере, и в браузере — идёт с
// platform === null: без подсветки и в исходном порядке. Определение
// происходит в useEffect, то есть ПОСЛЕ сверки разметки. Считать
// userAgent прямо в теле компонента нельзя — сервер и клиент выдали бы
// разное дерево, и React ругался бы на несовпадение.
// ============================================================

import { useEffect, useState } from 'react';

import Badge from './ui/Badge';
import Card from './ui/Card';
import {
  AddToHomeIcon,
  AndroidIcon,
  AppleIcon,
  BrowserIcon,
  CheckIcon,
  DotsIcon,
  InstallIcon,
  ShareIcon,
} from './ui/InstallIcons';
import type { DictKey, Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

type Platform = 'android' | 'ios';

// Описание карточки: логотип платформы, заголовок и шаги со своими
// значками. Таблицей, а не разметкой по месту: две карточки отличаются
// только содержимым, и копия разметки разъехалась бы при первой правке.
const PLATFORMS: {
  id: Platform;
  logo: (p: { className?: string }) => React.ReactElement;
  title: DictKey;
  steps: { text: DictKey; icon: (p: { className?: string }) => React.ReactElement }[];
}[] = [
  {
    id: 'android',
    logo: AndroidIcon,
    title: 'install_android_title',
    steps: [
      { text: 'install_android_1', icon: BrowserIcon },
      { text: 'install_android_2', icon: DotsIcon },
      { text: 'install_android_3', icon: InstallIcon },
      { text: 'install_android_4', icon: CheckIcon },
    ],
  },
  {
    id: 'ios',
    logo: AppleIcon,
    title: 'install_ios_title',
    steps: [
      { text: 'install_ios_1', icon: BrowserIcon },
      { text: 'install_ios_2', icon: ShareIcon },
      { text: 'install_ios_3', icon: AddToHomeIcon },
      { text: 'install_ios_4', icon: CheckIcon },
    ],
  },
];

export default function InstallGuide({ locale }: { locale: Locale }) {
  const t = getT(locale);

  // null — платформа ещё не определена (первый рендер и десктоп).
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;

    // iPad на iPadOS 13+ выдаёт себя за Mac, и отличить его можно
    // только по наличию касаний: у настоящего Mac maxTouchPoints = 0.
    const isIPadOS =
      /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number'
        ? navigator.maxTouchPoints > 1
        : false;

    if (/iPhone|iPad|iPod/.test(ua) || isIPadOS) {
      setPlatform('ios');
      return;
    }

    if (/Android/.test(ua)) setPlatform('android');
    // Десктоп остаётся с null: подсвечивать там нечего — инструкция
    // про телефон, и «ваше устройство» на ноутбуке было бы неправдой.
  }, []);

  // Своя карточка — первой. При platform === null порядок исходный.
  const ordered = platform
    ? [...PLATFORMS].sort((a, b) =>
        a.id === platform ? -1 : b.id === platform ? 1 : 0,
      )
    : PLATFORMS;

  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      {ordered.map((p) => {
        const mine = p.id === platform;

        return (
          <Card
            key={p.id}
            // Своя карточка обведена брендовым синим вместо серой
            // границы. Толщина та же (1px): рамка в 2px сдвигала бы
            // содержимое на пиксель относительно соседней карточки.
            className={mine ? 'border-brand-primary' : ''}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="flex items-center gap-2.5 text-h4 font-semibold">
                <p.logo className="h-5 w-5 shrink-0 text-brand-dark" />
                {t(p.title)}
              </h2>

              {mine && (
                <Badge tone="info-soft" size="sm">
                  {t('install_your_device')}
                </Badge>
              )}
            </div>

            <ol className="mt-4 space-y-4">
              {p.steps.map((step, i) => (
                <li key={step.text} className="flex items-start gap-3">
                  {/* Номер шага. Круг светлый, а не тёмный: рядом стоит
                      синий значок действия, и два тяжёлых пятна в одной
                      строке спорили бы между собой. Номер здесь —
                      порядок, а значок — смысл шага. */}
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-surface-muted text-small font-semibold text-neutral-60"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>

                  {/* Значок шага — брендовым синим: он подсказывает, что
                      искать в интерфейсе браузера (три точки, «Поделиться»,
                      плюс), и должен быть заметнее номера. */}
                  <step.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-primary" />

                  <p className="leading-relaxed text-neutral-75">
                    {/* Номер продублирован текстом для скринридера:
                        визуальный кружок от него скрыт (aria-hidden). */}
                    <span className="sr-only">
                      {t('install_step')} {i + 1}:{' '}
                    </span>
                    {t(step.text)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        );
      })}
    </div>
  );
}
