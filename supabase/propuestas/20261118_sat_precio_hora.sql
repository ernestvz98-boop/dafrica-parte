-- DAFRICA SAT · precio fijo por hora de la mano de obra y del desplazamiento (usuario, 2026-11-18: «fijo de 50 € la hora»).
-- Dos ajustes nuevos (50 € por defecto) que la revisión económica usa al proponer las líneas desde el parte; la oficina los
-- puede cambiar en Ajustes. Solo se añaden los dos ajustes y se amplía la lista de claves que acepta sat_ajuste_guardar.
insert into public.sat_ajustes (clave, valor) values
  ('precio_hora_mano_obra', '50'::jsonb),
  ('precio_hora_desplazamiento', '50'::jsonb)
on conflict (clave) do nothing;

create or replace function public.sat_ajuste_guardar(p_clave text, p_valor jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
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
  return public.sat_ajustes_leer();
end $$;
