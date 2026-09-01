'use client';

// ============================================================
// RS AUTO — Баннер о сроке публикации в кабинете.
// ============================================================
// ЗАЧЕМ. Письмо о скором истечении уходит только тому, у кого заполнен
// profiles.email, а вход на площадку по SMS — значит у большинства
// продавцов адреса нет вовсе. Для них кабинет остаётся единственным
// местом, где о сроке вообще можно узнать, и узнать они должны сразу
// при входе, а не долистав до нужной карточки.
//
// Баннер показывается, когда есть хотя бы одно объявление, которое
// истекло или истекает на неделе. В остальное время его нет: постоянно
// висящая плашка перестаёт читаться через два визита.
//
// ПОЧЕМУ КНОПКА ПРОДЛЕВАЕТ ВСЁ СРАЗУ. У салона объявлений десятки, и
// продление по одному — работа, которую никто делать не будет. У
// частника с двумя машинами массовое продление тоже не вредит: RPC
// extend_my_listings трогает только active и expired этого владельца,
// проданное и архивное остаются как были.
//
// Подтверждения нет намеренно: продление возвращает объявления в
// каталог, то есть делает ровно то, чего продавец и хочет. Вопрос
// «вы уверены?» уместен перед разрушительным действием, а не перед
// восстановительным.
// ============================================================

import { useState, useTransition } from 'react';

import { extendAllListings } from '@/app/my/actions';
import Alert from './ui/Alert';
import Button from './ui/Button';
import type { Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n';

type Props = {
  locale: Locale;
  // Сколько объявлений уже скрыто и сколько истекает на неделе.
  // Считает сервер: у него уже есть весь список, и второй запрос ради
  // двух чисел был бы лишним.
  expiredCount: number;
  expiringCount: number;
};

export default function ExpiryBanner({
  locale,
  expiredCount,
  expiringCount,
}: Props) {
  const t = getT(locale);
  const [pending, startTransition] = useTransition();
  // Результат продления: сколько объявлений вернулось в каталог.
  // null — кнопку ещё не нажимали.
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (expiredCount === 0 && expiringCount === 0) return null;

  function onExtendAll() {
    setError(null);
    startTransition(async () => {
      const result = await extendAllListings();
      if (!result.ok) {
        // Текст ошибки от Postgres наружу не показываем: он
        // технический и по-английски.
        setError(t('my_action_error'));
        return;
      }
      setDone(result.count ?? 0);
    });
  }

  // После успешного продления баннер сообщает результат числом:
  // «продлено 12» отвечает на вопрос «сработало ли», а исчезнувшая
  // плашка — нет.
  if (done !== null) {
    return (
      <Alert tone="success">
        {t('my_extend_done').replace('{n}', String(done))}
      </Alert>
    );
  }

  return (
    <Alert tone="warning">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{t('my_expiry_banner')}</span>

        <Button
          size="sm"
          disabled={pending}
          onClick={onExtendAll}
          className="shrink-0"
        >
          {pending ? t('my_action_busy') : t('my_extend_all')}
        </Button>
      </div>

      {error && <div className="mt-2 text-caption">{error}</div>}
    </Alert>
  );
}
