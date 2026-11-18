-- DAFRICA SAT · al elegir en Ajustes el servicio de mano de obra o de desplazamiento, los albaranes de trabajo parados
-- SOLO por eso vuelven a la cola (usuario, 2026-11-18: primer parte real parado por «Falta: servicio de mano de obra de
-- STEL (Ajustes)»). La oficina después pulsa guardar y la app procesa la cola. Misma función que en
-- 20261118_sat_precio_hora.sql con ese añadido.
create or replace function public.sat_ajuste_guardar(p_clave text, p_valor jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ops uuid[];
begin
  perform public.sat_exigir('sat.administrar');
  if p_clave not in ('texto_alcance_firma', 'stel_servicio_mano_obra_id', 'stel_servicio_desplazamiento_id', 'stel_serie_albaran_trabajo_id',
    'stel_emitir_factura', 'stel_limite_llamadas_dia', 'transcripcion_url', 'precio_hora_mano_obra', 'precio_hora_desplazamiento') then
    raise exception 'ajuste_no_valido';
  end if;
  if p_clave in ('precio_hora_mano_obra', 'precio_hora_desplazamiento')
     and not (p_valor = 'null'::jsonb or (jsonb_typeof(p_valor) = 'number' and (p_valor #>> '{}')::numeric >= 0)) then
    raise exception 'precio_no_valido';
  end if;
  if p_clave = 'stel_emitir_factura' then perform public.sat_exigir('sat.facturar'); end if;
  perform public.sat_auditar('AJUSTE', 'ajustes', null, jsonb_build_object('clave', p_clave, 'anterior', public.sat_ajuste(p_clave), 'nuevo', p_valor));
  insert into public.sat_ajustes (clave, valor, actualizado_por, actualizado_en) values (p_clave, p_valor, auth.uid(), now())
  on conflict (clave) do update set valor = excluded.valor, actualizado_por = excluded.actualizado_por, actualizado_en = now();
  if p_clave in ('stel_servicio_mano_obra_id', 'stel_servicio_desplazamiento_id') and p_valor <> 'null'::jsonb then
    with x as (
      update public.sat_stel_operaciones set estado = 'PENDIENTE', error = null, actualizado_en = now()
      where tipo = 'ALBARAN_TRABAJO' and estado = 'BLOQUEADA' and error like 'Falta:%servicio de % de STEL (Ajustes)%'
      returning parte_id)
    select array_agg(parte_id) into v_ops from x;
    update public.sat_partes set stel_estado = 'PENDIENTE', stel_error = null where id = any(coalesce(v_ops, '{}')) and stel_estado = 'BLOQUEADO';
  end if;
  return public.sat_ajustes_leer();
end $$;
