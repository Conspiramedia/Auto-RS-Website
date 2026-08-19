-- ============================================================
-- AUTO.RS — Миграция 0020: Серверный гейт верификации на бронирование
-- ============================================================
-- Вторая (реальная) линия обороны гейта верификации. Клиентский гейт
-- во FlutterFlow — это UX; настоящую защиту даёт этот триггер: он не даст
-- создать бронь пользователю без пройденной верификации, даже если UI обойдён
-- (прямой INSERT в bookings). Соответствует принципу Thick Backend (CLAUDE.md).
-- ============================================================

create or replace function public.enforce_verified_booking()
returns trigger
language plpgsql
as $$
declare
  v_status verification_status_type;
begin
  -- Тянем статус верификации арендатора (создателя брони)
  select verification_status
    into v_status
  from public.profiles
  where id = new.customer_id;

  -- Бронировать может только верифицированный пользователь
  if v_status is distinct from 'verified' then
    raise exception 'Бронирование доступно только верифицированным пользователям'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function public.enforce_verified_booking()
  is 'Гейт: запрещает создание брони, если customer не прошёл верификацию (verified)';

-- Триггер срабатывает ДО вставки брони — неверифицированный INSERT отклоняется.
create trigger trg_enforce_verified_booking
  before insert on public.bookings
  for each row execute function public.enforce_verified_booking();
