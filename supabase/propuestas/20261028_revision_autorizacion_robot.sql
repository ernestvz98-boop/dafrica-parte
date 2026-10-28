-- 2026-10-28 · PROPUESTA (SIN APLICAR: necesita la autorización expresa del usuario).
-- Petición del usuario (prueba real de 40 páginas): revisión manual guardada en Supabase, autorización
-- para crear en STEL, robot autónomo con la cola segura y registro de sincronizaciones.
--
-- Qué hace (solo AÑADE; no borra ni cambia filas existentes):
--  1. stel_revisiones: cada revisión manual (quién, cuándo, plan anterior y corregido, cambios, si los
--     datos se confirmaron contra el papel). Solo lectura con costes.ver; se escribe por función.
--  2. stel_autorizaciones: autorización de UNA creación en STEL (identificador de operación único, huella
--     del plan y del PDF autorizados, controles). Una vigente por albarán; el robot la consume una vez.
--  3. stel_sync_log: columnas cola_id y usuario (nulas en lo existente) para el historial por albarán.
--  4. stel_cola_enviar: una relectura ya no pisa un albarán revisado o autorizado.
--  5. Funciones: stel_revision_guardar, stel_autorizar, stel_autorizacion_anular, robot_llave_registrar.
--  6. Permisos: sin TRUNCATE/REFERENCES/TRIGGER para anon y authenticated en las tablas de la cola.
--  7. lector_obras admite también códigos PRYMP (importador de obras; petición del usuario).
-- La verificación en dos pasos se mantiene: tiene_permiso() no concede nada a una sesión sin código.
-- Prueba: supabase/tests/revision_autorizacion.sql (Postgres local con auth y permisos simulados).
-- Deshacer: drop function public.stel_revision_guardar(uuid,jsonb,jsonb,text,timestamptz,boolean,text),
--   public.stel_autorizar(uuid,text,timestamptz,jsonb), public.stel_autorizacion_anular(uuid,text),
--   public.robot_llave_registrar(text,integer); drop table public.stel_autorizaciones, public.stel_revisiones;
--   alter table public.stel_sync_log drop column cola_id, drop column usuario; y volver a crear
--   stel_cola_enviar desde supabase/migraciones/20261026_stel_cola.sql.

begin;

-- 3. Registro de sincronizaciones por albarán.
alter table public.stel_sync_log add column if not exists cola_id uuid references public.stel_cola(id) on delete set null;
alter table public.stel_sync_log add column if not exists usuario uuid;
create index if not exists stel_sync_log_cola_idx on public.stel_sync_log (cola_id, iniciado_en desc);

-- 1. Revisiones manuales.
create table if not exists public.stel_revisiones (
  id uuid primary key default gen_random_uuid(),
  cola_id uuid not null references public.stel_cola(id) on delete restrict,
  revisado_por uuid not null default auth.uid(),
  revisado_en timestamptz not null default now(),
  confirmado boolean not null,
  plan_anterior jsonb not null,
  plan jsonb not null,
  cambios jsonb not null default '[]'::jsonb check (jsonb_typeof(cambios) = 'array'),
  huella_plan text not null check (huella_plan ~ '^[0-9a-f]{64}$'),
  nota text check (nota is null or length(nota) <= 500)
);
create index if not exists stel_revisiones_cola_idx on public.stel_revisiones (cola_id, revisado_en desc);
alter table public.stel_revisiones enable row level security;
create policy stel_revisiones_leer on public.stel_revisiones for select to authenticated using (public.tiene_permiso('costes.ver'));

-- 2. Autorizaciones de creación en STEL.
create table if not exists public.stel_autorizaciones (
  id uuid primary key default gen_random_uuid(),
  cola_id uuid not null references public.stel_cola(id) on delete restrict,
  revision_id uuid not null references public.stel_revisiones(id) on delete restrict,
  operacion_id uuid not null unique default gen_random_uuid(),
  huella_plan text not null check (huella_plan ~ '^[0-9a-f]{64}$'),
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  controles jsonb not null default '{}'::jsonb,
  estado text not null default 'VIGENTE' check (estado in ('VIGENTE','USADA','ANULADA')),
  autorizado_por uuid not null default auth.uid(),
  autorizado_en timestamptz not null default now(),
  usada_en timestamptz,
  anulada_por uuid,
  anulada_en timestamptz,
  motivo_anulacion text check (motivo_anulacion is null or length(motivo_anulacion) <= 300)
);
create unique index if not exists stel_autorizaciones_una_vigente on public.stel_autorizaciones (cola_id) where estado = 'VIGENTE';
alter table public.stel_autorizaciones enable row level security;
create policy stel_autorizaciones_leer on public.stel_autorizaciones for select to authenticated using (public.tiene_permiso('costes.ver'));

-- 7. Obras con código PRYMP en la lista del lector (el importador los acepta tal cual).
alter table public.lector_obras drop constraint if exists lector_obras_codigo_check;
alter table public.lector_obras add constraint lector_obras_codigo_check check (codigo ~ '^(PRY[0-9]{5}|PRYMP[0-9]{2,8})$');

-- 6. Sin escrituras directas ni TRUNCATE (que se salta RLS) para los roles de la API.
revoke truncate, references, trigger on public.stel_cola, public.stel_sync_log from anon, authenticated;
revoke all on public.stel_revisiones, public.stel_autorizaciones from anon;
revoke insert, update, delete, truncate, references, trigger on public.stel_revisiones, public.stel_autorizaciones from authenticated;
grant select on public.stel_revisiones, public.stel_autorizaciones to authenticated;

-- Registro interno (solo desde las funciones de abajo).
create or replace function public.stel_registrar(p_tipo text, p_estado text, p_cola uuid, p_detalle jsonb, p_error text default null)
returns void language sql security definer set search_path to '' as $$
  insert into public.stel_sync_log (tipo_sync, estado, cola_id, usuario, detalle, error, finalizado_en)
  values (p_tipo, p_estado, p_cola, auth.uid(), p_detalle, p_error, now());
$$;
revoke all on function public.stel_registrar(text,text,uuid,jsonb,text) from public, anon, authenticated;

-- 4. Una relectura del PDF no pisa un albarán que una persona ya ha revisado o autorizado.
create or replace function public.stel_cola_enviar(p_filas jsonb)
returns table(clave text, estado text, accion text)
language plpgsql
security definer
set search_path to ''
as $$
declare f jsonb; actual text; fila_id uuid;
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
    select c.estado, c.id into actual, fila_id from public.stel_cola c where c.clave = f->>'clave' for update;
    if actual is null then
      insert into public.stel_cola(clave, estado, motivos, plan, pdf_ruta, pdf_sha256)
      values (f->>'clave', f->>'estado', coalesce(f->'motivos','[]'::jsonb), f->'plan', f->>'pdf_ruta', f->>'pdf_sha256');
      clave := f->>'clave'; estado := f->>'estado'; accion := 'nuevo'; return next;
    elsif actual in ('PENDIENTE','REVISAR')
      and not exists (select 1 from public.stel_revisiones r where r.cola_id = fila_id)
      and not exists (select 1 from public.stel_autorizaciones a where a.cola_id = fila_id and a.estado = 'VIGENTE') then
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

-- 5a. Revisión manual: guarda el plan corregido (o confirmado) con quién, cuándo y qué cambió.
-- No cambia el PDF, las páginas ni el albarán de STEL encontrado; nunca pone el albarán en PENDIENTE
-- (eso solo lo hace una autorización) y anula la autorización vigente si el plan cambia.
create or replace function public.stel_revision_guardar(p_cola_id uuid, p_plan jsonb, p_cambios jsonb, p_huella_plan text,
  p_actualizado_en timestamptz, p_confirmado boolean, p_nota text default null)
returns table(revision_id uuid, estado text, actualizado_en timestamptz)
language plpgsql security definer set search_path to '' as $$
declare c public.stel_cola%rowtype; rid uuid; nuevo text; cambia boolean;
begin
  if not public.tiene_permiso('costes.editar') then raise exception 'Permiso costes.editar requerido' using errcode = '42501'; end if;
  select * into c from public.stel_cola s where s.id = p_cola_id for update;
  if c.id is null then raise exception 'Albarán no encontrado en la cola'; end if;
  if c.estado not in ('PENDIENTE','REVISAR','PARADO') then
    raise exception 'Un albarán en estado % no se revisa aquí (en proceso, creado, ya existente o con error: compruébalo en STEL)', c.estado;
  end if;
  if date_trunc('milliseconds', c.actualizado_en) <> date_trunc('milliseconds', p_actualizado_en) then
    raise exception 'El albarán ha cambiado desde que lo abriste; vuelve a abrirlo' using errcode = '40001';
  end if;
  if jsonb_typeof(p_plan) <> 'object' or length(p_plan::text) > 200000 or jsonb_typeof(p_plan->'lineas') <> 'array'
     or jsonb_typeof(coalesce(p_cambios,'[]'::jsonb)) <> 'array' or p_huella_plan !~ '^[0-9a-f]{64}$' then
    raise exception 'Revisión no válida';
  end if;
  if (p_plan->'pdf') is distinct from (c.plan->'pdf') or (p_plan->'paginas') is distinct from (c.plan->'paginas')
     or (p_plan->'ya_en_stel') is distinct from (c.plan->'ya_en_stel') then
    raise exception 'La revisión no puede cambiar el PDF, las páginas ni el albarán de STEL encontrado';
  end if;
  cambia := p_plan is distinct from c.plan;
  insert into public.stel_revisiones (cola_id, confirmado, plan_anterior, plan, cambios, huella_plan, nota)
  values (c.id, p_confirmado, c.plan, p_plan, coalesce(p_cambios,'[]'::jsonb), p_huella_plan, nullif(trim(p_nota),''))
  returning id into rid;
  if cambia then
    update public.stel_autorizaciones a set estado = 'ANULADA', anulada_por = auth.uid(), anulada_en = now(),
      motivo_anulacion = 'Plan corregido en una revisión posterior' where a.cola_id = c.id and a.estado = 'VIGENTE';
  end if;
  nuevo := case when c.estado = 'PARADO' or (cambia and c.estado = 'PENDIENTE') then 'REVISAR' else c.estado end;
  update public.stel_cola s set plan = p_plan, estado = nuevo, actualizado_en = now() where s.id = c.id
  returning s.actualizado_en into actualizado_en;
  perform public.stel_registrar('REVISION', case when p_confirmado then 'CONFIRMADA' else 'GUARDADA' end, c.id,
    jsonb_build_object('revision_id', rid, 'estado_anterior', c.estado, 'estado_nuevo', nuevo, 'cambios', jsonb_array_length(coalesce(p_cambios,'[]'::jsonb)),
      'plan_cambiado', cambia));
  revision_id := rid; estado := nuevo; return next;
end;
$$;

-- 5b. Autorizar la creación en STEL. Exige una revisión CONFIRMADA del plan actual y los controles
-- obligatorios (los mismos que el robot vuelve a comprobar en STEL antes de crear). Si alguno falla, no
-- autoriza: devuelve los fallos (y quedan en el registro) sin cambiar nada más.
create or replace function public.stel_autorizar(p_cola_id uuid, p_huella_plan text, p_actualizado_en timestamptz, p_controles jsonb default '{}'::jsonb)
returns table(operacion_id uuid, fallos text[])
language plpgsql security definer set search_path to '' as $$
declare c public.stel_cola%rowtype; r public.stel_revisiones%rowtype; fallos text[] := '{}'; l jsonb; op uuid;
begin
  if not public.tiene_permiso('costes.editar') then raise exception 'Permiso costes.editar requerido' using errcode = '42501'; end if;
  select * into c from public.stel_cola s where s.id = p_cola_id for update;
  if c.id is null then raise exception 'Albarán no encontrado en la cola'; end if;
  if date_trunc('milliseconds', c.actualizado_en) <> date_trunc('milliseconds', p_actualizado_en) then
    raise exception 'El albarán ha cambiado desde que lo abriste; vuelve a abrirlo' using errcode = '40001';
  end if;
  if c.estado not in ('PENDIENTE','REVISAR') then fallos := fallos || ('Estado ' || c.estado || ': no se puede autorizar'); end if;
  select * into r from public.stel_revisiones v where v.cola_id = c.id order by v.revisado_en desc limit 1;
  if r.id is null or not r.confirmado or r.plan is distinct from c.plan or r.huella_plan <> p_huella_plan then
    fallos := fallos || 'Falta una revisión manual CONFIRMADA del plan actual'::text;
  end if;
  if c.clave like 'SIN_IDENTIFICAR|%' then fallos := fallos || 'Documento sin identificar (proveedor, número o fecha)'::text; end if;
  if coalesce(c.plan->>'tipo','ALBARAN') <> 'ALBARAN' then fallos := fallos || 'Abono o rectificativo: no se crea automáticamente'::text; end if;
  if c.plan->'pedido' is not null and jsonb_typeof(c.plan->'pedido') <> 'null' then fallos := fallos || 'Lleva pedido (PAP): las entregas con pedido aún no se crean solas'::text; end if;
  if c.plan->'ya_en_stel' is not null and jsonb_typeof(c.plan->'ya_en_stel') <> 'null' then fallos := fallos || 'Ya existe en STEL'::text; end if;
  if coalesce(c.plan->'proveedor'->>'account_id','') = '' then fallos := fallos || 'Proveedor sin cuenta de STEL'::text; end if;
  if coalesce(c.plan->>'numero','') = '' then fallos := fallos || 'Sin número de albarán'::text; end if;
  if coalesce(c.plan->>'fecha','') !~ '^\d{2}/\d{2}/\d{4}$' then fallos := fallos || 'Fecha no válida'::text; end if;
  if coalesce(c.plan->'obra'->>'codigo','') !~ '^PRY\d{5}$' then fallos := fallos || 'Obra (PRY) sin identificar'::text; end if;
  if jsonb_typeof(c.plan->'lineas') <> 'array' or jsonb_array_length(c.plan->'lineas') = 0 then fallos := fallos || 'Sin líneas'::text;
  else
    for l in select * from jsonb_array_elements(c.plan->'lineas') loop
      if jsonb_typeof(l->'cantidad') <> 'number' or (l->>'cantidad')::numeric <= 0 then fallos := fallos || ('Línea ' || coalesce(l->>'fila','?') || ': cantidad no válida'); end if;
      if coalesce(l->'articulo'->>'estado','') not in ('existente','buscar','crear') then fallos := fallos || ('Línea ' || coalesce(l->>'fila','?') || ': artículo sin resolver'); end if;
    end loop;
  end if;
  if coalesce((c.plan->'pdf'->>'individual')::boolean, false) is not true or c.plan->'pdf'->>'sha256' is distinct from c.pdf_sha256
     or c.pdf_ruta is distinct from c.pdf_sha256 || '.pdf' then
    fallos := fallos || 'Sin PDF individual verificable del albarán'::text;
  end if;
  if array_length(fallos, 1) > 0 then
    perform public.stel_registrar('AUTORIZACION', 'RECHAZADA', c.id, jsonb_build_object('fallos', to_jsonb(fallos), 'estado', c.estado));
    operacion_id := null; return next; return;
  end if;
  insert into public.stel_autorizaciones (cola_id, revision_id, huella_plan, pdf_sha256, controles)
  values (c.id, r.id, p_huella_plan, c.pdf_sha256, coalesce(p_controles,'{}'::jsonb)) returning stel_autorizaciones.operacion_id into op;
  update public.stel_cola s set estado = 'PENDIENTE', actualizado_en = now() where s.id = c.id;
  perform public.stel_registrar('AUTORIZACION', 'CONCEDIDA', c.id,
    jsonb_build_object('operacion_id', op, 'estado_anterior', c.estado, 'estado_nuevo', 'PENDIENTE', 'revision_id', r.id, 'controles', coalesce(p_controles,'{}'::jsonb)));
  operacion_id := op; fallos := '{}'; return next;
end;
$$;

-- 5c. Retirar una autorización aún no usada.
create or replace function public.stel_autorizacion_anular(p_cola_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to '' as $$
declare n integer; e text;
begin
  if not public.tiene_permiso('costes.editar') then raise exception 'Permiso costes.editar requerido' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo),'') = '' then raise exception 'Indica el motivo'; end if;
  update public.stel_autorizaciones a set estado = 'ANULADA', anulada_por = auth.uid(), anulada_en = now(), motivo_anulacion = left(trim(p_motivo), 300)
  where a.cola_id = p_cola_id and a.estado = 'VIGENTE';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No hay una autorización vigente para este albarán'; end if;
  update public.stel_cola s set estado = 'REVISAR', actualizado_en = now() where s.id = p_cola_id and s.estado = 'PENDIENTE' returning s.estado into e;
  perform public.stel_registrar('AUTORIZACION', 'ANULADA', p_cola_id, jsonb_build_object('motivo', left(trim(p_motivo), 300)));
end;
$$;

-- 5d. Llave temporal del robot desde la aplicación (sustituye pegar SQL en el editor). Solo la HUELLA
-- (SHA-256) llega a Supabase; la llave la guarda el ordenador del robot. Máximo 12 horas.
create or replace function public.robot_llave_registrar(p_huella text, p_horas integer default 12)
returns timestamptz language plpgsql security definer set search_path to '' as $$
declare caduca timestamptz;
begin
  if not public.tiene_permiso('costes.editar') then raise exception 'Permiso costes.editar requerido' using errcode = '42501'; end if;
  if p_huella !~ '^[0-9a-f]{64}$' or p_horas not between 1 and 12 then raise exception 'Llave no válida'; end if;
  delete from public.robot_llaves where expira < now();
  if (select count(*) from public.robot_llaves where expira > now()) >= 3 then raise exception 'Ya hay 3 llaves vigentes del robot'; end if;
  caduca := now() + make_interval(hours => p_horas);
  insert into public.robot_llaves (huella, expira) values (p_huella, caduca);
  perform public.stel_registrar('LLAVE_ROBOT', 'REGISTRADA', null, jsonb_build_object('expira', caduca));
  return caduca;
end;
$$;

revoke all on function public.stel_revision_guardar(uuid,jsonb,jsonb,text,timestamptz,boolean,text) from public, anon;
revoke all on function public.stel_autorizar(uuid,text,timestamptz,jsonb) from public, anon;
revoke all on function public.stel_autorizacion_anular(uuid,text) from public, anon;
revoke all on function public.robot_llave_registrar(text,integer) from public, anon;
grant execute on function public.stel_revision_guardar(uuid,jsonb,jsonb,text,timestamptz,boolean,text) to authenticated;
grant execute on function public.stel_autorizar(uuid,text,timestamptz,jsonb) to authenticated;
grant execute on function public.stel_autorizacion_anular(uuid,text) to authenticated;
grant execute on function public.robot_llave_registrar(text,integer) to authenticated;

commit;
