-- DAFRICA SAT · artículos del albarán del proveedor dados de alta por sat-stel (usuario, 2026-11-20: «necesito que cree el
-- albarán»). Cuando el albarán de trabajo queda creado, sat-stel devuelve en el detalle `articulos` ({material_id: id de STEL})
-- y `articulos_creados` ([{stel_id, referencia, nombre, precio}]). Aquí:
--  1. las líneas de la revisión económica de esos materiales que aún no tienen artículo de STEL lo reciben (la factura lo
--     necesita y la oficina no tiene que buscarlo);
--  2. los artículos nuevos entran en la copia local del catálogo (sat_articulos) para que la oficina los vea por su nombre.
-- Misma función que en 20261116_sat_partes.sql con ese añadido (comprobado igual a producción el 2026-11-20).
create or replace function public.sat_stel_terminar(p_op uuid, p_estado text, p_stel_id bigint default null, p_detalle jsonb default '{}'::jsonb,
  p_error text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.sat_stel_operaciones; f public.sat_facturas; r public.sat_partes; x jsonb;
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
    if p_estado = 'OK' and jsonb_typeof(p_detalle->'articulos') = 'object' then
      update public.sat_partes p set revision = (
        select jsonb_agg(case when l->>'material_id' is not null and coalesce(l->>'stel_item_id', '') = ''
            and p_detalle->'articulos' ? (l->>'material_id') and (p_detalle->'articulos'->>(l->>'material_id')) ~ '^\d+$'
          then l || jsonb_build_object('stel_item_id', (p_detalle->'articulos'->>(l->>'material_id'))::bigint) else l end order by n)
        from jsonb_array_elements(p.revision) with ordinality t(l, n))
      where p.id = o.parte_id and jsonb_typeof(p.revision) = 'array' and jsonb_array_length(p.revision) > 0;
    end if;
    if p_estado = 'OK' and jsonb_typeof(p_detalle->'articulos_creados') = 'array' then
      for x in select * from jsonb_array_elements(p_detalle->'articulos_creados') loop
        if (x->>'stel_id') ~ '^\d+$' and coalesce(x->>'nombre', '') <> '' then
          insert into public.sat_articulos (stel_id, tipo, referencia, nombre, precio, iva_pct, activo)
          values ((x->>'stel_id')::bigint, 'PRODUCTO', x->>'referencia', x->>'nombre', nullif(x->>'precio', '')::numeric, null, true)
          on conflict (stel_id) do nothing;
        end if;
      end loop;
    end if;
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
