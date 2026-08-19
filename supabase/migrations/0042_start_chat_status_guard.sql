-- ============================================================
-- AUTO.RS — Миграция 0042: Запрет начинать чат по закрытому объявлению
-- ============================================================
-- В интерфейсе кнопки «Позвонить»/«Написать» у проданного объявления скрыты,
-- но это только клиент. По принципу «толстого бэкенда» проверка должна быть
-- на сервере: прямой вызов RPC start_chat не должен создавать переписку
-- по сделке, которая уже закрыта.
--
-- ПРАВИЛА:
--   • sold / archived / rejected — НОВЫЙ чат создать нельзя (исключение);
--   • moderation / active        — можно (как и раньше);
--   • если чат по объявлению УЖЕ существует — возвращаем его id, даже когда
--     машина продана. Иначе покупатель потеряет доступ к истории переписки
--     по только что купленному авто (сообщения остаются читаемыми).
--
-- Проверка стоит ПОСЛЕ поиска существующего чата — это и обеспечивает
-- сохранение доступа к старым диалогам.
-- ============================================================

create or replace function public.start_chat(p_car_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer   uuid := auth.uid();
  v_seller  uuid;
  v_status  car_status;
  v_chat_id uuid;
begin
  -- Требуется авторизация
  if v_buyer is null then
    raise exception 'Требуется авторизация для начала чата'
      using errcode = 'insufficient_privilege';
  end if;

  -- Находим продавца (владельца машины) и статус объявления одним запросом
  select c.user_id, c.status
    into v_seller, v_status
  from public.cars c
  where c.id = p_car_id;

  if v_seller is null then
    raise exception 'Объявление % не найдено', p_car_id
      using errcode = 'no_data_found';
  end if;

  -- Нельзя писать самому себе
  if v_buyer = v_seller then
    raise exception 'Нельзя начать чат с самим собой'
      using errcode = 'check_violation';
  end if;

  -- Ищем существующий чат по этой комбинации.
  -- ВАЖНО: делаем это ДО проверки статуса — уже начатая переписка должна
  -- открываться и после того, как машину продали или сняли с публикации.
  select id
    into v_chat_id
  from public.chats
  where car_id = p_car_id
    and buyer_id = v_buyer
    and seller_id = v_seller;

  if v_chat_id is not null then
    return v_chat_id;   -- чат уже есть — возвращаем его независимо от статуса
  end if;

  -- НОВЫЙ чат по закрытому объявлению создавать нельзя.
  -- Сообщения разные, чтобы клиент показал пользователю понятную причину.
  if v_status = 'sold' then
    raise exception 'Объявление продано — начать переписку нельзя'
      using errcode = 'check_violation';
  end if;

  if v_status = 'archived' then
    raise exception 'Объявление снято с публикации — начать переписку нельзя'
      using errcode = 'check_violation';
  end if;

  if v_status = 'rejected' then
    raise exception 'Объявление отклонено модератором — начать переписку нельзя'
      using errcode = 'check_violation';
  end if;

  -- Создаём новый чат. ON CONFLICT — страховка от гонок.
  insert into public.chats (car_id, buyer_id, seller_id)
  values (p_car_id, v_buyer, v_seller)
  on conflict (car_id, buyer_id, seller_id) do update
    set car_id = excluded.car_id   -- no-op апдейт, чтобы RETURNING вернул строку
  returning id into v_chat_id;

  return v_chat_id;
end;
$$;

comment on function public.start_chat(uuid)
  is 'Создаёт чат покупатель↔продавец или возвращает существующий. Новый чат по проданному/архивному/отклонённому объявлению запрещён';

grant execute on function public.start_chat(uuid) to authenticated;
