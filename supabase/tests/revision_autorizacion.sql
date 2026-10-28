-- Prueba de supabase/propuestas/20261028_revision_autorizacion_robot.sql en un Postgres LOCAL con
-- supabase-simulado.sql y supabase/migraciones/20261026_stel_cola.sql. Datos ficticios. Termina con
-- «REVISION_AUTORIZACION OK» o con el primer error.
\set ON_ERROR_STOP on
grant select, truncate, references, trigger on public.stel_cola to authenticated;
grant truncate, references, trigger on public.stel_cola to anon;
\ir ../propuestas/20261028_revision_autorizacion_robot.sql

create function pg_temp.espera_error(sql text, patron text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlerrm !~ patron then raise exception 'Error inesperado: % (esperaba %)', sqlerrm, patron; end if; return;
  end;
  raise exception 'Debía fallar: % (esperaba %)', sql, patron;
end $$;
grant execute on function pg_temp.espera_error(text,text) to authenticated;
-- Autorización rechazada: sin operación, con los fallos esperados (y sin deshacer el registro).
create function pg_temp.rechazada(p_id uuid, p_huella text, patron text) returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.stel_autorizar(p_id, p_huella, (select actualizado_en from public.stel_cola where id = p_id));
  if r.operacion_id is not null or array_to_string(r.fallos,' | ') !~ patron then
    raise exception 'Autorización no rechazada como se esperaba: % / %', r.operacion_id, r.fallos;
  end if;
end $$;
grant execute on function pg_temp.rechazada(uuid,text,text) to authenticated;

-- Albarán ficticio identificado, con PDF individual, obra y artículos resueltos.
insert into public.stel_cola (id, clave, estado, motivos, plan, pdf_ruta, pdf_sha256) values
 ('00000000-0000-0000-0000-000000000001','9001|123456|2026-10-22','REVISAR','["Obra (PRY) sin validar"]',
  jsonb_build_object('tipo','ALBARAN','numero','123.456','fecha','22/10/2026','paginas','[3]'::jsonb,'proveedor',jsonb_build_object('account_id',9001),
   'obra',null,'pedido',null,'ya_en_stel',null,
   'lineas',jsonb_build_array(jsonb_build_object('fila',1,'cantidad',4,'articulo',jsonb_build_object('estado','existente','item_id',777))),
   'pdf',jsonb_build_object('individual',true,'sha256',repeat('a',64),'paginas',1)), repeat('a',64)||'.pdf', repeat('a',64)),
 ('00000000-0000-0000-0000-000000000002','SIN_IDENTIFICAR|'||repeat('b',64),'REVISAR','[]',
  jsonb_build_object('tipo','ABONO','numero',null,'lineas','[]'::jsonb,'paginas','[22]'::jsonb,'pdf',jsonb_build_object('individual',true,'sha256',repeat('b',64))), repeat('b',64)||'.pdf', repeat('b',64)),
 ('00000000-0000-0000-0000-000000000003','9001|999|2026-10-01','CREADO','[]','{"lineas":[]}', null, null);

set role authenticated;
-- Sin sesión verificada / sin permiso: nada.
select set_config('prueba.uid','11111111-1111-1111-1111-111111111111',false), set_config('prueba.permisos','costes.ver',false);
select pg_temp.espera_error($$select public.stel_revision_guardar('00000000-0000-0000-0000-000000000001','{}'::jsonb,'[]',repeat('c',64),now(),true,null)$$,'costes.editar');
select pg_temp.espera_error($$select public.robot_llave_registrar(repeat('d',64),12)$$,'costes.editar');
-- Nadie escribe directamente en las tablas nuevas ni vacía las de la cola.
select pg_temp.espera_error($$insert into public.stel_revisiones(cola_id,confirmado,plan_anterior,plan,huella_plan) values ('00000000-0000-0000-0000-000000000001',true,'{}','{}',repeat('c',64))$$,'permission denied');
select pg_temp.espera_error($$truncate public.stel_cola$$,'permission denied');
select pg_temp.espera_error($$truncate public.stel_sync_log$$,'permission denied');

select set_config('prueba.permisos','costes.ver,costes.editar',false);
-- Concurrencia: con una fecha de actualización antigua, se rechaza.
select pg_temp.espera_error($$select public.stel_revision_guardar('00000000-0000-0000-0000-000000000001',(select plan from public.stel_cola where id='00000000-0000-0000-0000-000000000001'),'[]',repeat('c',64),'2000-01-01',true,null)$$,'ha cambiado');
-- No se puede cambiar el PDF ni las páginas.
select pg_temp.espera_error($$select public.stel_revision_guardar('00000000-0000-0000-0000-000000000001',(select plan||'{"paginas":[1,2,3]}' from public.stel_cola where id='00000000-0000-0000-0000-000000000001'),'[]',repeat('c',64),(select actualizado_en from public.stel_cola where id='00000000-0000-0000-0000-000000000001'),true,null)$$,'PDF, las páginas');
-- Autorizar sin revisión confirmada: rechazado y anotado.
select pg_temp.rechazada('00000000-0000-0000-0000-000000000001',repeat('c',64),'revisión manual CONFIRMADA');
-- Revisión que corrige la obra (sin confirmar todavía): sigue en REVISAR y no se puede autorizar.
select * from public.stel_revision_guardar('00000000-0000-0000-0000-000000000001',
  (select plan||'{"obra":{"codigo":"PRY09999","stel_id":null,"nombre":null}}' from public.stel_cola where id='00000000-0000-0000-0000-000000000001'),
  '[{"campo":"obra","antes":null,"despues":"PRY09999"}]', repeat('c',64), (select actualizado_en from public.stel_cola where id='00000000-0000-0000-0000-000000000001'), false, 'obra según el papel');
select pg_temp.rechazada('00000000-0000-0000-0000-000000000001',repeat('c',64),'CONFIRMADA');
-- Confirmada (mismo plan): se autoriza una vez; queda PENDIENTE con una autorización vigente.
select * from public.stel_revision_guardar('00000000-0000-0000-0000-000000000001',(select plan from public.stel_cola where id='00000000-0000-0000-0000-000000000001'),'[]',repeat('e',64),(select actualizado_en from public.stel_cola where id='00000000-0000-0000-0000-000000000001'),true,null);
select pg_temp.rechazada('00000000-0000-0000-0000-000000000001',repeat('c',64),'CONFIRMADA');
select operacion_id is not null as autorizado from public.stel_autorizar('00000000-0000-0000-0000-000000000001',repeat('e',64),(select actualizado_en from public.stel_cola where id='00000000-0000-0000-0000-000000000001'),'{"cliente":"prueba"}');
do $$ begin
  if (select estado from public.stel_cola where id='00000000-0000-0000-0000-000000000001')<>'PENDIENTE' then raise exception 'Debía quedar PENDIENTE'; end if;
  if (select count(*) from public.stel_autorizaciones where estado='VIGENTE')<>1 then raise exception 'Una autorización vigente'; end if;
end $$;
-- Una relectura del PDF no pisa lo revisado y autorizado.
select pg_temp.espera_error($$select 1/0 from public.stel_cola_enviar('[{"clave":"9001|123456|2026-10-22","estado":"REVISAR","plan":{"lineas":[]}}]') where accion<>'sin_cambios'$$,'division by zero');
do $$ begin if (select plan->'obra'->>'codigo' from public.stel_cola where id='00000000-0000-0000-0000-000000000001')<>'PRY09999' then raise exception 'La relectura pisó la revisión'; end if; end $$;
-- Corregir de nuevo anula la autorización vigente y devuelve el albarán a REVISAR.
select * from public.stel_revision_guardar('00000000-0000-0000-0000-000000000001',
  (select plan||'{"numero":"123.457"}' from public.stel_cola where id='00000000-0000-0000-0000-000000000001'),'[{"campo":"numero"}]',repeat('f',64),
  (select actualizado_en from public.stel_cola where id='00000000-0000-0000-0000-000000000001'),true,null);
do $$ begin
  if (select estado from public.stel_cola where id='00000000-0000-0000-0000-000000000001')<>'REVISAR' then raise exception 'Debía volver a REVISAR'; end if;
  if exists (select 1 from public.stel_autorizaciones where estado='VIGENTE') then raise exception 'La autorización debía anularse'; end if;
end $$;
-- Documento sin identificar y abono: nunca se autoriza, aunque esté revisado.
select * from public.stel_revision_guardar('00000000-0000-0000-0000-000000000002',(select plan from public.stel_cola where id='00000000-0000-0000-0000-000000000002'),'[]',repeat('1',64),(select actualizado_en from public.stel_cola where id='00000000-0000-0000-0000-000000000002'),true,null);
select pg_temp.rechazada('00000000-0000-0000-0000-000000000002',repeat('1',64),'sin identificar.*Abono.*Obra');
-- Un albarán ya creado no se revisa.
select pg_temp.espera_error($$select public.stel_revision_guardar('00000000-0000-0000-0000-000000000003','{"lineas":[]}','[]',repeat('1',64),now(),true,null)$$,'estado CREADO');
-- Llave del robot: solo huella, máximo 12 h, máximo 3 vigentes.
select pg_temp.espera_error($$select public.robot_llave_registrar(repeat('d',64),24)$$,'Llave no válida');
select public.robot_llave_registrar(repeat('d',64),12) > now();
reset role;
do $$ begin
  if (select count(*) from public.stel_sync_log where tipo_sync='AUTORIZACION' and estado='RECHAZADA')<3 then raise exception 'Faltan rechazos en el registro'; end if;
  if (select count(*) from public.stel_sync_log where tipo_sync='AUTORIZACION' and estado='CONCEDIDA' and usuario='11111111-1111-1111-1111-111111111111')<>1 then raise exception 'Falta la autorización en el registro'; end if;
  if (select count(*) from public.stel_sync_log where tipo_sync='REVISION' and cola_id='00000000-0000-0000-0000-000000000001')<>3 then raise exception 'Faltan revisiones en el registro'; end if;
  if (select count(*) from public.stel_revisiones)<>4 then raise exception 'Revisiones: %', (select count(*) from public.stel_revisiones); end if;
end $$;
-- Obras PRYMP en la lista del lector; un código mal formado sigue rechazado.
insert into public.lector_obras (codigo, nombre, origen) values ('PRYMP0012','MANTENIMIENTO FICTICIO','lista');
select pg_temp.espera_error($$insert into public.lector_obras (codigo, nombre, origen) values ('PRYM0012','MAL','lista')$$,'lector_obras_codigo_check');
select 'REVISION_AUTORIZACION OK';
