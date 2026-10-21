-- Registro independiente del lector y de STEL. Escritura solo desde backend autorizado.
create table public.licitaciones_ejecuciones (
  id uuid primary key default gen_random_uuid(),
  clave_ejecucion text not null unique check (length(clave_ejecucion) between 1 and 200),
  fecha_local date not null,
  iniciada_en timestamptz not null default now(),
  finalizada_en timestamptz,
  estado text not null default 'EN_CURSO' check (estado in ('EN_CURSO','COMPLETADO','PARCIAL','FALLIDO')),
  ambito text not null default 'Ponferrada, El Bierzo y provincia de León',
  resumen text not null default '',
  informe text not null default '',
  fuentes jsonb not null default '[]'::jsonb check (jsonb_typeof(fuentes) = 'array'),
  oportunidades jsonb not null default '[]'::jsonb check (jsonb_typeof(oportunidades) = 'array'),
  limitaciones jsonb not null default '[]'::jsonb check (jsonb_typeof(limitaciones) = 'array'),
  creado_en timestamptz not null default now(),
  constraint licitaciones_estado_fechas check (
    (estado = 'EN_CURSO' and finalizada_en is null) or
    (estado <> 'EN_CURSO' and finalizada_en is not null and finalizada_en >= iniciada_en)
  ),
  constraint licitaciones_informe_completado check (
    estado <> 'COMPLETADO' or
    (length(trim(informe)) > 0 and jsonb_array_length(fuentes) > 0)
  )
);
create index licitaciones_ejecuciones_fecha_idx on public.licitaciones_ejecuciones(fecha_local desc, iniciada_en desc, id desc);
alter table public.licitaciones_ejecuciones enable row level security;
revoke all on public.licitaciones_ejecuciones from public, anon, authenticated;
grant select on public.licitaciones_ejecuciones to authenticated;
grant select, insert, update on public.licitaciones_ejecuciones to service_role;
create policy licitaciones_lectura_economica on public.licitaciones_ejecuciones
  for select to authenticated using (public.tiene_permiso('costes.ver'));
comment on table public.licitaciones_ejecuciones is
  'Revisiones de licitaciones: informes y estimaciones orientativas. Solo backend escribe; costes.ver lee. Un registro por ejecución, sin datos en el repositorio público.';
notify pgrst, 'reload schema';
