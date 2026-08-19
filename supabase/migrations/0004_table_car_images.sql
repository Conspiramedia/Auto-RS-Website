-- ============================================================
-- AUTO.RS — Миграция 0004: Таблица car_images (фото объявлений)
-- ============================================================
-- Один автомобиль — много фото (связь 1:N).
-- Ссылки указывают на файлы в Supabase Storage.
-- ============================================================

create table public.car_images (
  id           uuid         primary key default uuid_generate_v4(),
  car_id       uuid         not null references public.cars (id) on delete cascade, -- при удалении авто фото удаляются каскадно
  image_url    text         not null,                 -- ссылка на файл в Supabase Storage
  order_index  integer      not null default 0,       -- порядок отображения фото в галерее
  created_at   timestamptz  not null default now()
);

comment on table public.car_images is 'Фотографии объявлений (1:N к cars)';

-- Индекс покрывает выборку фото конкретной машины в правильном порядке
create index idx_car_images_car_id on public.car_images (car_id, order_index);
