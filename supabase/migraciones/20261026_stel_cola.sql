-- 2026-10-26 · Fase 2 (aprobada por el usuario): cola de albaranes leídos para crearlos en STEL.
-- La web (lector, permiso costes.editar) envía la orden de cada albarán y su PDF; el robot la ejecuta.
-- Nadie escribe la tabla directamente: la web usa stel_cola_enviar (comprueba el permiso y nunca pisa
-- un albarán ya procesado); el robot usa la función Edge robot-cola con una llave temporal.
-- Deshacer: drop function public.stel_cola_enviar(jsonb); drop table public.stel_cola;
--   drop table public.robot_llaves; borrar el almacén «albaranes-stel» (antes, copia de sus PDF).

create table if not exists public.stel_cola (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  estado text not null check (estado in ('PENDIENTE','REVISAR','YA_EXISTE','PROCESANDO','CREADO','PARADO','ERROR')),
  motivos jsonb not null default '[]'::jsonb,
  plan jsonb not null,
  pdf_ruta text,
  pdf_sha256 text,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  actualizado_en timestamptz not null default now(),
  intentos integer not null default 0,
  resultado jsonb,
  stel_id bigint,
  stel_referencia text
);
alter table public.stel_cola enable row level security;
drop policy if exists stel_cola_leer on public.stel_cola;
create policy stel_cola_leer on public.stel_cola for select to authenticated using (public.tiene_permiso('costes.ver'));
revoke all on public.stel_cola from anon;
revoke insert, update, delete on public.stel_cola from authenticated;

-- Envío desde la web: inserta o actualiza SOLO lo que aún no se ha procesado (PENDIENTE/REVISAR).
-- Un albarán ya creado, en proceso, parado o con error no se toca.
create or replace function public.stel_cola_enviar(p_filas jsonb)
returns table(clave text, estado text, accion text)
language plpgsql
security definer
set search_path to ''
as $$
declare f jsonb; actual text;
begin
  if not public.tiene_permiso('costes.editar') then
    raise exception 'Permiso costes.editar requerido' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) > 200 then
    raise exception 'Envío no válido (hasta 200 albaranes)';
  end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    if coalesce(f->>'clave','') = '' or f->>'estado' not in ('PENDIENTE','REVISAR','YA_EXISTE')
       or jsonb_typeof(f->'plan') <> 'object' or length(f::text) > 200000 then
      raise exception 'Albarán no válido en el envío';
    end if;
    select c.estado into actual from public.stel_cola c where c.clave = f->>'clave' for update;
    if actual is null then
      insert into public.stel_cola(clave, estado, motivos, plan, pdf_ruta, pdf_sha256)
      values (f->>'clave', f->>'estado', coalesce(f->'motivos','[]'::jsonb), f->'plan', f->>'pdf_ruta', f->>'pdf_sha256');
      clave := f->>'clave'; estado := f->>'estado'; accion := 'nuevo'; return next;
    elsif actual in ('PENDIENTE','REVISAR') then
      update public.stel_cola c set estado = f->>'estado', motivos = coalesce(f->'motivos','[]'::jsonb), plan = f->'plan',
        pdf_ruta = f->>'pdf_ruta', pdf_sha256 = f->>'pdf_sha256', actualizado_en = now()
      where c.clave = f->>'clave';
      clave := f->>'clave'; estado := f->>'estado'; accion := 'actualizado'; return next;
    else
      clave := f->>'clave'; estado := actual; accion := 'sin_cambios'; return next;
    end if;
  end loop;
end;
$$;
revoke execute on function public.stel_cola_enviar(jsonb) from public, anon;
grant execute on function public.stel_cola_enviar(jsonb) to authenticated;

-- Llaves temporales del robot (solo su huella SHA-256; la llave vive en el entorno privado del robot).
create table if not exists public.robot_llaves (
  huella text primary key,
  expira timestamptz not null,
  creada_en timestamptz not null default now()
);
alter table public.robot_llaves enable row level security;
revoke all on public.robot_llaves from anon, authenticated;

-- PDF de los albaranes enviados: almacén privado, por su huella SHA-256.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('albaranes-stel', 'albaranes-stel', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;
drop policy if exists albaranes_stel_subir on storage.objects;
create policy albaranes_stel_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'albaranes-stel' and public.tiene_permiso('costes.editar'));
drop policy if exists albaranes_stel_leer on storage.objects;
create policy albaranes_stel_leer on storage.objects for select to authenticated
  using (bucket_id = 'albaranes-stel' and public.tiene_permiso('costes.ver'));
