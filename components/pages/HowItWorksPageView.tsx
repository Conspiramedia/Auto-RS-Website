// ============================================================
// RS AUTO — Содержимое страницы /how-it-works, общее для sr и ru.
// ============================================================
// Три сценария по ролям, каждый — три пронумерованных шага.
// Нумерация здесь смысловая, а не декоративная: посетитель должен
// понять, что произойдёт ПОСЛЕ его действия (подал → модерация →
// сообщения), иначе ожидание проверки выглядит как «объявление
// пропало».
// ============================================================

import Image from 'next/image';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import BackCloseButton from '@/components/BackCloseButton';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { SCENARIOS, SELLER_SCENARIO } from '@/lib/scenarios';
import { buildHowToJsonLd, buildPageJsonLd } from '@/lib/seo';

export default function HowItWorksPageView({ locale }: { locale: Locale }) {
  const t = getT(locale);

  // HowTo размечает ОДИН сценарий — подачу объявления, а не все три.
  // Схема описывает одну процедуру с одной последовательностью шагов;
  // три HowTo на странице (покупатель, продавец, салон) поисковик
  // читает как три конкурирующие инструкции и не показывает ни одной.
  //
  // Выбран сценарий продавца: подача объявления — главная бизнес-цель
  // сайта, и расширенный сниппет со списком шагов нужен именно ей.
  // Шаги берутся из того же SCENARIOS, что рендерится ниже: требование
  // Google — совпадение разметки с видимым текстом.
  // Сам сценарий — из общего модуля: тот же массив рендерит /sell.
  const sellerScenario = SELLER_SCENARIO;

  const howToJsonLd = sellerScenario
    ? buildHowToJsonLd({
        locale,
        path: '/how-it-works',
        name: t(sellerScenario.title),
        description: t('how_meta_desc'),
        steps: sellerScenario.steps.map((step) => ({
          name: t(step.title),
          text: t(step.text),
        })),
      })
    : null;

  const pageJsonLd = buildPageJsonLd({
    type: 'WebPage',
    locale,
    path: '/how-it-works',
    name: t('how_title'),
    description: t('how_meta_desc'),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            howToJsonLd ? [pageJsonLd, howToJsonLd] : [pageJsonLd],
          ),
        }}
      />

      <SiteHeader locale={locale} pathname="/how-it-works" />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {/* Заголовок и крестик в одну строку. Крестик уводит назад -
            на эти страницы приходят из бургер-меню с любого раздела,
            и возврат по истории точнее любого фиксированного адреса.
            items-start: заголовок на узком экране занимает две строки,
            и крестик обязан остаться у верхнего края.
            -mr-2 втягивает область 40px в поле бокового отступа. */}
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-h2 font-bold sm:text-h1">{t('how_title')}</h1>
          <BackCloseButton locale={locale} className="-mr-2 shrink-0" />
        </div>
        <p className="mt-3 text-h4 text-neutral-60">{t('how_lead')}</p>

        {/* СЪЁМКА АВТО НА ТЕЛЕФОН — ПОД ЛИДОМ.
            ------------------------------------------------------------
            Страница — четыре сценария подряд, каждый из трёх шагов
            текстом. Без иллюстрации она читается как инструкция к
            прибору, хотя объясняет простое действие: сфотографировал
            машину, заполнил форму, получил сообщения.

            Кадр отвечает первому и главному сценарию — подаче
            объявления, — и стоит до того, как начнётся перечисление
            ролей: ниже он иллюстрировал бы уже конкретный сценарий и
            спорил бы с остальными тремя.

            priority не ставится: выше стоят заголовок и лид, ранняя
            загрузка отняла бы полосу у них. Область зарезервирована
            через aspect + fill — подгрузка не сдвигает шаги под
            картинкой.

            Пропорции 16/10 на узком экране и 21/9 с sm: страница
            max-w-3xl, и высокий кадр во всю её ширину отодвинул бы
            первый сценарий за сгиб.

            Пустой alt: изображение декоративное, смысл несут лид над
            ним и шаги под ним. */}
        <div className="relative mt-6 aspect-[16/10] overflow-hidden rounded-card sm:aspect-[21/9]">
          <Image
            src="/images/how-photo-phone.webp"
            alt=""
            fill
            sizes="(max-width: 639px) calc(100vw - 2rem), 48rem"
            className="object-cover"
          />
        </div>

        {SCENARIOS.map((scenario) => (
          <section key={scenario.title} className="mt-10">
            <h2 className="text-h3 font-semibold">{t(scenario.title)}</h2>

            <ol className="mt-4 space-y-4">
              {scenario.steps.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  {/* Номер шага в круге. shrink-0 обязателен: без него
                      круг сжимается в овал, когда текст шага длинный.

                      СВЕТЛАЯ ЗАЛИВКА С ТЁМНОЙ ЦИФРОЙ — тот же рисунок,
                      что у шагов установки на /install. Раньше круги
                      были тёмными (brand-dark) и читались как
                      служебные метки; заливку цветом бренда пробовать
                      незачем — номер шага это ориентир, а не действие,
                      и цветное пятно рядом с каждым заголовком спорит
                      с настоящими акцентами страницы.

                      Размер оставлен 32px, а не 24px как в /install:
                      там плотный список внутри карточки, здесь — шаги
                      с заголовком и абзацем текста. */}
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-surface-muted text-caption font-bold text-neutral-100"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div>
                    {/* Номер дублируется текстом для скринридера:
                        визуальный кружок от него скрыт (aria-hidden). */}
                    <h3 className="font-semibold">
                      <span className="sr-only">
                        {t('how_step')} {i + 1}:{' '}
                      </span>
                      {t(step.title)}
                    </h3>
                    <p className="mt-1 leading-relaxed text-neutral-75">
                      {t(step.text)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {/* КНОПКА ВО ВСЮ ШИРИНУ ДО sm. На узком экране подписи у
                сценариев разной длины («Все автомобили», «Сдать
                автомобиль», «Оставить заявку»), и кнопки по размеру
                текста вставали лесенкой у левого края — четыре
                сценария подряд превращали страницу в рваный столбец.
                Во всю ширину они выравниваются между собой, а текст
                внутри и так по центру (justify-center в базовых
                классах Button).

                С sm ширина возвращается к содержимому: там кнопка
                стоит в потоке текста колонки, и растянутая на 768px
                читалась бы как поле, а не как действие. */}
            <div className="mt-5">
              <Button
                variant={scenario.ctaPrimary ? 'primary' : 'secondary'}
                href={localeHref(locale, scenario.ctaPath)}
                className="w-full sm:w-auto"
              >
                {t(scenario.ctaLabel)}
              </Button>
            </div>
          </section>
        ))}

        <Card className="mt-10 text-center">
          <h2 className="text-h3 font-semibold">{t('faq_more_title')}</h2>
          <p className="mt-2 text-neutral-60">{t('faq_more_text')}</p>
          {/* grid, а НЕ inline-grid. С inline-grid контейнер сжимался
              по содержимому, и [&>*]:w-full растягивал кнопки лишь до
              ширины самой длинной подписи — на узком экране они стояли
              двумя одинаковыми, но узкими прямоугольниками посреди
              карточки. Блочный grid занимает всю ширину, и кнопки
              растягиваются вместе с ним, как в сценариях выше.

              С sm раскладка прежняя: ряд по содержимому, по центру
              карточки. */}
          <div className="mt-5 grid grid-cols-1 gap-3 [&>*]:w-full sm:[&>*]:w-auto sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
            <Button variant="secondary" href={localeHref(locale, '/faq')}>
              {t('nav_faq')}
            </Button>
            <Button variant="secondary" href={localeHref(locale, '/contact')}>
              {t('nav_contact')}
            </Button>
          </div>
        </Card>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
