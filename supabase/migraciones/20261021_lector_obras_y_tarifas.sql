-- Lector de albaranes: catálogo de obras (código PRY y nombre) y tarifas de proveedor.
-- 1. lector_obras: obras que el lector usa para validar un código PRY escrito a mano (el código
--    existe una sola vez y su nombre coincide con la obra del albarán o del albarán de compra de
--    STEL). STEL no publica sus proyectos en la API. Se llena importando la lista de obras o al
--    confirmar la obra de un albarán. Sin importes.
-- 2. lector_referencias_confirmadas: `origen` (persona | tarifa) y `clase` (código sin signos,
--    con O→0, S→5, I/L→1, B→8, Z→2, G→6) para pedir solo los códigos que hacen falta.
-- Leer: costes.ver · Escribir: costes.editar.
-- Reversión: drop table public.lector_obras;
--   alter table public.lector_referencias_confirmadas drop column clase, drop column origen;
create table if not exists public.lector_obras(
  codigo text primary key check (codigo ~ '^PRY[0-9]{5}$'),
  nombre text not null check (char_length(nombre) between 2 and 150),
  origen text not null default 'persona' check (origen in ('persona','lista')),
  creado_por uuid not null default auth.uid(),
  creado_en timestamptz not null default now()
);
comment on table public.lector_obras is
  'Lector de albaranes: obras (código PRY y nombre) para validar códigos de obra escritos a mano. Sin importes.';
alter table public.lector_obras enable row level security;
create policy lector_obras_select on public.lector_obras for select using (tiene_permiso('costes.ver'));
create policy lector_obras_insert on public.lector_obras for insert with check (tiene_permiso('costes.editar') and creado_por = auth.uid());
create policy lector_obras_delete on public.lector_obras for delete using (tiene_permiso('costes.editar'));
grant select, insert, delete on public.lector_obras to authenticated;

alter table public.lector_referencias_confirmadas
  add column if not exists origen text not null default 'persona' check (origen in ('persona','tarifa')),
  add column if not exists clase text generated always as
    (translate(regexp_replace(upper(referencia),'[^A-Z0-9]','','g'),'OSILBZG','0511826')) stored;
create index if not exists lector_referencias_confirmadas_clase on public.lector_referencias_confirmadas(proveedor_clave, clase);
