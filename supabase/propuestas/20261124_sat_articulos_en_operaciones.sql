-- DAFRICA SAT · la oficina ve el artículo de STEL de cada material del albarán de trabajo ya creado (usuario, 2026-11-24: «que
-- cuando lo envíe se cree el albarán de trabajo y ya Dani en la oficina lo revise y actualice todo»).
-- La operación ALBARAN_TRABAJO guarda en su detalle `articulos` (id del material → artículo de STEL: el encontrado, el dado de alta
-- o el genérico «por identificar»). Hasta ahora solo se copiaban a una revisión ya guardada (sat_stel_terminar); la revisión que la
-- oficina propone DESPUÉS de crearse el albarán salía sin ellos. Ahora sat_parte_json los incluye en cada operación de albarán de
-- trabajo y la oficina (sat/admin.js, sat-stel) los usa. Único cambio respecto a 20261116_sat_partes.sql: la clave `articulos`.
-- Solo lectura: no cambia ninguna tabla ni ningún permiso (create or replace conserva los privilegios).

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
        'stel_id', o.stel_id, 'error', o.error, 'actualizado_en', o.actualizado_en,
        'articulos', case when o.tipo = 'ALBARAN_TRABAJO' and jsonb_typeof(o.detalle->'articulos') = 'object' then o.detalle->'articulos' end) order by o.creado_en)
      from public.sat_stel_operaciones o where o.parte_id = p.id or (o.aviso_id = p.aviso_id and o.tipo = 'INCIDENCIA')), '[]'::jsonb),
    'auditoria', coalesce((select jsonb_agg(jsonb_build_object('accion', au.accion, 'creado_en', au.creado_en,
        'usuario', (select pf.nombre from public.perfiles pf where pf.id = au.usuario_id), 'detalle', au.detalle) order by au.id)
      from public.sat_auditoria au where au.entidad_id in (p.id, p.aviso_id)
        or au.entidad_id in (select fa.id from public.sat_facturas fa where fa.parte_id = p.id)), '[]'::jsonb))
  else '{}'::jsonb end
  from public.sat_partes p where p.id = p_id
$$;
