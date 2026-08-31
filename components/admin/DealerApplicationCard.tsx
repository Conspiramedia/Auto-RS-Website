'use client';

// ============================================================
// RS AUTO — Карточка заявки на статус автосалона. Client Component.
// ============================================================
// РЕШЕНИЕ ЗДЕСЬ ДОРОЖЕ, ЧЕМ В ОСТАЛЬНОЙ АДМИНКЕ. Одобрение не
// помечает строку в таблице — оно ВЫДАЁТ ПРАВА: заявитель становится
// автосалоном, получает витрину в каталоге, страницу /dealer/{id} и
// отметку «Автосалон» на объявлениях. Площадка от своего имени
// подтверждает покупателю, что за объявлениями стоит
// зарегистрированная компания.
//
// Отсюда две особенности разметки:
//
//   1) РЕКВИЗИТЫ СТОЯТ НА ВИДУ, а не прячутся во всплывающее окно.
//      PIB и матични број — то единственное, что администратор
//      обязан проверить по реестру APR перед нажатием, и прятать их
//      за лишний клик значило бы поощрять одобрение не глядя.
//      PIB выделен моноширинным начертанием: девять цифр подряд
//      сверяются посимвольно, и пропорциональный шрифт для этого
//      неудобен.
//   2) ОБА РЕШЕНИЯ ТРЕБУЮТ ПОДТВЕРЖДЕНИЯ — и одобрение тоже, в
//      отличие от одобрения объявления в очереди модерации. Там
//      ошибка стоит одного лишнего объявления в выдаче и снимается
//      кнопкой на его карточке; здесь она выдаёт статус компании,
//      которую никто не проверял, и заметят это в лучшем случае по
//      жалобе покупателя.
//
// Отказ идёт через тот же диалог с причиной, что у отклонения
// объявления и блокировки салона: те же границы 10–1000 символов,
// тот же счётчик. Причину читает заявитель в своём кабинете, поэтому
// «нет» и «не подходит» здесь недостаточно.
// ============================================================

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import {
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
} from '@/lib/admin/rejectionReasons';
import { reviewDealerApplication } from '@/app/admin/actions';
import { useDismissableLayer } from '@/lib/useDismissableLayer';
import type { AdminDealerApplication } from '@/lib/types';

// Дата с временем: по заявке звонят, и «вчера в 19:40» объясняет, что
// человек подал её вечером и ждёт ответа утром. Тот же формат, что в
// списке лидов.
const DATE = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

// Заглушка реквизитов у заявок, заведённых миграцией 0100 задним
// числом действующим салонам. Настоящих PIB и матични број у площадки
// на тот момент не было, выдумывать их нельзя, а колонки требуют
// значения — поэтому нули. Карточка обязана назвать это прямо, иначе
// «000000000» читается как проверенный номер.
const PLACEHOLDER_TAX_ID = '000000000';

type Props = {
  application: AdminDealerApplication;
};

export default function DealerApplicationCard({ application }: Props) {
  const router = useRouter();

  // Открытый диалог: 'reject' — отказ с причиной, 'approve' —
  // подтверждение одобрения, null — закрыт.
  const [dialog, setDialog] = useState<'reject' | 'approve' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useDismissableLayer({
    open: dialog !== null,
    onClose: () => setDialog(null),
    locked: busy,
  });

  useEffect(() => {
    if (dialog === 'reject') inputRef.current?.focus();
  }, [dialog]);

  const trimmed = reason.trim();
  const canReject = trimmed.length >= REASON_MIN_LENGTH && !busy;

  const pending = application.status === 'pending';
  const isPlaceholder = application.tax_id === PLACEHOLDER_TAX_ID;

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);

    const result = await reviewDealerApplication(
      application.id,
      approve,
      approve ? undefined : trimmed,
    );

    setBusy(false);

    if (result.ok) {
      setDialog(null);
      setReason('');
      // Список перерисовывается ответом сервера: revalidatePath в
      // действии уже пометил маршрут устаревшим, refresh забирает
      // свежую разметку. Локально состояние карточки не правим —
      // показывать «одобрено» по своей догадке, не убедившись, что
      // база согласна, здесь нельзя.
      router.refresh();
      return;
    }

    setError(result.error ?? 'Не удалось сохранить решение.');

    // Заявку разобрал другой администратор — обновляем список, чтобы
    // карточка ушла из очереди вместе с бесполезными теперь кнопками.
    if (result.alreadyHandled) {
      setDialog(null);
      router.refresh();
    }
  }

  // Строка реквизита: подпись и значение. Локальная функция —
  // используется только здесь и только для однотипных пар.
  function row(label: string, value: string | null, mono = false) {
    if (!value) return null;
    return (
      <div className="flex gap-2 text-caption">
        <span className="w-[136px] shrink-0 text-neutral-50">{label}</span>
        <span className={`min-w-0 break-words ${mono ? 'font-mono' : ''}`}>
          {value}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-neutral-10 p-4">
      {/* ---------- Шапка: название, стадия, дата ---------- */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="min-w-0 text-h3 font-semibold">
          {application.company_name}
        </h3>
        <span className="shrink-0 text-caption text-neutral-50">
          {DATE.format(new Date(application.created_at))}
        </span>
      </div>

      {/* Стадия — чипсом, только у разобранных: у ждущих её заменяют
          кнопки решения ниже, и подпись «Ждёт» рядом с ними была бы
          повтором. */}
      {!pending && (
        <p className="mt-1">
          <span
            className={[
              'inline-block rounded-pill px-2 py-0.5 text-micro font-medium',
              application.status === 'approved'
                ? 'bg-status-success text-success'
                : 'bg-surface-muted text-neutral-60',
            ].join(' ')}
          >
            {application.status === 'approved' ? 'Одобрена' : 'Отклонена'}
            {application.reviewed_at
              ? ` · ${DATE.format(new Date(application.reviewed_at))}`
              : ''}
          </span>
        </p>
      )}

      {/* ---------- Реквизиты ---------- */}
      <div className="mt-3 space-y-1">
        {row('PIB', application.tax_id, true)}
        {row('Матични број', application.registration_number, true)}
        {row('Город', application.company_city)}
        {row('Контактное лицо', application.contact_person)}
        {row('Телефон заявки', application.phone)}
        {row('Сайт', application.website)}
      </div>

      {/* Реквизиты-заглушки. Предупреждение стоит СРАЗУ ПОД ними, а не
          в конце карточки: администратор читает номера сверху вниз и
          должен узнать об их происхождении там же, где их видит. */}
      {isPlaceholder && (
        <Alert tone="warning" className="mt-2">
          Реквизиты не собраны: заявка заведена миграцией задним числом
          для салона, работавшего до введения подтверждения статуса.
          Запросите PIB и матични број у салона.
        </Alert>
      )}

      {/* ---------- Контакты аккаунта ---------- */}
      {/* Отдельным блоком от реквизитов заявки: это данные учётной
          записи, по которым заявителя опознают и с ним связываются,
          даже если контактный телефон в заявке он не указал. */}
      <div className="mt-3 space-y-1 border-t border-neutral-10 pt-3">
        {row('Аккаунт', application.account_name)}
        {application.account_phone && (
          <div className="flex gap-2 text-caption">
            <span className="w-[136px] shrink-0 text-neutral-50">
              Телефон входа
            </span>
            {/* dir=ltr: номер начинается с «+» и в потоке текста
                иначе съезжает. */}
            <a
              href={`tel:${application.account_phone}`}
              dir="ltr"
              className="text-brand-blue hover:underline"
            >
              {application.account_phone}
            </a>
          </div>
        )}
        {application.account_email && (
          <div className="flex gap-2 text-caption">
            <span className="w-[136px] shrink-0 text-neutral-50">Почта</span>
            <a
              href={`mailto:${application.account_email}`}
              className="min-w-0 break-all text-brand-blue hover:underline"
            >
              {application.account_email}
            </a>
          </div>
        )}
      </div>

      {/* ---------- Комментарий заявителя ---------- */}
      {application.comment && (
        <div className="mt-3 rounded-control bg-surface-subtle p-3">
          <p className="text-micro text-neutral-50">Комментарий заявителя</p>
          <p className="mt-0.5 whitespace-pre-line text-caption">
            {application.comment}
          </p>
        </div>
      )}

      {/* ---------- Причина отказа у разобранных ---------- */}
      {application.status === 'rejected' && application.reject_reason && (
        <Alert tone="error" className="mt-3">
          <span className="font-medium">Причина отказа:</span>{' '}
          {application.reject_reason}
        </Alert>
      )}

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      {/* ---------- Решение ---------- */}
      {pending && (
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDialog('reject')}
            disabled={busy}
          >
            Отклонить
          </Button>
          <Button size="sm" onClick={() => setDialog('approve')} disabled={busy}>
            Одобрить
          </Button>
        </div>
      )}

      {/* ============================================================
          ДИАЛОГИ. Разметка та же, что у блокировки салона и отказа в
          модерации: три разных модальных окна в одном инструменте
          читались бы как элементы разных продуктов.
          ============================================================ */}
      {dialog !== null && (
        <div
          className="fixed inset-0 z-modal flex items-end justify-center bg-surface-overlay p-0 sm:items-center sm:p-4"
          onClick={() => {
            if (!busy) setDialog(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dealer-app-dialog-title"
            onClick={(e) => e.stopPropagation()}
            className="
              max-h-[90dvh] w-full overflow-y-auto rounded-t-card bg-white p-4
              sm:max-w-lg sm:rounded-card sm:p-6
            "
          >
            <h2
              id="dealer-app-dialog-title"
              className="text-h3 font-semibold"
            >
              {dialog === 'approve'
                ? `Одобрить «${application.company_name}»`
                : `Отклонить «${application.company_name}»`}
            </h2>

            {dialog === 'approve' ? (
              <>
                {/* Последствия перечислены до кнопки: одобрение
                    выдаёт права, и администратор должен видеть,
                    какие именно, а не вспоминать. */}
                <p className="mt-1 text-caption text-neutral-60">
                  Аккаунт станет автосалоном: появится карточка в каталоге
                  салонов, страница витрины и отметка «Автосалон» на
                  объявлениях. Название, город и контактное лицо будут взяты
                  из заявки.
                </p>

                {/* Напоминание о непроверенных реквизитах — последний
                    рубеж перед выдачей статуса. */}
                {isPlaceholder && (
                  <Alert tone="warning" className="mt-3">
                    У заявки нет настоящих реквизитов. Одобряйте, только
                    если проверили компанию другим способом.
                  </Alert>
                )}

                <p className="mt-3 text-caption text-neutral-60">
                  Проверено по реестру APR:{' '}
                  <span className="font-mono">{application.tax_id}</span> ·{' '}
                  <span className="font-mono">
                    {application.registration_number}
                  </span>
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-caption text-neutral-60">
                  Причину увидит заявитель в своём кабинете. Он сможет
                  исправить данные и подать заявку заново.
                </p>

                <textarea
                  ref={inputRef}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={REASON_MAX_LENGTH}
                  rows={3}
                  placeholder="Что не так с заявкой"
                  className="
                    mt-3 w-full rounded-control border border-neutral-15 px-3 py-2
                    text-caption outline-none focus:border-neutral-30
                  "
                />
                <p className="mt-1 text-micro text-neutral-50">
                  {trimmed.length < REASON_MIN_LENGTH
                    ? `Минимум ${REASON_MIN_LENGTH} символов (введено ${trimmed.length})`
                    : `${trimmed.length} из ${REASON_MAX_LENGTH}`}
                </p>
              </>
            )}

            {error && (
              <Alert tone="error" className="mt-3">
                {error}
              </Alert>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={() => setDialog(null)}
                disabled={busy}
              >
                Отмена
              </Button>
              {dialog === 'approve' ? (
                <Button onClick={() => decide(true)} disabled={busy}>
                  {busy ? 'Одобряем…' : 'Одобрить и выдать статус'}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={() => decide(false)}
                  disabled={!canReject}
                >
                  {busy ? 'Отклоняем…' : 'Отклонить'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
