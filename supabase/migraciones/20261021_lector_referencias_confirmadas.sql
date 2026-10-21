-- Lector de albaranes: códigos de proveedor CONFIRMADOS POR UNA PERSONA en la revisión.
-- Solo proveedor, código y descripción (nunca precios, cantidades ni importes). Es la evidencia
-- con la que el lector valida el mismo código del mismo proveedor en lecturas posteriores.
-- Leer: costes.ver · Confirmar o retirar: costes.editar (mismo patrón que coste_documentos).
-- Reversión: drop table public.lector_referencias_confirmadas;
create table if not exists public.lector_referencias_confirmadas(
  id bigint generated always as identity primary key,
  proveedor_clave text not null check (char_length(proveedor_clave) between 3 and 80),
  referencia text not null check (char_length(referencia) between 1 and 60),
  descripcion text check (descripcion is null or char_length(descripcion) <= 200),
  confirmado_por uuid not null default auth.uid(),
  confirmado_en timestamptz not null default now(),
  unique (proveedor_clave, referencia)
);
comment on table public.lector_referencias_confirmadas is
  'Lector de albaranes: códigos de proveedor confirmados por una persona (sin precios). Evidencia para validar el mismo código del mismo proveedor.';
alter table public.lector_referencias_confirmadas enable row level security;
create policy lector_referencias_confirmadas_select on public.lector_referencias_confirmadas
  for select using (tiene_permiso('costes.ver'));
create policy lector_referencias_confirmadas_insert on public.lector_referencias_confirmadas
  for insert with check (tiene_permiso('costes.editar') and confirmado_por = auth.uid());
create policy lector_referencias_confirmadas_delete on public.lector_referencias_confirmadas
  for delete using (tiene_permiso('costes.editar'));
grant select, insert, delete on public.lector_referencias_confirmadas to authenticated;
