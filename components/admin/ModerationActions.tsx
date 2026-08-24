'use client';

// ============================================================
// RS AUTO — Панель решений на карточке модерации. Client Component.
// ============================================================
// Держит всё интерактивное карточки в одном месте: две кнопки, диалог
// отклонения, горячие клавиши и состояние запроса. Сама карточка
// (ModerationCard) остаётся серверной — клиентским становится только
// то, что действительно требует браузера.
//
// ГОРЯЧИЕ КЛАВИШИ A / R — не украшение. Модератор разбирает очередь
// подряд, и путь «увидел → решил → следующая» должен проходить без
// мыши. A одобряет сразу, R открывает диалог причины с фокусом на
// первом чипсе, дальше Tab и Enter.
//
// Клавиши НЕ СРАБАТЫВАЮТ, когда фокус в поле ввода: в диалоге
// отклонения есть textarea, и буква «r», набранная в причине, не
// должна открывать второй диалог. Проверяется тег активного элемента,
// а не открытость диалога, — так правило работает и для любого
// будущего поля на карточке.
//
// ПОСЛЕ УСПЕХА — ВОЗВРАТ В ОЧЕРЕДЬ. Оставаться на карточке
// разобранного объявления незачем: обе кнопки на ней уже
// бессмысленны. router.push плюс refresh: push уводит, refresh
// заставляет сервер перечитать очередь, из которой объявление ушло.
// ============================================================

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import ApproveButton from '@/components/admin/ApproveButton';
import RejectDialog from '@/components/admin/RejectDialog';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { approveCar, rejectCar } from '@/app/admin/actions';

type Props = {
  carId: string;
  // Язык продавца — определяет, на каком языке уйдёт причина.
  ownerLocale: string | null;
  // Объявление уже не на проверке (открыли по прямой ссылке карточку
  // активного или отклонённого). Решения недоступны, но карточку
  // показать надо — модератор мог прийти сюда из журнала.
  decided: boolean;
};

export default function ModerationActions({
  carId,
  ownerLocale,
  decided,
}: Props) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Флаг «уходим»: после успешного решения запрещаем повторные
  // действия, пока навигация в пути. Без него быстрое второе нажатие
  // отправило бы approve_car по объявлению, которое уже одобрено.
  const leaving = useRef(false);

  function goBackToQueue() {
    leaving.current = true;
    router.push('/admin/queue');
    // refresh обязателен: очередь отрисована на сервере, и без него
    // список пришёл бы из кэша роутера вместе с только что
    // разобранным объявлением.
    router.refresh();
  }

  async function handleApprove() {
    if (busy || decided || leaving.current) return;
    setBusy(true);
    setError(null);

    const result = await approveCar(carId);

    if (result.ok) {
      goBackToQueue();
      return;
    }

    setBusy(false);

    // Объявление разобрал другой модератор — на карточке делать
    // больше нечего, уводим в очередь. Текст ошибки при этом
    // показываем: без него уход выглядел бы как случайный сбой.
    if (result.alreadyHandled) {
      setError(result.error ?? null);
      // Небольшая задержка, чтобы сообщение успели прочитать.
      window.setTimeout(goBackToQueue, 1200);
      return;
    }

    setError(result.error ?? null);
  }

  // Возвращает текст ошибки или null при успехе — так диалог сам
  // решает, гасить ему себя или показать причину отказа.
  async function handleReject(reason: string): Promise<string | null> {
    if (leaving.current) return null;

    const result = await rejectCar(carId, reason);

    if (result.ok) {
      setDialogOpen(false);
      goBackToQueue();
      return null;
    }

    if (result.alreadyHandled) {
      setDialogOpen(false);
      setError(result.error ?? null);
      window.setTimeout(goBackToQueue, 1200);
      return null;
    }

    return result.error ?? 'Не удалось отклонить объявление.';
  }

  // ---------- Горячие клавиши ----------
  useEffect(() => {
    if (decided) return;

    function onKey(e: KeyboardEvent) {
      // Модификаторы — не наши: Ctrl+R это перезагрузка страницы, и
      // перехватывать её нельзя.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Фокус в поле ввода — буквы принадлежат полю, а не нам.
      const el = document.activeElement;
      const tag = el?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      // Пока диалог открыт, A и R не работают: решение уже
      // принимается, и второе нажатие только запутает. Escape там
      // обрабатывает сам диалог (useDismissableLayer).
      if (dialogOpen) return;

      const key = e.key.toLowerCase();

      // Латиница и кириллица: раскладка у модератора может быть
      // русской, и «ф» на месте A — та же физическая клавиша.
      if (key === 'a' || key === 'ф') {
        e.preventDefault();
        void handleApprove();
        return;
      }

      if (key === 'r' || key === 'к') {
        e.preventDefault();
        setError(null);
        setDialogOpen(true);
      }
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // handleApprove читает busy/decided через замыкание, поэтому
    // эффект пересоздаётся при их смене — это дешевле, чем прятать
    // всё в ref ради одного слушателя.
  }, [dialogOpen, busy, decided]); // eslint-disable-line react-hooks/exhaustive-deps

  // Объявление уже разобрано — вместо кнопок объясняем, почему их нет.
  if (decided) {
    return (
      <div className="rounded-card border border-neutral-10 bg-surface-subtle p-4 text-caption text-neutral-60">
        Объявление уже не на проверке — решения недоступны.
      </div>
    );
  }

  return (
    <>
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <ApproveButton onApprove={handleApprove} busy={busy} />

        <Button
          variant="destructive"
          size="lg"
          onClick={() => {
            setError(null);
            setDialogOpen(true);
          }}
          disabled={busy}
        >
          Отклонить
        </Button>

        {/* Подсказка о клавишах. Мелким и рядом с кнопками: тот, кто
            разбирает очередь каждый день, увидит её один раз и
            запомнит, остальным она не мешает. */}
        <p className="text-micro text-neutral-50 sm:ml-2">
          A — одобрить, R — отклонить
        </p>
      </div>

      <RejectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        ownerLocale={ownerLocale}
        onSubmit={handleReject}
      />
    </>
  );
}
