-- ============================================================
-- AUTO.RS — Миграция 0064: ХОТФИКС авторизации get_vendor_balance
-- ============================================================
-- ПРОБЛЕМА (найдена аудитом Supabase Security Advisor).
-- Функция public.get_vendor_balance(p_user_id uuid) объявлена как
-- SECURITY DEFINER и принимает ЧУЖОЙ user_id параметром, но не сверяет
-- его с auth.uid(). Комментарий миграции 0021 гласил «на клиенте
-- передаём currentUser.uid», однако клиент передаёт что угодно: RPC
-- доступен по HTTP, и подставить чужой UUID тривиально.
--
-- UUID продавца не является секретом — он приходит вместе с карточкой
-- объявления в каталоге. Значит любой авторизованный пользователь мог
-- узнать сумму завершённых выплат любого продавца. Это утечка
-- коммерческих данных.
--
-- ИСПРАВЛЕНИЕ. Свой баланс — можно; чужой — только администратору;
-- иначе исключение. Проверка выполняется ВНУТРИ функции (принцип
-- «толстого бэкенда»): даже если грант когда-нибудь выдадут шире,
-- данные не утекут.
--
-- СОВМЕСТИМОСТЬ. Сигнатура и возвращаемый тип не меняются, поэтому
-- вызов приложения (lib/data/repositories/transactions_repository.dart,
-- getVendorBalance → rpc('get_vendor_balance', {'p_user_id': userId}))
-- продолжает работать: там передаётся currentUser.uid, то есть свой id.
--
-- Язык меняется с sql на plpgsql — в чистом SQL нет raise exception.
-- Тело запроса при этом идентично оригиналу из 0021.
-- ============================================================

begin;

create or replace function public.get_vendor_balance(p_user_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_result numeric;
begin
  -- Аноним не имеет права ни на чей баланс. Явная проверка на null
  -- обязательна: без неё сравнение null = p_user_id вернёт null,
  -- условие не сработает как «запрет», и выполнение пойдёт дальше.
  if v_caller is null then
    raise exception 'Требуется авторизация'
      using errcode = '28000';
  end if;

  -- Чужой баланс — только администратору (кабинет модерации).
  -- Своей баланс смотреть можно всегда.
  if p_user_id is distinct from v_caller and not public.is_admin() then
    raise exception 'Недостаточно прав: доступен только собственный баланс'
      using errcode = '42501';
  end if;

  -- Логика расчёта — без изменений относительно миграции 0021:
  -- сумма завершённых выплат, coalesce → 0.0, если выплат не было.
  select coalesce(sum(t.amount), 0.0)::numeric
    into v_result
    from public.transactions t
   where t.user_id = p_user_id
     and t.type = 'payout'
     and t.status = 'completed';

  return v_result;
end;
$$;

comment on function public.get_vendor_balance(uuid)
  is 'Доступный баланс владельца: сумма завершённых выплат (payout/completed). Только свой баланс; чужой — администратору. 0.0 если выплат нет';

-- Грант не расширяем: как и в 0021, только authenticated.
-- Явный revoke от anon/public — страховка на случай, если EXECUTE
-- достался роли PUBLIC при создании функции (поведение PostgreSQL
-- по умолчанию; массово это чинится миграцией 0065).
revoke execute on function public.get_vendor_balance(uuid) from public;
revoke execute on function public.get_vendor_balance(uuid) from anon;
grant  execute on function public.get_vendor_balance(uuid) to authenticated;

commit;
