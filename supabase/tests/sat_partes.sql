-- Pruebas de la propuesta SAT (avisos, partes, firmas, revisión, factura, entrega) en Postgres EN MEMORIA.
--   node supabase/tests/ejecutar-local.mjs supabase/tests/sat_simulado.sql supabase/propuestas/20261116_sat_partes.sql supabase/tests/sat_partes.sql
-- Datos ficticios. Cada bloque falla con un mensaje claro si algo no se cumple.

-- Usuarios: T1 y T2 técnicos, AD administración, FA facturación.
insert into public.perfiles (id, nombre, email) values
  ('11111111-1111-4111-8111-111111111111', 'Técnico Uno', 't1@prueba.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'Técnico Dos', 't2@prueba.invalid'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Admin Prueba', 'ad@prueba.invalid'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Factura Prueba', 'fa@prueba.invalid');
insert into public.usuario_roles (usuario_id, rol_id) select '11111111-1111-4111-8111-111111111111', id from public.roles where codigo = 'TECNICO_SAT';
insert into public.usuario_roles (usuario_id, rol_id) select '22222222-2222-4222-8222-222222222222', id from public.roles where codigo = 'TECNICO_SAT';
insert into public.usuario_roles (usuario_id, rol_id) select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id from public.roles where codigo = 'ADMINISTRACION';
insert into public.usuario_roles (usuario_id, rol_id) select 'ffffffff-ffff-4fff-8fff-ffffffffffff', id from public.roles where codigo = 'FACTURACION_SAT';

create table public.prueba_datos (clave text primary key, valor jsonb);
grant select on public.prueba_datos to authenticated, service_role;
insert into public.prueba_datos values
  ('c1', '{"tipo_visita":"REPARACION_FINALIZADA","fecha":"2026-11-16","hora_inicio":"09:00","hora_fin":"10:30","cliente":{"nombre":"Cliente Ficticio"},"trabajos":"Sustituido el termostato","materiales":[{"id":"m1","descripcion":"Termostato","cantidad":1,"unidad":"ud"}],"fotos":[]}'),
  ('c2', '{"tipo_visita":"REPARACION_FINALIZADA","fecha":"2026-11-16","hora_inicio":"09:00","hora_fin":"10:45","cliente":{"nombre":"Cliente Ficticio"},"trabajos":"Sustituido el termostato","materiales":[{"id":"m1","descripcion":"Termostato","cantidad":1,"unidad":"ud"}],"fotos":[]}');

create or replace function public.prueba_falla(p_sql text, p_fragmento text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_fragmento in sqlerrm) = 0 then raise exception 'Falló con otro error: «%» (se esperaba «%»)', sqlerrm, p_fragmento; end if;
    return;
  end;
  raise exception 'Debía fallar (%): %', p_fragmento, p_sql;
end $$;
grant execute on function public.prueba_falla(text, text) to authenticated, service_role;

-- 1. Administración crea un aviso y lo asigna a T1.
select set_config('prueba.uid', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
set role authenticated;
do $$ declare a jsonb; begin
  a := public.sat_alta_provisional('CLIENTE', '{"id":"c0000000-0000-4000-8000-000000000001","nombre":"Cliente Ficticio","nif":"B-00.000.000"}');
  a := public.sat_aviso_guardar('{"id":"a0000000-0000-4000-8000-000000000001","motivo":"Caldera no arranca","prioridad":"ALTA",
    "cliente_id":"c0000000-0000-4000-8000-000000000001","cliente_texto":"Cliente Ficticio","tecnico_id":"11111111-1111-4111-8111-111111111111"}');
  if a->>'estado' <> 'ASIGNADO' or a->>'codigo' !~ '^AV-\d\d-00001$' then raise exception 'Aviso mal creado: %', a; end if;
end $$;
reset role;

-- 2. T1 lo ve; T2 no. T1 crea un aviso por llamada directa y administración recibe la notificación.
select set_config('prueba.uid', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ declare l jsonb; a jsonb; begin
  l := public.sat_avisos_listar();
  if jsonb_array_length(l) <> 1 then raise exception 'T1 debería ver 1 aviso: %', l; end if;
  a := public.sat_aviso_guardar('{"id":"a0000000-0000-4000-8000-000000000002","motivo":"Fuga en radiador","prioridad":"URGENTE","cliente_texto":"Otro cliente"}');
  if a->>'origen' <> 'LLAMADA_TECNICO' or a->>'tecnico_id' <> '11111111-1111-4111-8111-111111111111' then raise exception 'Aviso por llamada mal: %', a; end if;
  -- Un técnico no puede asignarse avisos de otro ni tocar funciones de administración.
  perform public.prueba_falla($q$select public.sat_revision_guardar('a0000000-0000-4000-8000-000000000002', '[]', null)$q$, 'sin_permiso');
end $$;
reset role;
select set_config('prueba.uid', '22222222-2222-4222-8222-222222222222', false);
set role authenticated;
do $$ begin
  if jsonb_array_length(public.sat_avisos_listar()) <> 0 then raise exception 'T2 no debería ver avisos de T1'; end if;
  perform public.prueba_falla($q$select public.sat_parte_guardar(jsonb_build_object('id','b0000000-0000-4000-8000-000000000009','aviso_id','a0000000-0000-4000-8000-000000000001','contenido','{}'::jsonb))$q$, 'aviso_de_otro_tecnico');
end $$;
reset role;
do $$ begin
  if (select count(*) from public.sat_notificaciones where usuario_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and tipo = 'AVISO_TECNICO') <> 1 then
    raise exception 'Administración debería tener la notificación del aviso por llamada'; end if;
  if (select count(*) from public.sat_notificaciones where usuario_id = '11111111-1111-4111-8111-111111111111' and tipo = 'AVISO_ASIGNADO') <> 1 then
    raise exception 'T1 debería tener la notificación de asignación'; end if;
end $$;

-- 3. T1 guarda el parte; repetir no cambia nada. Archivos: solo T1 puede subir a la carpeta de su parte.
select set_config('prueba.uid', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ declare r jsonb; begin
  r := public.sat_parte_guardar(jsonb_build_object('id', 'b0000000-0000-4000-8000-000000000001', 'aviso_id', 'a0000000-0000-4000-8000-000000000001',
    'contenido', (select valor from public.prueba_datos where clave = 'c1')));
  if r->>'estado' <> 'BORRADOR' or (r->>'version')::int <> 1 or r->>'codigo' !~ '^PT-\d\d-00001$' then raise exception 'Parte mal creado: %', r; end if;
  r := public.sat_parte_guardar(jsonb_build_object('id', 'b0000000-0000-4000-8000-000000000001', 'aviso_id', 'a0000000-0000-4000-8000-000000000001',
    'contenido', (select valor from public.prueba_datos where clave = 'c1')));
  if not coalesce((r->>'sin_cambios')::boolean, false) or (r->>'version')::int <> 1 then raise exception 'Repetir el guardado no debería crear versión: %', r; end if;
  insert into storage.objects (bucket_id, name) values ('sat-archivos', 'b0000000-0000-4000-8000-000000000001/firma-t.png'),
    ('sat-archivos', 'b0000000-0000-4000-8000-000000000001/firma-c.png'), ('sat-archivos', 'b0000000-0000-4000-8000-000000000001/parte-v1.pdf');
  perform public.sat_archivo_registrar('{"id":"d0000000-0000-4000-8000-000000000001","parte_id":"b0000000-0000-4000-8000-000000000001","tipo":"FIRMA","storage_path":"b0000000-0000-4000-8000-000000000001/firma-t.png","sha256":"aa"}');
  perform public.sat_archivo_registrar('{"id":"d0000000-0000-4000-8000-000000000001","parte_id":"b0000000-0000-4000-8000-000000000001","tipo":"FIRMA","storage_path":"b0000000-0000-4000-8000-000000000001/firma-t.png","sha256":"aa"}');
  perform public.prueba_falla($q$select public.sat_archivo_registrar('{"id":"d0000000-0000-4000-8000-000000000002","parte_id":"b0000000-0000-4000-8000-000000000001","tipo":"FOTO","storage_path":"otra/carpeta.jpg"}')$q$, 'ruta_no_valida');
end $$;
reset role;
select set_config('prueba.uid', '22222222-2222-4222-8222-222222222222', false);
set role authenticated;
do $$ begin
  perform public.prueba_falla($q$insert into storage.objects (bucket_id, name) values ('sat-archivos', 'b0000000-0000-4000-8000-000000000001/intruso.jpg')$q$, 'row-level security');
  if exists (select 1 from storage.objects where name like 'b0000000-0000-4000-8000-000000000001/%') then raise exception 'T2 no debería ver los archivos de T1'; end if;
  perform public.prueba_falla($q$select public.sat_parte_detalle('b0000000-0000-4000-8000-000000000001')$q$, 'sin_permiso');
end $$;
reset role;

-- 4. Firmas: técnico con el contenido actual (válida); cliente con OTRO contenido (no válida); cliente ausente con motivo (válida) → FIRMADO.
select set_config('prueba.uid', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ declare f jsonb; begin
  perform public.prueba_falla($q$select public.sat_parte_enviar('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001/parte-v1.pdf', 'bb')$q$, 'parte_sin_firmas');
  f := public.sat_firma_registrar(jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000001', 'parte_id', 'b0000000-0000-4000-8000-000000000001',
    'rol', 'TECNICO', 'imagen_path', 'b0000000-0000-4000-8000-000000000001/firma-t.png', 'texto_alcance', 'Alcance', 'firmado_en', now(),
    'contenido', (select valor from public.prueba_datos where clave = 'c1')));
  if not (f->>'valida')::boolean or f->>'nombre' <> 'Técnico Uno' then raise exception 'Firma del técnico mal: %', f; end if;
  f := public.sat_firma_registrar(jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000002', 'parte_id', 'b0000000-0000-4000-8000-000000000001',
    'rol', 'CLIENTE', 'nombre', 'Responsable', 'cargo', 'Encargado', 'imagen_path', 'b0000000-0000-4000-8000-000000000001/firma-c.png',
    'texto_alcance', 'Alcance', 'firmado_en', now(), 'contenido', (select valor from public.prueba_datos where clave = 'c2')));
  if (f->>'valida')::boolean or f->>'estado_parte' <> 'BORRADOR' then raise exception 'Firma de otro contenido no debería valer: %', f; end if;
  perform public.prueba_falla($q$select public.sat_firma_registrar(jsonb_build_object('id','e0000000-0000-4000-8000-000000000009','parte_id','b0000000-0000-4000-8000-000000000001','rol','CLIENTE','texto_alcance','A','firmado_en',now(),'contenido','{}'::jsonb,'ausente_motivo',''))$q$, 'falta_firma_o_motivo');
  f := public.sat_firma_registrar(jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000003', 'parte_id', 'b0000000-0000-4000-8000-000000000001',
    'rol', 'CLIENTE', 'ausente_motivo', 'Responsable ausente; atendió el conserje', 'texto_alcance', 'Alcance', 'firmado_en', now(),
    'contenido', (select valor from public.prueba_datos where clave = 'c1')));
  if not (f->>'valida')::boolean or f->>'estado_parte' <> 'FIRMADO' then raise exception 'Firma con motivo de ausencia debería dejarlo FIRMADO: %', f; end if;
  -- Repetir la misma firma (reintento sin conexión) devuelve la misma.
  f := public.sat_firma_registrar(jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000003', 'parte_id', 'b0000000-0000-4000-8000-000000000001',
    'rol', 'CLIENTE', 'ausente_motivo', 'x', 'texto_alcance', 'A', 'firmado_en', now(), 'contenido', '{}'::jsonb));
  if f->>'ausente_motivo' <> 'Responsable ausente; atendió el conserje' then raise exception 'El reintento debería devolver la firma original'; end if;
end $$;
reset role;

-- 5. Corregir después de firmar: firmas invalidadas, versión registrada, hay que volver a firmar.
select set_config('prueba.uid', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ declare r jsonb; begin
  r := public.sat_parte_guardar(jsonb_build_object('id', 'b0000000-0000-4000-8000-000000000001', 'aviso_id', 'a0000000-0000-4000-8000-000000000001',
    'contenido', (select valor from public.prueba_datos where clave = 'c2')));
  if (r->>'firmas_invalidadas')::int <> 2 or r->>'estado' <> 'BORRADOR' or (r->>'version')::int <> 2 then raise exception 'Corrección tras firma mal: %', r; end if;
  if jsonb_array_length(r->'firmas') <> 0 then raise exception 'No debería quedar ninguna firma válida'; end if;
  perform public.sat_firma_registrar(jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000004', 'parte_id', 'b0000000-0000-4000-8000-000000000001',
    'rol', 'TECNICO', 'imagen_path', 'b0000000-0000-4000-8000-000000000001/firma-t.png', 'texto_alcance', 'Alcance', 'firmado_en', now(),
    'contenido', (select valor from public.prueba_datos where clave = 'c2')));
  perform public.sat_firma_registrar(jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000005', 'parte_id', 'b0000000-0000-4000-8000-000000000001',
    'rol', 'CLIENTE', 'nombre', 'Responsable', 'cargo', 'Encargado', 'imagen_path', 'b0000000-0000-4000-8000-000000000001/firma-c.png',
    'texto_alcance', 'Alcance', 'firmado_en', now(), 'contenido', (select valor from public.prueba_datos where clave = 'c2')));
  -- Enviar sin PDF registrado falla; con él, ENVIADO. Repetir el envío no duplica nada.
  perform public.prueba_falla($q$select public.sat_parte_enviar('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001/parte-v1.pdf', 'bb')$q$, 'pdf_no_subido');
  perform public.sat_archivo_registrar('{"id":"d0000000-0000-4000-8000-000000000003","parte_id":"b0000000-0000-4000-8000-000000000001","tipo":"PDF_PARTE","storage_path":"b0000000-0000-4000-8000-000000000001/parte-v1.pdf","sha256":"bb"}');
  r := public.sat_parte_enviar('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001/parte-v1.pdf', 'bb');
  if r->>'estado' <> 'ENVIADO' or r->>'stel_estado' <> 'PENDIENTE' then raise exception 'Envío mal: %', r; end if;
  r := public.sat_parte_enviar('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001/parte-v1.pdf', 'bb');
  if not coalesce((r->>'ya_enviado')::boolean, false) then raise exception 'El reenvío debería reconocerse como ya enviado'; end if;
  perform public.prueba_falla($q$select public.sat_parte_guardar(jsonb_build_object('id','b0000000-0000-4000-8000-000000000001','aviso_id','a0000000-0000-4000-8000-000000000001','contenido','{"x":1}'::jsonb))$q$, 'parte_no_editable');
end $$;
reset role;
do $$ begin
  if (select count(*) from public.sat_stel_operaciones) <> 2 then raise exception 'Deberían existir 2 operaciones de STEL (incidencia y albarán)'; end if;
  if (select count(*) from public.sat_parte_versiones where parte_id = 'b0000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'Deberían quedar 3 versiones (firmada v1, corrección v2, firmada v2): %', (select count(*) from public.sat_parte_versiones); end if;
  if (select estado from public.sat_avisos where id = 'a0000000-0000-4000-8000-000000000001') <> 'CERRADO' then raise exception 'La reparación finalizada cierra el aviso'; end if;
  if not exists (select 1 from public.sat_notificaciones where tipo = 'PARTE_RECIBIDO' and usuario_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'Administración debería recibir el parte'; end if;
end $$;

-- 6. Revisión económica y decisión de facturar (administración). La web no puede tocar las funciones de STEL.
select set_config('prueba.uid', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
set role authenticated;
do $$ declare r jsonb; begin
  perform public.prueba_falla($q$select public.sat_stel_terminar('00000000-0000-4000-8000-000000000000', 'OK')$q$, 'permission denied');
  perform public.prueba_falla($q$select public.sat_stel_tomar(null, 10)$q$, 'permission denied');
  r := public.sat_revision_guardar('b0000000-0000-4000-8000-000000000001',
    '[{"tipo":"MATERIAL","material_id":"m1","stel_item_id":501,"descripcion":"Termostato","cantidad":1,"precio":40,"descuento_pct":10,"iva_pct":21},
      {"tipo":"MANO_OBRA","stel_item_id":null,"descripcion":"Mano de obra","cantidad":1.75,"precio":35,"iva_pct":21}]', 'Revisado');
  perform public.prueba_falla($q$select public.sat_decidir('b0000000-0000-4000-8000-000000000001', 'FACTURAR', null)$q$, 'linea_incompleta');
  r := public.sat_revision_guardar('b0000000-0000-4000-8000-000000000001',
    '[{"tipo":"MATERIAL","material_id":"m1","stel_item_id":501,"descripcion":"Termostato","cantidad":1,"precio":40,"descuento_pct":10,"iva_pct":21},
      {"tipo":"MANO_OBRA","stel_item_id":900,"descripcion":"Mano de obra","cantidad":1.75,"precio":35,"iva_pct":21}]', 'Revisado');
  -- 36,00 + 61,25 = 97,25 de base: 43,56 + 74,11 = 117,67 con IVA (por línea).
  if (r->>'total_revision')::numeric <> 117.67 then raise exception 'Total mal: %', r->>'total_revision'; end if;
  r := public.sat_decidir('b0000000-0000-4000-8000-000000000001', 'FACTURAR', null);
  if r->>'estado' <> 'PENDIENTE_APROBACION' then raise exception 'Decisión mal: %', r->>'estado'; end if;
  -- Administración sin sat.facturar no puede aprobar.
  perform public.prueba_falla($q$select public.sat_factura_aprobar('b0000000-0000-4000-8000-000000000001', 117.67, 'Apruebo')$q$, 'sin_permiso');
end $$;
reset role;

-- 7. Aprobación expresa (facturación): exige el total que ve; nunca dos facturas.
select set_config('prueba.uid', 'ffffffff-ffff-4fff-8fff-ffffffffffff', false);
set role authenticated;
do $$ declare r jsonb; begin
  if not exists (select 1 from jsonb_array_elements(public.sat_notificaciones()) n where n->>'tipo' = 'FACTURA_POR_APROBAR') then
    raise exception 'Facturación debería tener el aviso de factura por aprobar'; end if;
  perform public.prueba_falla($q$select public.sat_factura_aprobar('b0000000-0000-4000-8000-000000000001', 100, 'Apruebo')$q$, 'total_distinto');
  r := public.sat_factura_aprobar('b0000000-0000-4000-8000-000000000001', 117.67, 'Apruebo la factura de 117,67 €');
  if r->>'estado' <> 'APROBADO' or r->'factura'->>'estado' <> 'APROBADA' then raise exception 'Aprobación mal: %', r; end if;
  perform public.prueba_falla($q$select public.sat_factura_aprobar('b0000000-0000-4000-8000-000000000001', 117.67, 'Otra vez')$q$, 'ya_facturado');
end $$;
reset role;

-- 8. La función Edge (service_role) procesa: incidencia, albarán de trabajo y factura con PDF.
set role service_role;
do $$ declare ops jsonb; o jsonb; begin
  ops := public.sat_stel_tomar('b0000000-0000-4000-8000-000000000001', 10);
  if jsonb_array_length(ops) <> 3 then raise exception 'Deberían tomarse 3 operaciones: %', jsonb_array_length(ops); end if;
  if ops->0->'op'->>'tipo' <> 'INCIDENCIA' or ops->1->'op'->>'tipo' <> 'ALBARAN_TRABAJO' or ops->2->'op'->>'tipo' <> 'FACTURA' then raise exception 'Orden mal'; end if;
  -- Una segunda pasada no vuelve a tomar las que están en curso.
  if jsonb_array_length(public.sat_stel_tomar('b0000000-0000-4000-8000-000000000001', 10)) <> 0 then raise exception 'No debería tomar dos veces'; end if;
  perform public.sat_stel_terminar((ops->0->'op'->>'id')::uuid, 'OK', 7001, '{}');
  perform public.sat_stel_terminar((ops->1->'op'->>'id')::uuid, 'OK', 8001, '{"referencia":"AT-0001","version":2}');
  -- La factura espera al albarán (PENDIENTE no gasta intentos) y después se crea con PDF.
  perform public.sat_stel_terminar((ops->2->'op'->>'id')::uuid, 'PENDIENTE', null, '{}', 'Esperando el albarán');
  ops := public.sat_stel_tomar('b0000000-0000-4000-8000-000000000001', 10);
  -- Creada sin emitir: ni PDF ni FACTURADO; facturación recibe el aviso de emitirla.
  perform public.sat_stel_terminar((ops->0->'op'->>'id')::uuid, 'OK', 9001, '{"referencia":"F-0001","total":117.67,"emitida":false}');
end $$;
reset role;
do $$ begin
  if (select estado from public.sat_partes where id = 'b0000000-0000-4000-8000-000000000001') <> 'APROBADO' then raise exception 'Sin emitir no está facturado'; end if;
  if not exists (select 1 from public.sat_notificaciones where tipo = 'FACTURA_POR_EMITIR' and usuario_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff') then
    raise exception 'Facturación debería tener el aviso de emitir'; end if;
end $$;
reset role;
select set_config('prueba.uid', 'ffffffff-ffff-4fff-8fff-ffffffffffff', false);
set role authenticated;
do $$ begin perform public.sat_factura_confirmar_emitida('b0000000-0000-4000-8000-000000000001'); end $$;
reset role;
set role service_role;
do $$ declare ops jsonb; begin
  ops := public.sat_stel_tomar('b0000000-0000-4000-8000-000000000001', 10);
  perform public.sat_stel_terminar((ops->0->'op'->>'id')::uuid, 'OK', 9001,
    '{"referencia":"F-0001","total":117.67,"emitida":true,"pdf_path":"b0000000-0000-4000-8000-000000000001/factura-F-0001.pdf"}');
end $$;
reset role;
do $$ begin
  if (select stel_incidencia_id from public.sat_avisos where id = 'a0000000-0000-4000-8000-000000000001') <> 7001 then raise exception 'Incidencia no guardada'; end if;
  if (select stel_albaran_id from public.sat_partes where id = 'b0000000-0000-4000-8000-000000000001') <> 8001 then raise exception 'Albarán no guardado'; end if;
  if (select estado from public.sat_partes where id = 'b0000000-0000-4000-8000-000000000001') <> 'FACTURADO' then raise exception 'El parte debería estar FACTURADO'; end if;
  if (select entrega_estado from public.sat_facturas) <> 'PENDIENTE_ENTREGA' then raise exception 'Notificar NO es entregar'; end if;
  if not exists (select 1 from public.sat_notificaciones where tipo = 'FACTURA_DISPONIBLE' and usuario_id = '11111111-1111-4111-8111-111111111111') then
    raise exception 'El técnico debería recibir la factura'; end if;
end $$;

-- 9. El técnico la ve en su bandeja y marca la entrega a mano. T2 no la ve.
select set_config('prueba.uid', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ declare b jsonb; f jsonb; begin
  b := public.sat_mis_facturas();
  if jsonb_array_length(b) <> 1 or b->0->>'entrega_estado' <> 'PENDIENTE_ENTREGA' then raise exception 'Bandeja mal: %', b; end if;
  f := public.sat_factura_entrega((b->0->>'id')::uuid, true, 'WhatsApp al responsable');
  if f->>'entrega_estado' <> 'ENTREGADA' or f->>'entrega_medio' <> 'WhatsApp al responsable' then raise exception 'Entrega mal: %', f; end if;
end $$;
reset role;
select set_config('prueba.uid', '22222222-2222-4222-8222-222222222222', false);
set role authenticated;
do $$ begin
  if jsonb_array_length(public.sat_mis_facturas()) <> 0 then raise exception 'T2 no debería ver facturas de T1'; end if;
end $$;
reset role;

-- 10. Petición de información: el técnico corrige (versión registrada), vuelve a firmar y a enviar; el albarán se reintenta.
select set_config('prueba.uid', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ begin
  perform public.sat_parte_guardar(jsonb_build_object('id', 'b0000000-0000-4000-8000-000000000002', 'aviso_id', 'a0000000-0000-4000-8000-000000000002',
    'contenido', (select valor from public.prueba_datos where clave = 'c1')));
  insert into storage.objects (bucket_id, name) values ('sat-archivos', 'b0000000-0000-4000-8000-000000000002/f.png'), ('sat-archivos', 'b0000000-0000-4000-8000-000000000002/p1.pdf');
  perform public.sat_firma_registrar(jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000011', 'parte_id', 'b0000000-0000-4000-8000-000000000002',
    'rol', 'TECNICO', 'imagen_path', 'b0000000-0000-4000-8000-000000000002/f.png', 'texto_alcance', 'A', 'firmado_en', now(), 'contenido', (select valor from public.prueba_datos where clave = 'c1')));
  perform public.sat_firma_registrar(jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000012', 'parte_id', 'b0000000-0000-4000-8000-000000000002',
    'rol', 'CLIENTE', 'imagen_path', 'b0000000-0000-4000-8000-000000000002/f.png', 'nombre', 'Responsable', 'texto_alcance', 'A', 'firmado_en', now(), 'contenido', (select valor from public.prueba_datos where clave = 'c1')));
  perform public.sat_archivo_registrar('{"id":"d0000000-0000-4000-8000-000000000011","parte_id":"b0000000-0000-4000-8000-000000000002","tipo":"PDF_PARTE","storage_path":"b0000000-0000-4000-8000-000000000002/p1.pdf","sha256":"p1"}');
  perform public.sat_parte_enviar('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002/p1.pdf', 'p1');
end $$;
reset role;
set role service_role;
do $$ declare ops jsonb; begin
  ops := public.sat_stel_tomar('b0000000-0000-4000-8000-000000000002', 10);
  perform public.sat_stel_terminar((ops->0->'op'->>'id')::uuid, 'OK', 7002, '{}');
  perform public.sat_stel_terminar((ops->1->'op'->>'id')::uuid, 'OK', 8002, '{"referencia":"AT-0002","version":1}');
end $$;
reset role;
select set_config('prueba.uid', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
set role authenticated;
do $$ begin
  perform public.prueba_falla($q$select public.sat_decidir('b0000000-0000-4000-8000-000000000002', 'INFO', '')$q$, 'falta_nota');
  perform public.sat_decidir('b0000000-0000-4000-8000-000000000002', 'INFO', 'Falta la hora real de fin');
end $$;
reset role;
select set_config('prueba.uid', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ declare r jsonb; begin
  r := public.sat_parte_guardar(jsonb_build_object('id', 'b0000000-0000-4000-8000-000000000002', 'aviso_id', 'a0000000-0000-4000-8000-000000000002',
    'contenido', (select valor from public.prueba_datos where clave = 'c2')));
  if r->>'estado' <> 'INFO_SOLICITADA' or (r->>'firmas_invalidadas')::int <> 2 then raise exception 'Corrección pedida mal: %', r; end if;
  insert into storage.objects (bucket_id, name) values ('sat-archivos', 'b0000000-0000-4000-8000-000000000002/p2.pdf');
  perform public.sat_firma_registrar(jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000013', 'parte_id', 'b0000000-0000-4000-8000-000000000002',
    'rol', 'TECNICO', 'imagen_path', 'b0000000-0000-4000-8000-000000000002/f.png', 'texto_alcance', 'A', 'firmado_en', now(), 'contenido', (select valor from public.prueba_datos where clave = 'c2')));
  r := public.sat_firma_registrar(jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000014', 'parte_id', 'b0000000-0000-4000-8000-000000000002',
    'rol', 'CLIENTE', 'ausente_motivo', 'No desea firmar', 'texto_alcance', 'A', 'firmado_en', now(), 'contenido', (select valor from public.prueba_datos where clave = 'c2')));
  if r->>'estado_parte' <> 'FIRMADO' then raise exception 'Debería quedar FIRMADO de nuevo: %', r; end if;
  perform public.sat_archivo_registrar('{"id":"d0000000-0000-4000-8000-000000000012","parte_id":"b0000000-0000-4000-8000-000000000002","tipo":"PDF_PARTE","storage_path":"b0000000-0000-4000-8000-000000000002/p2.pdf","sha256":"p2"}');
  r := public.sat_parte_enviar('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002/p2.pdf', 'p2');
  if r->>'estado' <> 'ENVIADO' or (r->>'pdf_version')::int <> 2 then raise exception 'Reenvío mal: %', r; end if;
end $$;
reset role;
do $$ begin
  if (select estado from public.sat_stel_operaciones where clave = 'wdn:b0000000-0000-4000-8000-000000000002') <> 'PENDIENTE' then
    raise exception 'El albarán debería volver a procesarse con la versión 2'; end if;
  if (select count(*) from public.sat_stel_operaciones where clave like 'wdn:b0000000-0000-4000-8000-000000000002%') <> 1 then raise exception 'Operación duplicada'; end if;
  if not exists (select 1 from public.sat_parte_versiones where parte_id = 'b0000000-0000-4000-8000-000000000002' and motivo like 'Corrección%') then
    raise exception 'La corrección debería quedar registrada'; end if;
  if (select count(*) from public.sat_auditoria where accion in ('FIRMA_TECNICO', 'FIRMA_CLIENTE', 'PARTE_ENVIADO', 'FACTURA_APROBADA', 'FACTURA_ENTREGADA', 'REVISION_GUARDADA')) < 10 then
    raise exception 'Falta auditoría: %', (select count(*) from public.sat_auditoria); end if;
end $$;
-- Precio fijo por hora (20261118_sat_precio_hora.sql): 50 € por defecto; administración lo cambia; un técnico no; nada negativo.
select set_config('prueba.uid', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
set role authenticated;
do $$ declare r jsonb; begin
  r := public.sat_ajustes_leer();
  if r->'precio_hora_mano_obra' <> '50'::jsonb or r->'precio_hora_desplazamiento' <> '50'::jsonb then raise exception 'Precio por hora inicial mal: %', r; end if;
  r := public.sat_ajuste_guardar('precio_hora_desplazamiento', '45.5');
  if r->'precio_hora_desplazamiento' <> '45.5'::jsonb then raise exception 'Precio por hora no guardado: %', r; end if;
  perform public.prueba_falla($q$select public.sat_ajuste_guardar('precio_hora_mano_obra', '-1')$q$, 'precio_no_valido');
  perform public.prueba_falla($q$select public.sat_ajuste_guardar('precio_hora_mano_obra', '"50"')$q$, 'precio_no_valido');
end $$;
reset role;
select set_config('prueba.uid', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$ begin
  perform public.prueba_falla($q$select public.sat_ajuste_guardar('precio_hora_mano_obra', '10')$q$, 'sin_permiso');
end $$;
reset role;
-- Parte rápido (20261118_sat_parte_rapido.sql): quien es de oficina Y técnico crea un aviso por llamada → queda a su nombre;
-- un aviso sin técnico lo coge quien hace el parte; uno asignado a otro técnico, no.
insert into public.perfiles (id, nombre, email) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Dirección Prueba', 'di@prueba.invalid');
insert into public.usuario_roles (usuario_id, rol_id) select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', id from public.roles where codigo = 'DIRECCION_ADMIN';
select set_config('prueba.uid', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', false);
set role authenticated;
do $$ declare a jsonb; r jsonb; begin
  a := public.sat_aviso_guardar('{"id":"a0000000-0000-4000-8000-000000000010","motivo":"Llamada","origen":"LLAMADA_TECNICO","cliente_texto":"Cliente Ficticio"}');
  if a->>'tecnico_id' <> 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' or a->>'estado' <> 'ASIGNADO' or a->>'origen' <> 'LLAMADA_TECNICO' then
    raise exception 'Aviso por llamada de oficina+técnico mal: %', a; end if;
  -- Un aviso de oficina sin técnico: el parte lo coge.
  a := public.sat_aviso_guardar('{"id":"a0000000-0000-4000-8000-000000000011","motivo":"Sin asignar","cliente_texto":"Cliente Ficticio"}');
  if a->>'tecnico_id' is not null or a->>'estado' <> 'NUEVO' then raise exception 'Aviso de oficina debería quedar sin técnico: %', a; end if;
  r := public.sat_parte_guardar(jsonb_build_object('id', 'b0000000-0000-4000-8000-000000000011', 'aviso_id', 'a0000000-0000-4000-8000-000000000011',
    'contenido', (select valor from public.prueba_datos where clave = 'c1')));
  if r->>'estado' <> 'BORRADOR' then raise exception 'Parte sobre aviso sin asignar mal: %', r; end if;
  -- Reasignar desde oficina un aviso que vino por llamada sigue funcionando (no se queda pegado a quien reasigna).
  a := public.sat_aviso_guardar(jsonb_build_object('id', 'a0000000-0000-4000-8000-000000000010', 'motivo', 'Llamada', 'origen', 'LLAMADA_TECNICO',
    'cliente_texto', 'Cliente Ficticio', 'tecnico_id', '22222222-2222-4222-8222-222222222222'));
  if a->>'tecnico_id' <> '22222222-2222-4222-8222-222222222222' then raise exception 'La reasignación desde oficina no se aplicó: %', a; end if;
  perform public.prueba_falla($q$select public.sat_parte_guardar(jsonb_build_object('id', 'b0000000-0000-4000-8000-000000000012',
    'aviso_id', 'a0000000-0000-4000-8000-000000000010', 'contenido', '{"tipo_visita":null}'::jsonb))$q$, 'aviso_de_otro_tecnico');
end $$;
reset role;
do $$ begin
  if (select tecnico_id from public.sat_avisos where id = 'a0000000-0000-4000-8000-000000000011') <> 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' then
    raise exception 'El aviso sin asignar debería quedar a nombre de quien hace el parte'; end if;
  if not exists (select 1 from public.sat_auditoria where accion = 'AVISO_COGIDO') then raise exception 'Falta la auditoría de AVISO_COGIDO'; end if;
end $$;
select 'SAT: todas las pruebas correctas' as resultado;
