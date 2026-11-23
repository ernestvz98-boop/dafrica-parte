-- DAFRICA SAT · margen de los materiales comprados y forma de pago fija (usuario, 2026-11-23: «a todos los materiales que
-- se compren le pongas un 30 % por encima del precio y también tiene que revisar que coja los descuentos. En forma de pago
-- siempre tiene que ser transferencia y cuenta bancaria la terminada en …»).
--  - margen_materiales_pct: % sobre el precio de compra NETO (con los descuentos del albarán del proveedor). 30 por defecto.
--  - stel_forma_pago_id / stel_cuenta_bancaria_id: forma de pago y cuenta de STEL de TODOS los albaranes de trabajo y
--    facturas del SAT (los elige la función sat-stel, acción «pagos», con la sesión de la oficina).
--  - stel_pago_descripcion: texto para enseñarlo en Ajustes (nombre de la forma de pago y últimas cifras de la cuenta).
-- Misma función que en 20261118_sat_servicios_desbloquean.sql con esas claves y, al elegir la forma de pago y la cuenta,
-- vuelven a la cola los albaranes y facturas parados SOLO por faltarles.
insert into public.sat_ajustes (clave, valor) values ('margen_materiales_pct', '30'::jsonb) on conflict (clave) do nothing;

create or replace function public.sat_ajuste_guardar(p_clave text, p_valor jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ops uuid[];
begin
  perform public.sat_exigir('sat.administrar');
  if p_clave not in ('texto_alcance_firma', 'stel_servicio_mano_obra_id', 'stel_servicio_desplazamiento_id', 'stel_serie_albaran_trabajo_id',
    'stel_emitir_factura', 'stel_limite_llamadas_dia', 'transcripcion_url', 'precio_hora_mano_obra', 'precio_hora_desplazamiento',
    'margen_materiales_pct', 'stel_forma_pago_id', 'stel_cuenta_bancaria_id', 'stel_pago_descripcion') then
    raise exception 'ajuste_no_valido';
  end if;
  if p_clave in ('precio_hora_mano_obra', 'precio_hora_desplazamiento')
     and not (p_valor = 'null'::jsonb or (jsonb_typeof(p_valor) = 'number' and (p_valor #>> '{}')::numeric >= 0)) then
    raise exception 'precio_no_valido';
  end if;
  if p_clave = 'margen_materiales_pct'
     and not (jsonb_typeof(p_valor) = 'number' and (p_valor #>> '{}')::numeric between 0 and 500) then
    raise exception 'margen_no_valido';
  end if;
  if p_clave in ('stel_forma_pago_id', 'stel_cuenta_bancaria_id')
     and not (p_valor = 'null'::jsonb or (jsonb_typeof(p_valor) = 'number' and (p_valor #>> '{}')::numeric > 0)) then
    raise exception 'id_no_valido';
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
  if p_clave in ('stel_forma_pago_id', 'stel_cuenta_bancaria_id') and p_valor <> 'null'::jsonb
     and public.sat_ajuste('stel_forma_pago_id') is not null and public.sat_ajuste('stel_forma_pago_id') <> 'null'::jsonb
     and public.sat_ajuste('stel_cuenta_bancaria_id') is not null and public.sat_ajuste('stel_cuenta_bancaria_id') <> 'null'::jsonb then
    with x as (
      update public.sat_stel_operaciones set estado = 'PENDIENTE', error = null, actualizado_en = now()
      where tipo in ('ALBARAN_TRABAJO', 'FACTURA') and estado = 'BLOQUEADA' and error like 'Falta:%forma de pago y cuenta bancaria (Ajustes)%'
      returning parte_id)
    select array_agg(parte_id) into v_ops from x;
    update public.sat_partes set stel_estado = 'PENDIENTE', stel_error = null where id = any(coalesce(v_ops, '{}')) and stel_estado = 'BLOQUEADO';
  end if;
  return public.sat_ajustes_leer();
end $$;
