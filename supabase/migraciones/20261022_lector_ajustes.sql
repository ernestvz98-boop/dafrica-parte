-- Lector de albaranes: ajustes compartidos. Por ahora solo «obras_lista_completa»: la lista de obras
-- importada (lector_obras) es el listado COMPLETO de proyectos de STEL, con su número de obras.
-- Con ella el lector puede usar la regla de la lectura a una cifra (ver manuscritos.obraPorNombre).
-- Leer: costes.ver · Escribir: costes.editar. Reversión: drop table public.lector_ajustes;
create table if not exists public.lector_ajustes(
  clave text primary key check (clave in ('obras_lista_completa')),
  valor jsonb not null,
  actualizado_por uuid not null default auth.uid(),
  actualizado_en timestamptz not null default now()
);
comment on table public.lector_ajustes is 'Lector de albaranes: ajustes compartidos (lista de obras completa).';
alter table public.lector_ajustes enable row level security;
create policy lector_ajustes_select on public.lector_ajustes for select using (tiene_permiso('costes.ver'));
create policy lector_ajustes_insert on public.lector_ajustes for insert with check (tiene_permiso('costes.editar') and actualizado_por = auth.uid());
create policy lector_ajustes_update on public.lector_ajustes for update using (tiene_permiso('costes.editar')) with check (tiene_permiso('costes.editar') and actualizado_por = auth.uid());
create policy lector_ajustes_delete on public.lector_ajustes for delete using (tiene_permiso('costes.editar'));
grant select, insert, update, delete on public.lector_ajustes to authenticated;
