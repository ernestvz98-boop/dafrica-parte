-- DAFRICA SAT · avisos, partes de técnicos, firmas, revisión económica y facturas con STEL (2026-11-16).
-- PROPUESTA: no aplicada. Aplicarla en producción exige autorización expresa del usuario.
-- Probar antes en local: node supabase/tests/ejecutar-local.mjs supabase/tests/sat_simulado.sql \
--   supabase/propuestas/20261116_sat_partes.sql supabase/tests/sat_partes.sql
--
-- Diseño (docs/sat-diseno.md):
--  - Toda la lógica de estados y permisos está en funciones `sat_*` (SECURITY DEFINER). Las tablas no
--    tienen permisos directos para la web: el navegador solo llama a funciones.
--  - Cada firma guarda el contenido exacto que se firmó. Si el parte cambia después, las firmas quedan
--    invalidadas (con motivo) y hay que volver a firmar. Los importes NO forman parte de lo firmado.
--  - Las escrituras en STEL las hace solo la función Edge `sat-stel` (clave en el servidor) a partir de
--    `sat_stel_operaciones` (una fila por operación con clave única: reintentar no duplica).
--  - La factura solo existe en la cola de STEL después de `sat_factura_aprobar` por alguien con
--    `sat.facturar`, con el total a la vista. Avisar al técnico no la marca como entregada.

-- ============================================================ Permisos y roles
insert into public.permisos (codigo, nombre, descripcion) values
  ('sat.tecnico', 'SAT · técnico', 'Avisos y partes propios: crear, dictar, fotografiar, firmar y enviar; bandeja de facturas'),
  ('sat.administrar', 'SAT · administración', 'Todos los avisos y partes: asignar, revisar, precios, sincronizar con STEL'),
  ('sat.facturar', 'SAT · autorizar facturas', 'Aprobar expresamente la emisión de la factura de un parte revisado')
on conflict (codigo) do nothing;

insert into public.roles (codigo, nombre, descripcion) values
  ('TECNICO_SAT', 'Técnico de mantenimiento', 'Avisos y partes propios desde el móvil'),
  ('FACTURACION_SAT', 'Facturación SAT', 'Revisión económica y aprobación de facturas de partes')
on conflict (codigo) do nothing;

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id from public.roles r join public.permisos p on (r.codigo, p.codigo) in (values
  ('TECNICO_SAT', 'sat.tecnico'),
  ('ADMINISTRACION', 'sat.administrar'),
  ('FACTURACION_SAT', 'sat.administrar'), ('FACTURACION_SAT', 'sat.facturar'),
  ('DIRECCION_ADMIN', 'sat.tecnico'), ('DIRECCION_ADMIN', 'sat.administrar'), ('DIRECCION_ADMIN', 'sat.facturar'))
on conflict do nothing;

-- ============================================================ Tablas
create sequence if not exists public.sat_aviso_seq;
create sequence if not exists public.sat_parte_seq;

-- Copia local del catálogo de STEL (clientes, direcciones, contactos, equipos) y altas provisionales
-- de los técnicos (stel_id null, provisional): administración las vincula o las crea en STEL.
create table if not exists public.sat_clientes (
  id uuid primary key default gen_random_uuid(),
  stel_id bigint unique,
  nombre text not null,
  nif text,
  telefono text,
  email text,
  provisional boolean not null default false,
  fusionado_en uuid references public.sat_clientes(id), -- provisional vinculado después a un cliente de STEL
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create table if not exists public.sat_direcciones (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.sat_clientes(id) on delete cascade,
  stel_id bigint unique,
  texto text not null,
  provisional boolean not null default false,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create table if not exists public.sat_contactos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.sat_clientes(id) on delete cascade,
  stel_id bigint unique,
  nombre text not null,
  cargo text,
  telefono text,
  email text,
  provisional boolean not null default false,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create table if not exists public.sat_equipos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.sat_clientes(id) on delete cascade,
  direccion_id uuid references public.sat_direcciones(id) on delete set null,
  stel_id bigint unique,
  nombre text not null,
  referencia text,
  marca text,
  modelo text,
  numero_serie text,
  provisional boolean not null default false,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
-- Artículos (PRODUCTO) y servicios (SERVICIO) de STEL: el id de STEL es el `item-id` de las líneas.
create table if not exists public.sat_articulos (
  stel_id bigint primary key,
  tipo text not null check (tipo in ('PRODUCTO', 'SERVICIO')),
  referencia text,
  nombre text not null,
  precio numeric(14, 4),
  iva_pct numeric(6, 2),
  activo boolean not null default true,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.sat_avisos (
  id uuid primary key,
  codigo text not null unique,
  cliente_id uuid references public.sat_clientes(id),
  direccion_id uuid references public.sat_direcciones(id),
  contacto_id uuid references public.sat_contactos(id),
  equipo_id uuid references public.sat_equipos(id),
  cliente_texto text,
  direccion_texto text,
  contacto_texto text,
  equipo_texto text,
  motivo text not null,
  prioridad text not null default 'NORMAL' check (prioridad in ('BAJA', 'NORMAL', 'ALTA', 'URGENTE')),
  origen text not null check (origen in ('ADMINISTRACION', 'LLAMADA_TECNICO')),
  estado text not null default 'NUEVO' check (estado in ('NUEVO', 'ASIGNADO', 'EN_CURSO', 'CERRADO', 'ANULADO')),
  tecnico_id uuid,
  programado_para timestamptz,
  notas text,
  stel_incidencia_id bigint,
  creado_por uuid not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.sat_partes (
  id uuid primary key,
  codigo text not null unique,
  aviso_id uuid not null references public.sat_avisos(id),
  tecnico_id uuid not null,
  estado text not null default 'BORRADOR' check (estado in ('BORRADOR', 'FIRMADO', 'ENVIADO', 'EN_REVISION',
    'INFO_SOLICITADA', 'PRESUPUESTAR', 'NO_FACTURABLE', 'PENDIENTE_APROBACION', 'APROBADO', 'FACTURADO')),
  contenido jsonb not null,
  contenido_hash text not null,
  version integer not null default 1,
  pdf_path text,
  pdf_hash text,
  pdf_version integer,
  enviado_en timestamptz,
  revision jsonb,
  revision_nota text,
  revisado_por uuid,
  revisado_en timestamptz,
  decision text check (decision in ('FACTURAR', 'PRESUPUESTAR', 'INFO', 'NO_FACTURABLE')),
  decision_nota text,
  stel_estado text not null default 'NO_ENVIADO' check (stel_estado in ('NO_ENVIADO', 'PENDIENTE', 'SINCRONIZADO', 'BLOQUEADO', 'ERROR')),
  stel_albaran_id bigint unique,
  stel_albaran_ref text,
  stel_albaran_version integer,
  stel_error text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists sat_partes_tecnico on public.sat_partes (tecnico_id, estado);
create index if not exists sat_partes_aviso on public.sat_partes (aviso_id);

create table if not exists public.sat_parte_versiones (
  id bigint generated always as identity primary key,
  parte_id uuid not null references public.sat_partes(id) on delete cascade,
  version integer not null,
  contenido jsonb not null,
  contenido_hash text not null,
  motivo text not null,
  guardado_por uuid,
  guardado_en timestamptz not null default now()
);

create table if not exists public.sat_firmas (
  id uuid primary key,
  parte_id uuid not null references public.sat_partes(id) on delete cascade,
  rol text not null check (rol in ('TECNICO', 'CLIENTE')),
  nombre text,
  cargo text,
  imagen_path text,
  ausente_motivo text,
  texto_alcance text not null,
  firmado_en timestamptz not null,
  recibido_en timestamptz not null default now(),
  contenido jsonb not null,
  contenido_hash text not null,
  parte_version integer,
  valida boolean not null,
  invalidada_en timestamptz,
  invalidada_motivo text,
  dispositivo text,
  registrado_por uuid not null
);
create index if not exists sat_firmas_parte on public.sat_firmas (parte_id, rol, valida);

create table if not exists public.sat_archivos (
  id uuid primary key,
  parte_id uuid not null references public.sat_partes(id) on delete cascade,
  tipo text not null check (tipo in ('FOTO', 'AUDIO', 'FIRMA', 'PDF_PARTE', 'PDF_FACTURA')),
  momento text check (momento in ('ANTES', 'DURANTE', 'DESPUES', 'MATERIAL')), -- MATERIAL: albarán o ticket del proveedor
  comentario text,
  storage_path text not null unique,
  mime_type text,
  bytes bigint,
  sha256 text,
  transcripcion text,
  subido_por uuid not null,
  creado_en timestamptz not null default now()
);

create table if not exists public.sat_facturas (
  id uuid primary key default gen_random_uuid(),
  parte_id uuid not null unique references public.sat_partes(id),
  estado text not null default 'APROBADA' check (estado in ('APROBADA', 'EN_STEL', 'EMITIDA', 'ERROR')),
  lineas jsonb not null,
  total_previsto numeric(14, 2) not null,
  aprobado_por uuid not null,
  aprobado_en timestamptz not null default now(),
  aprobacion_texto text not null,
  stel_factura_id bigint unique,
  stel_referencia text,
  stel_total numeric(14, 2),
  emitida_en timestamptz,
  pdf_path text,
  pdf_origen text check (pdf_origen in ('STEL', 'MANUAL')),
  entrega_estado text not null default 'SIN_PDF' check (entrega_estado in ('SIN_PDF', 'PENDIENTE_ENTREGA', 'ENTREGADA')),
  entregada_en timestamptz,
  entregada_por uuid,
  entrega_medio text
);

create table if not exists public.sat_stel_operaciones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('CLIENTE', 'INCIDENCIA', 'ALBARAN_TRABAJO', 'FACTURA')),
  clave text not null unique,
  parte_id uuid references public.sat_partes(id),
  aviso_id uuid references public.sat_avisos(id),
  cliente_id uuid references public.sat_clientes(id),
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'EN_CURSO', 'OK', 'ERROR', 'BLOQUEADA')),
  intentos integer not null default 0,
  stel_id bigint,
  detalle jsonb not null default '{}'::jsonb,
  error text,
  empezado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.sat_stel_llamadas (
  dia date primary key,
  llamadas integer not null default 0
);

create table if not exists public.sat_notificaciones (
  id bigint generated always as identity primary key,
  usuario_id uuid not null,
  tipo text not null,
  texto text not null,
  parte_id uuid,
  aviso_id uuid,
  leida boolean not null default false,
  creado_en timestamptz not null default now()
);
create index if not exists sat_notificaciones_usuario on public.sat_notificaciones (usuario_id, leida);

create table if not exists public.sat_auditoria (
  id bigint generated always as identity primary key,
  usuario_id uuid,
  accion text not null,
  entidad text not null,
  entidad_id uuid,
  detalle jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists sat_auditoria_entidad on public.sat_auditoria (entidad_id);

create table if not exists public.sat_ajustes (
  clave text primary key,
  valor jsonb,
  actualizado_por uuid,
  actualizado_en timestamptz not null default now()
);
insert into public.sat_ajustes (clave, valor) values
  ('texto_alcance_firma', to_jsonb('Con esta firma se deja constancia de la visita, de los trabajos realizados, de los materiales utilizados y del estado en que queda la instalación, tal como figuran en este parte. La firma NO supone la aceptación de precios ni importes, que se presentarán por separado.'::text)),
  ('stel_servicio_mano_obra_id', 'null'::jsonb),
  ('stel_servicio_desplazamiento_id', 'null'::jsonb),
  ('stel_serie_albaran_trabajo_id', 'null'::jsonb),
  ('stel_emitir_factura', 'false'::jsonb),
  ('stel_limite_llamadas_dia', '250'::jsonb),
  ('transcripcion_url', to_jsonb('https://dafrica-parte-backend.onrender.com/transcribir'::text))
on conflict (clave) do nothing;

do $$
declare t text;
begin
  foreach t in array array['sat_clientes','sat_direcciones','sat_contactos','sat_equipos','sat_articulos','sat_avisos',
    'sat_partes','sat_parte_versiones','sat_firmas','sat_archivos','sat_facturas','sat_stel_operaciones','sat_stel_llamadas',
    'sat_notificaciones','sat_auditoria','sat_ajustes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.sat_aviso_seq, public.sat_parte_seq from anon, authenticated;

-- ============================================================ Ayudas internas
create or replace function public.sat_hash(p jsonb) returns text language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(p::text, 'UTF8')), 'hex')
$$;

create or replace function public.sat_exigir(p_permiso text) returns void language plpgsql stable security definer
set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.tiene_permiso(p_permiso), false) then
    raise exception 'sin_permiso: %', p_permiso using errcode = '42501';
  end if;
end $$;

create or replace function public.sat_puede(p_permiso text) returns boolean language sql stable security definer
set search_path = public as $$
  select auth.uid() is not null and coalesce(public.tiene_permiso(p_permiso), false)
$$;

-- Usuarios activos con un permiso (misma regla que tiene_permiso: excepción individual, ADMIN, rol).
create or replace function public.sat_usuarios_con(p_permiso text) returns setof uuid language sql stable security definer
set search_path = public as $$
  select pf.id from public.perfiles pf
  where pf.activo and coalesce(
    (select up.permitido from public.usuario_permisos up join public.permisos p on p.id = up.permiso_id
      where up.usuario_id = pf.id and p.codigo = p_permiso limit 1),
    exists (select 1 from public.usuario_roles ur join public.roles r on r.id = ur.rol_id
      where ur.usuario_id = pf.id and r.codigo = 'ADMIN')
    or exists (select 1 from public.usuario_roles ur join public.rol_permisos rp on rp.rol_id = ur.rol_id
      join public.permisos p on p.id = rp.permiso_id where ur.usuario_id = pf.id and p.codigo = p_permiso))
$$;

create or replace function public.sat_auditar(p_accion text, p_entidad text, p_id uuid, p_detalle jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.sat_auditoria (usuario_id, accion, entidad, entidad_id, detalle) values (auth.uid(), p_accion, p_entidad, p_id, p_detalle)
$$;

create or replace function public.sat_notificar(p_usuario uuid, p_tipo text, p_texto text, p_parte uuid default null, p_aviso uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.sat_notificaciones (usuario_id, tipo, texto, parte_id, aviso_id)
  select p_usuario, p_tipo, p_texto, p_parte, p_aviso where p_usuario is not null
$$;

create or replace function public.sat_notificar_permiso(p_permiso text, p_tipo text, p_texto text, p_parte uuid default null, p_aviso uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.sat_notificaciones (usuario_id, tipo, texto, parte_id, aviso_id)
  select u, p_tipo, p_texto, p_parte, p_aviso from public.sat_usuarios_con(p_permiso) u
$$;

create or replace function public.sat_nuevo_codigo(p_prefijo text) returns text language sql volatile security definer
set search_path = public as $$
  select p_prefijo || '-' || to_char(now() at time zone 'Europe/Madrid', 'YY') || '-' ||
    lpad(nextval(case when p_prefijo = 'AV' then 'public.sat_aviso_seq' else 'public.sat_parte_seq' end)::text, 5, '0')
$$;

create or replace function public.sat_ajuste(p_clave text) returns jsonb language sql stable security definer
set search_path = public as $$ select valor from public.sat_ajustes where clave = p_clave $$;

-- Total con IVA de unas líneas económicas (cada línea redondeada a céntimos; igual que sat/lib/economia.js).
create or replace function public.sat_total(p_lineas jsonb) returns numeric language sql immutable set search_path = public as $$
  select coalesce(sum(round(base * (1 + coalesce((l->>'iva_pct')::numeric, 0) / 100), 2)), 0)
  from (select l, round(coalesce((l->>'cantidad')::numeric, 0) * coalesce((l->>'precio')::numeric, 0)
    * (1 - coalesce((l->>'descuento_pct')::numeric, 0) / 100), 2) as base
    from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) l) x
$$;

-- Ruta del almacén: «<id del parte>/<fichero>». Solo el técnico del parte (mientras lo puede cambiar) o
-- administración pueden subir; ver: el técnico del parte o administración.
create or replace function public.sat_parte_de_ruta(p_ruta text) returns uuid language sql immutable set search_path = public as $$
  select case when split_part(p_ruta, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_ruta, '/', 1)::uuid end
$$;
create or replace function public.sat_puede_ver_ruta(p_ruta text) returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.sat_partes p where p.id = public.sat_parte_de_ruta(p_ruta)
    and ((p.tecnico_id = auth.uid() and public.sat_puede('sat.tecnico')) or public.sat_puede('sat.administrar')))
$$;
create or replace function public.sat_puede_subir_ruta(p_ruta text) returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.sat_partes p where p.id = public.sat_parte_de_ruta(p_ruta)
    and ((p.tecnico_id = auth.uid() and public.sat_puede('sat.tecnico') and p.estado in ('BORRADOR', 'FIRMADO', 'INFO_SOLICITADA'))
      or public.sat_puede('sat.administrar')))
$$;

-- ============================================================ Almacén privado de archivos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('sat-archivos', 'sat-archivos', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav'])
on conflict (id) do nothing;
-- Sin políticas de cambiar ni borrar: los archivos no se sobrescriben (cada uno tiene su id).
drop policy if exists sat_archivos_ver on storage.objects;
create policy sat_archivos_ver on storage.objects for select to authenticated
  using (bucket_id = 'sat-archivos' and public.sat_puede_ver_ruta(name));
drop policy if exists sat_archivos_subir on storage.objects;
create policy sat_archivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'sat-archivos' and public.sat_puede_subir_ruta(name));

-- ============================================================ Lectura en forma de JSON
create or replace function public.sat_parte_json(p_id uuid, p_completo boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'contenido' - 'revision' || jsonb_build_object(
    'contenido', p.contenido,
    'revision', p.revision,
    'aviso', (select to_jsonb(a) from public.sat_avisos a where a.id = p.aviso_id),
    'tecnico_nombre', (select pf.nombre from public.perfiles pf where pf.id = p.tecnico_id),
    'firmas', coalesce((select jsonb_agg(to_jsonb(f) - 'contenido' order by f.recibido_en) from public.sat_firmas f
      where f.parte_id = p.id and (f.valida or p_completo)), '[]'::jsonb),
    'factura', (select to_jsonb(fa) from public.sat_facturas fa where fa.parte_id = p.id),
    'total_revision', public.sat_total(p.revision))
  || case when p_completo then jsonb_build_object(
    'archivos', coalesce((select jsonb_agg(to_jsonb(ar) order by ar.creado_en) from public.sat_archivos ar where ar.parte_id = p.id), '[]'::jsonb),
    'versiones', coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'motivo', v.motivo, 'guardado_en', v.guardado_en,
        'guardado_por', (select pf.nombre from public.perfiles pf where pf.id = v.guardado_por), 'contenido', v.contenido) order by v.id)
      from public.sat_parte_versiones v where v.parte_id = p.id), '[]'::jsonb),
    'operaciones', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'tipo', o.tipo, 'estado', o.estado, 'intentos', o.intentos,
        'stel_id', o.stel_id, 'error', o.error, 'actualizado_en', o.actualizado_en) order by o.creado_en)
      from public.sat_stel_operaciones o where o.parte_id = p.id or (o.aviso_id = p.aviso_id and o.tipo = 'INCIDENCIA')), '[]'::jsonb),
    'auditoria', coalesce((select jsonb_agg(jsonb_build_object('accion', au.accion, 'creado_en', au.creado_en,
        'usuario', (select pf.nombre from public.perfiles pf where pf.id = au.usuario_id), 'detalle', au.detalle) order by au.id)
      from public.sat_auditoria au where au.entidad_id in (p.id, p.aviso_id)
        or au.entidad_id in (select fa.id from public.sat_facturas fa where fa.parte_id = p.id)), '[]'::jsonb))
  else '{}'::jsonb end
  from public.sat_partes p where p.id = p_id
$$;

-- ============================================================ Funciones de la aplicación
create or replace function public.sat_yo() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sin_sesion' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', auth.uid(),
    'nombre', (select coalesce(nombre, email) from public.perfiles where id = auth.uid()),
    'email', (select email from public.perfiles where id = auth.uid()),
    'permisos', to_jsonb(array(select c from unnest(array['sat.tecnico', 'sat.administrar', 'sat.facturar']) c where public.sat_puede(c))),
    'texto_alcance_firma', public.sat_ajuste('texto_alcance_firma'),
    'transcripcion_url', public.sat_ajuste('transcripcion_url'),
    'no_leidas', (select count(*) from public.sat_notificaciones where usuario_id = auth.uid() and not leida));
end $$;

-- Catálogo para trabajar sin conexión (clientes, direcciones, contactos, equipos, artículos y servicios).
create or replace function public.sat_catalogo() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.sat_puede('sat.tecnico') or public.sat_puede('sat.administrar')) then
    raise exception 'sin_permiso: sat' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'stel_id', stel_id, 'nombre', nombre, 'nif', nif,
      'telefono', telefono, 'provisional', provisional) order by nombre) from public.sat_clientes where fusionado_en is null), '[]'::jsonb),
    'direcciones', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'cliente_id', cliente_id, 'stel_id', stel_id, 'texto', texto,
      'provisional', provisional)) from public.sat_direcciones), '[]'::jsonb),
    'contactos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'cliente_id', cliente_id, 'nombre', nombre, 'cargo', cargo,
      'telefono', telefono, 'provisional', provisional)) from public.sat_contactos), '[]'::jsonb),
    'equipos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'cliente_id', cliente_id, 'direccion_id', direccion_id,
      'stel_id', stel_id, 'nombre', nombre, 'marca', marca, 'modelo', modelo, 'numero_serie', numero_serie, 'provisional', provisional))
      from public.sat_equipos), '[]'::jsonb),
    'articulos', coalesce((select jsonb_agg(jsonb_build_object('stel_id', stel_id, 'tipo', tipo, 'referencia', referencia,
      'nombre', nombre) order by nombre) from public.sat_articulos where activo), '[]'::jsonb),
    'tecnicos', coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'nombre', coalesce(pf.nombre, pf.email)) order by pf.nombre)
      from public.perfiles pf where pf.id in (select public.sat_usuarios_con('sat.tecnico'))), '[]'::jsonb),
    'generado_en', now());
end $$;

-- Alta provisional (técnico o administración) de cliente, dirección, contacto o equipo. El id lo genera
-- el teléfono: repetir la llamada no duplica.
create or replace function public.sat_alta_provisional(p_tipo text, p_datos jsonb) returns jsonb language plpgsql
security definer set search_path = public as $$
declare v_id uuid := (p_datos->>'id')::uuid; v_cli uuid := (p_datos->>'cliente_id')::uuid;
begin
  if not (public.sat_puede('sat.tecnico') or public.sat_puede('sat.administrar')) then
    raise exception 'sin_permiso: sat' using errcode = '42501';
  end if;
  if v_id is null then raise exception 'falta_id'; end if;
  if p_tipo = 'CLIENTE' then
    if coalesce(trim(p_datos->>'nombre'), '') = '' then raise exception 'falta_nombre'; end if;
    insert into public.sat_clientes (id, nombre, nif, telefono, email, provisional, creado_por)
    values (v_id, trim(p_datos->>'nombre'), nullif(upper(regexp_replace(coalesce(p_datos->>'nif', ''), '[\s.-]', '', 'g')), ''),
      nullif(trim(p_datos->>'telefono'), ''), nullif(trim(p_datos->>'email'), ''), true, auth.uid())
    on conflict (id) do nothing;
  else
    if not exists (select 1 from public.sat_clientes where id = v_cli) then raise exception 'cliente_no_existe'; end if;
    if p_tipo = 'DIRECCION' then
      if coalesce(trim(p_datos->>'texto'), '') = '' then raise exception 'falta_direccion'; end if;
      insert into public.sat_direcciones (id, cliente_id, texto, provisional, creado_por)
      values (v_id, v_cli, trim(p_datos->>'texto'), true, auth.uid()) on conflict (id) do nothing;
    elsif p_tipo = 'CONTACTO' then
      if coalesce(trim(p_datos->>'nombre'), '') = '' then raise exception 'falta_nombre'; end if;
      insert into public.sat_contactos (id, cliente_id, nombre, cargo, telefono, email, provisional, creado_por)
      values (v_id, v_cli, trim(p_datos->>'nombre'), nullif(trim(p_datos->>'cargo'), ''), nullif(trim(p_datos->>'telefono'), ''),
        nullif(trim(p_datos->>'email'), ''), true, auth.uid()) on conflict (id) do nothing;
    elsif p_tipo = 'EQUIPO' then
      if coalesce(trim(p_datos->>'nombre'), '') = '' then raise exception 'falta_nombre'; end if;
      insert into public.sat_equipos (id, cliente_id, direccion_id, nombre, marca, modelo, numero_serie, provisional, creado_por)
      values (v_id, v_cli, (p_datos->>'direccion_id')::uuid, trim(p_datos->>'nombre'), nullif(trim(p_datos->>'marca'), ''),
        nullif(trim(p_datos->>'modelo'), ''), nullif(trim(p_datos->>'numero_serie'), ''), true, auth.uid()) on conflict (id) do nothing;
    else
      raise exception 'tipo_desconocido: %', p_tipo;
    end if;
  end if;
  perform public.sat_auditar('ALTA_PROVISIONAL_' || p_tipo, 'catalogo', v_id, p_datos);
  return jsonb_build_object('id', v_id, 'tipo', p_tipo);
end $$;

-- Crear o cambiar un aviso. Técnico: crea los suyos (llamada directa) y cambia los suyos abiertos.
-- Administración: crea, cambia y asigna cualquiera.
create or replace function public.sat_aviso_guardar(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_admin boolean := public.sat_puede('sat.administrar');
  v_tec boolean := public.sat_puede('sat.tecnico');
  a public.sat_avisos;
  v_tecnico uuid;
  v_anterior uuid;
begin
  if not (v_admin or v_tec) then raise exception 'sin_permiso: sat' using errcode = '42501'; end if;
  if v_id is null then raise exception 'falta_id'; end if;
  if coalesce(trim(p->>'motivo'), '') = '' then raise exception 'falta_motivo'; end if;
  if coalesce(p->>'prioridad', 'NORMAL') not in ('BAJA', 'NORMAL', 'ALTA', 'URGENTE') then raise exception 'prioridad_no_valida'; end if;
  select * into a from public.sat_avisos where id = v_id for update;
  v_tecnico := case when v_admin then (p->>'tecnico_id')::uuid else auth.uid() end;
  if not found then
    insert into public.sat_avisos (id, codigo, cliente_id, direccion_id, contacto_id, equipo_id, cliente_texto, direccion_texto,
      contacto_texto, equipo_texto, motivo, prioridad, origen, estado, tecnico_id, programado_para, notas, creado_por)
    values (v_id, public.sat_nuevo_codigo('AV'), (p->>'cliente_id')::uuid, (p->>'direccion_id')::uuid, (p->>'contacto_id')::uuid,
      (p->>'equipo_id')::uuid, p->>'cliente_texto', p->>'direccion_texto', p->>'contacto_texto', p->>'equipo_texto',
      trim(p->>'motivo'), coalesce(p->>'prioridad', 'NORMAL'),
      case when v_admin and coalesce(p->>'origen', 'ADMINISTRACION') = 'ADMINISTRACION' then 'ADMINISTRACION' else 'LLAMADA_TECNICO' end,
      case when v_tecnico is null then 'NUEVO' else 'ASIGNADO' end, v_tecnico, (p->>'programado_para')::timestamptz, p->>'notas', auth.uid())
    returning * into a;
    perform public.sat_auditar('AVISO_CREADO', 'aviso', v_id, jsonb_build_object('codigo', a.codigo, 'origen', a.origen));
    if a.origen = 'LLAMADA_TECNICO' then
      perform public.sat_notificar_permiso('sat.administrar', 'AVISO_TECNICO', 'Aviso ' || a.codigo || ' creado por el técnico: ' || a.motivo, null, a.id);
    end if;
    if a.tecnico_id is not null and a.tecnico_id <> auth.uid() then
      perform public.sat_notificar(a.tecnico_id, 'AVISO_ASIGNADO', 'Nuevo aviso ' || a.codigo || ': ' || a.motivo, null, a.id);
    end if;
  else
    if not v_admin and (a.tecnico_id is distinct from auth.uid() or a.estado in ('CERRADO', 'ANULADO')) then
      raise exception 'aviso_no_editable' using errcode = '42501';
    end if;
    v_anterior := a.tecnico_id;
    update public.sat_avisos set
      cliente_id = (p->>'cliente_id')::uuid, direccion_id = (p->>'direccion_id')::uuid, contacto_id = (p->>'contacto_id')::uuid,
      equipo_id = (p->>'equipo_id')::uuid, cliente_texto = p->>'cliente_texto', direccion_texto = p->>'direccion_texto',
      contacto_texto = p->>'contacto_texto', equipo_texto = p->>'equipo_texto', motivo = trim(p->>'motivo'),
      prioridad = coalesce(p->>'prioridad', 'NORMAL'), notas = p->>'notas', programado_para = (p->>'programado_para')::timestamptz,
      tecnico_id = v_tecnico,
      estado = case when v_admin and p->>'estado' = 'ANULADO' then 'ANULADO'
                    when estado = 'NUEVO' and v_tecnico is not null then 'ASIGNADO' else estado end,
      actualizado_en = now()
    where id = v_id returning * into a;
    perform public.sat_auditar('AVISO_CAMBIADO', 'aviso', v_id, p);
    if a.tecnico_id is not null and a.tecnico_id is distinct from v_anterior and a.tecnico_id <> auth.uid() then
      perform public.sat_notificar(a.tecnico_id, 'AVISO_ASIGNADO', 'Aviso asignado ' || a.codigo || ': ' || a.motivo, null, a.id);
    end if;
  end if;
  return to_jsonb(a);
end $$;

create or replace function public.sat_avisos_listar() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := public.sat_puede('sat.administrar');
begin
  if not (v_admin or public.sat_puede('sat.tecnico')) then raise exception 'sin_permiso: sat' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object(
      'tecnico_nombre', (select pf.nombre from public.perfiles pf where pf.id = a.tecnico_id),
      'partes', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'estado', p.estado)) from public.sat_partes p
        where p.aviso_id = a.id), '[]'::jsonb))
      order by case a.prioridad when 'URGENTE' then 0 when 'ALTA' then 1 when 'NORMAL' then 2 else 3 end, a.creado_en)
    from public.sat_avisos a
    where (v_admin or a.tecnico_id = auth.uid())
      and (a.estado not in ('CERRADO', 'ANULADO') or a.actualizado_en > now() - interval '30 days')), '[]'::jsonb);
end $$;

-- Guardar el parte (técnico). Repetir con el mismo contenido no cambia nada. Si cambia después de
-- firmar, las firmas quedan invalidadas, se registra la versión y hay que volver a firmar.
create or replace function public.sat_parte_guardar(p_parte jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p_parte->>'id')::uuid;
  v_aviso uuid := (p_parte->>'aviso_id')::uuid;
  v_cont jsonb := p_parte->'contenido';
  r public.sat_partes;
  a public.sat_avisos;
  v_inv integer := 0;
begin
  perform public.sat_exigir('sat.tecnico');
  if v_id is null or v_cont is null or jsonb_typeof(v_cont) <> 'object' then raise exception 'datos_incompletos'; end if;
  select * into r from public.sat_partes where id = v_id for update;
  if not found then
    select * into a from public.sat_avisos where id = v_aviso for update;
    if not found then raise exception 'aviso_no_existe'; end if;
    if a.tecnico_id is distinct from auth.uid() then raise exception 'aviso_de_otro_tecnico' using errcode = '42501'; end if;
    if a.estado in ('CERRADO', 'ANULADO') then raise exception 'aviso_cerrado'; end if;
    insert into public.sat_partes (id, codigo, aviso_id, tecnico_id, estado, contenido, contenido_hash, version)
    values (v_id, public.sat_nuevo_codigo('PT'), v_aviso, auth.uid(), 'BORRADOR', v_cont, public.sat_hash(v_cont), 1)
    returning * into r;
    update public.sat_avisos set estado = 'EN_CURSO', actualizado_en = now() where id = v_aviso and estado in ('NUEVO', 'ASIGNADO');
    perform public.sat_auditar('PARTE_CREADO', 'parte', v_id, jsonb_build_object('codigo', r.codigo, 'aviso', a.codigo));
    return public.sat_parte_json(v_id) || jsonb_build_object('firmas_invalidadas', 0);
  end if;
  if r.tecnico_id <> auth.uid() then raise exception 'parte_de_otro_tecnico' using errcode = '42501'; end if;
  if r.contenido = v_cont then
    return public.sat_parte_json(v_id) || jsonb_build_object('firmas_invalidadas', 0, 'sin_cambios', true);
  end if;
  if r.estado not in ('BORRADOR', 'FIRMADO', 'INFO_SOLICITADA') then raise exception 'parte_no_editable: %', r.estado; end if;
  update public.sat_firmas set valida = false, invalidada_en = now(),
    invalidada_motivo = 'El contenido del parte cambió después de firmar (versión ' || r.version || ' → ' || (r.version + 1) || ')'
  where parte_id = v_id and valida;
  get diagnostics v_inv = row_count;
  update public.sat_partes set contenido = v_cont, contenido_hash = public.sat_hash(v_cont), version = version + 1,
    estado = case when estado = 'FIRMADO' then 'BORRADOR' else estado end, actualizado_en = now()
  where id = v_id returning * into r;
  if v_inv > 0 or r.estado = 'INFO_SOLICITADA' then
    insert into public.sat_parte_versiones (parte_id, version, contenido, contenido_hash, motivo, guardado_por)
    values (v_id, r.version, v_cont, r.contenido_hash,
      case when v_inv > 0 then 'Corrección después de firmar: requiere nueva firma' else 'Corrección pedida por administración' end, auth.uid());
    perform public.sat_auditar('PARTE_CORREGIDO', 'parte', v_id, jsonb_build_object('version', r.version, 'firmas_invalidadas', v_inv));
  end if;
  return public.sat_parte_json(v_id) || jsonb_build_object('firmas_invalidadas', v_inv);
end $$;

-- Registrar un archivo ya subido al almacén (foto, audio, firma, PDF). Idempotente por id.
create or replace function public.sat_archivo_registrar(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid := (p->>'id')::uuid; v_parte uuid := (p->>'parte_id')::uuid; x public.sat_archivos; r public.sat_partes;
begin
  select * into x from public.sat_archivos where id = v_id;
  if found then
    if x.subido_por <> auth.uid() and not public.sat_puede('sat.administrar') then raise exception 'sin_permiso' using errcode = '42501'; end if;
    if p ? 'transcripcion' and p->>'transcripcion' is distinct from x.transcripcion then
      update public.sat_archivos set transcripcion = p->>'transcripcion' where id = v_id returning * into x;
    end if;
    return to_jsonb(x);
  end if;
  select * into r from public.sat_partes where id = v_parte;
  if not found then raise exception 'parte_no_existe'; end if;
  if coalesce(p->>'tipo', '') = 'PDF_FACTURA' then
    perform public.sat_exigir('sat.administrar');
  elsif not (r.tecnico_id = auth.uid() and public.sat_puede('sat.tecnico')) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  if public.sat_parte_de_ruta(p->>'storage_path') is distinct from v_parte then raise exception 'ruta_no_valida'; end if;
  insert into public.sat_archivos (id, parte_id, tipo, momento, comentario, storage_path, mime_type, bytes, sha256, transcripcion, subido_por)
  values (v_id, v_parte, p->>'tipo', nullif(p->>'momento', ''), nullif(p->>'comentario', ''), p->>'storage_path', p->>'mime_type',
    (p->>'bytes')::bigint, p->>'sha256', p->>'transcripcion', auth.uid())
  returning * into x;
  perform public.sat_auditar('ARCHIVO_' || x.tipo, 'parte', v_parte, jsonb_build_object('archivo', v_id, 'ruta', x.storage_path, 'sha256', x.sha256));
  return to_jsonb(x);
end $$;

-- Registrar una firma. Es válida solo si el contenido firmado es EXACTAMENTE el actual del parte.
create or replace function public.sat_firma_registrar(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid; v_rol text := p->>'rol'; v_valida boolean;
  r public.sat_partes; f public.sat_firmas;
begin
  perform public.sat_exigir('sat.tecnico');
  select * into f from public.sat_firmas where id = v_id;
  if found then
    return to_jsonb(f) - 'contenido' || jsonb_build_object('estado_parte', (select estado from public.sat_partes where id = f.parte_id));
  end if;
  select * into r from public.sat_partes where id = (p->>'parte_id')::uuid for update;
  if not found then raise exception 'parte_no_existe'; end if;
  if r.tecnico_id <> auth.uid() then raise exception 'parte_de_otro_tecnico' using errcode = '42501'; end if;
  if r.estado not in ('BORRADOR', 'FIRMADO', 'INFO_SOLICITADA') then raise exception 'parte_no_firmable: %', r.estado; end if;
  if v_rol not in ('TECNICO', 'CLIENTE') then raise exception 'rol_no_valido'; end if;
  if coalesce(trim(p->>'texto_alcance'), '') = '' or p->'contenido' is null or p->>'firmado_en' is null then raise exception 'datos_incompletos'; end if;
  if p->>'imagen_path' is not null and public.sat_parte_de_ruta(p->>'imagen_path') is distinct from r.id then raise exception 'ruta_no_valida'; end if;
  if v_rol = 'TECNICO' and p->>'imagen_path' is null then raise exception 'falta_firma_tecnico'; end if;
  if v_rol = 'CLIENTE' and p->>'imagen_path' is null and length(trim(coalesce(p->>'ausente_motivo', ''))) < 3 then
    raise exception 'falta_firma_o_motivo';
  end if;
  if v_rol = 'CLIENTE' and p->>'imagen_path' is not null and coalesce(trim(p->>'nombre'), '') = '' then raise exception 'falta_nombre_firmante'; end if;
  v_valida := (p->'contenido') = r.contenido;
  if v_valida then
    update public.sat_firmas set valida = false, invalidada_en = now(), invalidada_motivo = 'Sustituida por una firma posterior'
    where parte_id = r.id and rol = v_rol and valida;
  end if;
  insert into public.sat_firmas (id, parte_id, rol, nombre, cargo, imagen_path, ausente_motivo, texto_alcance, firmado_en, contenido,
    contenido_hash, parte_version, valida, invalidada_en, invalidada_motivo, dispositivo, registrado_por)
  values (v_id, r.id, v_rol,
    case when v_rol = 'TECNICO' then coalesce(nullif(trim(p->>'nombre'), ''), (select nombre from public.perfiles where id = auth.uid())) else nullif(trim(p->>'nombre'), '') end,
    nullif(trim(p->>'cargo'), ''), p->>'imagen_path', case when p->>'imagen_path' is null then trim(p->>'ausente_motivo') end,
    p->>'texto_alcance', (p->>'firmado_en')::timestamptz, p->'contenido', public.sat_hash(p->'contenido'),
    case when v_valida then r.version end, v_valida, case when not v_valida then now() end,
    case when not v_valida then 'Se firmó un contenido distinto del actual: hay que volver a firmar' end,
    left(p->>'dispositivo', 200), auth.uid())
  returning * into f;
  if v_valida and exists (select 1 from public.sat_firmas where parte_id = r.id and rol = 'TECNICO' and valida)
     and exists (select 1 from public.sat_firmas where parte_id = r.id and rol = 'CLIENTE' and valida) then
    update public.sat_partes set estado = 'FIRMADO', actualizado_en = now() where id = r.id;
    insert into public.sat_parte_versiones (parte_id, version, contenido, contenido_hash, motivo, guardado_por)
    select r.id, r.version, r.contenido, r.contenido_hash, 'Versión firmada', auth.uid()
    where not exists (select 1 from public.sat_parte_versiones where parte_id = r.id and version = r.version and motivo = 'Versión firmada');
  end if;
  perform public.sat_auditar(case when v_valida then 'FIRMA_' || v_rol else 'FIRMA_' || v_rol || '_NO_VALIDA' end, 'parte', r.id,
    jsonb_build_object('firma', v_id, 'nombre', f.nombre, 'cargo', f.cargo, 'ausente_motivo', f.ausente_motivo, 'version', r.version));
  return to_jsonb(f) - 'contenido' || jsonb_build_object('estado_parte', (select estado from public.sat_partes where id = r.id));
end $$;

-- Enviar a administración (técnico): con las dos firmas válidas y el PDF firmado ya subido.
create or replace function public.sat_parte_enviar(p_id uuid, p_pdf_path text, p_pdf_sha256 text) returns jsonb language plpgsql
security definer set search_path = public as $$
declare r public.sat_partes; a public.sat_avisos; c jsonb;
begin
  perform public.sat_exigir('sat.tecnico');
  select * into r from public.sat_partes where id = p_id for update;
  if not found then raise exception 'parte_no_existe'; end if;
  if r.tecnico_id <> auth.uid() then raise exception 'parte_de_otro_tecnico' using errcode = '42501'; end if;
  if r.estado not in ('BORRADOR', 'FIRMADO', 'INFO_SOLICITADA') and r.pdf_hash = p_pdf_sha256 then
    return public.sat_parte_json(p_id) || jsonb_build_object('ya_enviado', true);
  end if;
  if r.estado <> 'FIRMADO' then raise exception 'parte_sin_firmas: %', r.estado; end if;
  if not exists (select 1 from public.sat_firmas where parte_id = p_id and rol = 'TECNICO' and valida and parte_version = r.version)
     or not exists (select 1 from public.sat_firmas where parte_id = p_id and rol = 'CLIENTE' and valida and parte_version = r.version) then
    raise exception 'parte_sin_firmas';
  end if;
  if not exists (select 1 from public.sat_archivos where parte_id = p_id and tipo = 'PDF_PARTE' and storage_path = p_pdf_path and sha256 = p_pdf_sha256) then
    raise exception 'pdf_no_subido';
  end if;
  c := r.contenido;
  if coalesce(c->>'tipo_visita', '') not in ('DIAGNOSTICO', 'REPARACION_FINALIZADA', 'PENDIENTE') then raise exception 'falta_tipo_visita'; end if;
  if c->>'tipo_visita' = 'PENDIENTE' and coalesce(c->>'pendiente_de', '') not in ('PRESUPUESTO', 'REPUESTOS', 'SEGUNDA_VISITA') then
    raise exception 'falta_motivo_pendiente';
  end if;
  if coalesce(c->>'fecha', '') = '' or coalesce(c->>'hora_inicio', '') = '' or coalesce(c->>'hora_fin', '') = '' then raise exception 'faltan_fecha_horas'; end if;
  update public.sat_partes set estado = 'ENVIADO', pdf_path = p_pdf_path, pdf_hash = p_pdf_sha256, pdf_version = version,
    enviado_en = now(), stel_estado = 'PENDIENTE', stel_error = null, actualizado_en = now()
  where id = p_id returning * into r;
  select * into a from public.sat_avisos where id = r.aviso_id for update;
  update public.sat_avisos set estado = case when c->>'tipo_visita' = 'REPARACION_FINALIZADA' then 'CERRADO' else 'EN_CURSO' end,
    actualizado_en = now() where id = a.id;
  if a.stel_incidencia_id is null then
    insert into public.sat_stel_operaciones (tipo, clave, aviso_id, parte_id) values ('INCIDENCIA', 'inc:' || a.id, a.id, p_id)
    on conflict (clave) do update set estado = case when sat_stel_operaciones.estado = 'OK' then 'OK' else 'PENDIENTE' end, actualizado_en = now();
  end if;
  insert into public.sat_stel_operaciones (tipo, clave, parte_id, aviso_id, detalle) values ('ALBARAN_TRABAJO', 'wdn:' || p_id, p_id, a.id,
    jsonb_build_object('version', r.version))
  on conflict (clave) do update set estado = 'PENDIENTE', intentos = 0, error = null,
    detalle = sat_stel_operaciones.detalle || jsonb_build_object('version', r.version), actualizado_en = now();
  perform public.sat_auditar('PARTE_ENVIADO', 'parte', p_id, jsonb_build_object('version', r.version, 'pdf', p_pdf_path, 'sha256', p_pdf_sha256));
  perform public.sat_notificar_permiso('sat.administrar', 'PARTE_RECIBIDO', 'Parte ' || r.codigo || ' recibido (' || a.codigo || ': ' || a.motivo || ')', p_id, a.id);
  return public.sat_parte_json(p_id);
end $$;

create or replace function public.sat_partes_listar(p_estado text default null) returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare v_admin boolean := public.sat_puede('sat.administrar');
begin
  if not (v_admin or public.sat_puede('sat.tecnico')) then raise exception 'sin_permiso: sat' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'estado', p.estado, 'version', p.version,
      'aviso_id', p.aviso_id, 'aviso_codigo', a.codigo, 'motivo', a.motivo, 'prioridad', a.prioridad,
      'cliente', coalesce(p.contenido->'cliente'->>'nombre', a.cliente_texto), 'tipo_visita', p.contenido->>'tipo_visita',
      'fecha', p.contenido->>'fecha', 'tecnico_id', p.tecnico_id, 'tecnico_nombre', (select pf.nombre from public.perfiles pf where pf.id = p.tecnico_id),
      'stel_estado', p.stel_estado, 'stel_albaran_ref', p.stel_albaran_ref, 'enviado_en', p.enviado_en, 'actualizado_en', p.actualizado_en,
      'factura_estado', (select f.estado from public.sat_facturas f where f.parte_id = p.id),
      'entrega_estado', (select f.entrega_estado from public.sat_facturas f where f.parte_id = p.id))
      order by p.actualizado_en desc)
    from public.sat_partes p join public.sat_avisos a on a.id = p.aviso_id
    where (v_admin or p.tecnico_id = auth.uid()) and (p_estado is null or p.estado = p_estado)
      and (p.estado not in ('FACTURADO', 'NO_FACTURABLE') or p.actualizado_en > now() - interval '60 days')), '[]'::jsonb);
end $$;

create or replace function public.sat_parte_detalle(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.sat_partes;
begin
  select * into r from public.sat_partes where id = p_id;
  if not found then raise exception 'parte_no_existe'; end if;
  if not (public.sat_puede('sat.administrar') or (r.tecnico_id = auth.uid() and public.sat_puede('sat.tecnico'))) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  return public.sat_parte_json(p_id, true);
end $$;

-- Revisión económica (administración). Líneas: [{tipo, material_id?, stel_item_id, descripcion, cantidad,
-- precio, descuento_pct, iva_pct}]. Si el albarán de trabajo esperaba artículos de STEL, se reintenta.
create or replace function public.sat_revision_guardar(p_id uuid, p_lineas jsonb, p_nota text default null) returns jsonb language plpgsql
security definer set search_path = public as $$
declare r public.sat_partes; l jsonb;
begin
  perform public.sat_exigir('sat.administrar');
  select * into r from public.sat_partes where id = p_id for update;
  if not found then raise exception 'parte_no_existe'; end if;
  if r.estado not in ('ENVIADO', 'EN_REVISION', 'PRESUPUESTAR', 'PENDIENTE_APROBACION') then raise exception 'parte_no_revisable: %', r.estado; end if;
  if jsonb_typeof(p_lineas) <> 'array' then raise exception 'lineas_no_validas'; end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    if coalesce(l->>'tipo', '') not in ('MATERIAL', 'MANO_OBRA', 'DESPLAZAMIENTO', 'OTRO') then raise exception 'tipo_de_linea_no_valido'; end if;
    if (l->>'precio') is not null and (l->>'precio')::numeric < 0 then raise exception 'precio_negativo'; end if;
    if coalesce((l->>'descuento_pct')::numeric, 0) not between 0 and 100 then raise exception 'descuento_no_valido'; end if;
  end loop;
  update public.sat_partes set revision = p_lineas, revision_nota = p_nota, revisado_por = auth.uid(), revisado_en = now(),
    estado = 'EN_REVISION', actualizado_en = now()
  where id = p_id;
  update public.sat_stel_operaciones set estado = 'PENDIENTE', error = null, actualizado_en = now()
  where clave = 'wdn:' || p_id and estado = 'BLOQUEADA';
  update public.sat_partes set stel_estado = 'PENDIENTE' where id = p_id and stel_estado = 'BLOQUEADO';
  perform public.sat_auditar('REVISION_GUARDADA', 'parte', p_id, jsonb_build_object('anterior', r.revision, 'nueva', p_lineas,
    'total', public.sat_total(p_lineas), 'nota', p_nota));
  return public.sat_parte_json(p_id, true);
end $$;

-- Decisión de administración: FACTURAR (pasa a aprobación), PRESUPUESTAR, INFO (vuelve al técnico) o NO_FACTURABLE.
create or replace function public.sat_decidir(p_id uuid, p_decision text, p_nota text default null) returns jsonb language plpgsql
security definer set search_path = public as $$
declare r public.sat_partes; l jsonb;
begin
  perform public.sat_exigir('sat.administrar');
  select * into r from public.sat_partes where id = p_id for update;
  if not found then raise exception 'parte_no_existe'; end if;
  if r.estado not in ('ENVIADO', 'EN_REVISION', 'PRESUPUESTAR', 'PENDIENTE_APROBACION') then raise exception 'parte_no_revisable: %', r.estado; end if;
  if exists (select 1 from public.sat_facturas where parte_id = p_id) then raise exception 'ya_facturado'; end if;
  if p_decision in ('INFO', 'NO_FACTURABLE') and length(trim(coalesce(p_nota, ''))) < 3 then raise exception 'falta_nota'; end if;
  if p_decision = 'FACTURAR' then
    if r.revision is null or jsonb_array_length(r.revision) = 0 then raise exception 'sin_lineas_economicas'; end if;
    for l in select * from jsonb_array_elements(r.revision) loop
      if (l->>'stel_item_id') is null or (l->>'cantidad') is null or (l->>'precio') is null or (l->>'iva_pct') is null then
        raise exception 'linea_incompleta: %', coalesce(l->>'descripcion', '?');
      end if;
    end loop;
    update public.sat_partes set estado = 'PENDIENTE_APROBACION', decision = 'FACTURAR', decision_nota = p_nota, actualizado_en = now() where id = p_id;
    perform public.sat_notificar_permiso('sat.facturar', 'FACTURA_POR_APROBAR', 'Parte ' || r.codigo || ': factura pendiente de aprobación (' ||
      to_char(public.sat_total(r.revision), 'FM999G999G990D00') || ' €)', p_id, r.aviso_id);
  elsif p_decision = 'PRESUPUESTAR' then
    update public.sat_partes set estado = 'PRESUPUESTAR', decision = 'PRESUPUESTAR', decision_nota = p_nota, actualizado_en = now() where id = p_id;
  elsif p_decision = 'INFO' then
    update public.sat_partes set estado = 'INFO_SOLICITADA', decision = 'INFO', decision_nota = p_nota, actualizado_en = now() where id = p_id;
    perform public.sat_notificar(r.tecnico_id, 'INFO_SOLICITADA', 'Parte ' || r.codigo || ': administración pide información: ' || p_nota, p_id, r.aviso_id);
  elsif p_decision = 'NO_FACTURABLE' then
    update public.sat_partes set estado = 'NO_FACTURABLE', decision = 'NO_FACTURABLE', decision_nota = p_nota, actualizado_en = now() where id = p_id;
  else
    raise exception 'decision_no_valida';
  end if;
  perform public.sat_auditar('DECISION_' || p_decision, 'parte', p_id, jsonb_build_object('nota', p_nota, 'total', public.sat_total(r.revision)));
  return public.sat_parte_json(p_id, true);
end $$;

-- Aprobación expresa de la factura (sat.facturar). Exige el total que la persona ve; nunca dos facturas por parte.
create or replace function public.sat_factura_aprobar(p_id uuid, p_total_visto numeric, p_texto text) returns jsonb language plpgsql
security definer set search_path = public as $$
declare r public.sat_partes; v_total numeric; f public.sat_facturas;
begin
  perform public.sat_exigir('sat.facturar');
  select * into r from public.sat_partes where id = p_id for update;
  if not found then raise exception 'parte_no_existe'; end if;
  if exists (select 1 from public.sat_facturas where parte_id = p_id) then raise exception 'ya_facturado'; end if;
  if r.estado <> 'PENDIENTE_APROBACION' then raise exception 'parte_no_pendiente_de_aprobacion: %', r.estado; end if;
  v_total := public.sat_total(r.revision);
  if p_total_visto is null or abs(p_total_visto - v_total) > 0.005 then raise exception 'total_distinto: %', v_total; end if;
  if length(trim(coalesce(p_texto, ''))) < 3 then raise exception 'falta_confirmacion'; end if;
  insert into public.sat_facturas (parte_id, lineas, total_previsto, aprobado_por, aprobacion_texto)
  values (p_id, r.revision, v_total, auth.uid(), trim(p_texto)) returning * into f;
  update public.sat_partes set estado = 'APROBADO', actualizado_en = now() where id = p_id;
  insert into public.sat_stel_operaciones (tipo, clave, parte_id, aviso_id) values ('FACTURA', 'fac:' || p_id, p_id, r.aviso_id)
  on conflict (clave) do nothing;
  perform public.sat_auditar('FACTURA_APROBADA', 'factura', f.id, jsonb_build_object('parte', p_id, 'total', v_total, 'texto', p_texto));
  return public.sat_parte_json(p_id, true);
end $$;

-- PDF de la factura subido a mano por administración (cuando STEL no lo da por la API).
create or replace function public.sat_factura_pdf_manual(p_parte uuid, p_path text, p_sha256 text, p_referencia text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.sat_facturas; r public.sat_partes;
begin
  perform public.sat_exigir('sat.administrar');
  select * into f from public.sat_facturas where parte_id = p_parte for update;
  if not found then raise exception 'factura_no_aprobada'; end if;
  if not exists (select 1 from public.sat_archivos where parte_id = p_parte and tipo = 'PDF_FACTURA' and storage_path = p_path and sha256 = p_sha256) then
    raise exception 'pdf_no_subido';
  end if;
  update public.sat_facturas set pdf_path = p_path, pdf_origen = 'MANUAL', stel_referencia = coalesce(nullif(trim(p_referencia), ''), stel_referencia),
    estado = 'EMITIDA', emitida_en = coalesce(emitida_en, now()),
    entrega_estado = case when entrega_estado = 'ENTREGADA' then 'ENTREGADA' else 'PENDIENTE_ENTREGA' end
  where id = f.id returning * into f;
  update public.sat_partes set estado = 'FACTURADO', actualizado_en = now() where id = p_parte returning * into r;
  perform public.sat_notificar(r.tecnico_id, 'FACTURA_DISPONIBLE', 'Factura ' || coalesce(f.stel_referencia, '') || ' del parte ' || r.codigo || ' lista para entregar al cliente', p_parte, r.aviso_id);
  perform public.sat_auditar('FACTURA_PDF_MANUAL', 'factura', f.id, jsonb_build_object('ruta', p_path, 'sha256', p_sha256));
  return public.sat_parte_json(p_parte, true);
end $$;

-- La persona autorizada confirma que emitió en STEL la factura creada por la aplicación: entonces se trae su PDF.
create or replace function public.sat_factura_confirmar_emitida(p_parte uuid) returns jsonb language plpgsql security definer
set search_path = public as $$
declare o public.sat_stel_operaciones;
begin
  perform public.sat_exigir('sat.facturar');
  update public.sat_stel_operaciones set detalle = detalle || jsonb_build_object('emitida', true, 'emitida_confirmada_por', auth.uid(), 'emitida_confirmada_en', now()),
    estado = 'PENDIENTE', intentos = 0, error = null, actualizado_en = now()
  where clave = 'fac:' || p_parte and estado <> 'EN_CURSO' and stel_id is not null returning * into o;
  if not found then raise exception 'factura_no_creada_en_stel'; end if;
  perform public.sat_auditar('FACTURA_EMITIDA_CONFIRMADA', 'factura', (select id from public.sat_facturas where parte_id = p_parte),
    jsonb_build_object('stel_id', o.stel_id));
  return public.sat_parte_json(p_parte, true);
end $$;

-- Bandeja de facturas: el técnico ve las de sus partes; administración, todas.
create or replace function public.sat_mis_facturas() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := public.sat_puede('sat.administrar');
begin
  if not (v_admin or public.sat_puede('sat.tecnico')) then raise exception 'sin_permiso: sat' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'parte_id', p.id, 'parte_codigo', p.codigo,
      'cliente', p.contenido->'cliente'->>'nombre', 'referencia', f.stel_referencia, 'total', coalesce(f.stel_total, f.total_previsto),
      'pdf_path', f.pdf_path, 'estado', f.estado, 'entrega_estado', f.entrega_estado, 'entregada_en', f.entregada_en,
      'entrega_medio', f.entrega_medio, 'emitida_en', f.emitida_en) order by f.emitida_en desc nulls last)
    from public.sat_facturas f join public.sat_partes p on p.id = f.parte_id
    where f.pdf_path is not null and (v_admin or p.tecnico_id = auth.uid())), '[]'::jsonb);
end $$;

-- Entrega de la factura al cliente: solo cuando la persona lo marca (nunca al notificar).
create or replace function public.sat_factura_entrega(p_factura uuid, p_entregada boolean, p_medio text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f public.sat_facturas; r public.sat_partes;
begin
  select * into f from public.sat_facturas where id = p_factura for update;
  if not found then raise exception 'factura_no_existe'; end if;
  select * into r from public.sat_partes where id = f.parte_id;
  if not (public.sat_puede('sat.administrar') or (r.tecnico_id = auth.uid() and public.sat_puede('sat.tecnico'))) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  if f.pdf_path is null then raise exception 'factura_sin_pdf'; end if;
  update public.sat_facturas set entrega_estado = case when p_entregada then 'ENTREGADA' else 'PENDIENTE_ENTREGA' end,
    entregada_en = case when p_entregada then now() end, entregada_por = case when p_entregada then auth.uid() end,
    entrega_medio = case when p_entregada then nullif(trim(p_medio), '') end
  where id = p_factura returning * into f;
  perform public.sat_auditar(case when p_entregada then 'FACTURA_ENTREGADA' else 'FACTURA_ENTREGA_DESHECHA' end, 'factura', f.id,
    jsonb_build_object('medio', p_medio));
  return to_jsonb(f);
end $$;

create or replace function public.sat_notificaciones(p_todas boolean default false) returns jsonb language sql stable security definer
set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(n) order by n.id desc), '[]'::jsonb)
  from (select * from public.sat_notificaciones where usuario_id = auth.uid() and (p_todas or not leida) order by id desc limit 100) n
$$;
create or replace function public.sat_notificaciones_leidas(p_ids bigint[]) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.sat_notificaciones set leida = true where usuario_id = auth.uid() and id = any(p_ids) and not leida;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.sat_ajustes_leer() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sat_exigir('sat.administrar');
  return coalesce((select jsonb_object_agg(clave, valor) from public.sat_ajustes), '{}'::jsonb)
    || jsonb_build_object('_llamadas_hoy', coalesce((select llamadas from public.sat_stel_llamadas where dia = (now() at time zone 'Europe/Madrid')::date), 0),
       '_catalogo', jsonb_build_object('clientes', (select count(*) from public.sat_clientes where stel_id is not null),
         'articulos', (select count(*) from public.sat_articulos), 'actualizado', (select max(actualizado_en) from public.sat_articulos)));
end $$;
create or replace function public.sat_ajuste_guardar(p_clave text, p_valor jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.sat_exigir('sat.administrar');
  if p_clave not in ('texto_alcance_firma', 'stel_servicio_mano_obra_id', 'stel_servicio_desplazamiento_id', 'stel_serie_albaran_trabajo_id',
    'stel_emitir_factura', 'stel_limite_llamadas_dia', 'transcripcion_url') then raise exception 'ajuste_no_valido'; end if;
  if p_clave = 'stel_emitir_factura' then perform public.sat_exigir('sat.facturar'); end if;
  perform public.sat_auditar('AJUSTE', 'ajustes', null, jsonb_build_object('clave', p_clave, 'anterior', public.sat_ajuste(p_clave), 'nuevo', p_valor));
  insert into public.sat_ajustes (clave, valor, actualizado_por, actualizado_en) values (p_clave, p_valor, auth.uid(), now())
  on conflict (clave) do update set valor = excluded.valor, actualizado_por = excluded.actualizado_por, actualizado_en = now();
  return public.sat_ajustes_leer();
end $$;

-- Cuando un cliente ya tiene su id de STEL, vuelven a la cola la incidencia y el albarán de sus avisos y partes bloqueados.
create or replace function public.sat_desbloquear_cliente(p_cliente uuid) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.sat_stel_operaciones o set estado = 'PENDIENTE', error = null, actualizado_en = now()
  where o.estado = 'BLOQUEADA' and o.tipo in ('INCIDENCIA', 'ALBARAN_TRABAJO')
    and (o.parte_id in (select p.id from public.sat_partes p join public.sat_clientes c on c.id::text = p.contenido->'cliente'->>'id'
           where p_cliente in (c.id, c.fusionado_en))
      or o.aviso_id in (select a.id from public.sat_avisos a join public.sat_clientes c on c.id = a.cliente_id where p_cliente in (c.id, c.fusionado_en)));
  get diagnostics n = row_count;
  update public.sat_partes p set stel_estado = 'PENDIENTE', stel_error = null
  from public.sat_clientes c
  where p.stel_estado = 'BLOQUEADO' and c.id::text = p.contenido->'cliente'->>'id' and p_cliente in (c.id, c.fusionado_en);
  return n;
end $$;

-- Vincular un cliente provisional a uno existente de STEL (evita duplicar clientes) o pedir que se cree en STEL.
create or replace function public.sat_cliente_resolver(p_cliente uuid, p_stel_id bigint default null, p_crear_en_stel boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.sat_clientes; d public.sat_clientes;
begin
  perform public.sat_exigir('sat.administrar');
  select * into c from public.sat_clientes where id = p_cliente for update;
  if not found then raise exception 'cliente_no_existe'; end if;
  if p_stel_id is not null then
    select * into d from public.sat_clientes where stel_id = p_stel_id;
    if not found then raise exception 'cliente_stel_no_cargado'; end if;
    -- Lo que apuntaba al provisional pasa al de STEL; el provisional desaparece.
    update public.sat_direcciones set cliente_id = d.id where cliente_id = c.id;
    update public.sat_contactos set cliente_id = d.id where cliente_id = c.id;
    update public.sat_equipos set cliente_id = d.id where cliente_id = c.id;
    update public.sat_avisos set cliente_id = d.id where cliente_id = c.id;
    -- El provisional se conserva (lo firmado lo nombra) apuntando al de STEL; deja de salir en el catálogo.
    update public.sat_clientes set fusionado_en = d.id, actualizado_en = now() where id = c.id;
    update public.sat_stel_operaciones set estado = 'OK', error = null, stel_id = d.stel_id, actualizado_en = now()
      where cliente_id = c.id and tipo = 'CLIENTE' and estado <> 'EN_CURSO';
    perform public.sat_desbloquear_cliente(d.id);
    perform public.sat_auditar('CLIENTE_VINCULADO', 'catalogo', c.id, jsonb_build_object('stel_id', p_stel_id, 'nombre', c.nombre));
    return jsonb_build_object('id', d.id, 'stel_id', d.stel_id);
  elsif p_crear_en_stel then
    insert into public.sat_stel_operaciones (tipo, clave, cliente_id) values ('CLIENTE', 'cli:' || c.id, c.id)
    on conflict (clave) do update set estado = case when sat_stel_operaciones.estado = 'OK' then 'OK' else 'PENDIENTE' end, actualizado_en = now();
    perform public.sat_auditar('CLIENTE_A_STEL', 'catalogo', c.id, null);
    return jsonb_build_object('id', c.id, 'en_cola', true);
  end if;
  raise exception 'nada_que_hacer';
end $$;

-- Operaciones de STEL visibles para administración (pendientes, errores y bloqueadas).
create or replace function public.sat_stel_pendientes() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sat_exigir('sat.administrar');
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'tipo', o.tipo, 'estado', o.estado, 'intentos', o.intentos, 'error', o.error,
      'parte_id', o.parte_id, 'parte_codigo', (select codigo from public.sat_partes where id = o.parte_id),
      'cliente', (select nombre from public.sat_clientes where id = o.cliente_id), 'actualizado_en', o.actualizado_en) order by o.creado_en)
    from public.sat_stel_operaciones o where o.estado <> 'OK'), '[]'::jsonb);
end $$;

-- Precios del catálogo (solo administración: los técnicos no ven precios).
create or replace function public.sat_articulos_precios() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sat_exigir('sat.administrar');
  return coalesce((select jsonb_agg(jsonb_build_object('stel_id', stel_id, 'tipo', tipo, 'referencia', referencia, 'nombre', nombre,
    'precio', precio, 'iva_pct', iva_pct) order by nombre) from public.sat_articulos where activo), '[]'::jsonb);
end $$;

-- Volver a intentar una operación de STEL (con error, bloqueada o terminada, p. ej. para recuperar el PDF de la factura).
create or replace function public.sat_stel_reintentar(p_op uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.sat_stel_operaciones;
begin
  perform public.sat_exigir('sat.administrar');
  update public.sat_stel_operaciones set estado = 'PENDIENTE', intentos = 0, error = null, actualizado_en = now()
  where id = p_op and estado <> 'EN_CURSO' returning * into o;
  if not found then raise exception 'operacion_no_reintentable'; end if;
  perform public.sat_auditar('STEL_REINTENTO', 'parte', coalesce(o.parte_id, o.cliente_id), jsonb_build_object('operacion', p_op, 'tipo', o.tipo));
  return to_jsonb(o);
end $$;

-- ============================================================ Solo para la función Edge sat-stel (service_role)
-- Comprueba quién llama (la función Edge lo pregunta con el token del usuario).
create or replace function public.sat_puede_procesar(p_parte uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.sat_puede('sat.administrar') or exists (select 1 from public.sat_partes where id = p_parte and tecnico_id = auth.uid() and public.sat_puede('sat.tecnico'))
$$;

create or replace function public.sat_stel_contexto(p_op uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'op', to_jsonb(o),
    'parte', (select to_jsonb(p) from public.sat_partes p where p.id = o.parte_id),
    'aviso', (select to_jsonb(a) from public.sat_avisos a where a.id = coalesce(o.aviso_id, (select aviso_id from public.sat_partes where id = o.parte_id))),
    'cliente', (select to_jsonb(c) from public.sat_clientes c where c.id = (select coalesce(x.fusionado_en, x.id) from public.sat_clientes x
      where x.id = coalesce(case when o.tipo = 'CLIENTE' then o.cliente_id end,
        (select (p.contenido->'cliente'->>'id')::uuid from public.sat_partes p where p.id = o.parte_id),
        (select a.cliente_id from public.sat_avisos a where a.id = o.aviso_id)))),
    'archivos', coalesce((select jsonb_agg(to_jsonb(ar) order by ar.creado_en) from public.sat_archivos ar where ar.parte_id = o.parte_id), '[]'::jsonb),
    'factura', (select to_jsonb(f) from public.sat_facturas f where f.parte_id = o.parte_id),
    'tecnico_nombre', (select pf.nombre from public.perfiles pf join public.sat_partes p on p.tecnico_id = pf.id where p.id = o.parte_id),
    'ajustes', (select jsonb_object_agg(clave, valor) from public.sat_ajustes))
  from public.sat_stel_operaciones o where o.id = p_op
$$;

-- Toma operaciones pendientes (o con error, o en curso hace más de 10 minutos: la función murió).
create or replace function public.sat_stel_tomar(p_parte uuid default null, p_max integer default 10) returns jsonb language plpgsql
security definer set search_path = public as $$
declare v jsonb := '[]'::jsonb; o record;
begin
  for o in select id from public.sat_stel_operaciones
    where (p_parte is null or parte_id = p_parte or aviso_id = (select aviso_id from public.sat_partes where id = p_parte))
      and (estado = 'PENDIENTE' or (estado = 'ERROR' and intentos < 5) or (estado = 'EN_CURSO' and empezado_en < now() - interval '10 minutes'))
    order by case tipo when 'CLIENTE' then 0 when 'INCIDENCIA' then 1 when 'ALBARAN_TRABAJO' then 2 else 3 end, creado_en
    limit p_max for update skip locked
  loop
    update public.sat_stel_operaciones set estado = 'EN_CURSO', intentos = intentos + 1, empezado_en = now(), actualizado_en = now() where id = o.id;
    v := v || jsonb_build_array(public.sat_stel_contexto(o.id));
  end loop;
  return v;
end $$;

create or replace function public.sat_stel_sumar_llamadas(p_n integer) returns integer language sql security definer set search_path = public as $$
  insert into public.sat_stel_llamadas (dia, llamadas) values ((now() at time zone 'Europe/Madrid')::date, p_n)
  on conflict (dia) do update set llamadas = sat_stel_llamadas.llamadas + excluded.llamadas
  returning llamadas
$$;

-- Resultado de una operación. p_estado: OK, PENDIENTE (esperando otra), BLOQUEADA (falta algo de una persona) o ERROR.
create or replace function public.sat_stel_terminar(p_op uuid, p_estado text, p_stel_id bigint default null, p_detalle jsonb default '{}'::jsonb,
  p_error text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.sat_stel_operaciones; f public.sat_facturas; r public.sat_partes;
begin
  if p_estado not in ('OK', 'PENDIENTE', 'BLOQUEADA', 'ERROR') then raise exception 'estado_no_valido'; end if;
  update public.sat_stel_operaciones set estado = p_estado, stel_id = coalesce(p_stel_id, stel_id), detalle = detalle || coalesce(p_detalle, '{}'::jsonb),
    error = case when p_estado = 'OK' then null else left(p_error, 1000) end, actualizado_en = now(),
    intentos = case when p_estado in ('PENDIENTE', 'BLOQUEADA') then greatest(intentos - 1, 0) else intentos end
  where id = p_op returning * into o;
  if not found then raise exception 'operacion_no_existe'; end if;
  if o.tipo = 'CLIENTE' and p_estado = 'OK' then
    update public.sat_clientes set stel_id = p_stel_id, provisional = false, actualizado_en = now() where id = o.cliente_id;
    perform public.sat_desbloquear_cliente(o.cliente_id);
  elsif o.tipo = 'INCIDENCIA' and p_estado = 'OK' then
    update public.sat_avisos set stel_incidencia_id = p_stel_id, actualizado_en = now() where id = o.aviso_id;
  elsif o.tipo = 'ALBARAN_TRABAJO' and o.parte_id is not null then
    update public.sat_partes set
      stel_estado = case p_estado when 'OK' then 'SINCRONIZADO' when 'BLOQUEADA' then 'BLOQUEADO' when 'ERROR' then 'ERROR' else 'PENDIENTE' end,
      stel_albaran_id = coalesce(p_stel_id, stel_albaran_id), stel_albaran_ref = coalesce(p_detalle->>'referencia', stel_albaran_ref),
      stel_albaran_version = case when p_estado = 'OK' then coalesce((p_detalle->>'version')::integer, stel_albaran_version) else stel_albaran_version end,
      stel_error = case when p_estado = 'OK' then null else left(p_error, 1000) end
    where id = o.parte_id;
  elsif o.tipo = 'FACTURA' then
    select * into f from public.sat_facturas where parte_id = o.parte_id for update;
    if p_estado = 'OK' or p_stel_id is not null then
      update public.sat_facturas set stel_factura_id = coalesce(p_stel_id, stel_factura_id),
        stel_referencia = coalesce(p_detalle->>'referencia', stel_referencia), stel_total = coalesce((p_detalle->>'total')::numeric, stel_total),
        estado = case when (p_detalle->>'emitida')::boolean then 'EMITIDA' else 'EN_STEL' end,
        emitida_en = case when (p_detalle->>'emitida')::boolean then coalesce(emitida_en, now()) else emitida_en end,
        pdf_path = coalesce(p_detalle->>'pdf_path', pdf_path), pdf_origen = case when p_detalle ? 'pdf_path' then 'STEL' else pdf_origen end,
        entrega_estado = case when entrega_estado = 'ENTREGADA' then 'ENTREGADA' when coalesce(p_detalle->>'pdf_path', pdf_path) is not null
          then 'PENDIENTE_ENTREGA' else 'SIN_PDF' end
      where id = f.id returning * into f;
    elsif p_estado = 'ERROR' then
      update public.sat_facturas set estado = 'ERROR' where id = f.id;
    end if;
    if f.pdf_path is not null then
      update public.sat_partes set estado = 'FACTURADO', actualizado_en = now() where id = o.parte_id and estado <> 'FACTURADO' returning * into r;
      if found then
        perform public.sat_notificar(r.tecnico_id, 'FACTURA_DISPONIBLE', 'Factura ' || coalesce(f.stel_referencia, '') || ' del parte ' || r.codigo ||
          ' lista para entregar al cliente', r.id, r.aviso_id);
      end if;
    elsif p_estado = 'OK' and coalesce((p_detalle->>'emitida')::boolean, false) then
      perform public.sat_notificar_permiso('sat.administrar', 'FACTURA_SIN_PDF', 'La factura del parte ' ||
        (select codigo from public.sat_partes where id = o.parte_id) || ' está emitida en STEL pero sin PDF: súbelo para el técnico', o.parte_id, o.aviso_id);
    elsif p_estado = 'OK' then
      perform public.sat_notificar_permiso('sat.facturar', 'FACTURA_POR_EMITIR', 'La factura ' || coalesce(p_detalle->>'referencia', '') || ' del parte ' ||
        (select codigo from public.sat_partes where id = o.parte_id) || ' está creada en STEL pendiente de emitir: emítela en STEL y confírmalo en la aplicación',
        o.parte_id, o.aviso_id);
    end if;
  end if;
  if p_estado in ('ERROR', 'BLOQUEADA') then
    perform public.sat_notificar_permiso('sat.administrar', 'STEL_' || p_estado, o.tipo || ' ' ||
      coalesce((select codigo from public.sat_partes where id = o.parte_id), '') || ': ' || coalesce(left(p_error, 200), ''), o.parte_id, o.aviso_id);
  end if;
  insert into public.sat_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (null, 'STEL_' || o.tipo || '_' || p_estado, 'parte', coalesce(o.parte_id, o.aviso_id, o.cliente_id),
    jsonb_build_object('operacion', o.id, 'stel_id', p_stel_id, 'error', left(p_error, 300)));
  return to_jsonb(o);
end $$;

-- Carga del catálogo leído de STEL (solo la función Edge). p_tipo: CLIENTES, DIRECCIONES, CONTACTOS, EQUIPOS, ARTICULOS.
create or replace function public.sat_stel_catalogo_cargar(p_tipo text, p_filas jsonb) returns integer language plpgsql
security definer set search_path = public as $$
declare n integer := 0; x jsonb; v_cli uuid;
begin
  for x in select * from jsonb_array_elements(p_filas) loop
    if p_tipo = 'CLIENTES' then
      insert into public.sat_clientes (stel_id, nombre, nif, telefono, email) values ((x->>'stel_id')::bigint, x->>'nombre', x->>'nif', x->>'telefono', x->>'email')
      on conflict (stel_id) do update set nombre = excluded.nombre, nif = excluded.nif, telefono = excluded.telefono, email = excluded.email, actualizado_en = now();
    elsif p_tipo = 'ARTICULOS' then
      insert into public.sat_articulos (stel_id, tipo, referencia, nombre, precio, iva_pct, activo)
      values ((x->>'stel_id')::bigint, x->>'tipo', x->>'referencia', x->>'nombre', (x->>'precio')::numeric, (x->>'iva_pct')::numeric, coalesce((x->>'activo')::boolean, true))
      on conflict (stel_id) do update set tipo = excluded.tipo, referencia = excluded.referencia, nombre = excluded.nombre, precio = excluded.precio,
        iva_pct = excluded.iva_pct, activo = excluded.activo, actualizado_en = now();
    else
      select id into v_cli from public.sat_clientes where stel_id = (x->>'cliente_stel_id')::bigint;
      continue when v_cli is null;
      if p_tipo = 'DIRECCIONES' then
        insert into public.sat_direcciones (cliente_id, stel_id, texto) values (v_cli, (x->>'stel_id')::bigint, x->>'texto')
        on conflict (stel_id) do update set cliente_id = excluded.cliente_id, texto = excluded.texto, actualizado_en = now();
      elsif p_tipo = 'CONTACTOS' then
        insert into public.sat_contactos (cliente_id, stel_id, nombre, cargo, telefono, email) values (v_cli, (x->>'stel_id')::bigint, x->>'nombre', x->>'cargo', x->>'telefono', x->>'email')
        on conflict (stel_id) do update set cliente_id = excluded.cliente_id, nombre = excluded.nombre, cargo = excluded.cargo, telefono = excluded.telefono,
          email = excluded.email, actualizado_en = now();
      elsif p_tipo = 'EQUIPOS' then
        insert into public.sat_equipos (cliente_id, direccion_id, stel_id, nombre, referencia, marca, modelo, numero_serie)
        values (v_cli, (select id from public.sat_direcciones where stel_id = (x->>'direccion_stel_id')::bigint), (x->>'stel_id')::bigint, x->>'nombre',
          x->>'referencia', x->>'marca', x->>'modelo', x->>'numero_serie')
        on conflict (stel_id) do update set cliente_id = excluded.cliente_id, direccion_id = excluded.direccion_id, nombre = excluded.nombre,
          referencia = excluded.referencia, marca = excluded.marca, modelo = excluded.modelo, numero_serie = excluded.numero_serie, actualizado_en = now();
      else
        raise exception 'tipo_desconocido: %', p_tipo;
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ============================================================ Permisos de ejecución
do $$
declare f text;
begin
  foreach f in array array['sat_hash(jsonb)', 'sat_exigir(text)', 'sat_puede(text)', 'sat_usuarios_con(text)', 'sat_auditar(text,text,uuid,jsonb)',
    'sat_notificar(uuid,text,text,uuid,uuid)', 'sat_notificar_permiso(text,text,text,uuid,uuid)', 'sat_nuevo_codigo(text)', 'sat_ajuste(text)',
    'sat_total(jsonb)', 'sat_parte_de_ruta(text)', 'sat_puede_ver_ruta(text)', 'sat_puede_subir_ruta(text)', 'sat_parte_json(uuid,boolean)',
    'sat_yo()', 'sat_catalogo()', 'sat_alta_provisional(text,jsonb)', 'sat_aviso_guardar(jsonb)', 'sat_avisos_listar()', 'sat_parte_guardar(jsonb)',
    'sat_archivo_registrar(jsonb)', 'sat_firma_registrar(jsonb)', 'sat_parte_enviar(uuid,text,text)', 'sat_partes_listar(text)',
    'sat_parte_detalle(uuid)', 'sat_revision_guardar(uuid,jsonb,text)', 'sat_decidir(uuid,text,text)', 'sat_factura_aprobar(uuid,numeric,text)',
    'sat_factura_pdf_manual(uuid,text,text,text)', 'sat_mis_facturas()', 'sat_factura_entrega(uuid,boolean,text)', 'sat_notificaciones(boolean)',
    'sat_notificaciones_leidas(bigint[])', 'sat_ajustes_leer()', 'sat_ajuste_guardar(text,jsonb)', 'sat_cliente_resolver(uuid,bigint,boolean)',
    'sat_stel_pendientes()', 'sat_puede_procesar(uuid)', 'sat_articulos_precios()', 'sat_stel_reintentar(uuid)',
    'sat_factura_confirmar_emitida(uuid)', 'sat_desbloquear_cliente(uuid)', 'sat_stel_contexto(uuid)', 'sat_stel_tomar(uuid,integer)', 'sat_stel_sumar_llamadas(integer)',
    'sat_stel_terminar(uuid,text,bigint,jsonb,text)', 'sat_stel_catalogo_cargar(text,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- La web (sesión iniciada): solo las funciones de la aplicación (cada una comprueba su permiso).
  foreach f in array array['sat_puede_ver_ruta(text)', 'sat_puede_subir_ruta(text)', 'sat_total(jsonb)', 'sat_yo()', 'sat_catalogo()',
    'sat_alta_provisional(text,jsonb)', 'sat_aviso_guardar(jsonb)', 'sat_avisos_listar()', 'sat_parte_guardar(jsonb)', 'sat_archivo_registrar(jsonb)',
    'sat_firma_registrar(jsonb)', 'sat_parte_enviar(uuid,text,text)', 'sat_partes_listar(text)', 'sat_parte_detalle(uuid)',
    'sat_revision_guardar(uuid,jsonb,text)', 'sat_decidir(uuid,text,text)', 'sat_factura_aprobar(uuid,numeric,text)',
    'sat_factura_pdf_manual(uuid,text,text,text)', 'sat_mis_facturas()', 'sat_factura_entrega(uuid,boolean,text)', 'sat_notificaciones(boolean)',
    'sat_notificaciones_leidas(bigint[])', 'sat_ajustes_leer()', 'sat_ajuste_guardar(text,jsonb)', 'sat_cliente_resolver(uuid,bigint,boolean)',
    'sat_stel_pendientes()', 'sat_puede_procesar(uuid)', 'sat_articulos_precios()', 'sat_stel_reintentar(uuid)',
    'sat_factura_confirmar_emitida(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- La función Edge (clave de servicio).
  foreach f in array array['sat_ajuste(text)', 'sat_stel_contexto(uuid)', 'sat_stel_tomar(uuid,integer)', 'sat_stel_sumar_llamadas(integer)',
    'sat_stel_terminar(uuid,text,bigint,jsonb,text)', 'sat_stel_catalogo_cargar(text,jsonb)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
