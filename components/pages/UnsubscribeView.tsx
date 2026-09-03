// ============================================================
// RS AUTO — Отписка от писем о новых сообщениях (/unsubscribe).
// ============================================================
// Открывается ПО ССЫЛКЕ ИЗ ПИСЬМА, без авторизации: человек с забитым
// ящиком не станет вспоминать пароль ради отписки — он нажмёт «Спам»,
// а это бьёт по доставляемости всех писем площадки, включая код входа.
// Право на отписку даёт токен из ссылки (миграция 0132).
//
// ОТПИСКА ПРОИСХОДИТ ПО НАЖАТИЮ КНОПКИ, А НЕ ПРИ ОТКРЫТИИ СТРАНИЦЫ.
// Это не лишний шаг ради вежливости: почтовые клиенты и антивирусы
// заранее обходят все ссылки письма, чтобы проверить их на вредоносность.
// Отписка «по переходу» срабатывала бы у сканера — человек продолжал бы
// ждать писем, которые сам не отключал, и не понимал, почему их нет.
// Сканеры кнопок не нажимают.
//
// Клиентский компонент: страница ничего не читает с сервера, только
// вызывает RPC по нажатию. Токен в SSR не передаётся намеренно — он не
// должен попасть в разметку, отдаваемую с сервера, и осесть в кэше
// CDN вместе со страницей.
// ============================================================

'use client';

import { useState } from 'react';

import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import type { Locale } from '@/lib/i18n';
import { getT, localeHref } from '@/lib/i18n';
import { getBrowserClient } from '@/lib/supabaseClient';

type Props = {
  locale: Locale;
  // Токен из query-параметра ?t=. Пустой — ссылку открыли руками или
  // почтовый клиент обрезал адрес.
  token: string;
};

export default function UnsubscribeView({ locale, token }: Props) {
  const t = getT(locale);

  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function confirm() {
    setPending(true);
    setError(false);

    const supabase = getBrowserClient();
    const { error: rpcError } = await supabase.rpc('unsubscribe_by_token', {
      p_token: token,
    });

    setPending(false);

    if (rpcError) {
      setError(true);
      return;
    }

    setDone(true);
  }

  return (
    <>
      <SiteHeader locale={locale} pathname="/unsubscribe" />

      <main className="mx-auto w-full max-w-lg px-4 py-12">
        <Card padding="md">
          <div>
            <h1 className="mb-3 text-h2 font-bold text-neutral-100">
              {done ? t('unsub_done_title') : t('unsub_title')}
            </h1>

            <p className="text-body text-neutral-70">
              {done ? t('unsub_done_lead') : t('unsub_lead')}
            </p>

            {/* Что ОСТАЁТСЯ приходить — говорим на обоих экранах, до и
                после отписки. Иначе человек, отключивший письма о
                сообщениях, воспримет следующее письмо о модерации как
                нарушение своего отказа. */}
            <p className="mt-3 text-small text-neutral-50">
              {t('unsub_keep_note')}
            </p>

            {error ? (
              <p className="mt-4 text-small text-brand-red">
                {t('unsub_error')}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              {done ? (
                <>
                  <Button href={localeHref(locale, '/')} variant="primary">
                    {t('unsub_back')}
                  </Button>
                  {/* Путь назад: настройку можно вернуть в кабинете.
                      Отписка не должна быть дорогой в один конец. */}
                  <Button
                    href={localeHref(locale, '/my/profile')}
                    variant="ghost"
                  >
                    {t('unsub_settings')}
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  onClick={confirm}
                  disabled={pending || !token}
                >
                  {t('unsub_confirm')}
                </Button>
              )}
            </div>
          </div>
        </Card>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
