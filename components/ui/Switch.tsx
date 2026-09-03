// ============================================================
// RS AUTO — Переключатель (Switch).
// ============================================================
// Общий контрол для настроек с двумя состояниями. Первым потребителем
// стал переключатель писем о новых сообщениях в профиле, но компонент
// намеренно не знает ничего про почту: настройки в кабинете будут
// появляться и дальше, а второй такой же переключатель, собранный
// по месту из div-ов, разъехался бы с этим по размеру и поведению.
//
// ПОЧЕМУ НЕ <input type="checkbox"> СО СТИЛЯМИ, А КНОПКА.
// Нативный чекбокс невозможно оформить как «дорожку с бегунком» без
// appearance:none и подпорок под каждый браузер, а его собственная
// семантика (checked) для настройки-переключателя менее точна, чем
// role="switch": скринридер называет состояние «включено/выключено»,
// а не «отмечено». Кнопка с aria-checked даёт правильное объявление
// и полностью управляемый вид.
//
// ДОСТУПНОСТЬ. role="switch" + aria-checked обязательны — без них
// контрол читается как обычная кнопка без состояния. Подпись связана
// с кнопкой через aria-labelledby, пояснение — через aria-describedby:
// скринридер называет, что именно включается, а не просто «переключатель».
// ============================================================

'use client';

import { useId } from 'react';

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  // Подпись слева от переключателя. Обязательна: контрол без подписи
  // не читается ни глазами, ни скринридером.
  label: string;
  // Пояснение под подписью: что именно перестанет приходить.
  description?: string;
  // Блокировка на время сохранения. Отдельного состояния «сохраняется»
  // у контрола нет: мигание индикатора в настройке, которая
  // применяется мгновенно, отвлекает сильнее, чем помогает.
  disabled?: boolean;
};

export default function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: Props) {
  const labelId = useId();
  const descId = useId();

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div id={labelId} className="text-body text-neutral-80">
          {label}
        </div>
        {description ? (
          <p id={descId} className="mt-0.5 text-small text-neutral-50">
            {description}
          </p>
        ) : null}
      </div>

      {/* type="button" обязателен: контрол живёт внутри <form> профиля,
          и кнопка по умолчанию отправила бы форму при каждом клике. */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-pill transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-40 ${
          checked ? 'bg-brand-primary' : 'bg-neutral-15'
        }`}
      >
        {/* Бегунок. translate-x вместо left: анимация трансформацией
            не вызывает пересчёт раскладки на каждом кадре. */}
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-pill bg-white shadow-sm transition-transform duration-fast ease-out ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
