'use client';

// ============================================================
// RS AUTO — Инструкция по установке (/install). Оформление
// повторяет экран установки приложения Baza один в один.
// ============================================================
// Client Component по одной причине: платформу видно только в браузере
// (navigator.userAgent). Сам текст инструкции статичен.
//
// ИСТОЧНИК ОФОРМЛЕНИЯ — install_app_screen.dart приложения Baza.
// Перенесены ровно те величины, что заданы там: кегли 15/14/13/11,
// радиус карточки 16px, рамка активной платформы 1.5px акцентным
// цветом, плашка «ваше устройство» на подложке акцента 12%, кружок
// номера 24px, значок действия 20px, логотип платформы 20px, отступы
// карточки 16/14/16/14 и шага — 6px по вертикали.
//
// ЧТО ОТЛИЧАЕТСЯ ОТ BAZA — и почему:
//   * цвета берутся из наших токенов (brand-primary #1565C0 вместо
//     #185FA5, шкала neutral вместо ink/inkSoft). Палитра проекта своя,
//     копировать чужой синий значило бы нарушить дизайн-систему;
//   * логотипы платформ — наши SVG вместо Icons.apple / Icons.android;
//   * кегли 15px и 13px заданы точными значениями в квадратных
//     скобках: в нашей шкале таких ступеней нет (есть 14 и 16), а
//     задача — повторить размеры точь-в-точь.
//
// ПОЧЕМУ ОБЕ КАРТОЧКИ ВСЕГДА НА СТРАНИЦЕ. Так же, как в приложении:
// определение по userAgent ошибается (iPad на iPadOS 13+ выдаёт себя
// за Mac), и показывать только «свою» значило бы оставить неверно
// опознанного человека без нужной инструкции.
//
// ГИДРАТАЦИЯ. Первый рендер и на сервере, и в браузере идёт с
// platform === null. Определение — в useEffect, то есть ПОСЛЕ сверки
// разметки: иначе деревья разошлись бы и React сломал бы страницу.
// ============================================================

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

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
type IconComponent = (p: { className?: string }) => ReactNode;

// ------------------------------------------------------------
// Разбор строки шага: **фрагмент** → полужирный.
// ------------------------------------------------------------
// В приложении жирные куски вынесены отдельными ключами ARB и
// собираются в TextSpan. Здесь маркер стоит прямо в строке словаря:
// переводчику так виднее контекст, а результат тот же.
//
// split с группой в скобках оставляет содержимое групп в массиве,
// поэтому нечётные элементы — это текст между звёздочками.
function renderBold(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-bold">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

const PLATFORMS: {
  id: Platform;
  logo: IconComponent;
  title: DictKey;
  steps: { text: DictKey; icon: IconComponent }[];
}[] = [
  // iOS первой — как в приложении: там карточка Safari стоит выше,
  // когда платформа не определена.
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
];

export default function InstallGuide({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();

    if (/iphone|ipad|ipod/.test(ua)) {
      setPlatform('ios');
      return;
    }

    // iPad на iPadOS 13+ выдаёт себя за Macintosh, но имеет тач-экран.
    // Условие то же, что в install_platform_web.dart приложения.
    if (ua.includes('macintosh') && navigator.maxTouchPoints > 0) {
      setPlatform('ios');
      return;
    }

    if (ua.includes('android')) setPlatform('android');
    // Десктоп остаётся с null — показываем обе карточки без подсветки.
  }, []);

  // Своя платформа поднимается наверх. При null порядок исходный.
  const ordered = platform
    ? [...PLATFORMS].sort((a, b) =>
        a.id === platform ? -1 : b.id === platform ? 1 : 0,
      )
    : PLATFORMS;

  return (
    <>
      {/* ---------- Вводный блок ---------- */}
      {/* Отдельная карточка над инструкциями — как _Intro в приложении:
          значок акцентом 22px, заголовок 15px/600, текст 14px с
          межстрочным 1.4. */}
      <div className="mt-6 rounded-card border border-neutral-10 bg-white p-4">
        <div className="flex items-center gap-2.5">
          <AddToHomeIcon className="h-[22px] w-[22px] shrink-0 text-brand-primary" />
          <h2 className="text-[15px] font-semibold leading-tight text-neutral-100">
            {t('install_intro_title')}
          </h2>
        </div>
        <p className="mt-2.5 text-[14px] leading-[1.4] text-neutral-60">
          {t('install_intro_body')}
        </p>
      </div>

      {/* ---------- Карточки платформ ---------- */}
      {/* Между карточками 12px, как в приложении (SizedBox height: 12).
          На широком экране — две колонки: инструкции независимы, и
          пустая половина страницы на десктопе ничем не оправдана. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {ordered.map((p) => {
          const mine = p.id === platform;

          return (
            <div
              key={p.id}
              className={[
                'rounded-card bg-white',
                // Рамка активной платформы — 1.5px акцентным цветом,
                // как в приложении. Задана точным значением: у Tailwind
                // между border (1px) и border-2 промежутка нет.
                mine
                  ? 'border-[1.5px] border-brand-primary'
                  : 'border border-neutral-10',
              ].join(' ')}
            >
              {/* Заголовок платформы: отступы 16/14/16/6, как в
                  _PlatformCard. flex-wrap — на узком экране плашка
                  «ваше устройство» уходит на вторую строку, а не жмёт
                  заголовок. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 pb-1.5 pt-3.5">
                <p.logo className="h-5 w-5 shrink-0 text-neutral-100" />
                <h2 className="text-[15px] font-bold text-neutral-100">
                  {t(p.title)}
                </h2>

                {mine && (
                  // Плашка: 11px/600, подложка акцента 12%, полное
                  // скругление, отступы 8×2 — значения из приложения.
                  <span className="rounded-pill bg-brand-primary/[0.12] px-2 py-0.5 text-[11px] font-semibold text-brand-primary">
                    {t('install_your_device')}
                  </span>
                )}
              </div>

              {/* Шаги: отступы 16/4/16/14. */}
              <ol className="px-4 pb-3.5 pt-1">
                {p.steps.map((step, i) => (
                  // По 6px сверху и снизу у каждого шага — как
                  // EdgeInsets.symmetric(vertical: 6) в приложении.
                  <li key={step.text} className="flex items-start py-1.5">
                    {/* Кружок номера: 24px, светлая заливка,
                        цифра 13px/700. */}
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-surface-muted text-[13px] font-bold text-neutral-100"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>

                    {/* Значок действия: 20px, акцентный цвет, 12px от
                        кружка и 10px до текста — как в приложении. */}
                    <step.icon className="ml-3 mt-0.5 h-5 w-5 shrink-0 text-brand-primary" />

                    <p className="ml-2.5 pt-px text-[14px] leading-[1.35] text-neutral-100">
                      {/* Номер продублирован для скринридера: кружок
                          от него скрыт (aria-hidden). */}
                      <span className="sr-only">
                        {t('install_step')} {i + 1}:{' '}
                      </span>
                      {renderBold(t(step.text))}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </>
  );
}
