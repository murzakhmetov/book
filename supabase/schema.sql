-- ====================================================================
-- book_lovers.kz - Supabase Database Schema
--
-- Инструкция по установке:
-- 1. Зайдите в панель Supabase: https://supabase.com/dashboard
-- 2. Выберите ваш проект -> в левом меню перейдите в SQL Editor
-- 3. Нажмите "New Query", вставьте этот скрипт и нажмите "Run"
-- 4. Все таблицы, индексы, триггеры и политики безопасности (RLS)
--    будут созданы автоматически!
-- ====================================================================

-- Включаем расширение для генерации UUID
create extension if not exists "uuid-ossp";

-- ====================================================================
-- 1. ТАБЛИЦА ПРОФИЛЕЙ ПОЛЬЗОВАТЕЛЕЙ (public.profiles)
-- Хранит имя, телефон, адрес доставки и роль пользователя.
-- Привязана к встроенной аутентификации Supabase (auth.users).
-- ====================================================================
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  name text default '' not null,
  phone text default '' not null,
  address text default '' not null,
  role text default 'customer' check (role in ('customer', 'admin')) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Индексы для быстрого поиска
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_phone on public.profiles(phone);

-- Включаем Row Level Security (RLS)
alter table public.profiles enable row level security;

-- Политики безопасности для profiles:
-- Пользователь может просматривать свой профиль
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using ( (select auth.uid()) = id );

-- Пользователь может обновлять свой профиль
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- Пользователь может создавать свой профиль
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check ( (select auth.uid()) = id );

-- Триггер для автоматического создания профиля при регистрации в Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, phone, address, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'address', ''),
    coalesce(new.raw_user_meta_data->>'role', 'customer')
  )
  on conflict (id) do update set
    email = excluded.email,
    name = case when excluded.name <> '' then excluded.name else profiles.name end,
    phone = case when excluded.phone <> '' then excluded.phone else profiles.phone end,
    address = case when excluded.address <> '' then excluded.address else profiles.address end,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ====================================================================
-- 2. ТАБЛИЦА ИЗБРАННОГО (public.favorites)
-- Хранит понравившиеся пользователю книги и синхронизируется между устройствами.
-- ====================================================================
create table if not exists public.favorites (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  book_id text not null,
  created_at timestamptz default now() not null,
  unique (user_id, book_id)
);

-- Индекс для мгновенного получения избранного пользователя
create index if not exists idx_favorites_user_id on public.favorites(user_id);

-- Включаем RLS
alter table public.favorites enable row level security;

-- Политики безопасности для favorites:
drop policy if exists "Users can view own favorites" on public.favorites;
create policy "Users can view own favorites"
  on public.favorites for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "Users can insert own favorites" on public.favorites;
create policy "Users can insert own favorites"
  on public.favorites for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "Users can delete own favorites" on public.favorites;
create policy "Users can delete own favorites"
  on public.favorites for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- ====================================================================
-- 3. ТАБЛИЦА ЗАКАЗОВ (public.orders)
-- Хранит все оформленные заказы: состав книг, статус, контакты, адрес доставки.
-- Поддерживает как авторизованных покупателей, так и гостевые заказы.
-- ====================================================================
create table if not exists public.orders (
  id text primary key, -- Номер заказа в формате "BK-YYYY-XXXX"
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  contact_method text default 'whatsapp' not null,
  delivery_method text default 'courier' not null,
  delivery_city text default '',
  delivery_address text default '',
  delivery_fee numeric(10, 2) default 0 not null,
  payment_method text default 'transfer' not null,
  comment text default '',
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10, 2) default 0 not null,
  discount numeric(10, 2) default 0 not null,
  total numeric(10, 2) default 0 not null,
  status text not null default 'new' check (status in ('new', 'processing', 'shipped', 'completed', 'cancelled')),
  created_at timestamptz default now() not null
);

-- Индексы для быстрой фильтрации и сортировки
create index if not exists idx_orders_user_created on public.orders(user_id, created_at desc);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_orders_status on public.orders(status);

-- Включаем RLS
alter table public.orders enable row level security;

-- Политики безопасности для orders:
-- 1. Разрешаем создавать заказы гостям (user_id is null) и авторизованным пользователям (user_id = auth.uid())
drop policy if exists "Anyone can create orders" on public.orders;
create policy "Anyone can create orders"
  on public.orders for insert
  to anon, authenticated
  with check (
    user_id is null or user_id = (select auth.uid())
  );

-- 2. Пользователь видит только свои заказы
drop policy if exists "Users can view own orders" on public.orders;
create policy "Users can view own orders"
  on public.orders for select
  to authenticated
  using ( (select auth.uid()) = user_id );

-- 3. Администраторы магазина могут просматривать и обновлять все заказы
drop policy if exists "Admins can view all orders" on public.orders;
create policy "Admins can view all orders"
  on public.orders for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid()) and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can update all orders" on public.orders;
create policy "Admins can update all orders"
  on public.orders for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid()) and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid()) and profiles.role = 'admin'
    )
  );

-- ====================================================================
-- 4. ТАБЛИЦА КОРЗИНЫ (public.cart_items)
-- Хранит товары в корзине пользователя, позволяя продолжить покупку
-- с любого устройства.
-- ====================================================================
create table if not exists public.cart_items (
  user_id uuid references auth.users(id) on delete cascade not null,
  book_id text not null,
  quantity integer default 1 check (quantity > 0) not null,
  updated_at timestamptz default now() not null,
  primary key (user_id, book_id)
);

create index if not exists idx_cart_items_user_id on public.cart_items(user_id);

alter table public.cart_items enable row level security;

drop policy if exists "Users can manage own cart" on public.cart_items;
create policy "Users can manage own cart"
  on public.cart_items for all
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

-- ====================================================================
-- 5. ТАБЛИЦА ОТЗЫВОВ (public.reviews)
-- Хранит отзывы покупателей с модерацией.
-- ====================================================================
create table if not exists public.reviews (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  book text default '',
  rating integer not null check (rating >= 1 and rating <= 5),
  text text not null,
  lang text default 'ru' not null,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')) not null,
  created_at timestamptz default now() not null
);

create index if not exists idx_reviews_status on public.reviews(status);

alter table public.reviews enable row level security;

drop policy if exists "Anyone can submit a review" on public.reviews;
create policy "Anyone can submit a review"
  on public.reviews for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Public can view approved reviews" on public.reviews;
create policy "Public can view approved reviews"
  on public.reviews for select
  to anon, authenticated
  using (status = 'approved');

-- ====================================================================
-- 6. ПРАВА ДОСТУПА ДЛЯ DATA API (anon, authenticated)
-- ====================================================================
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant all on all routines in schema public to anon, authenticated;
