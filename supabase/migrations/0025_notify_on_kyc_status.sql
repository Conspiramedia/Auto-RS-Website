-- ============================================================
-- AUTO.RS — Миграция 0025: Уведомления о смене KYC-статуса
-- ============================================================
-- Триггер на profiles: при смене verification_status создаёт уведомление
-- пользователю. Активирует ветку 'kyc_status_changed' в диспетчере переходов
-- экрана уведомлений. Запись в notifications — SECURITY DEFINER (обход RLS).
-- ============================================================
create or replace function public.notify_on_kyc_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Реагируем только на реальное изменение статуса верификации
  if new.verification_status is distinct from old.verification_status then

    if new.verification_status = 'verified' then
      insert into public.notifications (user_id, title, body, type, action_id)
      values (
        new.id,
        'Верификация пройдена!',
        'Ваш профиль успешно подтвержден. Теперь вам доступна аренда авто.',
        'kyc_status_changed',
        new.id
      );

    elsif new.verification_status = 'rejected' then
      insert into public.notifications (user_id, title, body, type, action_id)
      values (
        new.id,
        'Документы отклонены',
        -- Текст причины из verification_comment; подстраховка на случай null
        coalesce(new.verification_comment, 'Проверьте документы и подайте повторно.'),
        'kyc_status_changed',
        new.id
      );
    end if;

  end if;

  return new;
end;
$$;

comment on function public.notify_on_kyc_status()
  is 'Уведомление пользователю при смене KYC-статуса (verified / rejected)';

-- AFTER UPDATE OF verification_status — срабатывает только при изменении этой колонки
create trigger tg_notify_on_kyc_status
  after update of verification_status on public.profiles
  for each row execute function public.notify_on_kyc_status();
