-- DAFRICA SAT · parte rápido y transcripción propia (usuario, 2026-11-18, tras el primer parte de prueba).
-- 1. Un aviso creado «por llamada» desde el teléfono queda a nombre de quien lo crea aunque también sea de oficina
--    (antes, con sat.administrar quedaba sin técnico y el parte se rechazaba como «de otro técnico").
-- 2. Un aviso sin técnico lo coge quien hace el parte (con sat.tecnico); uno asignado a otro técnico sigue rechazándose.
-- 3. La transcripción pasa a la función propia `sat-transcribir` (exige sat.tecnico o sat.administrar), solo si el ajuste
--    sigue apuntando al servicio antiguo de DAFRICA Parte.

create or replace function public.sat_aviso_guardar(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_admin boolean := public.sat_puede('sat.administrar');
  v_tec boolean := public.sat_puede('sat.tecnico');
  v_llamada boolean := coalesce(p->>'origen', '') = 'LLAMADA_TECNICO' and v_tec;
  a public.sat_avisos;
  v_tecnico uuid;
  v_anterior uuid;
begin
  if not (v_admin or v_tec) then raise exception 'sin_permiso: sat' using errcode = '42501'; end if;
  if v_id is null then raise exception 'falta_id'; end if;
  if coalesce(trim(p->>'motivo'), '') = '' then raise exception 'falta_motivo'; end if;
  if coalesce(p->>'prioridad', 'NORMAL') not in ('BAJA', 'NORMAL', 'ALTA', 'URGENTE') then raise exception 'prioridad_no_valida'; end if;
  select * into a from public.sat_avisos where id = v_id for update;
  v_tecnico := case when v_admin and not (v_llamada and not found) then (p->>'tecnico_id')::uuid else auth.uid() end;
  if not found then
    insert into public.sat_avisos (id, codigo, cliente_id, direccion_id, contacto_id, equipo_id, cliente_texto, direccion_texto,
      contacto_texto, equipo_texto, motivo, prioridad, origen, estado, tecnico_id, programado_para, notas, creado_por)
    values (v_id, public.sat_nuevo_codigo('AV'), (p->>'cliente_id')::uuid, (p->>'direccion_id')::uuid, (p->>'contacto_id')::uuid,
      (p->>'equipo_id')::uuid, p->>'cliente_texto', p->>'direccion_texto', p->>'contacto_texto', p->>'equipo_texto',
      trim(p->>'motivo'), coalesce(p->>'prioridad', 'NORMAL'),
      case when v_admin and not v_llamada and coalesce(p->>'origen', 'ADMINISTRACION') = 'ADMINISTRACION' then 'ADMINISTRACION' else 'LLAMADA_TECNICO' end,
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
    if a.estado in ('CERRADO', 'ANULADO') then raise exception 'aviso_cerrado'; end if;
    -- Un aviso sin asignar lo coge quien hace el parte; uno de otro técnico, no.
    if a.tecnico_id is null then
      update public.sat_avisos set tecnico_id = auth.uid(), estado = case when estado = 'NUEVO' then 'ASIGNADO' else estado end,
        actualizado_en = now() where id = a.id returning * into a;
      perform public.sat_auditar('AVISO_COGIDO', 'aviso', a.id, jsonb_build_object('codigo', a.codigo));
    end if;
    if a.tecnico_id is distinct from auth.uid() then raise exception 'aviso_de_otro_tecnico' using errcode = '42501'; end if;
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

update public.sat_ajustes set valor = to_jsonb('https://sbocfjxamjmwabmqbeyw.supabase.co/functions/v1/sat-transcribir'::text), actualizado_en = now()
where clave = 'transcripcion_url' and valor = to_jsonb('https://dafrica-parte-backend.onrender.com/transcribir'::text);
