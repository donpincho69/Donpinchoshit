-- =====================================================
--  Preparación de la base de datos (se pega UNA vez en Supabase)
--  Se puede ejecutar más de una vez sin problema.
-- =====================================================

-- Carpetas
create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  parent_id  uuid references public.folders(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Elementos guardados (links y archivos propios)
create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('x','ph','file','link')),
  url        text,
  file_path  text,
  mime       text,
  title      text,
  note       text,
  tags       text[] not null default '{}',
  folder_id  uuid references public.folders(id) on delete set null,
  favorite   boolean not null default false,
  later      boolean not null default false,
  seen       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Escenas guardadas de la pantalla dividida
create table if not exists public.layouts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Seguridad: cada usuario solo ve lo suyo
alter table public.folders enable row level security;
alter table public.items   enable row level security;
alter table public.layouts enable row level security;

drop policy if exists "folders_propias" on public.folders;
create policy "folders_propias" on public.folders for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "items_propios" on public.items;
create policy "items_propios" on public.items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "layouts_propios" on public.layouts;
create policy "layouts_propios" on public.layouts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Almacenamiento privado para tus archivos
insert into storage.buckets (id, name, public)
values ('biblioteca', 'biblioteca', false)
on conflict (id) do nothing;

drop policy if exists "biblioteca_leer" on storage.objects;
create policy "biblioteca_leer" on storage.objects for select to authenticated
  using (bucket_id = 'biblioteca' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "biblioteca_subir" on storage.objects;
create policy "biblioteca_subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'biblioteca' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "biblioteca_cambiar" on storage.objects;
create policy "biblioteca_cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'biblioteca' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "biblioteca_borrar" on storage.objects;
create policy "biblioteca_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'biblioteca' and (storage.foldername(name))[1] = auth.uid()::text);
