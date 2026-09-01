-- ============================================================
-- AUTO.RS — Миграция 0109: чистка справочника от демо-моделей
-- ============================================================
-- ЗАЧЕМ:
--   В форме подачи у BMW рядом с каноничной «3 Series» стояла
--   «Serija 3», у Mercedes-Benz — «C klasa» и «E klasa» рядом с
--   «C-Class» и «E-Class». Продавец видел одну и ту же машину дважды
--   и не понимал, что выбирать; выбор «неправильного» варианта дробил
--   бы каталог и SEO-страницы моделей на два несвязанных набора.
--
-- ОТКУДА ВЗЯЛИСЬ:
--   Не опечатка и не ручной ввод продавца. Демо-сид 0054, помеченный
--   «только для dev/staging», перечислял модели по-сербски
--   (0054_seed_site_demo.sql:50). Триггер автопополнения справочника
--   из 0029 отработал штатно и завёл их как новые модели BMW и
--   Mercedes-Benz. Сами демо-объявления с боевой базы позже удалили,
--   а записи в car_models осиротели и остались в пикере.
--
-- ПОЧЕМУ НЕ СРАБОТАЛА ЗАЩИТА ОТ ДУБЛЕЙ:
--   uq_car_models_brand_norm уникален по f_normalize (unaccent+lower).
--   Она снимает регистр и диакритику, но «serija 3» и «3 series» —
--   разные строки. Перевод названия нормализацией не ловится, и это
--   правильно: справочник не обязан знать, что это одна модель.
--
-- БЕЗОПАСНОСТЬ:
--   Удаляются только записи справочника, на которые не ссылается ни
--   одно объявление. Связь cars → car_models по внешнему ключу здесь
--   не идёт (в cars модель хранится текстом), поэтому проверяем по
--   нормализованному тексту cars.model — тем же f_normalize, что и в
--   справочнике. Есть хоть одно объявление — запись остаётся, и
--   миграция не трогает данные продавца.
--
--   Идемпотентно: повторный запуск не находит уже удалённых записей.
-- ============================================================

do $$
declare
  -- Пары «марка → мусорная модель» из демо-сида 0054. Каноничный
  -- вариант каждой из них уже есть в справочнике из 0029, поэтому
  -- переносить объявления некуда и незачем — их просто нет.
  v_pairs text[][] := array[
    array['BMW',           'Serija 3'],
    array['Mercedes-Benz', 'C klasa'],
    array['Mercedes-Benz', 'E klasa']
  ];
  v_brand    text;
  v_model    text;
  v_in_use   integer;
  v_deleted  integer;
  i          integer;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    v_brand := v_pairs[i][1];
    v_model := v_pairs[i][2];

    -- Страховка: вдруг за время между проверкой и накатом кто-то подал
    -- объявление именно на этой модели. Тогда запись нужна — оставляем.
    select count(*) into v_in_use
      from public.cars c
     where public.f_normalize(c.brand) = public.f_normalize(v_brand)
       and public.f_normalize(c.model) = public.f_normalize(v_model);

    if v_in_use > 0 then
      raise notice 'Пропущено: % / % — используется в % объявлениях',
        v_brand, v_model, v_in_use;
      continue;
    end if;

    delete from public.car_models m
     using public.car_brands b
     where m.brand_id = b.id
       and b.name_norm = public.f_normalize(v_brand)
       and m.name_norm = public.f_normalize(v_model);

    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      raise notice 'Удалено из справочника: % / %', v_brand, v_model;
    end if;
  end loop;
end $$;
