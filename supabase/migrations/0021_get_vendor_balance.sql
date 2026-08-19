-- ============================================================
-- AUTO.RS — Миграция 0021: Баланс владельца (вендора)
-- ============================================================
-- Доступный баланс вендора = сумма завершённых выплат (payout/completed).
-- Выплаты переходят в completed при завершении аренды (complete_booking,
-- миграция 0012). Пока аренда не завершена, payout висит в pending и в
-- баланс не попадает. Так владелец видит реально заработанное.
-- ============================================================
create or replace function public.get_vendor_balance(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  -- coalesce → 0.0, если выплат ещё не было
  select coalesce(sum(t.amount), 0.0)::numeric
  from public.transactions t
  where t.user_id = p_user_id
    and t.type = 'payout'
    and t.status = 'completed';
$$;

comment on function public.get_vendor_balance(uuid)
  is 'Доступный баланс владельца: сумма завершённых выплат (payout/completed). 0.0 если выплат нет';

-- Доступно авторизованным. Функция считает баланс по переданному p_user_id;
-- на клиенте передаём currentUser.uid (свой баланс).
grant execute on function public.get_vendor_balance(uuid) to authenticated;
