-- Supabase SIMULADO para probar la propuesta SAT en un Postgres local (PGlite), nunca en producción.
-- Roles de la API, auth.uid() leído de la variable `prueba.uid`, tablas de usuarios/roles/permisos con el
-- mismo esquema que producción y tiene_permiso() con la misma regla (sin la verificación en dos pasos).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid(),
  created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select, insert on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;

create table if not exists public.perfiles (id uuid primary key, nombre text, email text, activo boolean not null default true,
  creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now());
create table if not exists public.permisos (id bigint generated always as identity primary key, codigo text not null unique, nombre text not null,
  descripcion text, creado_en timestamptz not null default now());
create table if not exists public.roles (id bigint generated always as identity primary key, codigo text not null unique, nombre text not null,
  descripcion text, creado_en timestamptz not null default now());
create table if not exists public.rol_permisos (rol_id bigint references public.roles(id) on delete cascade,
  permiso_id bigint references public.permisos(id) on delete cascade, primary key (rol_id, permiso_id));
create table if not exists public.usuario_roles (usuario_id uuid references public.perfiles(id) on delete cascade,
  rol_id bigint references public.roles(id) on delete cascade, creado_en timestamptz not null default now(), primary key (usuario_id, rol_id));
create table if not exists public.usuario_permisos (usuario_id uuid references public.perfiles(id) on delete cascade,
  permiso_id bigint references public.permisos(id) on delete cascade, permitido boolean not null, creado_en timestamptz not null default now(),
  primary key (usuario_id, permiso_id));
insert into public.roles (codigo, nombre) values ('ADMIN', 'Admin'), ('ADMINISTRACION', 'Administración'), ('DIRECCION_ADMIN', 'Dirección')
on conflict (codigo) do nothing;

create or replace function public.tiene_permiso(permiso_codigo text) returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.usuario_permisos up join public.permisos p on p.id = up.permiso_id
      where up.usuario_id = auth.uid() and p.codigo = permiso_codigo)
    then (select up.permitido from public.usuario_permisos up join public.permisos p on p.id = up.permiso_id
      where up.usuario_id = auth.uid() and p.codigo = permiso_codigo limit 1)
    when exists (select 1 from public.usuario_roles ur join public.roles r on r.id = ur.rol_id where ur.usuario_id = auth.uid() and r.codigo = 'ADMIN')
    then true
    else exists (select 1 from public.usuario_roles ur join public.rol_permisos rp on rp.rol_id = ur.rol_id
      join public.permisos p on p.id = rp.permiso_id where ur.usuario_id = auth.uid() and p.codigo = permiso_codigo)
  end
$$;
grant execute on function public.tiene_permiso(text) to authenticated;
